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
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const lower=v=>String(v??'').trim().toLowerCase();
const txKind=x=>String(x?.type??x?.transaction_type??x?.kind??x?.category??x?.action??'').trim().toLowerCase();
const txRef=x=>String(x?.reference??x?.reference_no??'').trim();
const isPayment=x=>txKind(x)==='payment'||txRef(x).startsWith('PAY-');
const isRefund=x=>['refund','refunded','refund_payment'].includes(txKind(x))||/^(REF|RFD|REFUND)-/i.test(txRef(x))||Number(x?.amount||0)<0;
const shiftStatus=x=>String(x?.status??x?.shift_status??'').trim().toLowerCase();
const shiftActual=x=>x?.actual_closing??x?.closing_balance??x?.actual_balance;
const shiftVariance=x=>Number(x?.variance??x?.difference??0);
const bookingGross=b=>Math.max(0,num(b?.paid_amount),num(b?.snapshot?.finance?.grossPaidHistory));
const bookingActive=b=>!['cancelled','canceled','deleted','refunded'].includes(lower(b?.status));
const safeTrip=t=>t?{id:t.id,trip_code:t.trip_code||'',branch_id:t.branch_id||null,branch_name:t.branch_name||'',from_city:t.from_city||'',to_city:t.to_city||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null,status:t.status||'',price_one_way:Number(t.price_one_way||0),price_no_accommodation:Number(t.price_no_accommodation||0),price_shared:Number(t.price_shared||0),price_private_room:Number(t.price_private_room||0)}:null;

function refundMap(refunds){const m=new Map();for(const r of refunds||[]){const id=String(r.booking_id||'');if(!id)continue;m.set(id,Number(((m.get(id)||0)+Math.max(0,num(r.amount))).toFixed(2)))}return m}
function bookingFinanceRow(b,refundsByBooking){
  const total=Math.max(0,num(b.total_price)),gross=bookingGross(b),refund=Math.max(0,num(refundsByBooking.get(String(b.id))||0)),net=Number((gross-refund).toFixed(2)),paid=Math.max(0,net),remaining=Math.max(0,Number((total-paid).toFixed(2))),credit=Math.max(0,Number((paid-total).toFixed(2)));
  return {id:b.id,booking_number:b.booking_number,branch_id:b.branch_id,status:b.status,financial_status:b.financial_status,total,gross,refund,net,paid,remaining,credit};
}
function bookingFinanceMismatch(x){
  const reasons=[];
  if(x.refund>x.gross+0.001)reasons.push('الاسترداد أكبر من إجمالي التحصيل التاريخي');
  if(x.total<=0.001&&x.refund>0.001)reasons.push('يوجد استرداد على حجز بدون قيمة');
  if(['cancelled','canceled','refunded'].includes(lower(x.status))&&x.gross>0.001&&x.refund>=x.gross-0.001&&lower(x.financial_status)!=='refunded')reasons.push('الحجز مسترد بالكامل لكن الحالة المالية لا تعكس ذلك');
  if(bookingActive(x)&&lower(x.financial_status)==='paid'&&x.remaining>0.001)reasons.push('الحالة المالية مسدد رغم وجود مبلغ متبقٍ');
  return reasons.length?{booking_id:x.id,booking_number:x.booking_number,branch_id:x.branch_id,total_price:x.total,gross_collected:x.gross,refunded_amount:x.refund,net_paid:x.net,status:x.status,financial_status:x.financial_status,reasons}:null;
}
function financialScope(request,actor){const all=elevated(actor),branchId=all?String(new URL(request.url).searchParams.get('branch_id')||'').trim():String(actor?.branch_id||'').trim();return {all,branchId,scope:branchId?`branch_id=eq.${enc(branchId)}&`:''}}

