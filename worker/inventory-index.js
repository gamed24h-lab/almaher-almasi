import restoreWorker from './restore-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

const operationalTables=['trips','trip_branches','bookings','booking_passengers','transactions','expenses','refunds','cash_shifts','room_assignments','seat_assignments','scan_events','approval_requests'];
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

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/production/prelaunch-inventory'&&request.method==='GET')return prelaunchInventory(request,env);return restoreWorker.fetch(request,env,ctx)}};
