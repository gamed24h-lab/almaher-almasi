import appWorker from './wallet-payments-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const str=v=>String(v??'').trim();
const elevated=u=>!!u&&(String(u.role||'').toLowerCase()==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranchesFinance===true);
const permitted=(u,key)=>!!u&&(elevated(u)||u.permissions?.[key]===true);
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await readJson(r);return b?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
async function rpc(env,name,body){const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});const b=await readJson(r);if(!r.ok){const raw=String(b?.message||b?.details||b?.hint||'تعذر تنفيذ العملية');throw new Error(raw.replace(/^P0001:\s*/,'').replace(/^.*?:\s*(REFUND_|WALLET_|AMOUNT_|REASON_|METHOD_|BOOKING_)/,'$1'))}return b}
async function refundRow(env,id){return (await rows(env,'booking_refunds',`id=eq.${enc(id)}&select=*&limit=1`))[0]||null}
const inScope=(me,row)=>elevated(me)||String(row?.branch_id||'')===String(me?.branch_id||'');

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(u.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);
 let body={};try{body=await request.clone().json()}catch{return appWorker.fetch(request,env,ctx)}
 const action=String(body?.action||'');
 if(action==='refund_list'){
  const me=await actor(request,env);if(!me)return json({error:'غير مصرح'},401);
  const r=await appWorker.fetch(request,env,ctx),b=await readJson(r);
  if(!r.ok)return json(b,r.status);
  return json({...b,can_edit:permitted(me,'refund_edit'),can_reverse:permitted(me,'refund_reverse'),can_wallet_refund:permitted(me,'wallet_refund')},r.status);
 }
 if(!['refund_edit','refund_reverse','wallet_refund'].includes(action))return appWorker.fetch(request,env,ctx);
 const me=await actor(request,env);if(!me)return json({error:'غير مصرح'},401);
 try{
  if(action==='refund_edit'){
   if(!permitted(me,'refund_edit'))return json({error:'لا توجد صلاحية تعديل الاسترداد'},403);
   const row=await refundRow(env,body.id);if(!row)return json({error:'طلب الاسترداد غير موجود'},404);if(!inScope(me,row))return json({error:'الاسترداد خارج نطاقك المالي'},403);
   const out=await rpc(env,'almaher_refund_edit_atomic',{p_refund_id:row.id,p_amount:Number(body.amount||0),p_reason:str(body.reason),p_refund_method:str(body.refund_method),p_actor_id:str(me.id),p_actor_name:str(me.name||me.id),p_actor_role:str(me.role)});
   return json(out);
  }
  if(action==='refund_reverse'){
   if(!permitted(me,'refund_reverse'))return json({error:'لا توجد صلاحية عكس الاسترداد'},403);
   const row=await refundRow(env,body.id);if(!row)return json({error:'طلب الاسترداد غير موجود'},404);if(!inScope(me,row))return json({error:'الاسترداد خارج نطاقك المالي'},403);
   const reason=str(body.reason);if(!reason)return json({error:'سبب التراجع عن الاسترداد إلزامي'},400);
   const out=await rpc(env,'almaher_refund_reverse_atomic',{p_refund_id:row.id,p_reason:reason,p_actor_id:str(me.id),p_actor_name:str(me.name||me.id),p_actor_role:str(me.role)});
   return json(out);
  }
  if(!permitted(me,'wallet_refund'))return json({error:'لا توجد صلاحية استرداد رصيد المحفظة'},403);
  const identity=str(body.customer_identity),amount=Number(body.amount||0),reason=str(body.reason),method=str(body.refund_method);
  if(!identity)return json({error:'هوية العميل مطلوبة'},400);if(!(amount>0))return json({error:'مبلغ الاسترداد غير صالح'},400);if(!reason)return json({error:'سبب استرداد المحفظة إلزامي'},400);if(!method)return json({error:'طريقة الاسترداد مطلوبة'},400);
  const environment=String(body.data_environment||me.permissions?._accountMode||me.account_mode||'training')==='production'?'production':'training';
  const out=await rpc(env,'almaher_wallet_refund_atomic',{p_customer_identity:identity,p_data_environment:environment,p_amount:amount,p_reason:reason,p_refund_method:method,p_client_request_id:str(body.client_request_id)||`${Date.now()}-${Math.random()}`,p_actor_id:str(me.id),p_actor_name:str(me.name||me.id),p_actor_role:str(me.role)});
  return json(out);
 }catch(e){
  const m=String(e?.message||'تعذر تنفيذ العملية');
  if(m.includes('REFUND_NOT_EDITABLE'))return json({error:'يمكن تعديل طلب الاسترداد قبل التنفيذ فقط'},409);
  if(m.includes('REFUND_NOT_COMPLETED'))return json({error:'يمكن عكس الاسترداد بعد تنفيذه فقط'},409);
  if(m.includes('AMOUNT_EXCEEDS_AVAILABLE'))return json({error:'المبلغ الجديد يتجاوز المتاح للاسترداد'},409);
  if(m.includes('WALLET_BALANCE_INSUFFICIENT_FOR_REVERSE'))return json({error:'لا يمكن عكس هذا الاسترداد لأن جزءًا من رصيد المحفظة تم استخدامه بالفعل'},409);
  if(m.includes('WALLET_AMOUNT_EXCEEDS_BALANCE'))return json({error:'مبلغ الاسترداد من المحفظة أكبر من الرصيد الحالي'},409);
  return json({error:m},500);
 }
}};
