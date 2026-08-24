import appWorker from './payment-ledger-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all||a.permissions?.allBranchesFinance);
const allReturnBranches=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all||a.permissions?.allBranches);
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const canReconcile=a=>{if(!a)return false;if(elevated(a))return true;const p=a.permissions||{};if(hasOwn(p,'reconcileFinance'))return p.reconcileFinance===true;return !!(p.finance||p.reports)};
const canReadBookings=a=>!!a&&(allReturnBranches(a)||a.permissions?.branchBooking||a.permissions?.viewBookings||a.permissions?.editBookings||a.permissions?.changeTrip||a.permissions?.printTickets||a.permissions?.bookings);
const canCrossBranchReturn=a=>!!a&&(allReturnBranches(a)||(a.permissions?.crossBranchReturn===true&&a.permissions?.changeTrip===true));
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}
const sum=(arr,key='amount')=>Number(arr.reduce((n,x)=>n+Number(x?.[key]||0),0).toFixed(2));
const txKind=x=>String(x?.type??x?.transaction_type??x?.kind??x?.category??x?.action??'').trim().toLowerCase();
const txRef=x=>String(x?.reference??x?.reference_no??'').trim();
const isPayment=x=>txKind(x)==='payment'||txRef(x).startsWith('PAY-');
const isRefund=x=>['refund','refunded','refund_payment'].includes(txKind(x))||/^(REF|RFD|REFUND)-/i.test(txRef(x))||Number(x?.amount||0)<0;
const shiftStatus=x=>String(x?.status??x?.shift_status??'').trim().toLowerCase();
const shiftActual=x=>x?.actual_closing??x?.closing_balance??x?.actual_balance;
const shiftVariance=x=>Number(x?.variance??x?.difference??0);
const safeTrip=t=>t?{id:t.id,trip_code:t.trip_code||'',branch_id:t.branch_id||null,branch_name:t.branch_name||'',from_city:t.from_city||'',to_city:t.to_city||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null,status:t.status||'',price_one_way:Number(t.price_one_way||0),price_no_accommodation:Number(t.price_no_accommodation||0),price_shared:Number(t.price_shared||0),price_private_room:Number(t.price_private_room||0)}:null;

async function returnTripOptions(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canCrossBranchReturn(actor))return json({error:'اختيار عودة من فرع آخر يتطلب الصلاحية المستقلة المخصصة لذلك.'},403);
  try{
    const [list,branches]=await Promise.all([
      rows(env,'trips','select=id,trip_code,branch_id,from_city,to_city,departure_date,departure_time,return_date,return_time,status,price_one_way,price_no_accommodation,price_shared,price_private_room&order=return_date.asc&limit=1000'),
      rows(env,'branches','select=id,name&limit=500')
    ]);
    const branchMap=new Map(branches.map(b=>[String(b.id),b.name||'']));
    const today=new Date().toISOString().slice(0,10);
    const trips=list.filter(t=>t.return_date&&String(t.return_date)>=today&&!['cancelled','completed'].includes(String(t.status||'').toLowerCase())).map(t=>safeTrip({...t,branch_name:branchMap.get(String(t.branch_id))||''}));
    return json({ok:true,trips});
  }catch(e){return json({error:e?.message||'تعذر تحميل رحلات العودة.'},502)}
}

