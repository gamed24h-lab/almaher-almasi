import appWorker from './trip-incidents-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const count=v=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0};

function adminRequest(request,action,tripId){
  const headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');
  return new Request(new URL('/api/admin',request.url),{method:'POST',headers,body:JSON.stringify({action,trip_id:tripId})});
}
async function readJson(response,label){
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data?.error||data?.message||`تعذر قراءة ${label}.`);e.status=response.status;e.data=data;throw e}
  return data;
}
async function lowerState(request,env,ctx,action,tripId){return readJson(await appWorker.fetch(adminRequest(request,action,tripId),env,ctx),action)}
function closureFrom(timeline,incidents,handoffs){
  const inc=incidents?.summary||{},hand=handoffs?.summary||{};
  const incidentOpen=count(inc.open),critical=count(inc.critical),high=count(inc.high),warnings=Math.max(0,incidentOpen-critical-high),openHandoffs=count(hand.open);
  const blockers=openHandoffs+critical+high;
  const openIncidentItems=(incidents?.incidents||[]).filter(x=>x?.status==='open');
  const openHandoffItems=(handoffs?.handoffs||[]).filter(x=>x?.status!=='closed');
  return {
    available:true,
    operations_status:low(timeline?.trip?.operations_status||timeline?.current_status||'scheduled'),
    completed:low(timeline?.trip?.operations_status||timeline?.current_status)==='completed',
    blocker_count:blockers,
    warning_count:warnings,
    ready:blockers===0,
    incidents:{open:incidentOpen,critical,high,warning:warnings,items:openIncidentItems.slice(0,12).map(x=>({incident_id:x.incident_id,severity:x.severity,title:x.title,responsible_area:x.responsible_area,booking_number:x.booking_number||null}))},
    handoffs:{open:openHandoffs,pending:count(hand.pending),received:count(hand.received),items:openHandoffItems.slice(0,12).map(x=>({handoff_id:x.handoff_id,status:x.status,from_area:x.from_area,to_area:x.to_area,open_items:x.open_items||null}))},
    policy:{blocks:['open_handoff','critical_incident','high_incident'],warning_note_required:warnings>0}
  };
}
async function verifiedSnapshot(request,env,ctx,tripId){
  const [timeline,incidents,handoffs]=await Promise.all([
    lowerState(request,env,ctx,'trip_operations_timeline',tripId),
    lowerState(request,env,ctx,'trip_incidents_state',tripId),
    lowerState(request,env,ctx,'trip_handoff_state',tripId)
  ]);
  return {timeline,incidents,handoffs,closure:closureFrom(timeline,incidents,handoffs)};
}
async function actorFrom(request,env,ctx){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);
    if(!r.ok)return null;return (await r.json().catch(()=>({})))?.user||null;
  }catch{return null}
}
async function logClosure(env,actor,snapshot,note){
  const trip=snapshot?.timeline?.trip||{},closure=snapshot?.closure||{};
  if(!trip?.id)return false;
  const payload={
    actor_id:txt(actor?.id),actor_name:txt(actor?.name||actor?.username),actor_role:txt(actor?.role),branch_id:trip.branch_id||actor?.branch_id||null,
    action:'trip_operational_closure_passed',entity_type:'trip',entity_id:txt(trip.id),
    metadata:{source:'trip_360',trip_code:trip.trip_code||'',data_environment:trip.data_environment||null,note:note||null,closure:{blocker_count:count(closure.blocker_count),warning_count:count(closure.warning_count),open_handoffs:count(closure.handoffs?.open),open_incidents:count(closure.incidents?.open),critical_incidents:count(closure.incidents?.critical),high_incidents:count(closure.incidents?.high),warning_incidents:count(closure.incidents?.warning)}}
  };
  try{
    const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=minimal'},body:JSON.stringify([payload])});
    return r.ok;
  }catch{return false}
}
async function closureState(request,env,ctx,body){
  const tripId=txt(body?.trip_id);if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  try{const snap=await verifiedSnapshot(request,env,ctx,tripId);return json({ok:true,trip:snap.timeline.trip,closure:snap.closure})}
  catch(e){return json({error:e.message||'تعذر التحقق من جاهزية إقفال الرحلة.',code:'TRIP_CLOSURE_CHECK_UNAVAILABLE'},e.status||502)}
}
async function enrichTimeline(request,env,ctx){
  const lower=await appWorker.fetch(request,env,ctx);if(!lower.ok)return lower;
  const timeline=await lower.json().catch(()=>null);if(!timeline?.trip?.id)return json(timeline||{error:'تعذر قراءة دورة تشغيل الرحلة.'},timeline?200:502);
  try{
    const [incidents,handoffs]=await Promise.all([
      lowerState(request,env,ctx,'trip_incidents_state',timeline.trip.id),
      lowerState(request,env,ctx,'trip_handoff_state',timeline.trip.id)
    ]);
    return json({...timeline,closure:closureFrom(timeline,incidents,handoffs)});
  }catch(e){return json({...timeline,closure:{available:false,ready:false,blocker_count:null,warning_count:null,error:e.message||'تعذر فحص إقفال الرحلة.'}})}
}
async function guardedCompletion(request,env,ctx,body){
  const tripId=txt(body?.trip_id),note=txt(body?.note);if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  let snap;
  try{snap=await verifiedSnapshot(request,env,ctx,tripId)}
  catch(e){return json({error:'تعذر التحقق من التسليمات والمشاكل المفتوحة؛ تم إيقاف الإقفال لحماية سجل الرحلة.',code:'TRIP_CLOSURE_CHECK_UNAVAILABLE',details:e.message||null},409)}
  const c=snap.closure;
  if(c.blocker_count>0){
    const parts=[];if(c.handoffs.open)parts.push(`${c.handoffs.open} تسليم مفتوح`);if(c.incidents.critical)parts.push(`${c.incidents.critical} مشكلة حرجة`);if(c.incidents.high)parts.push(`${c.incidents.high} مشكلة عالية`);
    return json({error:`لا يمكن إكمال الرحلة قبل معالجة: ${parts.join('، ')}.`,code:'TRIP_CLOSURE_BLOCKED',closure:c},409);
  }
  if(c.warning_count>0&&note.length<5)return json({error:`يوجد ${c.warning_count} مشكلة متوسطة/منخفضة ما زالت مفتوحة. اكتب ملاحظة إقفال واضحة قبل إكمال الرحلة.`,code:'TRIP_CLOSURE_NOTE_REQUIRED',closure:c},409);
  const inner=await appWorker.fetch(request,env,ctx);if(!inner.ok)return inner;
  const data=await inner.json().catch(()=>({ok:true}));
  const actor=await actorFrom(request,env,ctx),auditLogged=await logClosure(env,actor,snap,note);
  return json({...data,closure:{...c,completed:true,audit_logged:auditLogged}});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));const action=txt(body?.action);
      if(action==='trip_closure_state')return closureState(request,env,ctx,body);
      if(action==='trip_operations_timeline')return enrichTimeline(request,env,ctx);
      if(action==='set_trip_operations_status'&&low(body?.status)==='completed')return guardedCompletion(request,env,ctx,body);
    }
    return appWorker.fetch(request,env,ctx);
  }
};
