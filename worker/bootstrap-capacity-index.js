import capacityGuardWorker from './capacity-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
const low=v=>String(v??'').toLowerCase();
const num=v=>Number(v||0);
const activeLink=x=>!['cancelled','released','inactive'].includes(low(x?.status||'assigned'));
const activeBooking=x=>!['cancelled','deleted','refunded'].includes(low(x?.status));
const activePassenger=x=>low(x?.status)!=='cancelled';
const activeSeat=x=>low(x?.status)==='assigned'&&!!x?.passenger_id;
const grossPaidHistory=b=>Math.max(num(b?.paid_amount),num(b?.snapshot?.finance?.grossPaidHistory));

async function readTable(env,table,select){
  const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return [];
  const r=await fetch(`${b}/rest/v1/${table}?select=${encodeURIComponent(select)}`,{headers:headers(env)});
  const out=await parse(r);return r.ok&&Array.isArray(out)?out:[];
}

async function enrichBootstrap(env,payload){
  const trips=Array.isArray(payload?.trips)?payload.trips:[];
  const visibleBookings=Array.isArray(payload?.bookings)?payload.bookings.map(b=>{const gross=grossPaidHistory(b);return gross>num(b?.paid_amount)+0.001?{...b,stored_paid_amount:b.paid_amount,paid_amount:gross}:b}):payload?.bookings;
  if(!trips.length||!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return {...payload,bookings:visibleBookings};
  const [tripVehicles,bookings,passengers,seats]=await Promise.all([
    readTable(env,'trip_vehicles','id,trip_id,booking_capacity,capacity,status'),
    readTable(env,'bookings','id,trip_id,return_trip_id,status'),
    readTable(env,'booking_passengers','id,booking_id,status'),
    readTable(env,'seat_assignments','id,trip_vehicle_id,passenger_id,status')
  ]);

  const bookingById=new Map(bookings.map(b=>[String(b.id),b]));
  const passengersByBooking=new Map();
  for(const p of passengers){if(!activePassenger(p))continue;const id=String(p.booking_id||'');if(!id)continue;const a=passengersByBooking.get(id)||[];a.push(p);passengersByBooking.set(id,a)}

  const tvByTrip=new Map();
  const tripByTv=new Map();
  for(const tv of tripVehicles){if(!activeLink(tv))continue;const tid=String(tv.trip_id||'');if(!tid)continue;const a=tvByTrip.get(tid)||[];a.push(tv);tvByTrip.set(tid,a);tripByTv.set(String(tv.id),tid)}

  const seatedByTrip=new Map();
  for(const a of seats){if(!activeSeat(a))continue;const tid=tripByTv.get(String(a.trip_vehicle_id||''));if(!tid)continue;const set=seatedByTrip.get(tid)||new Set();set.add(String(a.passenger_id));seatedByTrip.set(tid,set)}

  const bookedByTrip=new Map();
  for(const [bookingId,b] of bookingById){if(!activeBooking(b))continue;const count=(passengersByBooking.get(bookingId)||[]).length;if(!count)continue;for(const tid0 of [b.trip_id,b.return_trip_id]){const tid=String(tid0||'');if(!tid)continue;bookedByTrip.set(tid,(bookedByTrip.get(tid)||0)+count)}}

  const enriched=trips.map(t=>{
    const tid=String(t.id||'');const fleet=tvByTrip.get(tid)||[];
    const fleetCapacity=fleet.reduce((n,x)=>n+Math.max(0,Number(x.booking_capacity||x.capacity||0)),0);
    const fallback=Math.max(0,Number(t.booking_capacity||t.bus_capacity||t.default_bus_capacity||0));
    const liveCapacity=fleetCapacity>0?fleetCapacity:fallback;
    const booked=bookedByTrip.get(tid)||0;
    const seated=seatedByTrip.get(tid)?.size||0;
    return {...t,live_capacity:liveCapacity,booked_passengers:booked,available_seats:Math.max(0,liveCapacity-booked),seated_passengers:seated,unseated_passengers:Math.max(0,booked-seated),assigned_vehicle_count:fleet.length};
  });
  return {...payload,bookings:visibleBookings,trips:enriched};
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  const response=await capacityGuardWorker.fetch(request,env,ctx);
  if(u.pathname!=='/api/bootstrap'||request.method!=='GET'||!response.ok)return response;
  const payload=await response.json().catch(()=>null);if(!payload)return response;
  try{return json(await enrichBootstrap(env,payload),response.status)}catch{return json(payload,response.status)}
}};
