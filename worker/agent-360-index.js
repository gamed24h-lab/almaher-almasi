import appWorker from './agent-merge-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const digits=v=>text(v).replace(/\D/g,'');
const compact=v=>lower(v).replace(/[\s-]+/g,'');

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
const sovereign=u=>!!u&&(lower(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true);
const canView=u=>!!u&&(sovereign(u)||u.permissions?.agents===true||u.permissions?.finance===true);
const canFinance=u=>!!u&&(sovereign(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.expenses===true||u.permissions?.refunds===true||u.permissions?.allBranchesFinance===true);
const globalScope=u=>!!u&&(sovereign(u)||u.permissions?.allBranches===true||(canFinance(u)&&u.permissions?.allBranchesFinance===true));
const accountMode=u=>{const m=lower(u?.account_mode||u?.permissions?._accountMode);return m==='production'||m==='training'?m:''};

function agentMatch(a,b){
 const acr=compact(a?.commercial_registration),bcr=compact(b?.commercial_registration);
 if(acr&&bcr&&acr===bcr)return {ok:true,type:'commercial_registration',label:'نفس السجل التجاري'};
 const at=compact(a?.tax_number),bt=compact(b?.tax_number);
 if(at&&bt&&at===bt)return {ok:true,type:'tax_number',label:'نفس الرقم الضريبي'};
 const an=compact(a?.company_name||a?.name),bn=compact(b?.company_name||b?.name);
 const ap=digits(a?.phone||a?.whatsapp),bp=digits(b?.phone||b?.whatsapp);
 if(an&&bn&&an===bn&&ap&&bp&&ap===bp)return {ok:true,type:'name_phone',label:'نفس اسم الجهة والجوال'};
 const ae=lower(a?.email),be=lower(b?.email);
 if(an&&bn&&an===bn&&ae&&be&&ae===be)return {ok:true,type:'name_email',label:'نفس اسم الجهة والبريد الإلكتروني'};
 return {ok:false,type:'none',label:''};
}
function activeAgent(a){return lower(a?.status)==='active'&&!a?.merged_into_id}
function redactFinancial(agent,financial){
 if(financial)return agent;
 const out={...agent};for(const k of ['current_balance','credit_limit','default_commission_type','default_commission_value','default_discount_type','default_discount_value','allow_credit'])out[k]=null;return out;
}
function summarizeBookings(bookings,financial){
 const total=bookings.length;
 const confirmed=bookings.filter(x=>['confirmed','paid'].includes(lower(x.booking_status||x.status))).length;
 const cancelled=bookings.filter(x=>lower(x.booking_status||x.status)==='cancelled').length;
 const amount=financial?bookings.reduce((n,x)=>n+Number(x.total_price||0),0):null;
 const paid=financial?bookings.reduce((n,x)=>n+Number(x.paid_amount||0),0):null;
 return {total,confirmed,cancelled,total_value:amount,paid_value:paid,outstanding_value:financial?Math.max(0,amount-paid):null};
}
async function agent360(request,env,ctx,id){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canView(u))return json({error:'لا توجد صلاحية لعرض بيانات الوكلاء.'},403);
 const financial=canFinance(u),branch=text(u?.branch_id||u?.home_branch_id);
 const agent=(await rows(env,'agents','id=eq.'+enc(id)+'&select=*&limit=1'))[0];
 if(!agent)return json({error:'الوكيل غير موجود.'},404);
 if(!globalScope(u)&&String(agent.branch_id||'')!==branch)return json({error:'الوكيل خارج نطاق فرعك.'},403);

 const mode=accountMode(u);
 const bookingQuery='agent_id=eq.'+enc(id)+'&select='+enc('id,booking_number,agent_id,branch_id,customer_name,customer_phone,booking_status,status,total_price,paid_amount,trip_id,outbound_trip_id,return_trip_id,data_environment,created_at,updated_at')+(mode?'&data_environment=eq.'+enc(mode):'')+'&order=created_at.desc&limit=1000';
 const [bookings,allocations,quotas,branches,mergeHistory,allAgents]=await Promise.all([
  rows(env,'bookings',bookingQuery).catch(()=>[]),
  rows(env,'agent_allocations','agent_id=eq.'+enc(id)+'&select=*&order=created_at.desc&limit=1000').catch(()=>[]),
  rows(env,'resource_quotas','agent_id=eq.'+enc(id)+'&select=*&order=created_at.desc&limit=1000').catch(()=>[]),
  agent.branch_id?rows(env,'branches','id=eq.'+enc(agent.branch_id)+'&select=id,name&limit=1').catch(()=>[]):Promise.resolve([]),
  rows(env,'record_merge_history','entity_type=eq.agents&or=(canonical_id.eq.'+enc(id)+',duplicate_id.eq.'+enc(id)+')&select=id,canonical_id,duplicate_id,reason,match_type,moved_references,actor_name,actor_role,created_at&order=created_at.desc&limit=50').catch(()=>[]),
  rows(env,'agents','branch_id'+(agent.branch_id?'=eq.'+enc(agent.branch_id):'=is.null')+'&select=id,agent_code,name,company_name,phone,whatsapp,email,commercial_registration,tax_number,branch_id,status,current_balance,credit_limit,default_commission_type,default_commission_value,default_discount_type,default_discount_value,allow_credit,allow_group_booking,portal_enabled,merged_into_id,created_at&limit=1000').catch(()=>[])
 ]);

 const tripIds=[...new Set([
  ...bookings.flatMap(b=>[b.trip_id,b.outbound_trip_id,b.return_trip_id]),
  ...allocations.map(x=>x.trip_id),
  ...quotas.map(x=>x.trip_id)
 ].filter(Boolean).map(String))];
 const trips=tripIds.length?await rows(env,'trips','id=in.('+tripIds.join(',')+')&select='+enc('id,trip_code,from_city,to_city,departure_date,departure_time,branch_id,status')+'&limit=1000').catch(()=>[]):[];
 const tripMap=new Map(trips.map(t=>[String(t.id),t]));
 const enrichTrip=r=>({...r,trip:tripMap.get(String(r.trip_id||''))||null});
 const safeBookings=bookings.map(b=>financial?b:{...b,total_price:null,paid_amount:null});
 const duplicateCandidates=allAgents.filter(x=>String(x.id)!==String(id)&&activeAgent(x)).map(x=>({record:x,match:agentMatch(agent,x)})).filter(x=>x.match.ok).map(x=>({match:x.match,record:redactFinancial(x.record,financial)}));
 let mergedInto=null;
 if(agent.merged_into_id){
  const found=(await rows(env,'agents','id=eq.'+enc(agent.merged_into_id)+'&select=id,agent_code,name,company_name,status&limit=1').catch(()=>[]))[0];
  mergedInto=found||null;
 }

 return json({
  ok:true,
  financial_access:financial,
  scope:globalScope(u)?'all':'branch',
  account_mode:mode||null,
  branch:branches[0]||null,
  agent:redactFinancial(agent,financial),
  bookings:safeBookings,
  allocations:allocations.map(enrichTrip),
  quotas:quotas.map(enrichTrip),
  trips,
  merge_history:mergeHistory,
  duplicate_candidates:duplicateCandidates,
  merged_into:mergedInto,
  summary:{
   bookings:summarizeBookings(bookings,financial),
   allocations:{total:allocations.length,active:allocations.filter(x=>lower(x.status)==='active').length,allocated:allocations.reduce((n,x)=>n+Number(x.allocated_quantity||0),0),used:allocations.reduce((n,x)=>n+Number(x.used_quantity||0),0)},
   quotas:{total:quotas.length,active:quotas.filter(x=>lower(x.status)==='active').length,quantity:quotas.reduce((n,x)=>n+Number(x.quantity||0),0),used:quotas.reduce((n,x)=>n+Number(x.used_quantity||0),0)}
  }
 });
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  const m=url.pathname.match(/^\/api\/agents\/([^/]+)\/360$/);
  if(m&&request.method==='GET')return agent360(request,env,ctx,decodeURIComponent(m[1]));
  return appWorker.fetch(request,env,ctx);
 }
};
