import appWorker from './trip-closure-gate-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const elevated=u=>!!u&&(low(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranchesFinance===true);
const financeAccess=u=>!!u&&(elevated(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.viewPayments===true||u.permissions?.reports===true);
const financeWrite=u=>!!u&&(elevated(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.collectPayments===true||u.permissions?.editBookings===true||u.permissions?.manageBookings===true);
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:dbHeaders(env)}),b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
const enc=v=>encodeURIComponent(String(v??''));
async function booking(env,id){return (await rows(env,'bookings',`id=eq.${enc(id)}&select=id,booking_number,branch_id,total_price,paid_amount,data_environment,customer_name,customer_phone&limit=1`))[0]||null}
function inScope(me,b){return elevated(me)||String(b?.branch_id||'')===String(me?.branch_id||'')}
const allowedStatuses=new Set(['new','contacted','no_answer','follow_up','promised','disputed','paid','closed']);
function cleanDate(v){const s=txt(v);if(!s)return null;const d=new Date(s);return Number.isFinite(d.getTime())?d.toISOString():null}
async function listFollowups(env,me){
 const filter=elevated(me)?'':`&branch_id=eq.${enc(me.branch_id)}`;
 const q=`action=eq.finance_collection_followup${filter}&select=id,created_at,actor_id,actor_name,actor_role,branch_id,entity_id,metadata&order=created_at.desc&limit=1000`;
 return rows(env,'activity_events',q);
}
async function saveFollowup(env,me,b,body){
 const status=allowedStatuses.has(low(body.status))?low(body.status):'new';
 const note=txt(body.notes).slice(0,1500),assignedTo=txt(body.assigned_to).slice(0,160),assignedName=txt(body.assigned_name).slice(0,200);
 const promisedAmount=Math.max(0,Number(body.promised_amount||0)||0),promisedDate=cleanDate(body.promised_date),nextFollow=cleanDate(body.next_follow_up);
 if(status==='promised'&&!promisedDate)throw Object.assign(new Error('تاريخ وعد السداد مطلوب عند اختيار «وعد سداد».'),{status:400});
 if(['follow_up','no_answer'].includes(status)&&!nextFollow)throw Object.assign(new Error('موعد المتابعة القادمة مطلوب لهذه الحالة.'),{status:400});
 const balance=Math.max(0,(Number(b.total_price)||0)-(Number(b.paid_amount)||0));
 const payload={actor_id:txt(me.id),actor_name:txt(me.name||me.username||me.id),actor_role:txt(me.role),branch_id:b.branch_id||me.branch_id||null,action:'finance_collection_followup',entity_type:'booking',entity_id:txt(b.id),metadata:{source:'finance_360',booking_number:b.booking_number||'',data_environment:b.data_environment||null,status,assigned_to:assignedTo||null,assigned_name:assignedName||null,next_follow_up:nextFollow,promised_date:promisedDate,promised_amount:promisedAmount||null,notes:note||null,balance_snapshot:balance,total_snapshot:Number(b.total_price)||0,paid_snapshot:Number(b.paid_amount)||0,customer_name:b.customer_name||null,customer_phone:b.customer_phone||null}};
 const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify([payload])}),out=await readJson(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر حفظ متابعة التحصيل.');return Array.isArray(out)?out[0]:out;
}

export default {async fetch(request,env,ctx){
 const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);
 const body=await request.clone().json().catch(()=>({})),action=txt(body.action);
 if(!['finance_collection_followups','finance_collection_followup_save'].includes(action))return appWorker.fetch(request,env,ctx);
 const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);
 try{
  if(action==='finance_collection_followups'){
   if(!financeAccess(me))return json({error:'لا توجد صلاحية لعرض متابعات التحصيل'},403);
   return json({ok:true,rows:await listFollowups(env,me),can_write:financeWrite(me)});
  }
  if(!financeWrite(me))return json({error:'لا توجد صلاحية لتحديث خطة التحصيل'},403);
  const b=await booking(env,txt(body.booking_id));if(!b)return json({error:'الحجز غير موجود'},404);if(!inScope(me,b))return json({error:'الحجز خارج نطاقك المالي'},403);
  const saved=await saveFollowup(env,me,b,body);return json({ok:true,row:saved});
 }catch(e){return json({error:e.message||'تعذر تنفيذ متابعة التحصيل'},e.status||500)}
}};