async function returnTripInfo(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canReadBookings(actor))return json({error:'لا توجد صلاحية عرض بيانات الحجز.'},403);
  const u=new URL(request.url),bookingNo=String(u.searchParams.get('booking_number')||'').trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
  try{
    const booking=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=id,branch_id,return_trip_id,journey_mode&limit=1`))[0];
    if(!booking)return json({error:'الحجز غير موجود.'},404);
    if(!allReturnBranches(actor)&&String(booking.branch_id||'')!==String(actor.branch_id||''))return json({error:'الحجز خارج فرعك.'},403);
    if(!booking.return_trip_id)return json({ok:true,trip:null});
    const trip=(await rows(env,'trips',`id=eq.${enc(booking.return_trip_id)}&select=id,trip_code,branch_id,from_city,to_city,departure_date,departure_time,return_date,return_time,status,price_one_way,price_no_accommodation,price_shared,price_private_room&limit=1`))[0];
    return json({ok:true,trip:safeTrip(trip)});
  }catch(e){return json({error:e?.message||'تعذر تحميل رحلة العودة المرتبطة بالحجز.'},502)}
}

async function crossBranchBookingUpdate(request,env,ctx,payload){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  const b=payload?.booking||{},bookingNo=String(b.number||b.booking_number||'').trim(),targetId=String(b.returnTripId||'').trim();
  if(!bookingNo||!targetId||String(b.journeyMode||'').toLowerCase()!=='separate')return json({error:'بيانات رحلة العودة المنفصلة غير مكتملة.'},400);
  try{
    const current=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id,trip_id,return_trip_id,journey_mode,snapshot&limit=1`))[0];
    if(!current)return json({error:'الحجز غير موجود.'},404);
    const all=allReturnBranches(actor);
    if(!all&&String(current.branch_id||'')!==String(actor.branch_id||''))return json({error:'لا يمكن تعديل حجز تابع لفرع آخر.'},403);
    const target=(await rows(env,'trips',`id=eq.${enc(targetId)}&select=id,branch_id,return_date,return_time,status&limit=1`))[0];
    if(!target)return json({error:'رحلة العودة المختارة غير موجودة.'},400);
    if(['cancelled','completed'].includes(String(target.status||'').toLowerCase()))return json({error:'رحلة العودة المختارة غير متاحة.'},400);
    if(!target.return_date)return json({error:'رحلة العودة المختارة لا تحتوي على تاريخ عودة.'},400);
    const primaryId=String(b.tripId||current.trip_id||'');if(primaryId===targetId)return json({error:'رحلة العودة المنفصلة يجب أن تكون مختلفة عن رحلة الذهاب.'},400);
    const unchanged=String(current.return_trip_id||'')===targetId;
    const crossBranch=!all&&String(target.branch_id||'')!==String(actor.branch_id||'');
    if(crossBranch&&!unchanged&&!canCrossBranchReturn(actor))return json({error:'اختيار عودة من فرع آخر يتطلب صلاحية «اختيار عودة من فرع آخر» مع صلاحية تغيير الرحلة.'},403);
    if(!crossBranch)return appWorker.fetch(request,env,ctx);

    const forwarded=JSON.parse(JSON.stringify(payload));
    forwarded.cross_branch_return=false;
    forwarded.booking={...forwarded.booking,returnTripId:null};
    const hs=new Headers(request.headers);hs.delete('content-length');
    const downstream=await appWorker.fetch(new Request(request.url,{method:'POST',headers:hs,body:JSON.stringify(forwarded)}),env,ctx);
    if(!downstream.ok)return downstream;

    const patch=await fetch(`${base(env)}/rest/v1/bookings?booking_number=eq.${enc(bookingNo)}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify({return_trip_id:targetId,journey_mode:'separate'})});
    if(!patch.ok){
      await fetch(`${base(env)}/rest/v1/bookings?booking_number=eq.${enc(bookingNo)}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify({return_trip_id:current.return_trip_id||null,journey_mode:current.journey_mode||'oneway',snapshot:current.snapshot||{}})}).catch(()=>{});
      const er=await parse(patch);return json({error:er?.message||er?.details||'تعذر تثبيت رحلة العودة المنفصلة.'},502);
    }
    return downstream;
  }catch(e){return json({error:e?.message||'تعذر حفظ رحلة العودة المنفصلة.'},502)}
}

async function guardCrossBranchCreate(request,env,ctx){
  const payload=await request.clone().json().catch(()=>null),b=payload?.booking||{};
  const targetId=String(b.return_trip_id||b.returnTripId||'').trim(),mode=String(b.journey_mode||b.journeyMode||'').toLowerCase();
  if(mode!=='separate'||!targetId)return appWorker.fetch(request,env,ctx);
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  try{
    const target=(await rows(env,'trips',`id=eq.${enc(targetId)}&select=id,branch_id,return_date,status&limit=1`))[0];
    if(!target)return json({error:'رحلة العودة المختارة غير موجودة.'},400);
    if(!target.return_date||['cancelled','completed'].includes(String(target.status||'').toLowerCase()))return json({error:'رحلة العودة المختارة غير متاحة للعودة.'},400);
    const crossBranch=!allReturnBranches(actor)&&String(target.branch_id||'')!==String(actor.branch_id||'');
    if(crossBranch&&!canCrossBranchReturn(actor))return json({error:'اختيار عودة من فرع آخر يتطلب صلاحية «اختيار عودة من فرع آخر».'},403);
    return appWorker.fetch(request,env,ctx);
  }catch(e){return json({error:e?.message||'تعذر التحقق من رحلة العودة.'},502)}
}

