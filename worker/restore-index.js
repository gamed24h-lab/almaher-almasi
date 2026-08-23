import productionWorker from './production-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const serviceHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const restoreOrder=['branches','system_settings','feature_flags','trips','trip_branches','bookings','booking_passengers'];

async function actorFrom(request,env){
  try{
    const r=await productionWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}
function isDeveloper(actor){return String(actor?.role||'').toLowerCase()==='developer'}
async function parseJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function latestSnapshot(env){
  const url=base(env),h=serviceHeaders(env);
  const r=await fetch(`${url}/rest/v1/backup_runs?backup_type=eq.pre_release&status=eq.completed&select=id,storage_path,checksum,restore_tested,started_at,completed_at,details&order=completed_at.desc&limit=1`,{headers:h});
  const b=await parseJson(r);if(!r.ok)throw new Error(b?.message||`backup_runs HTTP ${r.status}`);
  const row=Array.isArray(b)?b[0]:null;if(!row?.storage_path)throw new Error('لا توجد Snapshot قبل التشغيل مكتملة.');
  return row;
}
async function loadSnapshot(env,row){
  const url=base(env),key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  const objectUrl=`${url}/storage/v1/object/almaher-backups/${String(row.storage_path).split('/').map(encodeURIComponent).join('/')}`;
  const r=await fetch(objectUrl,{headers:{apikey:key,Authorization:`Bearer ${key}`}});if(!r.ok)throw new Error(`تعذر قراءة Snapshot من التخزين (HTTP ${r.status}).`);
  const text=await r.text();let snap=null;try{snap=JSON.parse(text)}catch{throw new Error('ملف Snapshot ليس JSON صالحًا.');}
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));const checksum=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(row.checksum&&String(row.checksum)!==checksum)throw new Error('Checksum الخاص بالـSnapshot غير مطابق.');
  return {snap,checksum};
}
function ids(rows){return new Set((Array.isArray(rows)?rows:[]).map(x=>String(x?.id||'')).filter(Boolean))}
function duplicateIds(rows){const seen=new Set(),dupes=new Set();for(const r of Array.isArray(rows)?rows:[]){const id=String(r?.id||'');if(!id)continue;if(seen.has(id))dupes.add(id);seen.add(id)}return [...dupes]}
function relationshipChecks(snap){
  const t=snap?.tables||{},branches=ids(t.branches),trips=ids(t.trips),bookings=ids(t.bookings);const issues=[];
  for(const table of restoreOrder){const d=duplicateIds(t[table]);if(d.length)issues.push({type:'duplicate_id',table,count:d.length,sample:d.slice(0,5)})}
  for(const b of t.bookings||[]){if(b?.branch_id&&!branches.has(String(b.branch_id)))issues.push({type:'missing_parent',table:'bookings',field:'branch_id',id:String(b.id||''),value:String(b.branch_id)});if(b?.trip_id&&!trips.has(String(b.trip_id)))issues.push({type:'missing_parent',table:'bookings',field:'trip_id',id:String(b.id||''),value:String(b.trip_id)});if(b?.return_trip_id&&!trips.has(String(b.return_trip_id)))issues.push({type:'missing_parent',table:'bookings',field:'return_trip_id',id:String(b.id||''),value:String(b.return_trip_id)})}
  for(const p of t.booking_passengers||[]){if(p?.booking_id&&!bookings.has(String(p.booking_id)))issues.push({type:'missing_parent',table:'booking_passengers',field:'booking_id',id:String(p.id||''),value:String(p.booking_id)})}
  for(const x of t.trip_branches||[]){if(x?.trip_id&&!trips.has(String(x.trip_id)))issues.push({type:'missing_parent',table:'trip_branches',field:'trip_id',id:String(x.id||''),value:String(x.trip_id)});if(x?.branch_id&&!branches.has(String(x.branch_id)))issues.push({type:'missing_parent',table:'trip_branches',field:'branch_id',id:String(x.id||''),value:String(x.branch_id)})}
  return issues;
}
async function ensureDrillSchema(env){
  const url=base(env),h=serviceHeaders(env);
  for(const table of ['restore_drill_runs','restore_drill_rows']){const r=await fetch(`${url}/rest/v1/${table}?select=id&limit=1`,{headers:h});if(!r.ok)return {ok:false,table,status:r.status,body:await parseJson(r)}}
  return {ok:true};
}
async function insertBatch(env,table,rows){
  if(!rows.length)return;
  const url=base(env),h=serviceHeaders(env);const r=await fetch(`${url}/rest/v1/${table}`,{method:'POST',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify(rows)});if(!r.ok){const b=await parseJson(r);throw new Error(b?.message||`${table} HTTP ${r.status}`)}
}
async function isolatedRestoreDrill(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'اختبار Restore المعزول متاح للمطور الحقيقي فقط.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const schema=await ensureDrillSchema(env);if(!schema.ok)return json({error:'جداول Restore Drill المعزولة غير مثبتة بعد.',code:'RESTORE_DRILL_SCHEMA_MISSING',missing_table:schema.table,migration:'sql/2026-08-23_restore_drill_shadow.sql'},409);
  let row,snap,checksum;try{row=await latestSnapshot(env);({snap,checksum}=await loadSnapshot(env,row))}catch(e){return json({error:e.message},422)}
  const tableNames=snap?.tables&&typeof snap.tables==='object'?Object.keys(snap.tables):[];
  const missing=restoreOrder.filter(t=>!tableNames.includes(t));if(missing.length)return json({error:'Snapshot لا تغطي كل جداول Restore Drill المطلوبة.',missing_tables:missing},422);
  const relationIssues=relationshipChecks(snap);if(relationIssues.length)return json({error:'فشل فحص العلاقات داخل Snapshot قبل بدء Restore Drill.',relation_issues:relationIssues.slice(0,50),issue_count:relationIssues.length},422);
  const expectedRows=restoreOrder.reduce((n,t)=>n+(Array.isArray(snap.tables[t])?snap.tables[t].length:0),0),url=base(env),h=serviceHeaders(env),startedAt=new Date().toISOString();
  const runRec={status:'running',snapshot_backup_run_id:String(row.id),snapshot_path:row.storage_path,checksum,initiated_by:actor.name||actor.id,started_at:startedAt,table_count:restoreOrder.length,row_count:expectedRows,details:{restore_order:restoreOrder,production_tables_written:0,isolation:'restore_drill_rows_jsonb'}};
  const runR=await fetch(`${url}/rest/v1/restore_drill_runs`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify([runRec])});const runB=await parseJson(runR);if(!runR.ok)return json({error:runB?.message||'تعذر إنشاء Restore Drill.'},502);const run=Array.isArray(runB)?runB[0]:runB;if(!run?.id)return json({error:'تعذر الحصول على رقم Restore Drill.'},502);
  try{
    for(const table of restoreOrder){const rows=Array.isArray(snap.tables[table])?snap.tables[table]:[];for(let i=0;i<rows.length;i+=150){const batch=rows.slice(i,i+150).map((payload,j)=>({drill_id:run.id,table_name:table,source_id:payload?.id!=null?String(payload.id):null,row_no:i+j+1,payload}));await insertBatch(env,'restore_drill_rows',batch)}}
    const countR=await fetch(`${url}/rest/v1/restore_drill_rows?drill_id=eq.${encodeURIComponent(run.id)}&select=id`,{headers:{...h,Prefer:'count=exact',Range:'0-0'}});const cr=countR.headers.get('content-range')||'',m=cr.match(/\/(\d+|\*)$/),actualRows=m&&m[1]!=='*'?Number(m[1]):0;
    if(!countR.ok||actualRows!==expectedRows)throw new Error(`عدد الصفوف المستعادة في البيئة المعزولة غير مطابق (${actualRows}/${expectedRows}).`);
    const completedAt=new Date().toISOString(),details={restore_order:restoreOrder,expected_rows:expectedRows,restored_rows:actualRows,relation_issues:0,checksum_ok:true,production_tables_written:0,isolation:'restore_drill_rows_jsonb'};
    const doneR=await fetch(`${url}/rest/v1/restore_drill_runs?id=eq.${encodeURIComponent(run.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({status:'completed',completed_at:completedAt,row_count:actualRows,details})});if(!doneR.ok)throw new Error('تمت المحاكاة لكن تعذر تسجيل اكتمال Restore Drill.');
    const backupPatch=await fetch(`${url}/rest/v1/backup_runs?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({restore_tested:true,restore_tested_at:completedAt,restore_test_details:{mode:'isolated_shadow_jsonb',drill_id:run.id,rows:actualRows,tables:restoreOrder,checksum_ok:true,production_tables_written:0}})});if(!backupPatch.ok)throw new Error('نجح Restore Drill لكن تعذر تحديث حالة restore_tested في backup_runs.');
    return json({ok:true,verified:true,isolated_restore:true,production_tables_written:0,drill:{id:run.id,status:'completed',started_at:startedAt,completed_at:completedAt,table_count:restoreOrder.length,expected_rows:expectedRows,restored_rows:actualRows},snapshot:{backup_run_id:row.id,storage_path:row.storage_path,checksum_ok:true},relationship_checks:{ok:true,issues:0},restore_order:restoreOrder,warnings:['تمت الاستعادة التجريبية داخل جداول Shadow معزولة فقط.','لم تتم أي كتابة على جداول التشغيل الفعلية.','تم تعليم الـSnapshot بأنها اجتازت Restore Drill المعزول.']});
  }catch(e){
    await fetch(`${url}/rest/v1/restore_drill_runs?id=eq.${encodeURIComponent(run.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({status:'failed',completed_at:new Date().toISOString(),details:{error:e.message,production_tables_written:0}})}).catch(()=>{});
    return json({error:e.message,drill_id:run.id,production_tables_written:0},502);
  }
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/production/restore-drill'&&request.method==='POST')return isolatedRestoreDrill(request,env);
    return productionWorker.fetch(request,env,ctx);
  }
};
