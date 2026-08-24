import appWorker from './finance-reconcile-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const s=v=>String(v??'');
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}
function bookingInput(path,body){if(path==='/api/customer/book')return body?.booking||{};if(path==='/api/admin'&&s(body?.action)==='update_booking')return body?.booking||{};return null}
function modeOf(b={}){const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};return s(b.journey_mode||b.journeyMode||snap.journeyMode||'oneway').toLowerCase()}
function primaryTripId(b={}){const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};return s(b.trip_id||b.tripId||snap.tripId||'')}
function returnTripId(b={}){const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};return s(b.return_trip_id||b.returnTripId||snap.returnTripId||'')}
function unavailableTrip(t){return !t||['cancelled','completed'].includes(s(t.status).toLowerCase())}
function legMoment(date,time){const d=s(date).slice(0,10);if(!d)return'';const raw=s(time||'00:00:00').trim();const parts=raw.split(':');const hh=s(parts[0]||'00').padStart(2,'0'),mm=s(parts[1]||'00').padStart(2,'0'),ss=s(parts[2]||'00').padStart(2,'0');return `${d}T${hh}:${mm}:${ss}`}
async function guardBooking(env,path,body){
 const b=bookingInput(path,body);if(!b)return null;
 const mode=modeOf(b),tripId=primaryTripId(b),returnId=returnTripId(b);
 if(!['oneway','roundtrip','separate','returnonly'].includes(mode))return json({error:'نوع الرحلة غير مدعوم.',code:'INVALID_JOURNEY_MODE'},400);
 if(!tripId)return json({error:'اختر الرحلة الأساسية.',code:'TRIP_REQUIRED'},400);
 const trip=(await rows(env,'trips',`id=eq.${enc(tripId)}&select=id,departure_date,departure_time,return_date,return_time,status&limit=1`))[0];
 if(unavailableTrip(trip))return json({error:'الرحلة الأساسية غير متاحة للحجز حاليًا.',code:'PRIMARY_TRIP_UNAVAILABLE'},409);
 if(mode==='roundtrip'){
   if(returnId&&returnId!==tripId)return json({error:'في «ذهاب وعودة» يجب أن تكون العودة على نفس رحلة الذهاب. استخدم «ذهاب + عودة من رحلة أخرى» لاختيار رحلة منفصلة.',code:'ROUNDTRIP_RETURN_LOCKED'},409);
   if(!trip?.return_date)return json({error:'الرحلة المختارة لا تحتوي على تاريخ عودة.',code:'ROUNDTRIP_RETURN_MISSING'},409);
   const outMoment=legMoment(trip.departure_date,trip.departure_time),backMoment=legMoment(trip.return_date,trip.return_time);
   if(outMoment&&backMoment&&backMoment<outMoment)return json({error:'تاريخ/وقت العودة لا يمكن أن يكون قبل تاريخ/وقت الذهاب.',code:'ROUNDTRIP_RETURN_BEFORE_OUTBOUND'},409);
 }
 if(mode==='separate'){
   if(!returnId)return json({error:'اختر رحلة العودة المنفصلة.',code:'SEPARATE_RETURN_REQUIRED'},400);
   if(returnId===tripId)return json({error:'رحلة العودة المنفصلة يجب أن تكون مختلفة عن رحلة الذهاب.',code:'SEPARATE_RETURN_MUST_DIFFER'},409);
   const rt=(await rows(env,'trips',`id=eq.${enc(returnId)}&select=id,departure_date,departure_time,return_date,return_time,status&limit=1`))[0];
   if(unavailableTrip(rt)||!rt?.return_date)return json({error:'رحلة العودة المنفصلة غير متاحة أو لا تحتوي على تاريخ عودة.',code:'SEPARATE_RETURN_UNAVAILABLE'},409);
   const outMoment=legMoment(trip.departure_date,trip.departure_time),backMoment=legMoment(rt.return_date,rt.return_time);
   if(outMoment&&backMoment&&backMoment<outMoment)return json({error:'رحلة العودة المنفصلة يجب أن تكون بعد رحلة الذهاب زمنيًا.',code:'SEPARATE_RETURN_BEFORE_OUTBOUND'},409);
 }
 if(mode==='returnonly'){
   if(!trip?.return_date)return json({error:'رحلة «عودة فقط» يجب أن تحتوي على تاريخ عودة.',code:'RETURN_ONLY_DATE_REQUIRED'},409);
 }
 return null;
}
async function guardReturnHousing(env,body){
 if(s(body?.table)!=='room_assignments'||!['insert','update'].includes(s(body?.action).toLowerCase()))return null;
 const row=body?.row&&typeof body.row==='object'?body.row:{};let passengerId=s(row.passenger_id||'');
 if(!passengerId&&s(body?.action).toLowerCase()==='update'&&body?.id){const cur=(await rows(env,'room_assignments',`id=eq.${enc(body.id)}&select=passenger_id&limit=1`))[0];passengerId=s(cur?.passenger_id||'')}
 if(!passengerId)return null;
 const p=(await rows(env,'booking_passengers',`id=eq.${enc(passengerId)}&select=id,booking_id&limit=1`))[0];if(!p)return null;
 const b=(await rows(env,'bookings',`id=eq.${enc(p.booking_id)}&select=id,trip_id,return_trip_id,journey_mode&limit=1`))[0];if(!b)return null;
 const mode=s(b.journey_mode).toLowerCase();
 // A separate return leg belongs only to return transport. Housing stays attached to the
 // outbound/primary booking. Return-only remains eligible for housing before its return.
 if(mode==='separate'&&b.return_trip_id&&s(b.return_trip_id)!==s(b.trip_id)){
   const roomId=s(row.hotel_room_id||'');if(!roomId)return null;
   const room=(await rows(env,'hotel_rooms',`id=eq.${enc(roomId)}&select=id,trip_hotel_id&limit=1`))[0];if(!room)return null;
   const th=(await rows(env,'trip_hotels',`id=eq.${enc(room.trip_hotel_id)}&select=id,trip_id&limit=1`))[0];
   if(th&&s(th.trip_id)===s(b.return_trip_id))return json({error:'العودة المنفصلة للنقل فقط ولا تضيف العميل إلى سكن رحلة العودة. استخدم سكن رحلة الذهاب/الحجز الأساسي.',code:'SEPARATE_RETURN_HOUSING_BLOCKED'},409);
 }
 return null;
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='POST'&&(u.pathname==='/api/customer/book'||u.pathname==='/api/admin')){
   const body=await request.clone().json().catch(()=>({}));
   try{const guard=await guardBooking(env,u.pathname,body);if(guard)return guard}catch(e){return json({error:e?.message||'تعذر التحقق من نوع الرحلة.',code:'BOOKING_CYCLE_GUARD_FAILED'},502)}
 }
 if(request.method==='POST'&&u.pathname==='/api/module'){
   const body=await request.clone().json().catch(()=>({}));
   try{const guard=await guardReturnHousing(env,body);if(guard)return guard}catch(e){return json({error:e?.message||'تعذر التحقق من ارتباط السكن بالرحلة.',code:'RETURN_HOUSING_GUARD_FAILED'},502)}
 }
 return appWorker.fetch(request,env,ctx)
}};