async function reconcile(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canReconcile(actor))return json({error:'لا توجد صلاحية مراجعة المطابقة المالية.'},403);
  const all=elevated(actor),branchId=all?String(new URL(request.url).searchParams.get('branch_id')||'').trim():String(actor.branch_id||'').trim();
  if(!all&&!branchId)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
  const scope=branchId?`branch_id=eq.${enc(branchId)}&`:'';
  try{
    const [transactions,expenses,registers]=await Promise.all([
      rows(env,'transactions',`${scope}select=*&order=created_at.desc&limit=2000`),
      rows(env,'expenses',`${scope}select=*&limit=2000`),
      rows(env,'cash_registers',`${scope}select=*&limit=500`)
    ]);
    const regIds=registers.map(x=>String(x.id)).filter(Boolean);
    const shifts=regIds.length?await rows(env,'cash_shifts',`register_id=in.(${regIds.join(',')})&select=*&limit=1000`):[];
    const posted=transactions.filter(x=>String(x.status||'posted').toLowerCase()==='posted');
    const pending=transactions.filter(x=>String(x.status||'').toLowerCase()==='pending');
    const payments=posted.filter(isPayment);
    const refunds=posted.filter(x=>!isPayment(x)&&isRefund(x));
    const otherIn=posted.filter(x=>!isPayment(x)&&!isRefund(x)&&Number(x.amount||0)>0);
    const now=Date.now();
    const stalePending=pending.filter(x=>{const t=Date.parse(x.created_at||'');return Number.isFinite(t)&&now-t>10*60*1000});
    const openShifts=shifts.filter(x=>shiftStatus(x)==='open');
    const closedMissingActual=shifts.filter(x=>shiftStatus(x)==='closed'&&(shiftActual(x)===null||shiftActual(x)===undefined));
    const varianceShifts=shifts.filter(x=>Math.abs(shiftVariance(x))>0.01);
    const paymentsWithoutReceipt=payments.filter(x=>!txRef(x).startsWith('PAY-'));
    const duplicateRefs=[];const refCount=new Map();for(const x of transactions){const r=txRef(x);if(!r)continue;refCount.set(r,(refCount.get(r)||0)+1)}for(const [reference,count] of refCount)if(count>1)duplicateRefs.push({reference,count});
    const collected=sum(payments),refundTotal=Number(refunds.reduce((n,x)=>n+Math.abs(Number(x.amount||0)),0).toFixed(2)),expenseTotal=sum(expenses),net=Number((collected+sum(otherIn)-refundTotal-expenseTotal).toFixed(2));
    return json({ok:true,scope:{all_branches:all&&!branchId,branch_id:branchId||null},summary:{posted_payments:payments.length,collected,refunds:refunds.length,refund_total:refundTotal,expenses:expenses.length,expense_total:expenseTotal,net_movement:net,open_shifts:openShifts.length,registers:registers.length,pending_transactions:pending.length},anomalies:{stale_pending_transactions:stalePending,payments_without_receipt:paymentsWithoutReceipt,duplicate_references:duplicateRefs,closed_shifts_missing_actual:closedMissingActual,shift_variances:varianceShifts},generated_at:new Date().toISOString()});
  }catch(e){return json({error:e?.message||'تعذر إجراء المطابقة المالية.'},502)}
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/finance/reconcile'&&request.method==='GET')return reconcile(request,env);
  if(u.pathname==='/api/return-trip-options'&&request.method==='GET')return returnTripOptions(request,env);
  if(u.pathname==='/api/return-trip-info'&&request.method==='GET')return returnTripInfo(request,env);
  if(u.pathname==='/api/customer/book'&&request.method==='POST')return guardCrossBranchCreate(request,env,ctx);
  if(u.pathname==='/api/admin'&&request.method==='POST'){
    const payload=await request.clone().json().catch(()=>null);
    if(payload?.action==='update_booking'&&payload?.cross_branch_return===true)return crossBranchBookingUpdate(request,env,ctx,payload);
  }
  return appWorker.fetch(request,env,ctx)
}};
