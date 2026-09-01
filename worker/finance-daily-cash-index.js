import appWorker from './finance-collection-followup-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const elevated=u=>!!u&&(low(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranchesFinance===true);
const financeAccess=u=>!!u&&(elevated(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.viewPayments===true||u.permissions?.reports===true);
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:dbHeaders(env)}),b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function windowOf(body){const from=iso(body?.from),to=iso(body?.to);if(!from||!to)throw Object.assign(new Error('فترة التقرير غير صالحة.'),{status:400});const ms=new Date(to)-new Date(from);if(ms<=0||ms>8*86400000)throw Object.assign(new Error('فترة التقرير يجب أن تكون موجبة ولا تتجاوز 8 أيام.'),{status:400});return {from,to}}
async function paymentEvents(env,me,from,to){
  const branch=elevated(me)?'':`&branch_id=eq.${enc(me.branch_id)}`;
  const q=`action=eq.payment_collected${branch}&created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=id,created_at,actor_id,actor_name,actor_role,branch_id,entity_id,metadata&order=created_at.desc&limit=3000`;
  return rows(env,'activity_events',q);
}

export default {async fetch(request,env,ctx){
  const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);
  const body=await request.clone().json().catch(()=>({}));if(txt(body?.action)!=='finance_daily_payment_events')return appWorker.fetch(request,env,ctx);
  const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);if(!financeAccess(me))return json({error:'لا توجد صلاحية لعرض صندوق اليوم'},403);
  try{const {from,to}=windowOf(body),events=await paymentEvents(env,me,from,to);return json({ok:true,rows:events,scope:{branch_id:elevated(me)?null:me.branch_id||null,all_branches:elevated(me)},from,to})}
  catch(e){return json({error:e.message||'تعذر قراءة تحصيلات اليوم'},e.status||500)}
}};
