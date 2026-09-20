import appWorker from './passenger-merge-index.js';

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
async function rpc(env,name,body){
 const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});
 const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||'تعذر تنفيذ العملية');e.code=String(b?.message||'');throw e}return b;
}
const sovereign=u=>!!u&&(lower(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true);
const globalScope=u=>!!u&&(sovereign(u)||u.permissions?.allBranches===true);
const canReviewRegistry=u=>!!u&&(globalScope(u)||u.permissions?.auditLog===true||u.permissions?.managePermissions===true);
const canReviewAgents=u=>!!u&&(canReviewRegistry(u)||u.permissions?.agents===true||u.permissions?.finance===true||u.permissions?.suppliers===true);
const canMergeAgents=u=>!!u&&(sovereign(u)||(u.permissions?.editBookings===true&&u.permissions?.finance===true));

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
 return {ok:false,type:'none',label:'لا توجد مطابقة قوية كافية بين الوكيلين'};
}
function agentKeys(r){
 if(lower(r?.status)!=='active'||r?.merged_into_id)return [];
 const out=[],cr=compact(r.commercial_registration),tax=compact(r.tax_number);
 const n=compact(r.company_name||r.name),p=digits(r.phone||r.whatsapp),email=lower(r.email);
 if(cr)out.push('cr:'+cr);
 if(tax)out.push('tax:'+tax);
 if(n&&p)out.push('phone_name:'+n+'|'+p);
 if(n&&email)out.push('email_name:'+n+'|'+email);
 return out;
}
function matchLabel(key){
 if(key.startsWith('cr:'))return 'نفس السجل التجاري';
 if(key.startsWith('tax:'))return 'نفس الرقم الضريبي';
 if(key.startsWith('phone_name:'))return 'نفس اسم الجهة والجوال';
 if(key.startsWith('email_name:'))return 'نفس اسم الجهة والبريد الإلكتروني';
 return 'مطابقة قوية';
}
function buildAgentGroups(records){
 const owners=new Map(),parent=records.map((_,i)=>i),rank=records.map(()=>0);
 const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const join=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++};
 records.forEach((r,i)=>agentKeys(r).forEach(k=>{if(owners.has(k))join(i,owners.get(k));else owners.set(k,i)}));
 const grouped=new Map();records.forEach((r,i)=>{const root=find(i),a=grouped.get(root)||[];a.push(r);grouped.set(root,a)});
 return [...grouped.values()].filter(g=>g.length>1).map((records,i)=>{
  let match='مطابقة قوية';
  for(const k of agentKeys(records[0]))if(records.slice(1).some(r=>agentKeys(r).includes(k))){match=matchLabel(k);break}
  return {id:'agents-'+i+'-'+records[0].id,entity_type:'agents',label:'وكيل',match,merge_mode:'safe_preview',warning:'معاينة مالية وتشغيلية إلزامية قبل الدمج.',branch_id:records[0].branch_id||null,records};
 });
}
async function scopedAgents(env,u){
 const branch=text(u?.branch_id||u?.home_branch_id);
 const select='id,agent_code,name,company_name,phone,whatsapp,email,commercial_registration,tax_number,branch_id,status,current_balance,credit_limit,default_commission_type,default_commission_value,default_discount_type,default_discount_value,allow_credit,allow_group_booking,portal_enabled,merged_into_id,merged_at,created_at,updated_at';
 const scope=globalScope(u)?'':branch?'&branch_id=eq.'+enc(branch):'&id=eq.00000000-0000-0000-0000-000000000000';
 return rows(env,'agents','select='+enc(select)+scope+'&limit=5000');
}
async function registryWithAgents(request,env,ctx){
 const upstream=await appWorker.fetch(request,env,ctx);
 if(!upstream.ok)return upstream;
 const payload=await readJson(upstream);
 const u=await actor(request,env,ctx);
 if(!u||!canReviewRegistry(u))return json(payload,upstream.status);
 const agents=await scopedAgents(env,u).catch(()=>[]);
 const agentGroups=buildAgentGroups(agents);
 const other=(payload.groups||[]).filter(g=>g.entity_type!=='agents');
 const groups=[...other,...agentGroups];
 return json({...payload,groups,summary:{...(payload.summary||{}),agents:agentGroups.length,total:groups.length}},upstream.status);
}
async function agentReferenceRows(env,a,b){
 const ids='('+a.id+','+b.id+')';
 const [bookings,allocations,quotas]=await Promise.all([
  rows(env,'bookings','agent_id=in.'+ids+'&select='+enc('id,booking_number,agent_id,branch_id,booking_status,status,total_price,paid_amount,data_environment,created_at')+'&limit=1001').catch(()=>[]),
  rows(env,'agent_allocations','agent_id=in.'+ids+'&select='+enc('id,agent_id,trip_id,trip_bus_id,allocation_type,allocated_quantity,used_quantity,status,price_override,commission_override,release_at,created_at')+'&limit=1001').catch(()=>[]),
  rows(env,'resource_quotas','agent_id=in.'+ids+'&select='+enc('id,agent_id,resource_type,trip_id,branch_id,quantity,used_quantity,status,release_at,created_at')+'&limit=1001').catch(()=>[])
 ]);
 return {bookings,agent_allocations:allocations,resource_quotas:quotas};
}
function refCounts(refs,id){
 const out={};
 for(const [table,list] of Object.entries(refs||{})){
  const count=(list||[]).filter(x=>String(x.agent_id)===String(id)).length;
  out[table]={count:count>=1001?'1000+':count,truncated:count>=1001};
 }
 return out;
}
function policyDifferences(a,b){
 const fields=[
  ['credit_limit','حد الائتمان'],['current_balance','الرصيد الحالي'],
  ['default_commission_type','نوع العمولة'],['default_commission_value','قيمة العمولة'],
  ['default_discount_type','نوع الخصم'],['default_discount_value','قيمة الخصم'],
  ['allow_credit','السماح بالآجل'],['allow_group_booking','السماح بحجز المجموعات'],['portal_enabled','بوابة الوكيل']
 ];
 return fields.filter(([k])=>String(a?.[k]??'')!==String(b?.[k]??'')).map(([field,label])=>({field,label,canonical:a?.[field]??null,duplicate:b?.[field]??null}));
}
function allocationConflicts(refs,a,b){
 const ca=(refs.agent_allocations||[]).filter(x=>String(x.agent_id)===String(a.id)&&lower(x.status)==='active');
 const da=(refs.agent_allocations||[]).filter(x=>String(x.agent_id)===String(b.id)&&lower(x.status)==='active');
 return ca.filter(x=>da.some(y=>String(x.trip_id)===String(y.trip_id)&&String(x.trip_bus_id||'')===String(y.trip_bus_id||'')&&lower(x.allocation_type)===lower(y.allocation_type)));
}
async function inspectPair(env,u,canonicalId,duplicateId){
 if(!canonicalId||!duplicateId||canonicalId===duplicateId)return {can_merge:false,reasons:['اختر وكيلين مختلفين.']};
 const pair=await rows(env,'agents','id=in.('+enc(canonicalId)+','+enc(duplicateId)+')&select=*&limit=2');
 const canonical=pair.find(x=>String(x.id)===String(canonicalId)),duplicate=pair.find(x=>String(x.id)===String(duplicateId));
 if(!canonical||!duplicate)return {can_merge:false,reasons:['أحد سجلي الوكيل غير موجود.']};
 const branch=text(u?.branch_id||u?.home_branch_id);
 if(!globalScope(u)&&String(canonical.branch_id||'')!==branch)return {forbidden:true,can_merge:false,reasons:['سجل الوكيل الأساسي خارج نطاق فرعك.']};
 const reasons=[],warnings=[];
 if(String(canonical.branch_id||'')!==String(duplicate.branch_id||''))reasons.push('الوكيلان ليسا تابعين لنفس الفرع.');
 if(lower(canonical.status)!=='active'||lower(duplicate.status)!=='active'||canonical.merged_into_id||duplicate.merged_into_id)reasons.push('أحد سجلي الوكيل غير نشط أو مدموج بالفعل.');
 const ccr=compact(canonical.commercial_registration),dcr=compact(duplicate.commercial_registration);
 if(ccr&&dcr&&ccr!==dcr)reasons.push('السجل التجاري مختلف بين الوكيلين.');
 const ct=compact(canonical.tax_number),dt=compact(duplicate.tax_number);
 if(ct&&dt&&ct!==dt)reasons.push('الرقم الضريبي مختلف بين الوكيلين.');
 const match=agentMatch(canonical,duplicate);if(!match.ok)reasons.push(match.label);
 if(Math.abs(Number(duplicate.current_balance||0))>0.000001)reasons.push('السجل المكرر عليه رصيد غير صفري. اختر سجل الرصيد كأساسي أو سوِّ الرصيد قبل الدمج.');
 const refs=await agentReferenceRows(env,canonical,duplicate);
 const conflicts=allocationConflicts(refs,canonical,duplicate);
 if(conflicts.length)reasons.push('يوجد توزيع Active متعارض لنفس الرحلة/الباص/نوع التوزيع. راجع التوزيعات قبل الدمج.');
 const differences=policyDifferences(canonical,duplicate);
 if(differences.length)warnings.push('إعدادات مالية أو تشغيلية مختلفة؛ بعد الدمج ستظل إعدادات السجل الأساسي هي المعتمدة.');
 return {can_merge:reasons.length===0,match,reasons,warnings,canonical,duplicate,policy_differences:differences,allocation_conflicts:conflicts.slice(0,20),references:{canonical:refCounts(refs,canonical.id),duplicate:refCounts(refs,duplicate.id)}};
}
function friendlyError(e){
 const m=String(e?.message||e||'');
 if(/MERGE_REASON_REQUIRED/i.test(m))return 'اكتب سبب الدمج بوضوح (5 أحرف على الأقل).';
 if(/MERGE_AGENT_BRANCH_MISMATCH/i.test(m))return 'دمج الوكلاء مسموح داخل نفس الفرع فقط.';
 if(/MERGE_AGENT_CR_CONFLICT/i.test(m))return 'السجل التجاري مختلف بين الوكيلين، لذلك تم إيقاف الدمج.';
 if(/MERGE_AGENT_TAX_CONFLICT/i.test(m))return 'الرقم الضريبي مختلف بين الوكيلين، لذلك تم إيقاف الدمج.';
 if(/MERGE_AGENT_DUPLICATE_BALANCE_NONZERO/i.test(m))return 'السجل المكرر عليه رصيد غير صفري. اجعل سجل الرصيد هو الأساسي أو سوِّ الرصيد أولًا.';
 if(/MERGE_AGENT_ACTIVE_ALLOCATION_CONFLICT/i.test(m))return 'يوجد توزيع Active متعارض لنفس الرحلة/الباص/نوع التوزيع.';
 if(/MERGE_AGENT_STRONG_MATCH_REQUIRED/i.test(m))return 'لا توجد مطابقة قوية كافية بين الوكيلين.';
 if(/MERGE_AGENT_NOT_FOUND|MERGE_INACTIVE_AGENT|MERGE_AGENT_ALREADY_MERGED/i.test(m))return 'أحد سجلي الوكيل لم يعد صالحًا للدمج.';
 return m||'تعذر دمج سجلي الوكيل.';
}
async function handleAgent(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canReviewAgents(u)&&!canMergeAgents(u))return json({error:'لا توجد صلاحية مراجعة تكرارات الوكلاء.'},403);
 const preview=await inspectPair(env,u,String(body.canonical_id||''),String(body.duplicate_id||''));
 if(preview.forbidden)return json({error:preview.reasons?.[0]||'خارج نطاق الفرع.'},403);
 if(body.action==='agent_duplicate_preview')return json({ok:true,...preview,can_execute:canMergeAgents(u)});
 if(!canMergeAgents(u))return json({error:'دمج الوكلاء يتطلب صلاحية الحجوزات والمالية معًا أو صلاحية إدارية عليا.'},403);
 if(!preview.can_merge)return json({error:preview.reasons?.join(' ')||'لا يمكن دمج الوكيلين.',preview},409);
 if(text(body.confirm_agent_code)!==text(preview.canonical?.agent_code))return json({error:'اكتب كود الوكيل الأساسي كما هو لتأكيد الدمج.'},400);
 if(text(body.reason).length<5)return json({error:'سبب الدمج مطلوب (5 أحرف على الأقل).'},400);
 try{
  const result=await rpc(env,'merge_agent_duplicates',{p_canonical:preview.canonical.id,p_duplicate:preview.duplicate.id,p_actor_id:String(u.id||''),p_actor_name:String(u.name||u.username||''),p_actor_role:String(u.role||''),p_reason:text(body.reason)});
  return json({ok:true,result,preview});
 }catch(e){return json({error:friendlyError(e)},409)}
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(body?.action==='duplicate_review_registry')return registryWithAgents(request,env,ctx);
   if(['agent_duplicate_preview','agent_duplicate_merge'].includes(body?.action))return handleAgent(request,env,ctx,body);
  }
  return appWorker.fetch(request,env,ctx);
 }
};
