import appWorker from './trip-boarding-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:dbHeaders(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);
  return Array.isArray(out)?out:[];
}
async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    return (await r.json().catch(()=>({})))?.user||null;
  }catch{return null}
}
const elevated=a=>!!a&&(low(a.role)==='developer'||txt(a.role)==='مدير عام'||a.permissions?.all===true);
const canAllBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canWriteOperations=a=>elevated(a)||a?.permissions?.operations===true||a?.permissions?.trips===true;

async function tripRow(env,id){
  if(!id)return null;
  return (await rows(env,'trips',`id=eq.${enc(id)}&select=id,trip_code,branch_id,status,operations_status,version_no,data_environment&limit=1`))[0]||null;
}
async function canOperateTrip(env,actor,tripId){
  if(canAllBranches(actor))return true;
  const branchId=txt(actor?.branch_id),id=txt(tripId);
  if(!branchId||!id)return false;
  const trip=await tripRow(env,id);
  if(trip&&txt(trip.branch_id)===branchId)return true;
  const rel=await rows(env,'trip_branches',`trip_id=eq.${enc(id)}&branch_id=eq.${enc(branchId)}&operations_access=eq.true&active=eq.true&select=id&limit=1`).catch(()=>[]);
  return rel.length>0;
}
async function latestAck(env,tripId){
  const list=await rows(env,'activity_events',`entity_type=eq.trip&entity_id=eq.${enc(tripId)}&action=eq.trip_readiness_exception_acknowledged&select=id,actor_id,actor_name,actor_role,metadata,created_at&order=created_at.desc&limit=1`).catch(()=>[]);
  return list[0]||null;
}
function safeCount(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(10000,Math.trunc(n))):0}
async function insertAck(env,actor,trip,body){
  const note=txt(body?.note);
  if(note.length<5)return {error:'اكتب سبب اعتماد واضح لا يقل عن 5 أحرف.',status:400};
  if(note.length>1000)return {error:'الملاحظة أطول من الحد المسموح.',status:400};
  const critical=safeCount(body?.critical_count),warnings=safeCount(body?.warning_count),total=safeCount(body?.exception_total);
  const payload={
    actor_id:txt(actor?.id),
    actor_name:txt(actor?.name||actor?.username),
    actor_role:txt(actor?.role),
    branch_id:trip?.branch_id||actor?.branch_id||null,
    action:'trip_readiness_exception_acknowledged',
    entity_type:'trip',
    entity_id:txt(trip?.id),
    metadata:{
      source:'trip_360',
      trip_code:trip?.trip_code||'',
      operations_status:trip?.operations_status||'scheduled',
      data_environment:trip?.data_environment||null,
      version_no:Number(trip?.version_no||1),
      critical_count:critical,
      warning_count:warnings,
      exception_total:total,
      note
    }
  };
  const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify([payload])});
  const out=await parse(r);
  if(!r.ok)return {error:out?.message||out?.details||'تعذر تسجيل اعتماد الجاهزية.',status:r.status||500};
  const row=Array.isArray(out)?out[0]:null;
  return {row:row||{...payload,created_at:new Date().toISOString()}};
}
async function handleState(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  const tripId=txt(body?.trip_id);
  if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  const trip=await tripRow(env,tripId);
  if(!trip)return json({error:'الرحلة غير موجودة.'},404);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403);
  const ack=await latestAck(env,tripId);
  return json({ok:true,trip,ack,can_ack:canWriteOperations(actor)});
}
async function handleAck(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canWriteOperations(actor))return json({error:'لا توجد صلاحية لاعتماد مراجعة الاستثناءات.'},403);
  const tripId=txt(body?.trip_id);
  if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  const trip=await tripRow(env,tripId);
  if(!trip)return json({error:'الرحلة غير موجودة.'},404);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403);
  if(['cancelled','canceled'].includes(low(trip.status)))return json({error:'لا يمكن اعتماد جاهزية رحلة ملغاة.'},409);
  const saved=await insertAck(env,actor,trip,body);
  if(saved.error)return json({error:saved.error},saved.status||500);
  return json({ok:true,trip,ack:saved.row,can_ack:true,notice:'تم توثيق مراجعة الاستثناءات. هذا الاعتماد لا يتجاوز حارس الصعود أو صلاحيات التحرك.'});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='trip_readiness_state')return handleState(request,env,body);
      if(action==='ack_trip_readiness_exception')return handleAck(request,env,body);
    }
    return appWorker.fetch(request,env,ctx);
  }
};