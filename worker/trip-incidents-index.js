import appWorker from './trip-handoff-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const categories=new Set(['delay','vehicle','driver','passenger','housing','qr','finance','other']);
const severities=new Set(['low','medium','high','critical']);
const areas=new Set(['operations','supervisor','housing','branch','finance','fleet']);

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
const canOperations=a=>elevated(a)||a?.permissions?.operations===true||a?.permissions?.trips===true;
const canHousing=a=>elevated(a)||a?.permissions?.housing===true;
const canBooking=a=>elevated(a)||a?.permissions?.editBookings===true||a?.permissions?.manageBookings===true||a?.permissions?.bookings===true;
const canFinance=a=>elevated(a)||a?.permissions?.finance===true||a?.permissions?.collectPayments===true||a?.permissions?.refunds===true;
const canFleet=a=>elevated(a)||a?.permissions?.fleet===true||canOperations(a);

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
  const list=await rows(env,'trip_vehicles',`trip_id=eq.${enc(tripId)}&supervisor_id=eq.${enc(actorId)}&select=id,status&limit=50`).catch(()=>[]);
  return list.some(v=>!['cancelled','released','inactive'].includes(low(v.status||'assigned')));
}
async function canCreateIncident(env,actor,trip){
  if(elevated(actor)||canOperations(actor)||canHousing(actor)||canBooking(actor)||canFinance(actor)||canFleet(actor))return true;
  return assignedSupervisor(env,trip.id,actor);
}
async function canHandleArea(env,actor,trip,area){
  if(elevated(actor))return true;
  if(area==='operations')return canOperations(actor);
  if(area==='housing')return canHousing(actor);
  if(area==='finance')return canFinance(actor);
  if(area==='fleet')return canFleet(actor);
  if(area==='branch')return txt(actor?.branch_id)===txt(trip?.branch_id)||canBooking(actor);
  if(area==='supervisor')return (await assignedSupervisor(env,trip.id,actor))||canOperations(actor);
  return false;
}
function eventId(){try{return crypto.randomUUID()}catch{return `${Date.now()}-${Math.random().toString(36).slice(2)}`}}
async function insertEvent(env,payload){
  const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify([payload])});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||'تعذر تسجيل المشكلة التشغيلية.');
  return Array.isArray(out)?out[0]:payload;
}
async function incidentEvents(env,tripId){
  return rows(env,'activity_events',`entity_type=eq.trip&entity_id=eq.${enc(tripId)}&action=in.(trip_incident_created,trip_incident_closed,trip_incident_reopened)&select=id,actor_id,actor_name,actor_role,action,metadata,created_at&order=created_at.desc&limit=500`).catch(()=>[]);
}
function buildIncidents(events){
  const map=new Map();
  for(const ev of [...events].reverse()){
    const m=ev?.metadata||{},id=txt(m.incident_id);if(!id)continue;
    let item=map.get(id);
    if(!item){item={incident_id:id,status:'open',created:null,closed:null,reopened:null,category:txt(m.category),severity:txt(m.severity),responsible_area:txt(m.responsible_area),title:txt(m.title),details:txt(m.details),booking_number:txt(m.booking_number)};map.set(id,item)}
    if(ev.action==='trip_incident_created'){
      item.created=ev;item.status='open';item.category=txt(m.category)||item.category;item.severity=txt(m.severity)||item.severity;item.responsible_area=txt(m.responsible_area)||item.responsible_area;item.title=txt(m.title)||item.title;item.details=txt(m.details)||item.details;item.booking_number=txt(m.booking_number)||item.booking_number;
    }
    if(ev.action==='trip_incident_closed'){item.closed=ev;item.status='closed'}
    if(ev.action==='trip_incident_reopened'){item.reopened=ev;item.closed=null;item.status='open'}
  }
  const rank={critical:0,high:1,medium:2,low:3};
  return [...map.values()].sort((a,b)=>{
    if(a.status!==b.status)return a.status==='open'?-1:1;
    const r=(rank[a.severity]??9)-(rank[b.severity]??9);if(r)return r;
    return new Date(b.created?.created_at||0)-new Date(a.created?.created_at||0);
  });
}
async function decorate(env,actor,trip,items){
  const out=[];
  for(const item of items){
    const creatorId=txt(item.created?.actor_id),actorId=txt(actor?.id),areaAllowed=await canHandleArea(env,actor,trip,item.responsible_area);
    out.push({...item,can_close:item.status==='open'&&(areaAllowed||creatorId===actorId||canOperations(actor)),can_reopen:item.status==='closed'&&(elevated(actor)||canOperations(actor)||creatorId===actorId)});
  }
  return out;
}
function pick(set,v){const x=low(v);return set.has(x)?x:''}
function clipped(v,max){return txt(v).slice(0,max)}
function basePayload(actor,trip,action,metadata){return {actor_id:txt(actor?.id),actor_name:txt(actor?.name||actor?.username),actor_role:txt(actor?.role),branch_id:trip?.branch_id||actor?.branch_id||null,action,entity_type:'trip',entity_id:txt(trip?.id),metadata}}
async function context(request,env,body){
  const actor=await actorFrom(request,env);if(!actor)return {response:json({error:'انتهت الجلسة.'},401)};
  const tripId=txt(body?.trip_id);if(!tripId)return {response:json({error:'معرّف الرحلة مطلوب.'},400)};
  const trip=await tripRow(env,tripId);if(!trip)return {response:json({error:'الرحلة غير موجودة.'},404)};
  if(!(await canOperateTrip(env,actor,tripId)))return {response:json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403)};
  return {actor,trip,tripId};
}
async function state(request,env,body){
  const ctx=await context(request,env,body);if(ctx.response)return ctx.response;
  const events=await incidentEvents(env,ctx.tripId),items=await decorate(env,ctx.actor,ctx.trip,buildIncidents(events));
  const summary={open:items.filter(x=>x.status==='open').length,critical:items.filter(x=>x.status==='open'&&x.severity==='critical').length,high:items.filter(x=>x.status==='open'&&x.severity==='high').length,closed:items.filter(x=>x.status==='closed').length};
  return json({ok:true,trip:ctx.trip,can_create:await canCreateIncident(env,ctx.actor,ctx.trip),summary,incidents:items.slice(0,100)});
}
async function createIncident(request,env,body){
  const ctx=await context(request,env,body);if(ctx.response)return ctx.response;
  if(!(await canCreateIncident(env,ctx.actor,ctx.trip)))return json({error:'لا توجد صلاحية لتسجيل مشكلة تشغيلية على هذه الرحلة.'},403);
  if(['cancelled','canceled'].includes(low(ctx.trip.status)))return json({error:'لا يمكن تسجيل مشكلة تشغيلية جديدة على رحلة ملغاة.'},409);
  const category=pick(categories,body?.category),severity=pick(severities,body?.severity),responsible=pick(areas,body?.responsible_area),title=clipped(body?.title,160),details=clipped(body?.details,2200),booking=clipped(body?.booking_number,80);
  if(!category||!severity||!responsible)return json({error:'حدد نوع المشكلة ودرجة الخطورة والمسؤول عنها.'},400);
  if(title.length<5)return json({error:'اكتب عنوان مشكلة واضح لا يقل عن 5 أحرف.'},400);
  if(details.length<5)return json({error:'اكتب تفاصيل المشكلة التشغيلية.'},400);
  const id=eventId(),meta={incident_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',data_environment:ctx.trip.data_environment||null,version_no:Number(ctx.trip.version_no||1),category,severity,responsible_area:responsible,title,details,booking_number:booking||null};
  const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_incident_created',meta));
  return json({ok:true,incident_id:id,event:row,notice:'تم فتح المشكلة التشغيلية وتسجيلها في سجل الرحلة.'});
}
async function lifecycle(request,env,body,kind){
  const ctx=await context(request,env,body);if(ctx.response)return ctx.response;
  const id=txt(body?.incident_id);if(!id)return json({error:'رقم المشكلة مطلوب.'},400);
  const item=buildIncidents(await incidentEvents(env,ctx.tripId)).find(x=>x.incident_id===id);if(!item)return json({error:'المشكلة التشغيلية غير موجودة.'},404);
  const note=clipped(body?.note,1600);if(note.length<5)return json({error:'اكتب ملاحظة واضحة لا تقل عن 5 أحرف.'},400);
  const actorId=txt(ctx.actor?.id),creatorId=txt(item.created?.actor_id);
  if(kind==='close'){
    if(item.status!=='open')return json({error:'المشكلة مغلقة بالفعل.'},409);
    const areaAllowed=await canHandleArea(env,ctx.actor,ctx.trip,item.responsible_area);
    if(!(areaAllowed||creatorId===actorId||canOperations(ctx.actor)))return json({error:'هذا الحساب غير مخول بإغلاق هذه المشكلة.'},403);
    const meta={incident_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',category:item.category,severity:item.severity,responsible_area:item.responsible_area,title:item.title,note};
    const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_incident_closed',meta));
    return json({ok:true,event:row,notice:'تم إغلاق المشكلة التشغيلية.'});
  }
  if(item.status!=='closed')return json({error:'المشكلة مفتوحة بالفعل.'},409);
  if(!(elevated(ctx.actor)||canOperations(ctx.actor)||creatorId===actorId))return json({error:'لا توجد صلاحية لإعادة فتح هذه المشكلة.'},403);
  const meta={incident_id:id,source:'trip_360',trip_code:ctx.trip.trip_code||'',operations_status:ctx.trip.operations_status||'scheduled',category:item.category,severity:item.severity,responsible_area:item.responsible_area,title:item.title,note};
  const row=await insertEvent(env,basePayload(ctx.actor,ctx.trip,'trip_incident_reopened',meta));
  return json({ok:true,event:row,notice:'تمت إعادة فتح المشكلة التشغيلية.'});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='trip_incidents_state')return state(request,env,body);
      if(action==='create_trip_incident')return createIncident(request,env,body);
      if(action==='close_trip_incident')return lifecycle(request,env,body,'close');
      if(action==='reopen_trip_incident')return lifecycle(request,env,body,'reopen');
    }
    return appWorker.fetch(request,env,ctx);
  }
};