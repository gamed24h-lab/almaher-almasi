import runtimeModeWorker from './runtime-mode-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await runtimeModeWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const isDeveloper=a=>String(a?.role||'').toLowerCase()==='developer';
const isGM=a=>String(a?.role||'')==='مدير عام';
const elevated=a=>isDeveloper(a)||isGM(a)||!!a?.permissions?.all;
const has=(a,k)=>!!a&&(elevated(a)||a.permissions?.[k]);

async function tripVehicleTripId(env,tripVehicleId){
  const h=headers(env),b=base(env);
  const vr=await fetch(`${b}/rest/v1/trip_vehicles?id=eq.${encodeURIComponent(tripVehicleId)}&select=trip_id&limit=1`,{headers:h});
  const vb=await parse(vr);if(!vr.ok||!Array.isArray(vb)||!vb[0]?.trip_id)return null;
  return vb[0].trip_id;
}

async function canAccessTripVehicle(actor,env,tripVehicleId){
  if(elevated(actor)||actor?.permissions?.allBranches)return true;
  if(!actor?.branch_id)return false;
  const h=headers(env),b=base(env),tripId=await tripVehicleTripId(env,tripVehicleId);if(!tripId)return false;
  const tr=await fetch(`${b}/rest/v1/trip_branches?trip_id=eq.${encodeURIComponent(tripId)}&branch_id=eq.${encodeURIComponent(actor.branch_id)}&select=id&limit=1`,{headers:h});
  const tb=await parse(tr);return tr.ok&&Array.isArray(tb)&&tb.length>0;
}

async function bookingSeatContextAllowed(actor,env,body,tripVehicleId,action,segment,seatNo){
  if(!(has(actor,'branchBooking')||has(actor,'editBookings')))return false;
  if(!['assign','released'].includes(action))return false;
  const b=base(env),h=headers(env);if(!b)return false;
  const tripId=await tripVehicleTripId(env,tripVehicleId);if(!tripId)return false;

  let bookingId=String(body?.booking_id||'');
  let passengerId=String(body?.passenger_id||'');

  if(action==='released'&&(!bookingId||!passengerId)){
    const sr=await fetch(`${b}/rest/v1/seat_assignments?trip_vehicle_id=eq.${encodeURIComponent(tripVehicleId)}&segment_type=eq.${encodeURIComponent(segment)}&seat_no=eq.${encodeURIComponent(seatNo)}&status=eq.assigned&select=booking_id,passenger_id&limit=1`,{headers:h});
    const sb=await parse(sr);if(!sr.ok||!Array.isArray(sb)||!sb[0])return false;
    bookingId=String(sb[0].booking_id||'');passengerId=String(sb[0].passenger_id||'');
  }

  if(!bookingId)return false;
  const br=await fetch(`${b}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,branch_id,trip_id,return_trip_id,status&limit=1`,{headers:h});
  const bb=await parse(br);if(!br.ok||!Array.isArray(bb)||!bb[0])return false;
  const booking=bb[0];
  if(['cancelled','deleted','refunded'].includes(String(booking.status||'').toLowerCase()))return false;
  if(!elevated(actor)&&!actor?.permissions?.allBranches&&String(booking.branch_id||'')!==String(actor?.branch_id||''))return false;
  const expectedTrip=segment==='return'?(booking.return_trip_id||booking.trip_id):booking.trip_id;
  if(String(expectedTrip||'')!==String(tripId))return false;

  if(passengerId){
    const pr=await fetch(`${b}/rest/v1/booking_passengers?id=eq.${encodeURIComponent(passengerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&select=id,status&limit=1`,{headers:h});
    const pb=await parse(pr);if(!pr.ok||!Array.isArray(pb)||!pb[0])return false;
    if(String(pb[0].status||'').toLowerCase()==='cancelled')return false;
  }
  return true;
}

