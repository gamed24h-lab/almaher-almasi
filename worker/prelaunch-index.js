import restoreWorker from './restore-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

// Preview only. No DELETE endpoint exists in this gateway.
const resetTables=[
  'seat_assignments','room_assignments','scan_events','refunds','transactions','expenses','cash_shifts','approval_requests',
  'booking_passengers','bookings','trip_branches','trips'
];
const protectedTables=['branches','staff_users','roles','permissions','system_settings','developer_settings','document_templates','feature_flags','backup_runs','restore_drill_runs','restore_drill_rows'];

async function actorFrom(request,env){
  try{const r=await restoreWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}
}
const isDeveloper=actor=>String(actor?.role||'').toLowerCase()==='developer';
async function countTable(env,table){
  const r=await fetch(`${base(env)}/rest/v1/${table}?select=id`,{headers:{...headers(env),Prefer:'count=exact',Range:'0-0'}});
  const text=await r.text();let body=[];try{body=text?JSON.parse(text):[]}catch{}
  if(!r.ok)return {table,ok:false,count:0,error:body?.message||`HTTP ${r.status}`};
  const cr=r.headers.get('content-range')||'',m=cr.match(/\/(\d+|\*)$/);return {table,ok:true,count:m&&m[1]!=='*'?Number(m[1]):Array.isArray(body)?body.length:0,error:null};
}
async function prelaunchResetPreview(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'معاينة تصفير التشغيل متاحة للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const tables=[];for(const table of resetTables)tables.push(await countTable(env,table));
  const blockers=tables.filter(x=>!x.ok),total=tables.reduce((n,x)=>n+(x.ok?x.count:0),0);
  return json({ok:blockers.length===0,preview_only:true,execution_available:false,generated_at:new Date().toISOString(),scope:'all_current_operational_rows',would_delete_rows:total,tables:tables.map(x=>({...x,would_delete:x.ok?x.count:0})),protected_tables:protectedTables,delete_order:resetTables,warnings:['هذه معاينة قراءة فقط ولا يوجد في هذا المسار أي أمر DELETE.','المعاينة تشمل كل البيانات التشغيلية الحالية حتى لو لم تكن موسومة training.','الفروع والموظفون والصلاحيات والإعدادات والقوالب والنسخ الاحتياطية ونتائج Restore Drill محمية من التصفير.','التنفيذ الفعلي سيظل مقفولًا حتى Snapshot أخيرة + Restore Drill ناجح + تأكيد مزدوج.'],blockers:blockers.map(x=>x.table)});
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/production/prelaunch-reset-preview'&&request.method==='GET')return prelaunchResetPreview(request,env);return restoreWorker.fetch(request,env,ctx)}};
