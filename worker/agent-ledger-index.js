import appWorker from './agent-360-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};

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
const canView=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.reports===true||u.permissions?.agents===true);
const canPayment=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true);
const canAdjust=u=>!!u&&(sovereign(u)||u.permissions?.finance===true);
const modeOf=u=>lower(u?.account_mode||u?.permissions?._accountMode)==='production'?'production':'training';
const branchOf=u=>text(u?.branch_id||u?.home_branch_id);
const actorId=u=>text(u?.id||u?.user_id||u?.username||u?.email);
const actorName=u=>text(u?.name||u?.full_name||u?.username||u?.email);

async function agentById(env,id){return (await rows(env,'agents','id=eq.'+enc(id)+'&select=*&limit=1'))[0]||null}
function checkScope(u,agent){
 if(!agent)return {ok:false,status:404,error:'الوكيل غير موجود.'};
 if(globalScope(u))return {ok:true};
 const bid=branchOf(u);
 if(!bid||String(agent.branch_id||'')!==bid)return {ok:false,status:403,error:'الوكيل خارج نطاق فرعك.'};
 return {ok:true};
}
function friendly(e){
 const m=String(e?.message||e||'');
 if(/AGENT_LEDGER_REASON_REQUIRED/i.test(m))return 'اكتب سبب الحركة بوضوح (5 أحرف على الأقل).';
 if(/AGENT_LEDGER_AMOUNT_INVALID/i.test(m))return 'المبلغ يجب أن يكون أكبر من صفر.';
 if(/AGENT_LEDGER_ENV_INVALID/i.test(m))return 'بيئة الحركة غير صحيحة.';
 if(/AGENT_LEDGER_AGENT_NOT_FOUND/i.test(m))return 'الوكيل غير موجود.';
 if(/AGENT_LEDGER_AGENT_INACTIVE/i.test(m))return 'لا يمكن إضافة حركة على وكيل غير نشط أو مدموج.';
 if(/AGENT_LEDGER_NOT_INITIALIZED/i.test(m))return 'كشف الحساب يحتاج تهيئة رصيد افتتاحي أولًا.';
 if(/AGENT_LEDGER_ALREADY_INITIALIZED/i.test(m))return 'كشف الحساب مهيأ بالفعل لهذه البيئة.';
 if(/AGENT_LEDGER_BOOKING_NOT_FOUND/i.test(m))return 'الحجز المرتبط بالحركة غير موجود.';
 if(/AGENT_LEDGER_BOOKING_AGENT_MISMATCH/i.test(m))return 'الحجز لا يتبع هذا الوكيل.';
 if(/AGENT_LEDGER_BOOKING_ENV_MISMATCH/i.test(m))return 'الحجز من بيئة مختلفة عن كشف الحساب.';
 if(/AGENT_LEDGER_ENTRY_TYPE_INVALID/i.test(m))return 'نوع حركة الوكيل غير مسموح.';
 if(/AGENT_LEDGER_ENTRY_NOT_FOUND/i.test(m))return 'حركة كشف الحساب غير موجودة.';
 if(/AGENT_LEDGER_SYSTEM_ENTRY_NOT_REVERSIBLE/i.test(m))return 'هذه حركة نظام مرتبطة بحجز أو رصيد افتتاحي؛ يتم تصحيحها من مصدرها وليس بالعكس اليدوي.';
 if(/AGENT_LEDGER_ALREADY_REVERSED/i.test(m))return 'تم عكس هذه الحركة بالفعل.';
 if(/AGENT_LEDGER_ENTRIES_IMMUTABLE/i.test(m))return 'حركات كشف الحساب غير قابلة للتعديل أو الحذف؛ استخدم العكس.';
 return m||'تعذر تنفيذ حركة كشف حساب الوكيل.';
}
async function ledgerGet(request,env,ctx,id){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canView(u))return json({error:'لا توجد صلاحية لعرض كشف حساب الوكيل.'},403);
 const agent=await agentById(env,id),scope=checkScope(u,agent);if(!scope.ok)return json({error:scope.error},scope.status);
 const mode=modeOf(u);
 const [accounts,entries]=await Promise.all([
  rows(env,'agent_ledger_accounts','agent_id=eq.'+enc(id)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]),
  rows(env,'agent_ledger_entries','agent_id=eq.'+enc(id)+'&data_environment=eq.'+enc(mode)+'&select=*&order=created_at.desc&limit=3000').catch(()=>[])
 ]);
 const bookingIds=[...new Set(entries.map(x=>x.booking_id).filter(Boolean).map(String))];
 let bookings=[];
 for(let i=0;i<bookingIds.length;i+=80){
  const batch=bookingIds.slice(i,i+80);
  const part=await rows(env,'bookings','id=in.('+batch.join(',')+')&select=id,booking_number,customer_name,customer_phone,total_price,paid_amount,booking_status,status&limit=100').catch(()=>[]);
  bookings.push(...part);
 }
 const bookingMap=new Map(bookings.map(x=>[String(x.id),x]));
 const decorated=entries.map(x=>({...x,booking:bookingMap.get(String(x.booking_id||''))||null}));
 const debit=entries.filter(x=>x.direction==='debit').reduce((n,x)=>n+num(x.amount),0);
 const credit=entries.filter(x=>x.direction==='credit').reduce((n,x)=>n+num(x.amount),0);
 const derived=Math.round((debit-credit)*100)/100;
 const account=accounts[0]||null;
 const stored=account?num(account.current_balance):0;
 const discrepancy=Math.round((stored-derived)*100)/100;
 const reversedIds=new Set(entries.filter(x=>x.reversal_of_entry_id).map(x=>String(x.reversal_of_entry_id)));
 return json({
  ok:true,
  agent:{id:agent.id,agent_code:agent.agent_code,name:agent.name,company_name:agent.company_name,branch_id:agent.branch_id,status:agent.status,merged_into_id:agent.merged_into_id,legacy_current_balance:num(agent.current_balance),ledger_started_at:agent.ledger_started_at},
  data_environment:mode,
  account,
  entries:decorated.map(x=>({...x,reversed:reversedIds.has(String(x.id))})),
  summary:{debit,credit,current_balance:account?stored:derived,derived_balance:derived,discrepancy,entry_count:entries.length,opening_balance:account?num(account.opening_balance):0},
  setup_required:!agent.ledger_started_at,
  legacy_balance_requires_setup:!agent.ledger_started_at&&Math.abs(num(agent.current_balance))>0.000001,
  reconciliation_ok:Math.abs(discrepancy)<0.005,
  capabilities:{view:true,payment:canPayment(u),adjust:canAdjust(u),initialize:canAdjust(u),reverse:canAdjust(u)}
 });
}
async function ledgerWrite(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 const agent=await agentById(env,text(body.agent_id)),scope=checkScope(u,agent);if(!scope.ok)return json({error:scope.error},scope.status);
 const mode=modeOf(u),aid=actorId(u),aname=actorName(u),arole=text(u.role);
 try{
  if(body.action==='agent_ledger_initialize'){
   if(!canAdjust(u))return json({error:'تهيئة كشف حساب الوكيل تتطلب صلاحية مالية.'},403);
   const result=await rpc(env,'initialize_agent_ledger',{
    p_agent_id:agent.id,p_environment:mode,p_opening_balance:num(body.opening_balance),
    p_actor_id:aid,p_actor_name:aname,p_actor_role:arole,p_reason:text(body.reason)
   });
   return json({ok:true,result});
  }
  if(body.action==='agent_ledger_post'){
   const type=text(body.entry_type);
   if(type==='payment'){if(!canPayment(u))return json({error:'تسجيل دفعة وكيل يتطلب صلاحية التحصيل أو المالية.'},403)}
   else if(!canAdjust(u))return json({error:'هذه الحركة تتطلب صلاحية مالية.'},403);
   const result=await rpc(env,'post_agent_ledger_entry',{
    p_agent_id:agent.id,p_environment:mode,p_entry_type:type,p_amount:num(body.amount),
    p_booking_id:body.booking_id||null,p_payment_method:text(body.payment_method)||null,p_reason:text(body.reason),
    p_actor_id:aid,p_actor_name:aname,p_actor_role:arole,
    p_idempotency_key:text(body.idempotency_key)||null,p_metadata:{ui:'agent_360',...(body.metadata||{})}
   });
   return json({ok:true,result});
  }
  if(body.action==='agent_ledger_reverse'){
   if(!canAdjust(u))return json({error:'عكس حركة الوكيل يتطلب صلاحية مالية.'},403);
   const entryId=text(body.entry_id);
   const owned=await rows(env,'agent_ledger_entries','id=eq.'+enc(entryId)+'&agent_id=eq.'+enc(agent.id)+'&data_environment=eq.'+enc(mode)+'&select=id&limit=1');
   if(!owned[0])return json({error:'الحركة غير موجودة في كشف هذا الوكيل أو البيئة الحالية.'},404);
   const result=await rpc(env,'reverse_agent_ledger_entry',{
    p_entry_id:entryId,p_actor_id:aid,p_actor_name:aname,p_actor_role:arole,p_reason:text(body.reason)
   });
   return json({ok:true,result});
  }
  return json({error:'إجراء كشف الحساب غير معروف.'},400);
 }catch(e){return json({error:friendly(e)},409)}
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  const m=url.pathname.match(/^\/api\/agents\/([^/]+)\/ledger$/);
  if(m&&request.method==='GET')return ledgerGet(request,env,ctx,decodeURIComponent(m[1]));
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(['agent_ledger_initialize','agent_ledger_post','agent_ledger_reverse'].includes(body?.action))return ledgerWrite(request,env,ctx,body);
  }
  return appWorker.fetch(request,env,ctx);
 }
};