async function executiveBrief(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!elevated(actor)&&!actor?.permissions?.reports&&!actor?.permissions?.finance)return json({error:'Reports permission required'},403);
  const {all,branchId,scope}=financialScope(request,actor);if(!all&&!branchId)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
  try{
    const [bookings,refunds,expenses,trips,failed]=await Promise.all([
      rows(env,'bookings',`${scope}select=id,booking_number,branch_id,status,financial_status,total_price,paid_amount,snapshot,created_at,trip_id&limit=5000`),
      rows(env,'booking_refunds',`${scope}status=eq.completed&select=id,booking_id,booking_number,branch_id,amount,status&limit=5000`),
      rows(env,'expenses',`${scope}select=id,branch_id,amount,expense_date,trip_id&limit=5000`),
      rows(env,'trips',`${scope}select=id,trip_code,departure_date,status,bus_capacity,remaining_seats,branch_id&limit=1000`),
      rows(env,'notifications',`${scope}status=eq.failed&select=id,branch_id&limit=1000`)
    ]);
    const rmap=refundMap(refunds),financeRows=bookings.map(b=>bookingFinanceRow(b,rmap));
    const revenue=Number(financeRows.reduce((n,x)=>n+x.total,0).toFixed(2));
    const grossCollected=Number(financeRows.reduce((n,x)=>n+x.gross,0).toFixed(2));
    const refunded=Number(refunds.reduce((n,x)=>n+Math.max(0,num(x.amount)),0).toFixed(2));
    const netCollected=Number((grossCollected-refunded).toFixed(2));
    const expense=Number(expenses.reduce((n,x)=>n+Math.max(0,num(x.amount)),0).toFixed(2));
    const outstanding=Number(financeRows.filter(x=>bookingActive(x)).reduce((n,x)=>n+x.remaining,0).toFixed(2));
    const activeNetPaid=Number(financeRows.filter(x=>bookingActive(x)).reduce((n,x)=>n+x.paid,0).toFixed(2));
    const mismatches=financeRows.map(bookingFinanceMismatch).filter(Boolean);
    const today=new Date().toISOString().slice(0,10),upcoming=trips.filter(t=>t.departure_date>=today&&!['cancelled','completed','closed'].includes(lower(t.status))).sort((a,b)=>String(a.departure_date).localeCompare(String(b.departure_date))).slice(0,10);
    const warnings=[];if(outstanding>0)warnings.push(`متبقي تحصيل ${outstanding.toFixed(2)}`);if(refunded>0)warnings.push(`استردادات مكتملة ${refunded.toFixed(2)}`);if(mismatches.length)warnings.push(`${mismatches.length} حالة عدم تطابق مالي`);if(failed.length)warnings.push(`${failed.length} إشعار فشل`);
    return json({bookings:bookings.length,revenue,paid:grossCollected,gross_collected:grossCollected,refunded,refund_total:refunded,net:netCollected,net_collected:netCollected,active_net_paid:activeNetPaid,outstanding,expenses:expense,net_after_expenses:Number((netCollected-expense).toFixed(2)),upcoming,warnings,financial_mismatches:mismatches.length,generated_at:new Date().toISOString()});
  }catch(e){return json({error:e?.message||'تعذر تحميل الملخص المالي الموحد.'},502)}
}

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
  const {all,branchId,scope}=financialScope(request,actor);if(!all&&!branchId)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
  try{
    const [transactions,expenses,registers,bookings,completedRefunds]=await Promise.all([
      rows(env,'transactions',`${scope}select=*&order=created_at.desc&limit=2000`),
      rows(env,'expenses',`${scope}select=*&limit=2000`),
      rows(env,'cash_registers',`${scope}select=*&limit=500`),
      rows(env,'bookings',`${scope}select=id,booking_number,branch_id,status,financial_status,total_price,paid_amount,snapshot&limit=5000`),
      rows(env,'booking_refunds',`${scope}status=eq.completed&select=id,booking_id,booking_number,branch_id,amount,status,completed_at,created_at&limit=5000`)
    ]);
    const regIds=registers.map(x=>String(x.id)).filter(Boolean);
    const shifts=regIds.length?await rows(env,'cash_shifts',`register_id=in.(${regIds.join(',')})&select=*&limit=1000`):[];
    const posted=transactions.filter(x=>String(x.status||'posted').toLowerCase()==='posted');
    const pending=transactions.filter(x=>String(x.status||'').toLowerCase()==='pending');
    const payments=posted.filter(isPayment);
    const txRefunds=posted.filter(x=>!isPayment(x)&&isRefund(x));
    const otherIn=posted.filter(x=>!isPayment(x)&&!isRefund(x)&&Number(x.amount||0)>0);
    const now=Date.now();
    const stalePending=pending.filter(x=>{const t=Date.parse(x.created_at||'');return Number.isFinite(t)&&now-t>10*60*1000});
    const openShifts=shifts.filter(x=>shiftStatus(x)==='open');
    const closedMissingActual=shifts.filter(x=>shiftStatus(x)==='closed'&&(shiftActual(x)===null||shiftActual(x)===undefined));
    const varianceShifts=shifts.filter(x=>Math.abs(shiftVariance(x))>0.01);
    const paymentsWithoutReceipt=payments.filter(x=>!txRef(x).startsWith('PAY-'));
    const duplicateRefs=[];const refCount=new Map();for(const x of transactions){const r=txRef(x);if(!r)continue;refCount.set(r,(refCount.get(r)||0)+1)}for(const [reference,count] of refCount)if(count>1)duplicateRefs.push({reference,count});
    const rmap=refundMap(completedRefunds),financeRows=bookings.map(b=>bookingFinanceRow(b,rmap)),bookingMismatches=financeRows.map(bookingFinanceMismatch).filter(Boolean);
    const collected=Number(financeRows.reduce((n,x)=>n+x.gross,0).toFixed(2)),refundTotal=Number(completedRefunds.reduce((n,x)=>n+Math.max(0,num(x.amount)),0).toFixed(2)),netCollected=Number((collected-refundTotal).toFixed(2)),expenseTotal=sum(expenses),netMovement=Number((netCollected-expenseTotal).toFixed(2));
    const transactionCollected=sum(payments),transactionRefundTotal=Number(txRefunds.reduce((n,x)=>n+Math.abs(Number(x.amount||0)),0).toFixed(2));
    return json({ok:true,scope:{all_branches:all&&!branchId,branch_id:branchId||null},summary:{posted_payments:payments.length,collected,refunds:completedRefunds.length,refund_total:refundTotal,net_collected:netCollected,expenses:expenses.length,expense_total:expenseTotal,net_movement:netMovement,transaction_collected:transactionCollected,transaction_refund_total:transactionRefundTotal,other_inflow:sum(otherIn),open_shifts:openShifts.length,registers:registers.length,pending_transactions:pending.length},anomalies:{booking_finance_mismatches:bookingMismatches,stale_pending_transactions:stalePending,payments_without_receipt:paymentsWithoutReceipt,duplicate_references:duplicateRefs,closed_shifts_missing_actual:closedMissingActual,shift_variances:varianceShifts},generated_at:new Date().toISOString()});
  }catch(e){return json({error:e?.message||'تعذر إجراء المطابقة المالية.'},502)}
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/finance/reconcile'&&request.method==='GET')return reconcile(request,env);
  if(u.pathname==='/api/mega'&&u.searchParams.get('action')==='executive_brief')return executiveBrief(request,env);
  if(u.pathname==='/api/return-trip-options'&&request.method==='GET')return returnTripOptions(request,env);
  if(u.pathname==='/api/return-trip-info'&&request.method==='GET')return returnTripInfo(request,env);
  if(u.pathname==='/api/customer/book'&&request.method==='POST')return guardCrossBranchCreate(request,env,ctx);
  if(u.pathname==='/api/admin'&&request.method==='POST'){
    const payload=await request.clone().json().catch(()=>null);
    if(payload?.action==='update_booking'&&payload?.cross_branch_return===true)return crossBranchBookingUpdate(request,env,ctx,payload);
  }
  return appWorker.fetch(request,env,ctx)
}};
