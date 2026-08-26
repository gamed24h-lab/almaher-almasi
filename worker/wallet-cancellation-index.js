import appWorker from './executive-brief-schema-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const num=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
const low=v=>String(v??'').trim().toLowerCase();
const permitted=(u,key)=>!!u&&(u.role==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.[key]===true);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await readJson(r);return b?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
async function patch(env,table,query,body){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر تحديث ${table}`);return b}
async function insert(env,table,body){const r=await fetch(`${base(env)}/rest/v1/${table}`,{method:'POST',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر إنشاء ${table}`);return Array.isArray(b)?b[0]:b}
async function remove(env,table,query){await fetch(`${base(env)}/rest/v1/${table}?${query}`,{method:'DELETE',headers:headers(env)}).catch(()=>{})}
async function downstreamAdmin(request,env,body){const r=await appWorker.fetch(new Request(new URL('/api/admin',request.url),{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env);const b=await readJson(r);return {ok:r.ok,status:r.status,body:b}}
async function getBooking(env,bookingNo){return (await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0]||null}
async function walletAccount(env,b){const environment=b.data_environment||'training';let w=(await rows(env,'customer_wallets',`customer_identity=eq.${enc(b.customer_identity)}&data_environment=eq.${enc(environment)}&select=*&limit=1`))[0];if(w)return w;try{return await insert(env,'customer_wallets',{customer_identity:b.customer_identity,customer_phone:b.customer_phone||null,customer_name:b.customer_name||null,data_environment:environment})}catch{w=(await rows(env,'customer_wallets',`customer_identity=eq.${enc(b.customer_identity)}&data_environment=eq.${enc(environment)}&select=*&limit=1`))[0];if(!w)throw new Error('تعذر إنشاء محفظة العميل');return w}}
async function walletBalance(env,walletId){const r=await rows(env,'v_customer_wallet_balances',`wallet_id=eq.${enc(walletId)}&select=balance&limit=1`);return num(r[0]?.balance)}
async function cancellationQuote(request,env,bookingNo){const b=await getBooking(env,bookingNo);if(!b)return {error:'الحجز غير موجود',status:404};const q=await downstreamAdmin(request,env,{action:'refund_quote',booking_number:bookingNo});if(!q.ok)return {error:q.body?.error||'تعذر حساب التسوية',status:q.status};let wallet={balance:0};if(b.customer_identity){const ws=await rows(env,'customer_wallets',`customer_identity=eq.${enc(b.customer_identity)}&data_environment=eq.${enc(b.data_environment||'training')}&select=id&limit=1`);if(ws[0])wallet={wallet_id:ws[0].id,balance:await walletBalance(env,ws[0].id)}}return {booking:b,refund:q.body,wallet,settlement_due:num(q.body?.available_refund),status:200}}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);
  let body={};try{body=await request.clone().json()}catch{return appWorker.fetch(request,env,ctx)}
  const action=String(body?.action||'');
  if(!['cancel_quote','cancel_booking_settle','wallet_get'].includes(action))return appWorker.fetch(request,env,ctx);
  const me=await actor(request,env);if(!me)return json({error:'غير مصرح'},401);
  try{
   if(action==='wallet_get'){
    if(!permitted(me,'viewBookings')&&!permitted(me,'payments')&&!permitted(me,'refunds'))return json({error:'لا توجد صلاحية عرض المحفظة'},403);
    let identity=String(body.customer_identity||'').trim(),booking=null;
    if(!identity&&body.booking_number){booking=await getBooking(env,String(body.booking_number));identity=String(booking?.customer_identity||'').trim()}
    if(!identity)return json({ok:true,balance:0,transactions:[],wallet:null});
    const environment=booking?.data_environment||String(body.data_environment||me.account_mode||'training');
    const ws=await rows(env,'customer_wallets',`customer_identity=eq.${enc(identity)}&data_environment=eq.${enc(environment)}&select=*&limit=1`),w=ws[0];
    if(!w)return json({ok:true,balance:0,transactions:[],wallet:null});
    const tx=await rows(env,'wallet_transactions',`wallet_id=eq.${enc(w.id)}&select=*&order=created_at.desc&limit=200`);
    return json({ok:true,wallet:w,balance:await walletBalance(env,w.id),transactions:tx});
   }
   if(!permitted(me,'cancelBookings'))return json({error:'لا توجد صلاحية إلغاء الحجوزات'},403);
   const bookingNo=String(body.booking_number||body.bookingNo||'').trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب'},400);
   const quote=await cancellationQuote(request,env,bookingNo);if(quote.error)return json({error:quote.error},quote.status);
   const b=quote.booking,due=quote.settlement_due;
   const canDirect=permitted(me,'refunds')||permitted(me,'refund_complete');
   const canWallet=canDirect||permitted(me,'walletCredit');
   if(action==='cancel_quote')return json({ok:true,booking:{id:b.id,booking_number:b.booking_number,status:b.status,customer_name:b.customer_name,customer_phone:b.customer_phone,customer_identity:b.customer_identity,total_price:num(b.total_price),paid_amount:num(b.paid_amount),financial_status:b.financial_status},refunded_amount:num(quote.refund?.refunded_amount),settlement_due:due,wallet_balance:num(quote.wallet?.balance),capabilities:{cancel:true,direct_refund:canDirect,wallet_credit:canWallet}});

   const preset=String(body.reason||'').trim(),other=String(body.reason_other||'').trim();const reason=preset==='other'?other:preset;if(!reason)return json({error:'سبب الإلغاء إلزامي'},400);
   const mode=String(body.settlement_mode||'none');
   if(due>0.001&&!['direct_refund','wallet'].includes(mode))return json({error:'اختر طريقة تسوية المبلغ المستحق للعميل'},400);
   if(mode==='direct_refund'&&!canDirect)return json({error:'الاسترداد المباشر يحتاج صلاحية الاسترداد والتنفيذ'},403);
   if(mode==='wallet'&&!canWallet)return json({error:'إضافة الرصيد للمحفظة تحتاج صلاحية مالية'},403);
   const ts=new Date().toISOString();
   // Cancel through the existing atomic booking path first, so trip capacity is released safely.
   if(!['cancelled','canceled'].includes(low(b.status))){
    const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};
    const cancelled=await downstreamAdmin(request,env,{action:'update_booking',booking:{number:b.booking_number,versionNo:Number(b.version_no||0),status:'cancelled',paidAmount:num(b.paid_amount),snapshot:{...snap,cancellationReason:reason,cancelledAt:ts,cancelledBy:String(me.name||me.id||''),cancellationSettlementMode:mode}}});
    if(!cancelled.ok)return json({error:cancelled.body?.error||'تعذر إلغاء الحجز'},cancelled.status);
   }
   await patch(env,'bookings',`id=eq.${enc(b.id)}`,{cancellation_reason:reason}).catch(()=>{});
   await patch(env,'seat_assignments',`booking_id=eq.${enc(b.id)}&status=in.(assigned,hold)`,{status:'released',updated_at:ts}).catch(()=>{});
   await patch(env,'room_assignments',`booking_id=eq.${enc(b.id)}&status=eq.assigned`,{status:'cancelled',cancelled_at:ts,cancellation_reason:reason}).catch(()=>{});

   let settlement={mode:'none',amount:0};
   if(due>0.001&&mode==='direct_refund'){
    const rr=await downstreamAdmin(request,env,{action:'refund_request',booking_number:b.booking_number,amount:due,reason:`إلغاء الحجز — ${reason}`,refund_method:String(body.refund_method||'cash'),direct_execute:true,cancel_booking:false,client_request_id:`cancel-direct-${b.id}-${Math.round(due*100)}`});
    if(!rr.ok||rr.body?.status!=='completed')return json({ok:false,cancelled:true,settlement_pending:true,error:rr.body?.error||'تم إلغاء الحجز لكن تعذر تنفيذ الاسترداد مباشرة. يمكن إكماله من شاشة الاسترداد.',refund:rr.body},409);
    settlement={mode:'direct_refund',amount:due,receipt_no:rr.body?.receipt_no||null,status:'completed'};
   }
   if(due>0.001&&mode==='wallet'){
    const w=await walletAccount(env,b),key=`cancel-wallet-${b.id}-${Math.round(due*100)}`;
    const old=(await rows(env,'wallet_transactions',`idempotency_key=eq.${enc(key)}&select=*&limit=1`))[0];
    let wt=old;
    if(!wt)wt=await insert(env,'wallet_transactions',{wallet_id:w.id,booking_id:b.id,transaction_type:'credit',amount:due,status:'pending',reason:`إلغاء الحجز — ${reason}`,reference_no:`WAL-${Date.now()}`,idempotency_key:key,created_by:String(me.name||me.id||''),metadata:{booking_number:b.booking_number,cancellation_reason:reason},data_environment:b.data_environment||'training'});
    if(wt.status!=='posted'){
     const rr=await downstreamAdmin(request,env,{action:'refund_request',booking_number:b.booking_number,amount:due,reason:`تحويل مستحق الإلغاء إلى المحفظة — ${reason}`,refund_method:'wallet',direct_execute:true,cancel_booking:false,client_request_id:key});
     if(!rr.ok||rr.body?.status!=='completed'){if(!old)await remove(env,'wallet_transactions',`id=eq.${enc(wt.id)}&status=eq.pending`);return json({ok:false,cancelled:true,settlement_pending:true,error:rr.body?.error||'تم إلغاء الحجز لكن تعذر تحويل المستحق إلى المحفظة.',refund:rr.body},409)}
     await patch(env,'wallet_transactions',`id=eq.${enc(wt.id)}`,{status:'posted',metadata:{...(wt.metadata||{}),refund_receipt_no:rr.body?.receipt_no||null,posted_at:ts}});
    }
    settlement={mode:'wallet',amount:due,wallet_id:w.id,wallet_balance:await walletBalance(env,w.id),status:'completed'};
   }
   await insert(env,'activity_events',{actor_id:String(me.id||''),actor_name:String(me.name||''),actor_role:String(me.role||''),branch_id:b.branch_id,entity_type:'booking',entity_id:String(b.id),action:'booking_cancelled_settled',metadata:{booking_number:b.booking_number,reason,settlement},created_at:ts}).catch(()=>{});
   return json({ok:true,cancelled:true,booking_number:b.booking_number,reason,settlement});
  }catch(e){return json({error:e?.message||'تعذر تنفيذ عملية الإلغاء'},500)}
 }
};
