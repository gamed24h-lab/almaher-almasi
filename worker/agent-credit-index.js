import appWorker from './agent-ledger-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||('HTTP '+r.status)}}}
async function actor(request,env,ctx){
 try{
  const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);
  if(!r.ok)return null;
  return (await readJson(r))?.user||null;
 }catch{return null}
}
async function rows(env,table,query){
 const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});
 const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[];
}
async function rpc(env,name,body){
 const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});
 const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||'تعذر تنفيذ العملية');e.code=String(b?.message||'');throw e}return b;
}
const sovereign=u=>!!u&&(lower(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true);
const globalScope=u=>!!u&&(sovereign(u)||u.permissions?.allBranches===true||u.permissions?.allBranchesFinance===true);
const canView=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.reports===true||u.permissions?.refunds===true||u.permissions?.allBranchesFinance===true);
const canPolicy=u=>!!u&&(sovereign(u)||u.permissions?.finance===true);
const canCollections=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true);
const modeOf=u=>lower(u?.account_mode||u?.permissions?._accountMode)==='production'?'production':'training';
const branchOf=u=>text(u?.branch_id||u?.home_branch_id);
const actorId=u=>text(u?.id||u?.user_id||u?.username||u?.email);
const actorName=u=>text(u?.name||u?.full_name||u?.username||u?.email);

async function agentById(env,id){return (await rows(env,'agents','id=eq.'+enc(id)+'&select=*&limit=1'))[0]||null}
function scopeCheck(u,a){
 if(!a)return {ok:false,status:404,error:'الوكيل غير موجود.'};
 if(globalScope(u))return {ok:true};
 const b=branchOf(u);
 return b&&String(a.branch_id||'')===b?{ok:true}:{ok:false,status:403,error:'الوكيل خارج نطاق فرعك.'};
}
function friendly(e){
 const m=String(e?.message||e||'');
 if(/AGENT_CREDIT_REASON_REQUIRED/i.test(m))return 'سبب تعديل سياسة الائتمان مطلوب (5 أحرف على الأقل).';
 if(/AGENT_CREDIT_LIMIT_INVALID/i.test(m))return 'حد الائتمان لا يمكن أن يكون سالبًا.';
 if(/AGENT_CREDIT_WARNING_INVALID/i.test(m))return 'نسبة التحذير يجب أن تكون من 0 إلى 100.';
 if(/AGENT_CREDIT_TERMS_INVALID/i.test(m))return 'مدة السداد يجب أن تكون بين 0 و365 يومًا.';
 if(/AGENT_CREDIT_MODE_INVALID/i.test(m))return 'وضع التحكم الائتماني غير صحيح.';
 if(/AGENT_COLLECTION_AMOUNT_INVALID/i.test(m))return 'مبلغ وعد السداد يجب أن يكون أكبر من صفر.';
 if(/AGENT_COLLECTION_DUE_DATE_REQUIRED/i.test(m))return 'تاريخ وعد السداد مطلوب.';
 if(/AGENT_COLLECTION_NOTE_REQUIRED/i.test(m))return 'اكتب ملاحظة متابعة واضحة.';
 if(/AGENT_COLLECTION_PROMISE_NOT_FOUND/i.test(m))return 'وعد السداد غير موجود.';
 if(/AGENT_COLLECTION_PROMISE_CLOSED/i.test(m))return 'وعد السداد مغلق بالفعل ولا يقبل إجراء جديد.';
 if(/AGENT_COLLECTION_PAYMENT_MISMATCH/i.test(m))return 'حركة الدفع المختارة لا تتبع نفس الوكيل والبيئة.';
 if(/AGENT_COLLECTION_ACTION_INVALID/i.test(m))return 'إجراء المتابعة غير صحيح.';
 return m||'تعذر تنفيذ إجراء الائتمان والتحصيل.';
}

