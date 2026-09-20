import appWorker from './agent-credit-index.js';

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
const canView=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.reports===true||u.permissions?.allBranchesFinance===true);
const canAssign=u=>!!u&&(sovereign(u)||u.permissions?.finance===true);
const modeOf=u=>lower(u?.account_mode||u?.permissions?._accountMode)==='production'?'production':'training';
const branchOf=u=>text(u?.branch_id||u?.home_branch_id);
const actorId=u=>text(u?.id||u?.user_id||u?.username||u?.email);
const actorName=u=>text(u?.name||u?.full_name||u?.username||u?.email);
const staffActive=s=>['active','نشط'].includes(lower(s?.status));
const staffCanCollect=s=>{
 const p=s?.permissions||{};
 return staffActive(s)&&(lower(s?.role)==='developer'||s?.role==='مدير عام'||p.all===true||p.finance===true||p.payments===true);
};
const staffGlobal=s=>{
 const p=s?.permissions||{};
 return lower(s?.role)==='developer'||s?.role==='مدير عام'||p.all===true||p.allBranches===true||p.allBranchesFinance===true;
};
function friendly(e){
 const m=String(e?.message||e||'');
 if(/AGENT_COLLECTION_PRIORITY_INVALID/i.test(m))return 'أولوية التحصيل غير صحيحة.';
 if(/AGENT_COLLECTION_COLLECTOR_INVALID/i.test(m))return 'موظف التحصيل غير موجود أو غير نشط.';
 if(/AGENT_COLLECTION_ENV_INVALID/i.test(m))return 'بيئة التحصيل غير صحيحة.';
 if(/AGENT_CREDIT_AGENT_NOT_FOUND/i.test(m))return 'الوكيل غير موجود.';
 return m||'تعذر تحديث مسؤول التحصيل.';
}

async function centerGet(request,env,ctx){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canView(u))return json({error:'لا توجد صلاحية لعرض مركز تحصيل الوكلاء.'},403);

 const url=new URL(request.url),mode=modeOf(u);
 const requestedBranch=text(url.searchParams.get('branch'));
 const branch=globalScope(u)?(requestedBranch||null):(branchOf(u)||null);
 if(!globalScope(u)&&!branch)return json({error:'لم يتم تحديد فرع لهذا الحساب.'},403);

 const [centerRows,allStaff,promises]=await Promise.all([
  rpc(env,'agent_collections_center_rows',{p_environment:mode,p_branch_id:branch||null}),
  rows(env,'staff_users','select='+enc('id,name,username,role,branch_id,home_branch_id,status,permissions,account_mode')+'&limit=5000').catch(()=>[]),
  rows(env,'agent_collection_promises','data_environment=eq.'+enc(mode)+(branch?'&branch_id=eq.'+enc(branch):'')+'&select='+enc('id,agent_id,branch_id,amount,due_date,status,note,related_payment_entry_id,created_by_name,closed_at,created_at,updated_at')+'&order=due_date.asc,created_at.desc&limit=5000').catch(()=>[])
 ]);

 const collectors=allStaff.filter(s=>staffCanCollect(s)&&(!s.account_mode||lower(s.account_mode)===mode)).filter(s=>{
  if(!branch)return true;
  if(staffGlobal(s))return true;
  return String(s.branch_id||s.home_branch_id||'')===String(branch);
 }).map(s=>({id:s.id,name:s.name,username:s.username,role:s.role,branch_id:s.branch_id||s.home_branch_id||null}));

 const promiseMap=new Map();
 for(const p of promises){
  const k=String(p.agent_id),a=promiseMap.get(k)||[];a.push(p);promiseMap.set(k,a);
 }
 const today=new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);
 const decorated=(Array.isArray(centerRows)?centerRows:[]).map(r=>{
  const ps=promiseMap.get(String(r?.agent?.id))||[];
  const open=ps.filter(x=>x.status==='open');
  const nextOpen=open[0]||null;
  const latestBroken=ps.filter(x=>x.status==='broken').sort((a,b)=>String(b.closed_at||b.updated_at||'').localeCompare(String(a.closed_at||a.updated_at||'')))[0]||null;
  return {...r,next_open_promise:nextOpen,latest_broken_promise:latestBroken};
 });

 const summary={
  agents:decorated.length,
  receivables:decorated.reduce((n,r)=>n+Math.max(0,Number(r?.credit?.balance||0)),0),
  overdue:decorated.reduce((n,r)=>n+Number(r?.credit?.aging?.overdue||0),0),
  over_limit:decorated.filter(r=>r?.credit?.exceeded).length,
  warning:decorated.filter(r=>r?.credit?.warning&&!r?.credit?.exceeded).length,
  urgent:decorated.filter(r=>r?.priority?.level==='urgent').length,
  high:decorated.filter(r=>r?.priority?.level==='high').length,
  unassigned:decorated.filter(r=>!r?.assignment?.collector_user_id).length,
  due_today:promises.filter(p=>p.status==='open'&&String(p.due_date)===today).length,
  promise_overdue:promises.filter(p=>p.status==='open'&&String(p.due_date)<today).length,
  broken:promises.filter(p=>p.status==='broken').length
 };
 return json({ok:true,data_environment:mode,scope:globalScope(u)?'all':'branch',branch_id:branch,rows:decorated,collectors,summary,capabilities:{assign:canAssign(u),all_branches:globalScope(u)}});
}

async function centerWrite(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canAssign(u))return json({error:'توزيع ملفات التحصيل يتطلب صلاحية مالية.'},403);
 const mode=modeOf(u);
 const agent=(await rows(env,'agents','id=eq.'+enc(body.agent_id)+'&select=id,branch_id,status,merged_into_id&limit=1'))[0];
 if(!agent)return json({error:'الوكيل غير موجود.'},404);
 if(!globalScope(u)&&String(agent.branch_id||'')!==branchOf(u))return json({error:'الوكيل خارج نطاق فرعك.'},403);

 let collectorId=text(body.collector_user_id)||null;
 if(collectorId){
  const s=(await rows(env,'staff_users','id=eq.'+enc(collectorId)+'&select='+enc('id,name,role,branch_id,home_branch_id,status,permissions,account_mode')+'&limit=1'))[0];
  if(!s||!staffCanCollect(s))return json({error:'الموظف المختار غير صالح للتحصيل أو غير نشط.'},409);
  if(!staffGlobal(s)&&String(s.branch_id||s.home_branch_id||'')!==String(agent.branch_id||''))return json({error:'لا يمكن تعيين موظف تحصيل من فرع مختلف لهذا الوكيل.'},409);
  if(s.account_mode&&lower(s.account_mode)!==mode)return json({error:'موظف التحصيل يعمل في بيئة مختلفة عن البيئة الحالية.'},409);
 }
 try{
  const result=await rpc(env,'update_agent_collection_assignment',{
   p_agent_id:agent.id,p_environment:mode,p_collector_user_id:collectorId,
   p_manual_priority:text(body.manual_priority)||'normal',
   p_next_followup_date:text(body.next_followup_date)||null,
   p_note:text(body.note)||null,
   p_actor_id:actorId(u),p_actor_name:actorName(u),p_actor_role:text(u.role)
  });
  return json({ok:true,result});
 }catch(e){return json({error:friendly(e)},409)}
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/agent-collections-center'&&request.method==='GET')return centerGet(request,env,ctx);
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(body?.action==='agent_collection_assignment_update')return centerWrite(request,env,ctx,body);
  }
  return appWorker.fetch(request,env,ctx);
 }
};
