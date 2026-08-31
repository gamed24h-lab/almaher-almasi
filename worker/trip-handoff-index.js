import appWorker from './trip-readiness-gate-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const areas=new Set(['branch','supervisor','operations','housing']);

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
const canHousing=a=>elevated(a)||a?.permissions?.housing===true;
const canBooking=a=>elevated(a)||a?.permissions?.editBookings===true||a?.permissions?.manageBookings===true||a?.permissions?.bookings===true;

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
async function assignedSupervisor(env,tripId,actor){
  const actorId=txt(actor?.id);if(!actorId)return false;
  const list=await rows(env,'trip_vehicles',`trip_id=eq.${enc(tripId)}&supervisor_id=eq.${enc(actorId)}&select=id,status&limit=20`).catch(()=>[]);
  return list.some(v=>!['cancelled','released','inactive'].includes(low(v.status||'assigned')));
}
async function canReceiveArea(env,actor,trip,area){
  if(elevated(actor))return true;
  if(area==='operations')return canWriteOperations(actor);
  if(area==='housing')return canHousing(actor);
  if(area==='branch')return canAllBranches(actor)||txt(actor?.branch_id)===txt(trip?.branch_id)||canBooking(actor);
  if(area==='supervisor')return (await assignedSupervisor(env,trip.id,actor))||canWriteOperations(actor);
  return false;
}
async function canCreateHandoff(env,actor,trip){
  if(elevated(actor)||canWriteOperations(actor)||canHousing(actor)||canBooking(actor))return true;
  return assignedSupervisor(env,trip.id,actor);
}
function eventId(){try{return crypto.randomUUID()}catch{return `${Date.now()}-${Math.random().toString(36).slice(2)}`}}
async function insertEvent(env,payload){
  const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify([payload])});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||'تعذر تسجيل حركة التسليم والاستلام.');
  return Array.isArray(out)?out[0]:payload;
}
async function handoffEvents(env,tripId){
  return rows(env,'activity_events',`entity_type=eq.trip&entity_id=eq.${enc(tripId)}&action=in.(trip_handoff_created,trip_handoff_received,trip_handoff_closed)&select=id,actor_id,actor_name,actor_role,action,metadata,created_at&order=created_at.desc&limit=300`).catch(()=>[]);
}
function buildHandoffs(events){
  const map=new Map();
  for(const ev of [...events].reverse()){
    const m=ev?.metadata||{},id=txt(m.handoff_id);if(!id)continue;
    let h=map.get(id);
    if(!h){h={handoff_id:id,status:'pending',created:null,received:null,closed:null,from_area:txt(m.from_area),to_area:txt(m.to_area),operations_status:txt(m.operations_status),trip_code:txt(m.trip_code),note:txt(m.note),open_items:txt(m.open_items)};map.set(id,h)}
    if(ev.action==='trip_handoff_created'){
      h.created=ev;h.status='pending';h.from_area=txt(m.from_area)||h.from_area;h.to_area=txt(m.to_area)||h.to_area;h.operations_status=txt(m.operations_status)||h.operations_status;h.note=txt(m.note)||h.note;h.open_items=txt(m.open_items)||h.open_items;
    }
    if(ev.action==='trip_handoff_received'){h.received=ev;h.status='received'}
    if(ev.action==='trip_handoff_closed'){h.closed=ev;h.status='closed'}
  }
  return [...map.values()].sort((a,b)=>new Date(b.created?.created_at||0)-new Date(a.created?.created_at||0));
}
async function decorate(env,actor,trip,handoffs){
  const out=[];
  for(const h of handoffs){
    const receiverId=txt(h.received?.actor_id),senderId=txt(h.created?.actor_id),actorId=txt(actor?.id);
    const receiveAllowed=h.status==='pending'&&await canReceiveArea(env,actor,trip,h.to_area);
    const closeAllowed=h.status==='received'&&(elevated(actor)||canWriteOperations(actor)||actorId===receiverId||actorId===senderId);
    out.push({...h,can_receive:receiveAllowed,can_close:closeAllowed});
  }
  return out;
}
function area(v){const x=low(v);return areas.has(x)?x:''}
function note(v,max=1600){return txt(v).slice(0,max)}
function basePayload(actor,trip,action,metadata){
  return {actor_id:txt(actor?.id),actor_name:txt(actor?.name||actor?.username),actor_role:txt(actor?.role),branch_id:trip?.branch_id||actor?.branch_id||null,action,entity_type:'trip',entity_id:txt(trip?.id),metadata};
}
async function readContext(request,env,body){
  const actor=await actorFrom(request,env);if(!actor)return {response:json({error:'انتهت الجلسة.'},401)};
  const tripId=txt(body?.trip_id);if(!tripId)return {response:json({error:'معرّف الرحلة مطلوب.'},400)};
  const trip=await tripRow(env,tripId);if(!trip)return {response:json({error:'الرحلة غير موجودة.'},404)};
  if(!(await canOperateTrip(env,actor,tripId)))return {response:json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403)};
  return {actor,trip,tripId};
}
async function state(request,env,body){
  const ctx=await readContext(request,env,body);if(ctx.response)return ctx.response;
  const events=await handoffEvents(env,ctx.tripId),items=await decorate(env,ctx.actor,ctx.trip,buildHandoffs(events));
  const summary={pending:items.filter(x=>x.status==='pending').length,received:items.filter(x=>x.status==='received').length,closed:items.filter(x=>x.status==='closed').length,open:items.filter(x=>x.status!=='closed').length};
  return json({ok:true,trip:ctx.trip,can_create:await canCreateHandoff(env,ctx.actor,ctx.trip),summary,handoffs:items.slice(0,60)});
}
async function createHandoff(request,env,body){
  const ctx=await readContext(request,env,body);if(ctx.response)return ctx.response;
  if(!(await canCreateHandoff(env,ctx.actor,ctx.trip)))return json({error:'لا توجد صلاحية لإنشاء تسليم على هذه الرحلة.'},403);
  if(['cancelled','canceled'].includes(low(ctx.trip.status)))return json({error:'لا يمكن إنشاء تسليم جديد لرحلة ملغاة.'},409);
  const fromArea=area(body?.from_area),toArea=area(body?.to_area),message=note(body?.note),openItems=note(body?.open_items,2200);
  if(!fromArea||!toArea)return json({error:'حدد جهة التسليم وجهة الاستلام.'},400);
  if(fromArea===toArea)return json({error:'جهة التسليم والاستلام يجب أن تكونا مختلفتين.'},400);
  if(message.length<5)return json({error:'اكتب ملاحظة تسليم واضحة لا تقل عن 5 أحرف.'},400);
  const id=eventId(),meta={handoff_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',data_environment:ctx.trip.data_environment||null,version_no:Number(ctx.trip.version_no||1),from_area:fromArea,to_area:toArea,note:message,open_items:openItems||null};
  const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_handoff_created',meta));
  return json({ok:true,handoff_id:id,event:row,notice:'تم تسجيل التسليم وأصبح في انتظار الاستلام.'});
}
async function lifecycleEvent(request,env,body,kind){
  const ctx=await readContext(request,env,body);if(ctx.response)return ctx.response;
  const id=txt(body?.handoff_id);if(!id)return json({error:'رقم التسليم مطلوب.'},400);
  const events=await handoffEvents(env,ctx.tripId),handoff=buildHandoffs(events).find(x=>x.handoff_id===id);
  if(!handoff)return json({error:'سجل التسليم غير موجود.'},404);
  const message=note(body?.note);
  if(kind==='receive'){
    if(handoff.status!=='pending')return json({error:'هذا التسليم تم استلامه أو إغلاقه بالفعل.'},409);
    if(!(await canReceiveArea(env,ctx.actor,ctx.trip,handoff.to_area)))return json({error:'هذا الحساب غير مخول باستلام التسليم لهذه الجهة.'},403);
    const meta={handoff_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',from_area:handoff.from_area,to_area:handoff.to_area,note:message||null,original_sender_id:txt(handoff.created?.actor_id),original_sender_name:txt(handoff.created?.actor_name)};
    const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_handoff_received',meta));
    return json({ok:true,event:row,notice:'تم تسجيل استلام الرحلة.'});
  }
  if(handoff.status!=='received')return json({error:'لا يمكن إغلاق التسليم قبل تسجيل الاستلام.'},409);
  const receiverId=txt(handoff.received?.actor_id),senderId=txt(handoff.created?.actor_id),actorId=txt(ctx.actor?.id);
  if(!(elevated(ctx.actor)||canWriteOperations(ctx.actor)||actorId===receiverId||actorId===senderId))return json({error:'لا توجد صلاحية لإغلاق سجل التسليم.'},403);
  if(message.length<5)return json({error:'اكتب ملاحظة إغلاق واضحة لا تقل عن 5 أحرف.'},400);
  const meta={handoff_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',from_area:handoff.from_area,to_area:handoff.to_area,note:message,received_by:txt(handoff.received?.actor_name),open_items:handoff.open_items||null};
  const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_handoff_closed',meta));
  return json({ok:true,event:row,notice:'تم إغلاق سجل التسليم والاستلام.'});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='trip_handoff_state')return state(request,env,body);
      if(action==='create_trip_handoff')return createHandoff(request,env,body);
      if(action==='receive_trip_handoff')return lifecycleEvent(request,env,body,'receive');
      if(action==='close_trip_handoff')return lifecycleEvent(request,env,body,'close');
    }
    return appWorker.fetch(request,env,ctx);
  }
};