async function releaseStalePassengerSeats(env,{passengerId,bookingId,segment,tripVehicleId,seatNo,assignedBy}){
  if(!passengerId||!bookingId)return 0;
  const b=base(env),h=headers(env);
  const q=`passenger_id=eq.${encodeURIComponent(passengerId)}&booking_id=eq.${encodeURIComponent(bookingId)}&segment_type=eq.${encodeURIComponent(segment)}&status=eq.assigned&select=trip_vehicle_id,seat_no&limit=20`;
  const r=await fetch(`${b}/rest/v1/seat_assignments?${q}`,{headers:h});
  const rows=await parse(r);if(!r.ok||!Array.isArray(rows))return 0;
  const stale=rows.filter(x=>String(x.trip_vehicle_id)!==String(tripVehicleId)||String(x.seat_no)!==String(seatNo));
  let released=0;
  for(const old of stale){
    const rr=await fetch(`${b}/rest/v1/rpc/almaher_set_seat_state_atomic`,{method:'POST',headers:h,body:JSON.stringify({p_trip_vehicle_id:old.trip_vehicle_id,p_segment_type:segment,p_seat_no:String(old.seat_no),p_status:'released',p_assigned_by:assignedBy})});
    if(rr.ok)released++;
  }
  return released;
}

async function atomicSeat(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const body=await request.json().catch(()=>({}));
  const action=String(body?.action||'');
  const tripVehicleId=String(body?.trip_vehicle_id||'');
  const segment=String(body?.segment_type||'outbound');
  const seatNo=String(body?.seat_no||'').trim();
  if(!tripVehicleId||!seatNo)return json({error:'بيانات المقعد أو الباص غير مكتملة.'},400);

  const fullSeatAccess=has(actor,'seats')||has(actor,'operations')||has(actor,'trips');
  const bookingSeatAccess=fullSeatAccess?false:await bookingSeatContextAllowed(actor,env,body,tripVehicleId,action,segment,seatNo);
  if(!fullSeatAccess&&!bookingSeatAccess)return json({error:'لا توجد صلاحية لإدارة هذا المقعد ضمن الحجز.'},403);
  if(!(await canAccessTripVehicle(actor,env,tripVehicleId)))return json({error:'المركبة/الرحلة خارج نطاق تشغيل فرعك.'},403);

  const assignedBy=actor.name||actor.id||null;
  let rpc,payload;
  if(action==='assign'){
    rpc='almaher_assign_seat_atomic';
    payload={p_trip_vehicle_id:tripVehicleId,p_segment_type:segment,p_seat_no:seatNo,p_passenger_id:body.passenger_id||null,p_booking_id:body.booking_id||null,p_assigned_by:assignedBy};
  }else if(['hold','blocked','released'].includes(action)){
    if(bookingSeatAccess&&!['released'].includes(action))return json({error:'موظف الحجز يمكنه فقط تعيين أو تحرير مقعد تابع للحجز.'},403);
    rpc='almaher_set_seat_state_atomic';
    payload={p_trip_vehicle_id:tripVehicleId,p_segment_type:segment,p_seat_no:seatNo,p_status:action,p_assigned_by:assignedBy};
  }else return json({error:'عملية المقعد غير معروفة.'},400);
  const r=await fetch(`${base(env)}/rest/v1/rpc/${rpc}`,{method:'POST',headers:headers(env),body:JSON.stringify(payload)});
  const out=await parse(r);
  if(!r.ok){const raw=String(out?.message||out?.details||out?.hint||'تعذر تنفيذ عملية المقعد.');if(/SEAT_ALREADY_ASSIGNED|SEAT_CONCURRENCY_CONFLICT|duplicate key/i.test(raw))return json({error:'المقعد تم اختياره بالفعل من مستخدم آخر. حدّث الخريطة واختر مقعدًا آخر.',code:'SEAT_CONFLICT'},409);return json({error:raw},502)}
  let staleReleased=0;
  if(action==='assign'&&body.passenger_id&&body.booking_id){
    staleReleased=await releaseStalePassengerSeats(env,{passengerId:body.passenger_id,bookingId:body.booking_id,segment,tripVehicleId,seatNo,assignedBy});
  }
  return json({ok:true,result:out,scope:bookingSeatAccess?'booking':'seat_management',stale_released:staleReleased});
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/seats/atomic')return atomicSeat(request,env);return runtimeModeWorker.fetch(request,env,ctx)}};
