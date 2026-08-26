import appWorker from './wallet-cancellation-index.js';

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
async function insert(env,table,body){const r=await fetch(`${base(env)}/rest/v1/${table}`,{method:'POST',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر إنشاء ${table}`);return Array.isArray(b)?b[0]:b}
async function patch(env,table,query,body){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر تحديث ${table}`);return b}
async function remove(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{method:'DELETE',headers:headers(env)});if(!r.ok){const b=await readJson(r);throw new Error(b?.message||'تعذر التراجع عن حركة المحفظة')}}
async function downstreamAdmin(request,env,body){const r=await appWorker.fetch(new Request(new URL('/api/admin',request.url),{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env);const b=await readJson(r);return {ok:r.ok,status:r.status,body:b}}
async function walletBalance(env,walletId){const r=await rows(env,'v_customer_wallet_balances',`wallet_id=eq.${enc(walletId)}&select=balance&limit=1`);return num(r[0]?.balance)}
async function getBooking(env,bookingNo){return (await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0]||null}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);if(u.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);
 let body={};try{body=await request.clone().json()}catch{return appWorker.fetch(request,env,ctx)}
 const action=String(body?.action||'');if(!['wallet_search','wallet_pay_booking'].includes(action))return appWorker.fetch(request,env,ctx);
 const me=await actor(request,env);if(!me)return json({error:'غير مصرح'},401);
 try{
  if(action==='wallet_search'){
   if(!permitted(me,'viewBookings')&&!permitted(me,'payments')&&!permitted(me,'refunds'))return json({error:'لا توجد صلاحية عرض المحافظ'},403);
   const environment=String(body.data_environment||me.permissions?._accountMode||me.account_mode||'training')==='production'?'production':'training';
   const q=low(body.q);const ws=await rows(env,'customer_wallets',`data_environment=eq.${enc(environment)}&select=*&order=updated_at.desc&limit=500`);
   const filtered=q?ws.filter(w=>[w.customer_name,w.customer_phone,w.customer_identity].some(v=>low(v).includes(q))):ws;
   if(!filtered.length)return json({ok:true,wallets:[]});
   const balances=await rows(env,'v_customer_wallet_balances',`data_environment=eq.${enc(environment)}&select=wallet_id,balance,last_transaction_at&limit=500`);
   const map=new Map(balances.map(x=>[String(x.wallet_id),x]));
   return json({ok:true,wallets:filtered.slice(0,100).map(w=>({...w,balance:num(map.get(String(w.id))?.balance),last_transaction_at:map.get(String(w.id))?.last_transaction_at||null}))});
  }
  if(!permitted(me,'payments'))return json({error:'لا توجد صلاحية استخدام رصيد المحفظة في التحصيل'},403);
  const bookingNo=String(body.booking_number||'').trim(),amount=num(body.amount),targetPaid=num(body.target_paid);if(!bookingNo)return json({error:'رقم الحجز مطلوب'},400);if(!(amount>0))return json({error:'مبلغ خصم المحفظة غير صالح'},400);
  const b=await getBooking(env,bookingNo);if(!b)return json({error:'الحجز غير موجود'},404);if(!String(b.customer_identity||'').trim())return json({error:'الحجز لا يحتوي على هوية عميل لربط المحفظة'},400);
  const environment=b.data_environment||'training';const ws=await rows(env,'customer_wallets',`customer_identity=eq.${enc(b.customer_identity)}&data_environment=eq.${enc(environment)}&select=*&limit=1`),w=ws[0];if(!w)return json({error:'لا توجد محفظة لهذا العميل'},400);
  const balance=await walletBalance(env,w.id);if(amount>balance+0.001)return json({error:`رصيد المحفظة غير كافٍ. المتاح ${balance.toFixed(2)} ريال`,balance},400);
  const key=String(body.idempotency_key||`wallet-pay-${b.id}-${Math.round(targetPaid*100)}-${Math.round(amount*100)}`).slice(0,160);
  const old=(await rows(env,'wallet_transactions',`idempotency_key=eq.${enc(key)}&select=*&limit=1`))[0];if(old?.status==='posted')return json({ok:true,duplicate:true,wallet_transaction:old,balance:await walletBalance(env,w.id)});
  const ts=new Date().toISOString();let wt=old;
  if(!wt)wt=await insert(env,'wallet_transactions',{wallet_id:w.id,booking_id:b.id,transaction_type:'debit',amount,status:'pending',reason:`دفع حجز ${bookingNo} من المحفظة`,reference_no:String(body.reference||'').trim()||`WALPAY-${Date.now()}`,idempotency_key:key,created_by:String(me.name||me.id||''),metadata:{booking_number:bookingNo,target_paid:targetPaid,source:'booking_editor'},data_environment:environment});
  const paidResult=await downstreamAdmin(request,env,{action:'update_booking',booking:{number:bookingNo,paidAmount:targetPaid,paymentMethod:'wallet',paymentReference:wt.reference_no}});
  if(!paidResult.ok){if(!old)await remove(env,'wallet_transactions',`id=eq.${enc(wt.id)}&status=eq.pending`).catch(()=>{});return json({error:paidResult.body?.error||'تعذر تسجيل دفع المحفظة على الحجز'},paidResult.status||500)}
  await patch(env,'wallet_transactions',`id=eq.${enc(wt.id)}`,{status:'posted',metadata:{...(wt.metadata||{}),posted_at:ts,payment_receipt:paidResult.body?.payment_receipt||null}});
  await insert(env,'activity_events',{actor_id:String(me.id||''),actor_name:String(me.name||''),actor_role:String(me.role||''),branch_id:b.branch_id,entity_type:'wallet_transaction',entity_id:String(wt.id),action:'wallet_booking_payment',metadata:{booking_number:bookingNo,amount,target_paid:targetPaid,wallet_id:w.id},created_at:ts}).catch(()=>{});
  return json({ok:true,wallet_transaction:{...wt,status:'posted'},balance:await walletBalance(env,w.id),payment_receipt:paidResult.body?.payment_receipt||null});
 }catch(e){return json({error:e?.message||'تعذر تنفيذ عملية المحفظة'},500)}
}};
