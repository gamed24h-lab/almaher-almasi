import tripGuardWorker from './trip-destination-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
const low=v=>String(v??'').toLowerCase();
const activeLink=x=>!['cancelled','released','inactive'].includes(low(x?.status||'assigned'));
const activeBooking=x=>!['cancelled','deleted','refunded'].includes(low(x?.status));
const activePassenger=x=>low(x?.status)!=='cancelled';

async function fleetCapacity(env,tripId,{excludeTripVehicleId=''}={}){
  if(!tripId)return 0;const b=base(env),h=headers(env);
  const r=await fetch(`${b}/rest/v1/trip_vehicles?trip_id=eq.${encodeURIComponent(tripId)}&select=id,booking_capacity,capacity,status`,{headers:h});
  const rows=await parse(r);if(!r.ok||!Array.isArray(rows))return 0;
  return rows.filter(x=>String(x.id)!==String(excludeTripVehicleId||'')&&activeLink(x)).reduce((n,x)=>n+Math.max(0,Number(x.booking_capacity||x.capacity||0)),0);
}
async function tripFallbackCapacity(env,tripId){
  if(!tripId)return 0;const b=base(env),h=headers(env);
  const r=await fetch(`${b}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}&select=booking_capacity,bus_capacity,default_bus_capacity&limit=1`,{headers:h});
  const rows=await parse(r);const x=r.ok&&Array.isArray(rows)?rows[0]:null;return Math.max(0,Number(x?.booking_capacity||x?.bus_capacity||x?.default_bus_capacity||0));
}
async function bookedPassengers(env,tripId,{excludeBookingId=''}={}){
  if(!tripId)return 0;const b=base(env),h=headers(env);
  const q=`or=(trip_id.eq.${encodeURIComponent(tripId)},return_trip_id.eq.${encodeURIComponent(tripId)})&select=id,status`;
  const br=await fetch(`${b}/rest/v1/bookings?${q}`,{headers:h});const bookings=await parse(br);if(!br.ok||!Array.isArray(bookings))return 0;
  const ids=bookings.filter(x=>String(x.id)!==String(excludeBookingId||'')&&activeBooking(x)).map(x=>String(x.id)).filter(Boolean);if(!ids.length)return 0;
  const filter=ids.map(id=>`\"${id}\"`).join(',');
  const pr=await fetch(`${b}/rest/v1/booking_passengers?booking_id=in.(${encodeURIComponent(filter)})&select=id,status`,{headers:h});const passengers=await parse(pr);if(!pr.ok||!Array.isArray(passengers))return 0;
  return passengers.filter(activePassenger).length;
}
async function effectiveCapacity(env,tripId,opts={}){const fleet=await fleetCapacity(env,tripId,opts);return fleet>0?fleet:tripFallbackCapacity(env,tripId)}

function bookingDescriptor(path,body){
  if(path==='/api/customer/book')return {booking:body?.booking||{},passengers:Array.isArray(body?.passengers)?body.passengers:[]};
  if(path==='/api/admin'&&String(body?.action||'')==='update_booking'){
    const b=body?.booking||{};return {booking:b,passengers:Array.isArray(b.passengerDetails)?b.passengerDetails:[]};
  }
  return null;
}
async function validateBookingCapacity(env,desc){
  if(!desc)return null;const booking=desc.booking||{};const requested=Math.max(1,desc.passengers.filter(x=>low(x?.status)!=='cancelled').length||Number(booking.travelers||0)||1);
  const bookingId=String(booking.id||booking.cloudBookingId||'');
  for(const tripId of [...new Set([booking.trip_id||booking.tripId,booking.return_trip_id||booking.returnTripId].filter(Boolean).map(String))]){
    const [capacity,current]=await Promise.all([effectiveCapacity(env,tripId),bookedPassengers(env,tripId,{excludeBookingId:bookingId})]);
    if(capacity>0&&current+requested>capacity)return `لا توجد سعة كافية على الرحلة. السعة التشغيلية ${capacity} مقعد، المحجوز قبل هذا الحجز ${current}، والمطلوب ${requested}.`;
  }
  return null;
}
async function validateTripVehicleRemoval(env,body){
  if(String(body?.table||'')!=='trip_vehicles'||String(body?.action||'')!=='delete'||!body?.id)return null;
  const b=base(env),h=headers(env),id=String(body.id);
  const rr=await fetch(`${b}/rest/v1/trip_vehicles?id=eq.${encodeURIComponent(id)}&select=id,trip_id,status&limit=1`,{headers:h});const rows=await parse(rr);const current=rr.ok&&Array.isArray(rows)?rows[0]:null;if(!current||!activeLink(current))return null;
  const [remaining,booked]=await Promise.all([effectiveCapacity(env,current.trip_id,{excludeTripVehicleId:id}),bookedPassengers(env,current.trip_id)]);
  if(booked>remaining)return `لا يمكن فك ربط هذا الباص؛ بعد الحذف ستصبح سعة الرحلة ${remaining} بينما عليها ${booked} مسافر محجوز.`;
  return null;
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(request.method==='POST'){
    if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return tripGuardWorker.fetch(request,env,ctx);
    const body=await request.clone().json().catch(()=>({}));
    const desc=bookingDescriptor(u.pathname,body);if(desc){const error=await validateBookingCapacity(env,desc);if(error)return json({error,code:'TRIP_CAPACITY_EXCEEDED'},409)}
    if(u.pathname==='/api/module'){const error=await validateTripVehicleRemoval(env,body);if(error)return json({error,code:'TRIP_CAPACITY_UNDER_BOOKED'},409)}
  }
  return tripGuardWorker.fetch(request,env,ctx);
}};
