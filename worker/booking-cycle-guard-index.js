import appWorker from './finance-reconcile-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const s=v=>String(v??'');
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}
async function insertRow(env,table,row){const r=await fetch(`${base(env)}/rest/v1/${table}`,{method:'POST',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر إضافة ${table}`);return Array.isArray(out)?out[0]||null:out}
async function patchRows(env,table,filter,row){const r=await fetch(`${base(env)}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر تحديث ${table}`);return Array.isArray(out)?out:[]}
async function actorFrom(request,env){
 try{
  const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
  if(!r.ok)return null;
  const b=await r.json().catch(()=>({}));
  return b?.user||null;
 }catch{return null}
}
const elevated=a=>!!a&&(s(a.role).toLowerCase()==='developer'||s(a.role)==='مدير عام'||a.permissions?.all===true);
const allBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canCrossBranchReturn=a=>elevated(a)||a?.permissions?.crossBranchReturn===true;
const canHousing=a=>elevated(a)||a?.permissions?.housing===true;
function bookingInput(path,body){if(path==='/api/customer/book')return body?.booking||{};if(path==='/api/admin'&&s(body?.action)==='update_booking')return body?.booking||{};return null}
function snapOf(b={}){return b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{}}
function modeOf(b={}){const snap=snapOf(b);return s(b.journey_mode||b.journeyMode||snap.journeyMode||'oneway').toLowerCase()}
function primaryTripId(b={}){const snap=snapOf(b);return s(b.trip_id||b.tripId||snap.tripId||'')}
function returnTripId(b={}){const snap=snapOf(b);return s(b.return_trip_id||b.returnTripId||snap.returnTripId||'')}
function bookingBranchId(b={}){const snap=snapOf(b);return s(b.branch_id||b.branchId||snap.branchId||'')}
function unavailableTrip(t){return !t||['cancelled','completed'].includes(s(t.status).toLowerCase())}
function legMoment(date,time){const d=s(date).slice(0,10);if(!d)return'';const raw=s(time||'00:00:00').trim();const parts=raw.split(':');const hh=s(parts[0]||'00').padStart(2,'0'),mm=s(parts[1]||'00').padStart(2,'0'),ss=s(parts[2]||'00').padStart(2,'0');return `${d}T${hh}:${mm}:${ss}`}
function privateCapacity(v){return ({single:1,double:2,triple:3,quad:4,quint:5})[s(v).toLowerCase()]||2}
function female(v){return ['female','f','أنثى','انثى'].includes(s(v).trim().toLowerCase())}
function b64urlEncodeText(text){const bytes=new TextEncoder().encode(text);let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64urlDecodeText(value){const raw=s(value).replace(/-/g,'+').replace(/_/g,'/');const pad=raw+'='.repeat((4-raw.length%4)%4);const bin=atob(pad);const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}
async function hmac(env,text){const secret=s(env.SUPABASE_SERVICE_ROLE_KEY);if(!secret)throw new Error('Customer access signing secret is unavailable');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));let bin='';for(const b of sig)bin+=String.fromCharCode(b);return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function issueAccessToken(env,bookingNo){const payload=b64urlEncodeText(JSON.stringify({b:s(bookingNo),exp:Math.floor(Date.now()/1000)+60*60*24*180,v:1}));return `${payload}.${await hmac(env,payload)}`}
async function verifyAccessToken(env,token){try{const [payload,sig]=s(token).split('.');if(!payload||!sig)return null;const expected=await hmac(env,payload);if(expected!==sig)return null;const body=JSON.parse(b64urlDecodeText(payload));if(!body?.b||!body?.exp||Number(body.exp)<Math.floor(Date.now()/1000))return null;return body}catch{return null}}
const maskIdentifier=v=>{const x=s(v).trim();if(!x)return'';return x.length<=4?x:`••••${x.slice(-4)}`};
async function tripIncludesBranch(env,trip,branchId){
 if(!trip||!branchId)return true;
 if(s(trip.branch_id)===s(branchId))return true;
 const rel=await rows(env,'trip_branches',`trip_id=eq.${enc(trip.id)}&branch_id=eq.${enc(branchId)}&select=id&limit=1`);
 return rel.length>0;
}
async function returnSeatContext(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'RETURN_SEAT_AUTH_REQUIRED'},401);
 if(!canCrossBranchReturn(actor))return json({error:'عرض مقاعد عودة فرع آخر يتطلب صلاحية «عودة من فرع آخر».',code:'CROSS_BRANCH_RETURN_SEATS_FORBIDDEN'},403);
 const u=new URL(request.url),tripId=s(u.searchParams.get('trip_id')).trim();if(!tripId)return json({error:'حدد رحلة العودة.',code:'RETURN_TRIP_REQUIRED'},400);
 const trip=(await rows(env,'trips',`id=eq.${enc(tripId)}&select=id,branch_id,return_date,return_time,status&limit=1`))[0];
 if(unavailableTrip(trip)||!trip?.return_date)return json({error:'رحلة العودة غير متاحة حاليًا.',code:'RETURN_TRIP_UNAVAILABLE'},409);
 const tripVehicles=await rows(env,'trip_vehicles',`trip_id=eq.${enc(tripId)}&select=id,trip_id,vehicle_id,bus_label,booking_capacity,capacity,status&limit=50`);
 const activeTripVehicles=tripVehicles.filter(x=>!['cancelled','released','inactive'].includes(s(x.status||'assigned').toLowerCase()));
 const tvIds=activeTripVehicles.map(x=>s(x.id)).filter(Boolean),vehicleIds=[...new Set(activeTripVehicles.map(x=>s(x.vehicle_id)).filter(Boolean))];
 if(!tvIds.length)return json({ok:true,trip,trip_vehicles:[],vehicles:[],vehicle_seats:[],seat_assignments:[]});
 const tvIn=tvIds.map(enc).join(','),vIn=vehicleIds.map(enc).join(',');
 const [vehicles,vehicleSeats,seatAssignments,ownBookings]=await Promise.all([
   vehicleIds.length?rows(env,'vehicles',`id=in.(${vIn})&select=id,name,plate_no,booking_capacity,physical_capacity&limit=100`):Promise.resolve([]),
   vehicleIds.length?rows(env,'vehicle_seats',`vehicle_id=in.(${vIn})&select=id,vehicle_id,seat_no,seat_index,seat_type,active&limit=1000`):Promise.resolve([]),
   rows(env,'seat_assignments',`trip_vehicle_id=in.(${tvIn})&segment_type=eq.return&status=in.(assigned,hold,blocked)&select=id,trip_vehicle_id,segment_type,seat_no,passenger_id,booking_id,status&limit=2000`),
   elevated(actor)||!actor?.branch_id?Promise.resolve([]):rows(env,'bookings',`branch_id=eq.${enc(actor.branch_id)}&return_trip_id=eq.${enc(tripId)}&select=id&limit=2000`)
 ]);
 const ownBookingIds=new Set((ownBookings||[]).map(x=>s(x.id)));
 const safeAssignments=elevated(actor)?seatAssignments:seatAssignments.map(a=>ownBookingIds.has(s(a.booking_id))?a:{...a,passenger_id:null,booking_id:null});
 return json({ok:true,trip,trip_vehicles:activeTripVehicles,vehicles,vehicle_seats:vehicleSeats,seat_assignments:safeAssignments});
}
async function customerAccessToken(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'CUSTOMER_ACCESS_TOKEN_AUTH_REQUIRED'},401);
 const u=new URL(request.url),bookingNo=s(u.searchParams.get('bookingNo')).trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب.',code:'CUSTOMER_ACCESS_BOOKING_REQUIRED'},400);
 const booking=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id&limit=1`))[0];if(!booking)return json({error:'الحجز غير موجود.',code:'CUSTOMER_ACCESS_BOOKING_NOT_FOUND'},404);
 if(!allBranches(actor)&&s(booking.branch_id)!==s(actor.branch_id))return json({error:'لا يمكنك إنشاء رابط بوابة لحجز فرع آخر.',code:'CUSTOMER_ACCESS_BRANCH_FORBIDDEN'},403);
 return json({ok:true,token:await issueAccessToken(env,booking.booking_number),expires_in_days:180});
}
async function customerAccess(request,env){
 const u=new URL(request.url),verified=await verifyAccessToken(env,u.searchParams.get('token'));if(!verified)return json({error:'رابط الحجز غير صالح أو انتهت صلاحيته.',code:'CUSTOMER_ACCESS_INVALID'},403);
 const b=(await rows(env,'bookings',`booking_number=eq.${enc(verified.b)}&select=*&limit=1`))[0];if(!b)return json({error:'الحجز غير موجود.',code:'CUSTOMER_ACCESS_NOT_FOUND'},404);
 const passengers=await rows(env,'booking_passengers',`booking_id=eq.${enc(b.id)}&status=neq.cancelled&select=id,passenger_order,full_name,gender,nationality,identity_number,status,accommodation_status,preferred_language&order=passenger_order.asc&limit=200`);
 const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};
 const booking={...snap,id:b.booking_number,number:b.booking_number,bookingNo:b.booking_number,tripId:b.trip_id,returnTripId:b.return_trip_id,branchId:b.branch_id,name:b.customer_name,journeyMode:b.journey_mode,accommodationType:b.accommodation_type,accommodationLabel:b.accommodation_label,privateRooms:b.private_rooms,privateRoomTypes:b.private_room_types||[],paymentMethod:b.payment_method,totalPrice:Number(b.total_price||0),paidAmount:Number(b.paid_amount||0),status:b.status,createdAt:b.created_at,cloudSynced:true,cloudBookingId:b.id};
 const safePassengers=passengers.map(p=>({...p,identity_number:maskIdentifier(p.identity_number)}));
 const safeRow=async(table,id)=>{if(!id)return null;return (await rows(env,table,`id=eq.${enc(id)}&select=*&limit=1`))[0]||null};
 const [tripRow,returnRow,branchRow]=await Promise.all([safeRow('trips',b.trip_id),safeRow('trips',b.return_trip_id),safeRow('branches',b.branch_id)]);
 const safeTrip=t=>t?{id:t.id,trip_code:t.trip_code||t.code||'',from_city:t.from_city||t.origin||'',to_city:t.to_city||t.destination||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null,status:t.status||''}:null;
 const safeBranch=branchRow?{id:branchRow.id,name:branchRow.name||'',address:branchRow.address||'',whatsapp:branchRow.whatsapp||'',phone:branchRow.phone||'',map_url:branchRow.map_url||branchRow.mapUrl||''}:null;
 return json({booking,passengers:safePassengers,trip:safeTrip(tripRow),returnTrip:safeTrip(returnRow),branch:safeBranch,access_mode:'signed_ticket_qr'});
}
async function autoHouseBooking(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'AUTO_HOUSING_AUTH_REQUIRED'},401);
 if(!canHousing(actor))return json({error:'التسكين الفوري من الحجز يتطلب صلاحية التسكين.',code:'AUTO_HOUSING_FORBIDDEN'},403);
 const body=await request.json().catch(()=>({}));const bookingNo=s(body?.booking_number).trim(),tripHotelId=s(body?.trip_hotel_id).trim();
 if(!bookingNo||!tripHotelId)return json({error:'رقم الحجز والفندق مطلوبان للتسكين الفوري.',code:'AUTO_HOUSING_INPUT_REQUIRED'},400);
 const booking=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0];
 if(!booking)return json({error:'الحجز غير موجود.',code:'AUTO_HOUSING_BOOKING_NOT_FOUND'},404);
 if(!allBranches(actor)&&s(booking.branch_id)!==s(actor.branch_id))return json({error:'لا يمكنك تسكين حجز تابع لفرع آخر.',code:'AUTO_HOUSING_BRANCH_FORBIDDEN'},403);
 const accommodation=s(booking.accommodation_type||booking?.snapshot?.accommodationType||'none').toLowerCase();
 if(accommodation==='none')return json({ok:true,skipped:true,reason:'no_housing'});
 if(!['shared','private'].includes(accommodation))return json({error:'نوع السكن غير مدعوم للتسكين التلقائي.',code:'AUTO_HOUSING_TYPE_INVALID'},409);
 const tripHotel=(await rows(env,'trip_hotels',`id=eq.${enc(tripHotelId)}&select=*&limit=1`))[0];
 if(!tripHotel)return json({error:'الفندق المختار غير مربوط بالرحلة.',code:'AUTO_HOUSING_HOTEL_NOT_FOUND'},404);
 if(s(tripHotel.trip_id)!==s(booking.trip_id))return json({error:'الفندق المختار يجب أن يكون تابعًا للرحلة الأساسية للحجز. رحلة العودة المنفصلة للنقل فقط.',code:'AUTO_HOUSING_WRONG_TRIP'},409);
 if(tripHotel.rooming_locked===true)return json({error:'التسكين مقفول لهذا الفندق/الرحلة.',code:'AUTO_HOUSING_LOCKED'},409);
 const passengers=await rows(env,'booking_passengers',`booking_id=eq.${enc(booking.id)}&status=neq.cancelled&select=id,booking_id,full_name,gender,nationality,status&order=passenger_order.asc&limit=200`);
 if(!passengers.length)return json({error:'لا يوجد مسافرون نشطون في الحجز.',code:'AUTO_HOUSING_NO_PASSENGERS'},409);
 if(accommodation==='shared'&&passengers.some(p=>female(p.gender)))return json({error:'السكن المشترك غير متاح للنساء.',code:'AUTO_HOUSING_SHARED_FEMALE'},409);
 let hotelRooms=await rows(env,'hotel_rooms',`trip_hotel_id=eq.${enc(tripHotelId)}&select=*&limit=1000`);
 const passengerIds=passengers.map(p=>s(p.id));
 const pIn=passengerIds.map(enc).join(',');
 let ownAssignments=passengerIds.length?await rows(env,'room_assignments',`passenger_id=in.(${pIn})&status=neq.released&select=*&limit=500`):[];
 const roomIds=hotelRooms.map(r=>s(r.id)).filter(Boolean),rIn=roomIds.map(enc).join(',');
 let allHotelAssignments=roomIds.length?await rows(env,'room_assignments',`hotel_room_id=in.(${rIn})&status=neq.released&select=*&limit=5000`):[];
 const assignmentByPassenger=new Map(ownAssignments.map(a=>[s(a.passenger_id),a]));
 const occupancy=new Map();for(const a of allHotelAssignments)occupancy.set(s(a.hotel_room_id),(occupancy.get(s(a.hotel_room_id))||0)+1);
 async function releaseAssignment(a){if(!a)return;await patchRows(env,'room_assignments',`id=eq.${enc(a.id)}`,{status:'released'});if(occupancy.has(s(a.hotel_room_id)))occupancy.set(s(a.hotel_room_id),Math.max(0,(occupancy.get(s(a.hotel_room_id))||1)-1));assignmentByPassenger.delete(s(a.passenger_id))}
 async function assignTo(room,p){const current=assignmentByPassenger.get(s(p.id));if(current&&s(current.hotel_room_id)===s(room.id))return false;if(current)await releaseAssignment(current);const old=(await rows(env,'room_assignments',`hotel_room_id=eq.${enc(room.id)}&passenger_id=eq.${enc(p.id)}&select=id,status&limit=1`))[0];let a;if(old){const got=await patchRows(env,'room_assignments',`id=eq.${enc(old.id)}`,{status:'assigned'});a=got[0]||{...old,status:'assigned',hotel_room_id:room.id,passenger_id:p.id}}else a=await insertRow(env,'room_assignments',{hotel_room_id:room.id,passenger_id:p.id,status:'assigned'});assignmentByPassenger.set(s(p.id),a);occupancy.set(s(room.id),(occupancy.get(s(room.id))||0)+1);return true}
 let created=0,assigned=0,overflow=0;
 if(accommodation==='shared'){
   let sharedRooms=hotelRooms.filter(r=>s(r.room_type).toLowerCase()==='shared5'&&r.locked!==true);
   const alreadyValid=new Set();for(const p of passengers){const a=assignmentByPassenger.get(s(p.id));if(a&&sharedRooms.some(r=>s(r.id)===s(a.hotel_room_id))){alreadyValid.add(s(p.id));}}
   const waiting=passengers.filter(p=>!alreadyValid.has(s(p.id)));
   let free=sharedRooms.reduce((sum,r)=>sum+Math.max(0,5-(occupancy.get(s(r.id))||0)),0),need=Math.max(0,waiting.length-free);
   let seq=Math.max(0,...sharedRooms.map(r=>{const m=/^M-(\d+)$/i.exec(s(r.room_no));return m?Number(m[1]):0}))+1;
   while(need>0){const room=await insertRow(env,'hotel_rooms',{trip_hotel_id:tripHotelId,room_no:`M-${seq++}`,room_type:'shared5',capacity:5,status:'available',locked:false});hotelRooms.push(room);sharedRooms.push(room);occupancy.set(s(room.id),0);created++;need-=5}
   let i=0;for(const room of sharedRooms){while((occupancy.get(s(room.id))||0)<5&&i<waiting.length){if(await assignTo(room,waiting[i]))assigned++;i++}if(i>=waiting.length)break}
   overflow=Math.max(0,waiting.length-i);
 }else{
   const snap=booking.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};const count=Math.max(1,Number(booking.private_rooms||snap.privateRooms||1));const stored=Array.isArray(snap.privateRoomSpecs)?snap.privateRoomSpecs:[];const types=Array.isArray(booking.private_room_types)&&booking.private_room_types.length?booking.private_room_types:Array.isArray(snap.privateRoomTypes)&&snap.privateRoomTypes.length?snap.privateRoomTypes:[snap.privateRoomType||'double'];const specs=Array.from({length:count},(_,i)=>({type:s(stored[i]?.type||types[i]||types[0]||'double'),capacity:privateCapacity(stored[i]?.type||types[i]||types[0]||'double')}));
   const usedNos=new Set(hotelRooms.map(r=>s(r.room_no)));let seq=Math.max(0,...hotelRooms.map(r=>{const m=/^P-(\d+)$/i.exec(s(r.room_no));return m?Number(m[1]):0}))+1;const nextNo=()=>{let no;do{no=`P-${String(seq++).padStart(3,'0')}`}while(usedNos.has(no));usedNos.add(no);return no};
   const dedicated=hotelRooms.filter(r=>s(r.room_type).toLowerCase()==='private'&&passengers.some(p=>s(assignmentByPassenger.get(s(p.id))?.hotel_room_id)===s(r.id)));const used=new Set(),targets=[];
   for(const spec of specs){let room=dedicated.find(r=>!used.has(s(r.id))&&Number(r.capacity||0)===spec.capacity);if(room)used.add(s(room.id));else{room=await insertRow(env,'hotel_rooms',{trip_hotel_id:tripHotelId,room_no:nextNo(),room_type:'private',capacity:spec.capacity,status:'available',locked:false});hotelRooms.push(room);occupancy.set(s(room.id),0);created++}targets.push(room)}
   for(const p of passengers){const current=assignmentByPassenger.get(s(p.id));if(current&&targets.some(r=>s(r.id)===s(current.hotel_room_id)))continue;const target=targets.find(r=>(occupancy.get(s(r.id))||0)<Number(r.capacity||0));if(!target){if(current)await releaseAssignment(current);overflow++;continue}if(await assignTo(target,p))assigned++}
 }
 const hotel=(await rows(env,'hotels',`id=eq.${enc(tripHotel.hotel_id)}&select=id,name,city&limit=1`))[0]||null;
 return json({ok:true,booking_number:bookingNo,trip_hotel_id:tripHotelId,hotel,accommodation_type:accommodation,created_rooms:created,assigned_passengers:assigned,kept_passengers:Math.max(0,passengers.length-assigned-overflow),overflow,operational_room_notice:'أرقام الغرف P-/M- تشغيلية مبدئية حتى تحديث رقم الغرفة الفعلي من الفندق.'});
}
async function guardBooking(request,env,path,body){
 const b=bookingInput(path,body);if(!b)return null;
 const mode=modeOf(b),tripId=primaryTripId(b),returnId=returnTripId(b),branchId=bookingBranchId(b);
 if(!['oneway','roundtrip','separate','returnonly'].includes(mode))return json({error:'نوع الرحلة غير مدعوم.',code:'INVALID_JOURNEY_MODE'},400);
 if(!tripId)return json({error:'اختر الرحلة الأساسية.',code:'TRIP_REQUIRED'},400);
 const trip=(await rows(env,'trips',`id=eq.${enc(tripId)}&select=id,branch_id,departure_date,departure_time,return_date,return_time,status&limit=1`))[0];
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
   const rt=(await rows(env,'trips',`id=eq.${enc(returnId)}&select=id,branch_id,departure_date,departure_time,return_date,return_time,status&limit=1`))[0];
   if(unavailableTrip(rt)||!rt?.return_date)return json({error:'رحلة العودة المنفصلة غير متاحة أو لا تحتوي على تاريخ عودة.',code:'SEPARATE_RETURN_UNAVAILABLE'},409);
   const outMoment=legMoment(trip.departure_date,trip.departure_time),backMoment=legMoment(rt.return_date,rt.return_time);
   if(outMoment&&backMoment&&backMoment<outMoment)return json({error:'رحلة العودة المنفصلة يجب أن تكون بعد رحلة الذهاب زمنيًا.',code:'SEPARATE_RETURN_BEFORE_OUTBOUND'},409);
   if(branchId&&!(await tripIncludesBranch(env,rt,branchId))){
     const actor=await actorFrom(request,env);
     if(!canCrossBranchReturn(actor))return json({error:'اختيار رحلة عودة من فرع آخر يتطلب صلاحية «عودة من فرع آخر».',code:'CROSS_BRANCH_RETURN_FORBIDDEN'},403);
   }
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
 if(request.method==='GET'&&u.pathname==='/api/customer/access-token'){
   try{return await customerAccessToken(request,env)}catch(e){return json({error:e?.message||'تعذر إنشاء رابط بوابة العميل.',code:'CUSTOMER_ACCESS_TOKEN_FAILED'},502)}
 }
 if(request.method==='GET'&&u.pathname==='/api/customer/access'){
   try{return await customerAccess(request,env)}catch(e){return json({error:e?.message||'تعذر فتح الحجز من الرابط.',code:'CUSTOMER_ACCESS_FAILED'},502)}
 }
 if(request.method==='POST'&&u.pathname==='/api/bookings/auto-house'){
   try{return await autoHouseBooking(request,env)}catch(e){return json({error:e?.message||'تعذر تنفيذ التسكين الفوري.',code:'AUTO_HOUSING_FAILED'},502)}
 }
 if(request.method==='GET'&&u.pathname==='/api/return-seat-context'){
   try{return await returnSeatContext(request,env)}catch(e){return json({error:e?.message||'تعذر تحميل مقاعد رحلة العودة.',code:'RETURN_SEAT_CONTEXT_FAILED'},502)}
 }
 if(request.method==='GET'&&u.pathname==='/api/return-trip-options'){
   const actor=await actorFrom(request,env);
   if(!canCrossBranchReturn(actor))return json({error:'لا توجد لديك صلاحية عرض رحلات العودة الخاصة بالفروع الأخرى.',code:'CROSS_BRANCH_RETURN_CATALOG_FORBIDDEN'},403);
 }
 if(request.method==='POST'&&(u.pathname==='/api/customer/book'||u.pathname==='/api/admin')){
   const body=await request.clone().json().catch(()=>({}));
   try{const guard=await guardBooking(request,env,u.pathname,body);if(guard)return guard}catch(e){return json({error:e?.message||'تعذر التحقق من نوع الرحلة.',code:'BOOKING_CYCLE_GUARD_FAILED'},502)}
 }
 if(request.method==='POST'&&u.pathname==='/api/module'){
   const body=await request.clone().json().catch(()=>({}));
   try{const guard=await guardReturnHousing(env,body);if(guard)return guard}catch(e){return json({error:e?.message||'تعذر التحقق من ارتباط السكن بالرحلة.',code:'RETURN_HOUSING_GUARD_FAILED'},502)}
 }
 return appWorker.fetch(request,env,ctx)
}};