import appWorker from './trip-lifecycle-index.js';

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
function activeBooking(b){return !['cancelled','canceled','refunded','deleted'].includes(low(b?.status||b?.booking_status))}
function activePassenger(p){return !['cancelled','canceled','released','inactive','deleted','refunded'].includes(low(p?.status))}
function scanSuccess(x){return low(x?.result||x?.metadata?.scan_result)==='success'}

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
function phaseBooking(b,tripId,phase){
  const id=txt(tripId),mode=low(b?.journey_mode),outId=txt(b?.trip_id||b?.outbound_trip_id),retId=txt(b?.return_trip_id);
  const outboundHere=outId===id;
  const returnHere=retId===id;
  if(phase==='outbound')return outboundHere&&mode!=='returnonly';
  if(returnHere&&retId!==outId)return true;
  return outboundHere&&['roundtrip','returnonly'].includes(mode);
}
function phaseForTimeline(data){
  const current=low(data?.current_status),next=low(data?.next_status);
  if(current.includes('return')||next.includes('return'))return 'return';
  if(current==='completed'&&data?.has_return)return 'return';
  return 'outbound';
}
async function boardingSummary(env,tripId,phase){
  const id=txt(tripId),scanMode=phase==='return'?'return_boarding':'outbound_boarding';
  const filter=enc(`(trip_id.eq.${id},return_trip_id.eq.${id})`);
  const related=await rows(env,'bookings',`or=${filter}&select=id,booking_number,branch_id,customer_name,status,booking_status,journey_mode,trip_id,outbound_trip_id,return_trip_id,travelers_count,travelers&limit=5000`);
  const bookings=related.filter(activeBooking).filter(b=>phaseBooking(b,id,phase));
  const bookingIds=bookings.map(b=>txt(b.id)).filter(Boolean);
  const counts=new Map();
  if(bookingIds.length){
    const passengerRows=await rows(env,'booking_passengers',`booking_id=in.(${bookingIds.join(',')})&select=id,booking_id,status&limit=10000`).catch(()=>[]);
    for(const p of passengerRows){
      if(!activePassenger(p))continue;
      const key=txt(p.booking_id);counts.set(key,(counts.get(key)||0)+1);
    }
  }
  let scans=[],available=true,error='';
  try{
    scans=await rows(env,'scan_events',`trip_id=eq.${enc(id)}&scan_mode=eq.${enc(scanMode)}&select=id,booking_id,scanned_at,result,metadata&order=scanned_at.desc&limit=5000`);
  }catch(e){available=false;error=txt(e?.message)||'تعذر قراءة بيانات QR';}
  const boardedIds=new Set();let lastScanAt=null;
  if(available){
    for(const s of scans){
      if(!scanSuccess(s))continue;
      const bid=txt(s.booking_id);if(bid)boardedIds.add(bid);
      if(!lastScanAt&&s.scanned_at)lastScanAt=s.scanned_at;
    }
  }
  let passengersTotal=0,passengersBoarded=0,bookingsBoarded=0;
  const pending=[];
  for(const b of bookings){
    const bid=txt(b.id),actual=counts.get(bid)||0,fallback=Math.max(0,Number(b.travelers_count||b.travelers||0)),passengers=actual||fallback;
    passengersTotal+=passengers;
    const boarded=available&&boardedIds.has(bid);
    if(boarded){bookingsBoarded++;passengersBoarded+=passengers}
    else pending.push({booking_id:bid,booking_number:txt(b.booking_number),customer_name:txt(b.customer_name),branch_id:txt(b.branch_id),passengers});
  }
  return {
    available,
    error:error||null,
    phase,
    scan_mode:scanMode,
    bookings_total:bookings.length,
    bookings_boarded:bookingsBoarded,
    bookings_pending:Math.max(0,bookings.length-bookingsBoarded),
    passengers_total:passengersTotal,
    passengers_boarded:passengersBoarded,
    passengers_pending:Math.max(0,passengersTotal-passengersBoarded),
    all_boarded:available&&bookings.length===bookingsBoarded,
    last_scan_at:lastScanAt,
    pending:pending.slice(0,20)
  };
}
async function supervisorState(env,tripId,actor){
  const vehicles=await rows(env,'trip_vehicles',`trip_id=eq.${enc(tripId)}&select=id,supervisor_id,status&limit=200`).catch(()=>[]);
  const supervisors=[...new Set(vehicles.filter(v=>!['cancelled','released','inactive'].includes(low(v.status||'assigned'))).map(v=>txt(v.supervisor_id)).filter(Boolean))];
  const actorId=txt(actor?.id),actorAssigned=!!actorId&&supervisors.includes(actorId);
  return {
    assigned_count:supervisors.length,
    supervisor_assigned:supervisors.length>0,
    actor_is_assigned_supervisor:actorAssigned,
    actor_can_approve:supervisors.length?actorAssigned||elevated(actor):canWriteOperations(actor),
    fallback_to_operations:supervisors.length===0
  };
}
async function logDepartureApproval(env,actor,trip,phase,boarding,approval,note){
  const payload={
    actor_id:txt(actor?.id),
    actor_name:txt(actor?.name||actor?.username),
    actor_role:txt(actor?.role),
    branch_id:trip?.branch_id||actor?.branch_id||null,
    action:'trip_departure_boarding_confirmed',
    entity_type:'trip',
    entity_id:txt(trip?.id),
    metadata:{
      trip_code:trip?.trip_code||'',phase,source:'trip_360',note:note||null,
      supervisor_assigned:approval.supervisor_assigned,
      actor_is_assigned_supervisor:approval.actor_is_assigned_supervisor,
      boarding:{
        available:boarding.available,
        scan_mode:boarding.scan_mode,
        bookings_total:boarding.bookings_total,
        bookings_boarded:boarding.bookings_boarded,
        bookings_pending:boarding.bookings_pending,
        passengers_total:boarding.passengers_total,
        passengers_boarded:boarding.passengers_boarded,
        passengers_pending:boarding.passengers_pending,
        last_scan_at:boarding.last_scan_at
      }
    }
  };
  try{await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=minimal'},body:JSON.stringify([payload])})}catch{}
}

async function handleTimeline(request,env,ctx){
  const inner=await appWorker.fetch(request,env,ctx);
  if(!inner.ok)return inner;
  const data=await inner.json().catch(()=>null);
  if(!data?.trip?.id)return json(data||{error:'تعذر قراءة دورة تشغيل الرحلة.'},data?200:502);
  const actor=await actorFrom(request,env);
  const phase=phaseForTimeline(data);
  const [boarding,approval]=await Promise.all([
    boardingSummary(env,data.trip.id,phase).catch(e=>({available:false,error:txt(e?.message)||'تعذر قراءة بيانات الصعود',phase,scan_mode:phase==='return'?'return_boarding':'outbound_boarding',bookings_total:0,bookings_boarded:0,bookings_pending:0,passengers_total:0,passengers_boarded:0,passengers_pending:0,all_boarded:false,last_scan_at:null,pending:[]})),
    supervisorState(env,data.trip.id,actor)
  ]);
  return json({...data,boarding,departure_approval:approval});
}
async function handleStatus(request,env,ctx,body){
  const next=low(body?.status),isDeparture=next==='departed_outbound'||next==='departed_return';
  if(!isDeparture)return appWorker.fetch(request,env,ctx);
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canWriteOperations(actor))return json({error:'لا توجد صلاحية لاعتماد تحرك الرحلة.'},403);
  const tripId=txt(body?.trip_id),note=txt(body?.note);
  if(!tripId)return json({error:'معرّف الرحلة مطلوب.'},400);
  const trip=await tripRow(env,tripId);
  if(!trip)return json({error:'الرحلة غير موجودة.'},404);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة خارج نطاق تشغيل فرعك.'},403);
  const phase=next==='departed_return'?'return':'outbound';
  const [boarding,approval]=await Promise.all([boardingSummary(env,tripId,phase),supervisorState(env,tripId,actor)]);
  if(!approval.actor_can_approve){
    return json({error:'اعتماد التحرك يجب أن يتم بواسطة مشرف معيّن على الرحلة أو الإدارة.',code:'TRIP_SUPERVISOR_APPROVAL_REQUIRED'},403);
  }
  if(body?.departure_confirmed!==true){
    return json({error:'أكد مراجعة كشف الصعود واعتماد التحرك قبل تسجيل المرحلة.',code:'DEPARTURE_CONFIRMATION_REQUIRED',boarding,departure_approval:approval},409);
  }
  if((!boarding.available||boarding.passengers_pending>0||boarding.bookings_pending>0)&&!note){
    const reason=!boarding.available?'بيانات QR غير متاحة':`يوجد ${boarding.passengers_pending} مسافر لم يسجل صعوده`;
    return json({error:`${reason}. اكتب ملاحظة تشغيلية قبل اعتماد التحرك.`,code:'DEPARTURE_NOTE_REQUIRED',boarding,departure_approval:approval},409);
  }
  const inner=await appWorker.fetch(request,env,ctx);
  if(!inner.ok)return inner;
  const data=await inner.json().catch(()=>({ok:true}));
  await logDepartureApproval(env,actor,trip,phase,boarding,approval,note);
  const fresh=await boardingSummary(env,tripId,phase).catch(()=>boarding);
  return json({...data,boarding:fresh,departure_approval:approval,departure_confirmed:true});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='trip_operations_timeline')return handleTimeline(request,env,ctx);
      if(action==='set_trip_operations_status')return handleStatus(request,env,ctx,body);
    }
    return appWorker.fetch(request,env,ctx);
  }
};