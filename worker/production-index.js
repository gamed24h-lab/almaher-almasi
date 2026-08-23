import auditWorker from './audit-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

async function actorFrom(request,env){
  try{
    const u=new URL('/api/auth/me',request.url);
    const r=await auditWorker.fetch(new Request(u,{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}

function isDeveloper(actor){return String(actor?.role||'').toLowerCase()==='developer'}

async function countRows(env,table,filter=''){
  const url=base(env);if(!url)return {ok:false,count:0,error:'SUPABASE_URL missing'};
  const qs=new URLSearchParams({select:'id'});if(filter){const [k,v]=filter.split('=');if(k&&v)qs.set(k,v)}
  const r=await fetch(`${url}/rest/v1/${table}?${qs.toString()}`,{headers:{...headers(env),Prefer:'count=exact',Range:'0-0'}});
  const text=await r.text();let body=[];try{body=text?JSON.parse(text):[]}catch{}
  if(!r.ok)return {ok:false,count:0,error:body?.message||`HTTP ${r.status}`};
  const cr=r.headers.get('content-range')||'';const m=cr.match(/\/(\d+|\*)$/);const count=m&&m[1]!=='*'?Number(m[1]):Array.isArray(body)?body.length:0;
  return {ok:true,count};
}

async function envTableStatus(env,table){
  const url=base(env);if(!url)return {table,ok:false,error:'SUPABASE_URL missing',training:0,production:0,total:0};
  const probe=await fetch(`${url}/rest/v1/${table}?select=id,data_environment&limit=1`,{headers:headers(env)});
  const probeBody=await probe.json().catch(()=>[]);
  if(!probe.ok)return {table,ok:false,error:probeBody?.message||`HTTP ${probe.status}`,training:0,production:0,total:0};
  const [total,training,production]=await Promise.all([
    countRows(env,table),countRows(env,table,'data_environment=eq.training'),countRows(env,table,'data_environment=eq.production')
  ]);
  return {table,ok:total.ok&&training.ok&&production.ok,total:total.count,training:training.count,production:production.count,error:total.error||training.error||production.error||null};
}

async function productionReadiness(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'بوابة التشغيل الفعلي متاحة للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);

  const coreTables=['trips','bookings','booking_passengers','transactions','expenses','refunds','cash_shifts','room_assignments','seat_assignments','scan_events','approval_requests'];
  const tableStatus=[];
  for(const t of coreTables)tableStatus.push(await envTableStatus(env,t));

  const url=base(env),h=headers(env);
  const [branchesR,staffR,pendingR,healthR]=await Promise.all([
    countRows(env,'branches'),
    fetch(`${url}/rest/v1/staff_users?select=id,name,role,status,account_mode,branch_id&order=name.asc`,{headers:h}),
    countRows(env,'approval_requests','status=eq.pending'),
    auditWorker.fetch(new Request(new URL('/api/health',request.url),{method:'GET',headers:request.headers}),env)
  ]);
  const staff=await staffR.json().catch(()=>[]);let health={};try{health=await healthR.clone().json()}catch{}
  const activeStaff=Array.isArray(staff)?staff.filter(x=>!String(x.status||'نشط').includes('موق')&&String(x.status||'').toLowerCase()!=='inactive'):[];
  const productionStaff=activeStaff.filter(x=>String(x.account_mode||'training')==='production');
  const trainingStaff=activeStaff.filter(x=>String(x.account_mode||'training')!=='production');
  const missingEnvironmentTables=tableStatus.filter(x=>!x.ok);
  const pendingApprovals=pendingR.ok?pendingR.count:0;
  const checks=[
    {key:'api',label:'الخادم وواجهة API',ok:healthR.ok&&health?.ok!==false,blocking:true,details:health?.version||'API'},
    {key:'branches',label:'وجود فرع واحد على الأقل',ok:branchesR.ok&&branchesR.count>0,blocking:true,details:`${branchesR.count||0} فرع`},
    {key:'staff',label:'وجود حساب موظف نشط',ok:activeStaff.length>0,blocking:true,details:`${activeStaff.length} حساب نشط`},
    {key:'environment_schema',label:'عزل بيانات التدريب/التشغيل مثبت على الجداول الحرجة',ok:missingEnvironmentTables.length===0,blocking:true,details:missingEnvironmentTables.length?missingEnvironmentTables.map(x=>x.table).join(', '):'سليم'},
    {key:'approvals',label:'لا توجد موافقات حساسة معلقة',ok:pendingApprovals===0,blocking:true,details:`${pendingApprovals} طلب معلق`},
    {key:'production_staff',label:'تحديد حساب تشغيل فعلي واحد على الأقل قبل الإطلاق',ok:productionStaff.length>0,blocking:false,details:`${productionStaff.length} تشغيل فعلي / ${trainingStaff.length} تدريب`}
  ];
  const blockers=checks.filter(x=>x.blocking&&!x.ok);
  return json({
    ok:true,ready:blockers.length===0,mode:'training',activation_locked:true,
    generated_at:new Date().toISOString(),checks,blockers: blockers.map(x=>x.key),
    counts:{branches:branchesR.count||0,active_staff:activeStaff.length,production_staff:productionStaff.length,training_staff:trainingStaff.length,pending_approvals:pendingApprovals},
    tables:tableStatus,
    policy:{snapshot_required:true,double_confirmation_required:true,training_cleanup_preview_required:true,rollback_required:true,production_activation_available:false}
  });
}

async function createProtectedSnapshot(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'إنشاء لقطة ما قبل التشغيل متاح للمطور الحقيقي فقط.'},403);
  const u=new URL('/api/module',request.url);
  const r=await auditWorker.fetch(new Request(u,{method:'POST',headers:request.headers,body:JSON.stringify({action:'create_operational_snapshot'})}),env);
  const body=await r.text();return new Response(body,{status:r.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/production/readiness'&&request.method==='GET')return productionReadiness(request,env);
    if(url.pathname==='/api/production/snapshot'&&request.method==='POST')return createProtectedSnapshot(request,env);
    if(url.pathname==='/api/production/activate')return json({error:'التفعيل الفعلي مقفول حتى ينجح فحص الجاهزية، تُنشأ Snapshot معتمدة، وتُجهز معاينة حذف بيانات التدريب وآلية Rollback.'},423);
    return auditWorker.fetch(request,env,ctx);
  }
};