async function getCredit(request,env,ctx,id){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canView(u))return json({error:'لا توجد صلاحية لعرض الائتمان والتحصيل.'},403);
 const agent=await agentById(env,id),scope=scopeCheck(u,agent);if(!scope.ok)return json({error:scope.error},scope.status);
 const mode=modeOf(u);
 const snapshot=await rpc(env,'agent_credit_snapshot',{p_agent_id:agent.id,p_environment:mode});
 const [promises,credits]=await Promise.all([
  rows(env,'agent_collection_promises','agent_id=eq.'+enc(agent.id)+'&data_environment=eq.'+enc(mode)+'&select=*&order=due_date.asc,created_at.desc&limit=1000').catch(()=>[]),
  rows(env,'agent_ledger_entries','agent_id=eq.'+enc(agent.id)+'&data_environment=eq.'+enc(mode)+'&direction=eq.credit&select=id,reference_no,entry_type,amount,created_at,reason&order=created_at.desc&limit=300').catch(()=>[])
 ]);
 const promiseIds=promises.map(x=>x.id);
 let events=[];
 for(let i=0;i<promiseIds.length;i+=80){
  const batch=promiseIds.slice(i,i+80);if(!batch.length)continue;
  const part=await rows(env,'agent_collection_events','promise_id=in.('+batch.join(',')+')&select=*&order=created_at.desc&limit=1000').catch(()=>[]);
  events.push(...part);
 }
 const eventMap=new Map();
 for(const e of events){const k=String(e.promise_id),a=eventMap.get(k)||[];a.push(e);eventMap.set(k,a)}
 const today=new Date().toISOString().slice(0,10);
 const open=promises.filter(x=>x.status==='open');
 const overdue=open.filter(x=>String(x.due_date)<today);
 return json({
  ok:true,agent:{id:agent.id,agent_code:agent.agent_code,name:agent.name,company_name:agent.company_name,branch_id:agent.branch_id},
  data_environment:mode,snapshot,
  promises:promises.map(p=>({...p,events:eventMap.get(String(p.id))||[]})),
  credit_entries:credits,
  collection_summary:{
   total:promises.length,open:open.length,overdue:overdue.length,
   open_amount:open.reduce((n,x)=>n+Number(x.amount||0),0),
   overdue_amount:overdue.reduce((n,x)=>n+Number(x.amount||0),0)
  },
  capabilities:{policy:canPolicy(u),collections:canCollections(u)}
 });
}
async function writeCredit(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 const agent=await agentById(env,text(body.agent_id)),scope=scopeCheck(u,agent);if(!scope.ok)return json({error:scope.error},scope.status);
 const mode=modeOf(u),aid=actorId(u),aname=actorName(u),arole=text(u.role);
 try{
  if(body.action==='agent_credit_policy_update'){
   if(!canPolicy(u))return json({error:'تعديل سياسة الائتمان يتطلب صلاحية مالية.'},403);
   const result=await rpc(env,'update_agent_credit_policy',{
    p_agent_id:agent.id,p_allow_credit:!!body.allow_credit,p_credit_limit:Number(body.credit_limit||0),
    p_mode:text(body.mode),p_warning_percent:Number(body.warning_percent||0),p_terms_days:Number(body.terms_days||0),
    p_actor_id:aid,p_actor_name:aname,p_actor_role:arole,p_reason:text(body.reason)
   });
   return json({ok:true,result});
  }
  if(body.action==='agent_collection_promise_create'){
   if(!canCollections(u))return json({error:'إنشاء وعد سداد يتطلب صلاحية التحصيل أو المالية.'},403);
   const result=await rpc(env,'create_agent_collection_promise',{
    p_agent_id:agent.id,p_environment:mode,p_amount:Number(body.amount||0),p_due_date:text(body.due_date),
    p_note:text(body.note),p_actor_id:aid,p_actor_name:aname,p_actor_role:arole
   });
   return json({ok:true,result});
  }
  if(body.action==='agent_collection_promise_action'){
   if(!canCollections(u))return json({error:'متابعة وعود السداد تتطلب صلاحية التحصيل أو المالية.'},403);
   const owned=await rows(env,'agent_collection_promises','id=eq.'+enc(body.promise_id)+'&agent_id=eq.'+enc(agent.id)+'&data_environment=eq.'+enc(mode)+'&select=id&limit=1');
   if(!owned[0])return json({error:'وعد السداد غير موجود في حساب هذا الوكيل والبيئة الحالية.'},404);
   const result=await rpc(env,'manage_agent_collection_promise',{
    p_promise_id:text(body.promise_id),p_action:text(body.promise_action),p_note:text(body.note),
    p_payment_entry_id:body.payment_entry_id||null,p_actor_id:aid,p_actor_name:aname,p_actor_role:arole
   });
   return json({ok:true,result});
  }
  return json({error:'إجراء الائتمان غير معروف.'},400);
 }catch(e){return json({error:friendly(e)},409)}
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  const m=url.pathname.match(/^\/api\/agents\/([^/]+)\/credit$/);
  if(m&&request.method==='GET')return getCredit(request,env,ctx,decodeURIComponent(m[1]));
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(['agent_credit_policy_update','agent_collection_promise_create','agent_collection_promise_action'].includes(body?.action))return writeCredit(request,env,ctx,body);
  }
  return appWorker.fetch(request,env,ctx);
 }
};
