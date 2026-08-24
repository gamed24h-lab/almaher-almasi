import restoreWorker from './restore-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

const operationalTables=['trips','trip_branches','bookings','booking_passengers','transactions','expenses','refunds','cash_shifts','room_assignments','seat_assignments','scan_events','approval_requests'];
const deleteOrder=['seat_assignments','room_assignments','scan_events','refunds','transactions','expenses','cash_shifts','approval_requests','booking_passengers','bookings','trip_branches','trips'];
const protectedTables=['branches','staff_users','roles','permissions','system_settings','developer_settings','document_templates','feature_flags','backup_runs','restore_drill_runs','restore_drill_rows'];

async function actorFrom(request,env){
  try{const r=await restoreWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}
}
const isDeveloper=actor=>String(actor?.role||'').toLowerCase()==='developer';
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function count(env,table,filter=''){
  const qs=new URLSearchParams({select:'id'});if(filter)qs.set('data_environment',filter);
  const r=await fetch(`${base(env)}/rest/v1/${table}?${qs.toString()}`,{headers:{...headers(env),Prefer:'count=exact',Range:'0-0'}});
  const b=await parse(r);if(!r.ok)return {ok:false,count:0,error:b?.message||`HTTP ${r.status}`};
  const cr=r.headers.get('content-range')||'',m=cr.match(/\/(\d+|\*)$/);return {ok:true,count:m&&m[1]!=='*'?Number(m[1]):Array.isArray(b)?b.length:0};
}
async function hasEnvironmentColumn(env,table){
  const r=await fetch(`${base(env)}/rest/v1/${table}?select=id,data_environment&limit=1`,{headers:headers(env)});if(r.ok)return true;const b=await parse(r);return !/data_environment|column/i.test(String(b?.message||''));
}
async function inventoryRow(env,table){
  const total=await count(env,table);if(!total.ok)return {table,ok:false,total:0,training:0,production:0,unlabeled:0,error:total.error};
  const hasEnv=await hasEnvironmentColumn(env,table);
  if(!hasEnv)return {table,ok:true,total:total.count,training:0,production:0,unlabeled:total.count,environment_column:false,error:null};
  const [training,production]=await Promise.all([count(env,table,'eq.training'),count(env,table,'eq.production')]);
  if(!training.ok||!production.ok)return {table,ok:false,total:total.count,training:0,production:0,unlabeled:total.count,error:training.error||production.error};
  const unlabeled=Math.max(0,total.count-training.count-production.count);
  return {table,ok:true,total:total.count,training:training.count,production:production.count,unlabeled,environment_column:true,error:null};
}
async function prelaunchInventory(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'جرد ما قبل الإطلاق متاح للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const tables=[];for(const table of operationalTables)tables.push(await inventoryRow(env,table));
  const blockers=tables.filter(x=>!x.ok);
  const totals=tables.reduce((a,x)=>({total:a.total+x.total,training:a.training+x.training,production:a.production+x.production,unlabeled:a.unlabeled+x.unlabeled}),{total:0,training:0,production:0,unlabeled:0});
  return json({ok:blockers.length===0,preview_only:true,execution_available:false,generated_at:new Date().toISOString(),scope:'all_current_operational_rows_without_ui_filter',totals,tables,protected_tables:protectedTables,blockers:blockers.map(x=>x.table),warnings:['هذه قراءة فقط ولا يوجد أي DELETE في هذا المسار.','الإجمالي لا يعتمد على فلتر واجهة التدريب أو التشغيل.','غير موسوم يشمل الصفوف القديمة أو الصفوف التي لا تحمل data_environment=training/production.','الجداول المحمية لن تدخل في تصفير ما قبل الإطلاق.']});
}
async function tableIds(env,table){
  const r=await fetch(`${base(env)}/rest/v1/${table}?select=id&order=id.asc&limit=10000`,{headers:headers(env)});const b=await parse(r);
  if(!r.ok)return {table,ok:false,ids:[],error:b?.message||`HTTP ${r.status}`};
  return {table,ok:true,ids:(Array.isArray(b)?b:[]).map(x=>String(x?.id??'')).filter(Boolean),error:null};
}
async function latestRestoreTestedSnapshot(env){
  const r=await fetch(`${base(env)}/rest/v1/backup_runs?backup_type=eq.pre_release&status=eq.completed&select=id,storage_path,checksum,restore_tested,restore_tested_at,completed_at&order=completed_at.desc&limit=1`,{headers:headers(env)});const b=await parse(r);
  if(!r.ok)return {ok:false,error:b?.message||`HTTP ${r.status}`,row:null};
  const row=Array.isArray(b)?b[0]:null;return {ok:!!row,row};
}
async function prelaunchResetPlan(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'معاينة التصفير النهائي متاحة للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const rows=[];for(const table of deleteOrder)rows.push(await tableIds(env,table));
  const blockers=rows.filter(x=>!x.ok);if(blockers.length)return json({error:'تعذر تثبيت خطة التصفير بسبب جداول غير قابلة للقراءة.',blockers:blockers.map(x=>({table:x.table,error:x.error}))},422);
  const canonical=rows.map(x=>({table:x.table,ids:x.ids}));const text=JSON.stringify(canonical);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const planHash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const tables=canonical.map(x=>({table:x.table,count:x.ids.length})),total=tables.reduce((n,x)=>n+x.count,0),snapshot=await latestRestoreTestedSnapshot(env);
  return json({ok:true,preview_only:true,execution_available:false,generated_at:new Date().toISOString(),plan_hash:planHash,total_rows:total,tables,delete_order:deleteOrder,protected_tables:protectedTables,latest_snapshot:snapshot.row?{id:snapshot.row.id,completed_at:snapshot.row.completed_at,restore_tested:snapshot.row.restore_tested===true,restore_tested_at:snapshot.row.restore_tested_at||null}:null,requirements:{fresh_snapshot_after_plan:true,restore_drill_after_snapshot:true,double_confirmation:true,exact_plan_hash_match:true},warnings:['هذه خطة حذف مقفلة للمعاينة فقط ولا يوجد تنفيذ DELETE في هذا المسار.','تم تثبيت الخطة ببصمة SHA-256 مبنية على أرقام السجلات الحالية لكل جدول.','أي إضافة أو حذف أو تغيير في مجموعة السجلات قبل التنفيذ سيغير البصمة ويمنع اعتماد الخطة القديمة.','يجب إنشاء Snapshot جديدة بعد هذه الخطة ثم تشغيل Restore Drill عليها قبل فتح التنفيذ.']});
}
async function finalGate(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'بوابة المراجعة النهائية متاحة للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const clone=(path,method='GET')=>new Request(new URL(path,request.url),{method,headers:request.headers});
  const [inventoryR,planR,readinessR,rollbackR]=await Promise.all([
    prelaunchInventory(request,env),
    prelaunchResetPlan(request,env),
    restoreWorker.fetch(clone('/api/production/readiness'),env),
    restoreWorker.fetch(clone('/api/production/rollback-test','POST'),env)
  ]);
  const [inventory,plan,readiness,rollback]=await Promise.all([parse(inventoryR),parse(planR),parse(readinessR),parse(rollbackR)]);
  const checks=[
    {key:'readiness',label:'الجاهزية الأساسية',ok:readinessR.ok&&readiness?.ready===true,details:(readiness?.blockers||[]).length?`موانع: ${(readiness.blockers||[]).join(', ')}`:'الفحوصات الأساسية سليمة'},
    {key:'inventory',label:'الجرد الشامل',ok:inventoryR.ok&&inventory?.ok===true,details:`${inventory?.totals?.total??0} سجل تشغيلي`},
    {key:'reset_plan',label:'خطة التصفير الحالية',ok:planR.ok&&plan?.ok===true&&!!plan?.plan_hash,details:plan?.plan_hash?`SHA-256 ${String(plan.plan_hash).slice(0,12)}…`:'لا توجد بصمة صالحة'},
    {key:'snapshot',label:'Snapshot قبل التشغيل',ok:!!plan?.latest_snapshot,details:plan?.latest_snapshot?.completed_at||'غير موجودة'},
    {key:'restore_drill',label:'Restore Drill على آخر Snapshot',ok:plan?.latest_snapshot?.restore_tested===true,details:plan?.latest_snapshot?.restore_tested_at||'لم ينجح بعد'},
    {key:'rollback',label:'سلامة ملف Rollback',ok:rollbackR.ok&&rollback?.verified===true,details:rollback?.verified?'checksum والتغطية الأساسية سليمان':'فحص Rollback غير مكتمل'}
  ];
  const blockers=checks.filter(x=>!x.ok);
  return json({ok:true,read_only:true,generated_at:new Date().toISOString(),ready_for_final_review:blockers.length===0,activation_available:false,activation_locked:true,checks,blockers:blockers.map(x=>x.key),plan_hash:plan?.plan_hash||null,total_rows:plan?.total_rows??null,latest_snapshot:plan?.latest_snapshot||null,policy:{delete_execution:false,activation_execution:false,double_confirmation_required:true,exact_plan_hash_match_required:true,fresh_snapshot_sequence_must_be_revalidated_immediately_before_activation:true},warnings:['هذا الفحص لا يحذف ولا يعدل أي سجل ولا يفتح Production.','حتى عند نجاح كل الفحوصات سيظل التفعيل مقفولًا إلى أن يتم تنفيذ خطوة منفصلة بتأكيد مزدوج ومطابقة بصمة الخطة لحظيًا.']});
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/production/prelaunch-inventory'&&request.method==='GET')return prelaunchInventory(request,env);if(u.pathname==='/api/production/prelaunch-reset-plan'&&request.method==='GET')return prelaunchResetPlan(request,env);if(u.pathname==='/api/production/final-gate'&&request.method==='GET')return finalGate(request,env);return restoreWorker.fetch(request,env,ctx)}};
