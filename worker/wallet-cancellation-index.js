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
async function rpc(env,name,body){const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||b?.hint||'تعذر تنفيذ العملية');return b}
async function downstreamAdmin(request,env,body){const r=await appWorker.fetch(new Request(new URL('/api/admin',request.url),{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env);const b=await readJson(r);return {ok:r.ok,status:r.status,body:b}}
async function getBooking(env,bookingNo){return (await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0]||null}
async function walletBalance(env,walletId){const r=await rows(env,'v_customer_wallet_balances',`wallet_id=eq.${enc(walletId)}&select=balance&limit=1`);return num(r[0]?.balance)}
async function cancellationQuote(request,env,bookingNo){
 const b=await getBooking(env,bookingNo);if(!b)return {error:'الحجز غير موجود',status:404};
 const q=await downstreamAdmin(request,env,{action:'refund_quote',booking_number:bookingNo});if(!q.ok)return {error:q.body?.error||'تعذر حساب التسوية',status:q.status};
 let wallet={balance:0};
 if(b.customer_identity){const ws=await rows(env,'customer_wallets',`customer_identity=eq.${enc(b.customer_identity)}&data_environment=eq.${enc(b.data_environment||'training')}&select=id&limit=1`);if(ws[0])wallet={wallet_id:ws[0].id,balance:await walletBalance(env,ws[0].id)}}
 return {booking:b,refund:q.body,wallet,settlement_due:num(q.body?.available_refund),status:200};
}

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
   const manager=me.role==='developer'||me.role==='مدير عام'||me.permissions?.all===true||me.permissions?.allBranchesFinance===true;
   const canApprove=manager||me.permissions?.refund_approve===true||(me.permissions?.refunds===true&&me.permissions?.approvals===true);
   const canComplete=manager||me.permissions?.refund_complete===true||me.permissions?.refunds===true;
   const canDirect=canApprove&&canComplete;
   const canWallet=canDirect;
   if(action==='cancel_quote')return json({ok:true,booking:{id:b.id,booking_number:b.booking_number,status:b.status,customer_name:b.customer_name,customer_phone:b.customer_phone,customer_identity:b.customer_identity,total_price:num(b.total_price),paid_amount:num(b.paid_amount),financial_status:b.financial_status},refunded_amount:num(quote.refund?.refunded_amount),settlement_due:due,wallet_balance:num(quote.wallet?.balance),capabilities:{cancel:true,direct_refund:canDirect,wallet_credit:canWallet}});

   const preset=String(body.reason||'').trim(),other=String(body.reason_other||'').trim();const reason=preset==='other'?other:preset;if(!reason)return json({error:'سبب الإلغاء إلزامي'},400);
   const mode=String(body.settlement_mode||'none').trim();
   if(due>0.001&&!['direct_refund','wallet'].includes(mode))return json({error:'اختر طريقة تسوية المبلغ المستحق للعميل'},400);
   if(mode==='direct_refund'&&!canDirect)return json({error:'الاسترداد المباشر يحتاج صلاحية الاسترداد والتنفيذ'},403);
   if(mode==='wallet'&&!canWallet)return json({error:'إضافة الرصيد للمحفظة تحتاج صلاحية مالية'},403);
   const method=String(body.refund_method||'cash').trim();
   const allowedMethods=new Set(['cash','bank_transfer','mada','card','same_method','other']);
   if(mode==='direct_refund'&&!allowedMethods.has(method))return json({error:'طريقة الاسترداد غير مدعومة'},400);
   if(mode==='wallet'&&!String(b.customer_identity||'').trim())return json({error:'لا يمكن التحويل للمحفظة لأن هوية العميل غير مسجلة بالحجز'},400);

   const clientKey=String(body.client_request_id||`cancel-settle-${b.id}-v${Number(b.version_no||0)}-${mode}-${Math.round(due*100)}`).slice(0,180);
   const out=await rpc(env,'almaher_cancel_booking_settle_atomic',{
    p_booking_number:b.booking_number,
    p_reason:reason,
    p_settlement_mode:due>0.001?mode:'none',
    p_refund_method:method,
    p_client_request_id:clientKey,
    p_actor_id:String(me.id||''),
    p_actor_name:String(me.name||me.id||''),
    p_actor_role:String(me.role||'')
   });
   return json(out);
  }catch(e){
   const m=String(e?.message||'تعذر تنفيذ عملية الإلغاء');
   if(m.includes('SETTLEMENT_REQUIRED'))return json({error:'يوجد مبلغ مستحق للعميل ويجب اختيار طريقة التسوية قبل الإلغاء'},409);
   if(m.includes('INVALID_REFUND_METHOD'))return json({error:'طريقة الاسترداد غير مدعومة'},400);
   if(m.includes('CUSTOMER_IDENTITY_REQUIRED_FOR_WALLET'))return json({error:'لا يمكن التحويل للمحفظة لأن هوية العميل غير مسجلة بالحجز'},400);
   if(m.includes('BOOKING_NOT_FOUND'))return json({error:'الحجز غير موجود'},404);
   return json({error:m},500);
  }
 }
};
