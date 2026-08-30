import appWorker from './booking-internal-notes-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();

const STAGE_LABELS={
  scheduled:'مجدولة',
  preparing:'التجهيز',
  boarding_outbound:'صعود الذهاب',
  departed_outbound:'تحرك الذهاب',
  arrived_destination:'وصول الوجهة',
  housing:'التسكين',
  preparing_return:'تجهيز العودة',
  boarding_return:'صعود العودة',
  departed_return:'تحرك العودة',
  arrived_return:'وصول العودة',
  completed:'مكتملة',
  return_meeting:'تجمع العودة',
  return_departure:'تحرك العودة',
  return_arrival:'وصول العودة'
};
const ALL_STAGES=['scheduled','preparing','boarding_outbound','departed_outbound','arrived_destination','housing','preparing_return','boarding_return','departed_return','arrived_return','completed'];

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
const canViewOperations=a=>elevated(a)||a?.permissions?.operations===true||a?.permissions?.trips===true||a?.permissions?.manifest===true||a?.permissions?.scanner===true||a?.permissions?.viewBookings===true;
const canWriteOperations=a=>elevated(a)||a?.permissions?.operations===true||a?.permissions?.trips===true;

async function tripRow(env,id){
  if(!id)return null;
  return (await rows(env,'trips',`id=eq.${enc(id)}&select=id,trip_code,branch_id,status,from_city,to_city,origin,destination,departure_date,departure_time,return_date,return_time,operations_status,version_no,operational_closed,data_environment&limit=1`))[0]||null;
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
function activeBooking(b){return !['cancelled','canceled','refunded','deleted'].includes(low(b?.status||b?.booking_status))}
async function operationalPath(env,trip){
  const id=txt(trip?.id);
  let related=[];
  if(id){
    const filter=enc(`(trip_id.eq.${id},return_trip_id.eq.${id})`);
    related=await rows(env,'bookings',`or=${filter}&select=id,status,booking_status,accommodation_type&limit=5000`).catch(()=>[]);
  }
  const hasHousing=related.some(b=>activeBooking(b)&&!['','none','no','without'].includes(low(b.accommodation_type)));
  const path=['scheduled','preparing','boarding_outbound','departed_outbound','arrived_destination'];
  if(hasHousing)path.push('housing');
  if(trip?.return_date)path.push('preparing_return','boarding_return','departed_return','arrived_return');
  path.push('completed');
  return {path,hasHousing,hasReturn:!!trip?.return_date};
}
function normalizeStage(v){
  const x=low(v)||'scheduled';
  if(ALL_STAGES.includes(x))return x;
  if(x==='boarding')return 'boarding_outbound';
  if(x==='departed')return 'departed_outbound';
  if(x==='arrived')return 'arrived_destination';
  return x;
}
function eventView(r){
  const m=r?.metadata&&typeof r.metadata==='object'?r.metadata:{};
  return {
    id:r?.id||null,
    event_key:txt(r?.event_key),
    label:STAGE_LABELS[txt(r?.event_key)]||txt(r?.event_key)||'حدث تشغيلي',
    actual_at:r?.actual_at||r?.created_at||null,
    planned_at:r?.planned_at||null,
    actor_id:txt(r?.actor_id),
    actor_name:txt(m.actor_name)||txt(r?.actor_id)||'النظام',
    actor_role:txt(m.actor_role),
    notes:txt(r?.notes),
    metadata:m,
    created_at:r?.created_at||null
  };
}
async function timelinePayload(env,trip,actor){
  const {path,hasHousing,hasReturn}=await operationalPath(env,trip);
  const events=await rows(env,'trip_status_events',`trip_id=eq.${enc(trip.id)}&select=id,trip_id,event_key,planned_at,actual_at,actor_id,notes,metadata,created_at&order=created_at.desc&limit=100`).catch(()=>[]);
  const current=normalizeStage(trip.operations_status);
  const index=path.indexOf(current);
  const next=index>=0&&index<path.length-1?path[index+1]:null;
  return {
    ok:true,
    trip:{
      id:trip.id,
      trip_code:trip.trip_code||'',
      branch_id:trip.branch_id||null,
      status:trip.status||'',
      operations_status:current,
      version_no:Number(trip.version_no||1),
      operational_closed:trip.operational_closed===true,
      departure_date:trip.departure_date||null,
      departure_time:trip.departure_time||null,
      return_date:trip.return_date||null,
      return_time:trip.return_time||null,
      data_environment:trip.data_environment||null
    },
    current_status:current,
    current_label:STAGE_LABELS[current]||current,
    current_index:index,
    next_status:next,
    next_label:next?STAGE_LABELS[next]||next:null,
    path:path.map((key,i)=>({key,label:STAGE_LABELS[key]||key,index:i})),
    has_housing:hasHousing,
    has_return:hasReturn,
    can_write:canWriteOperations(actor),
    can_force:elevated(actor),
    events:events.map(eventView)
  };
}
async function loadTimeline(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canViewOperations(actor))return json({error:'لا توجد صلاحية لعرض دورة تشغيل الرحلة.'},403);
  const tripId=txt(body?.trip_id);
  if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  const trip=await tripRow(env,tripId);
  if(!trip)return json({error:'الرحلة غير موجودة.'},404);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403);
  return json(await timelinePayload(env,trip,actor));
}
async function setOperationsStatus(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canWriteOperations(actor))return json({error:'لا توجد صلاحية لتغيير مرحلة تشغيل الرحلة.'},403);
  const tripId=txt(body?.trip_id),next=normalizeStage(body?.status),note=txt(body?.note);
  const expectedVersion=Number(body?.version_no||0),force=body?.force===true;
  if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  if(!ALL_STAGES.includes(next))return json({error:'مرحلة التشغيل المطلوبة غير معروفة.'},400);
  if(note.length>1000)return json({error:'الملاحظة طويلة جدًا. الحد الأقصى 1000 حرف.'},400);
  const trip=await tripRow(env,tripId);
  if(!trip)return json({error:'الرحلة غير موجودة.'},404);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403);
  if(low(trip.status)==='cancelled')return json({error:'الرحلة ملغاة ولا يمكن تحريك دورة تشغيلها.'},409);
  const current=normalizeStage(trip.operations_status),currentVersion=Number(trip.version_no||1);
  if(expectedVersion&&expectedVersion!==currentVersion)return json({error:'تم تحديث الرحلة من مستخدم آخر. حدّث Trip 360 ثم أعد المحاولة.',code:'VERSION_CONFLICT',expected_version:expectedVersion,current_version:currentVersion},409);
  if(current===next)return json({...(await timelinePayload(env,trip,actor)),unchanged:true});
  const {path}=await operationalPath(env,trip);
  const currentIndex=path.indexOf(current),nextIndex=path.indexOf(next);
  if(currentIndex<0)return json({error:`حالة التشغيل الحالية «${current}» تحتاج مراجعة قبل المتابعة.`,code:'UNKNOWN_OPERATIONS_STATUS'},409);
  if(nextIndex<0)return json({error:'المرحلة المطلوبة لا تنطبق على مسار هذه الرحلة حاليًا.'},409);
  const validForward=nextIndex===currentIndex+1;
  if(!validForward){
    if(!(force&&elevated(actor)&&note))return json({error:`الانتقال المسموح الآن هو «${STAGE_LABELS[path[currentIndex+1]]||'لا توجد مرحلة تالية'}».`,code:'INVALID_STAGE_TRANSITION',expected_next:path[currentIndex+1]||null},409);
  }
  const now=new Date().toISOString(),h=dbHeaders(env),b=base(env);
  const patch={operations_status:next,version_no:currentVersion+1,operational_closed:next==='completed',updated_at:now};
  const update=await fetch(`${b}/rest/v1/trips?id=eq.${enc(trip.id)}&version_no=eq.${enc(currentVersion)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(patch)});
  const updated=await parse(update);
  if(!update.ok)return json({error:updated?.message||updated?.details||'تعذر تحديث مرحلة تشغيل الرحلة.'},update.status>=500?502:update.status);
  if(!Array.isArray(updated)||!updated.length)return json({error:'تم تحديث الرحلة من مستخدم آخر. حدّث Trip 360 ثم أعد المحاولة.',code:'VERSION_CONFLICT'},409);

  const eventPayload={
    trip_id:trip.id,
    event_key:next,
    actual_at:now,
    actor_id:txt(actor.id)||null,
    notes:note||null,
    metadata:{
      before:current,
      after:next,
      actor_name:txt(actor.name||actor.username)||'موظف',
      actor_role:txt(actor.role),
      branch_id:trip.branch_id||actor.branch_id||null,
      source:'trip_360',
      forced:force&&elevated(actor),
      version_before:currentVersion,
      version_after:currentVersion+1
    }
  };
  const ev=await fetch(`${b}/rest/v1/trip_status_events`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify([eventPayload])});
  const evOut=await parse(ev);
  if(!ev.ok){
    let rolledBack=false;
    try{
      const rb=await fetch(`${b}/rest/v1/trips?id=eq.${enc(trip.id)}&version_no=eq.${enc(currentVersion+1)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({operations_status:current,version_no:currentVersion+2,operational_closed:trip.operational_closed===true,updated_at:new Date().toISOString()})});
      rolledBack=rb.ok;
    }catch{}
    if(rolledBack)return json({error:'تعذر تسجيل سجل المرحلة، لذلك تم التراجع عن تغيير حالة التشغيل. أعد المحاولة.',code:'TRIP_STAGE_EVENT_ROLLBACK'},409);
    return json({error:'تم تغيير مرحلة الرحلة لكن تعذر تسجيل سجلها ولم ينجح التراجع التلقائي. راجع الرحلة فورًا.',code:'TRIP_STAGE_REVIEW_REQUIRED'},500);
  }

  const audit={
    actor_id:txt(actor.id),
    actor_name:txt(actor.name||actor.username),
    actor_role:txt(actor.role),
    branch_id:trip.branch_id||actor.branch_id||null,
    action:'trip_operations_status_changed',
    entity_type:'trip',
    entity_id:txt(trip.id),
    metadata:{trip_code:trip.trip_code||'',before:current,after:next,note:note||null,source:'trip_360',forced:force&&elevated(actor)}
  };
  try{await fetch(`${b}/rest/v1/activity_events`,{method:'POST',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify([audit])})}catch{}
  const after=Array.isArray(updated)?updated[0]:updated;
  return json(await timelinePayload(env,{...trip,...after,operations_status:next,version_no:currentVersion+1,operational_closed:next==='completed'},actor));
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='trip_operations_timeline')return loadTimeline(request,env,body);
      if(action==='set_trip_operations_status')return setOperationsStatus(request,env,body);
    }
    return appWorker.fetch(request,env,ctx);
  }
};