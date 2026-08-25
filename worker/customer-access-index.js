import appWorker from './booking-cycle-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const s=v=>String(v??'');
const enc=v=>encodeURIComponent(s(v));
const headers=env=>{const key=s(env.SUPABASE_SERVICE_ROLE_KEY);return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}
async function actorFrom(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(s(a.role).toLowerCase()==='developer'||s(a.role)==='مدير عام'||a.permissions?.all===true);
const allBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canIssue=a=>elevated(a)||a?.permissions?.viewBookings===true||a?.permissions?.editBookings===true||a?.permissions?.printTickets===true;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
function b64urlBytes(bytes){let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function b64urlText(text){return b64urlBytes(encoder.encode(text))}
function fromB64url(value){const raw=s(value).replace(/-/g,'+').replace(/_/g,'/');const pad=raw+'='.repeat((4-raw.length%4)%4);const bin=atob(pad);return Uint8Array.from(bin,ch=>ch.charCodeAt(0))}
async function sign(env,text){const secret=s(env.CUSTOMER_PORTAL_TOKEN_SECRET||env.SUPABASE_SERVICE_ROLE_KEY);if(!secret)throw new Error('Customer portal token secret is missing');const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,encoder.encode(text));return b64urlBytes(new Uint8Array(sig))}
async function issueToken(env,bookingNo){const exp=Math.floor(Date.now()/1000)+180*24*60*60;const payload=b64urlText(JSON.stringify({v:1,b:s(bookingNo),exp}));const sig=await sign(env,payload);return {token:`${payload}.${sig}`,exp}}
async function verifyToken(env,token){try{const [payload,sig]=s(token).split('.');if(!payload||!sig)return null;const expected=await sign(env,payload);if(expected!==sig)return null;const body=JSON.parse(decoder.decode(fromB64url(payload)));if(body?.v!==1||!body?.b||Number(body?.exp||0)<Math.floor(Date.now()/1000))return null;return body}catch{return null}}
const safeTrip=t=>t?{id:t.id,trip_code:t.trip_code||t.code||'',from_city:t.from_city||t.origin||'',to_city:t.to_city||t.destination||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null,status:t.status||''}:null;
const safeBranch=b=>b?{id:b.id,name:b.name||'',address:b.address||'',whatsapp:b.whatsapp||'',phone:b.phone||'',map_url:b.map_url||b.mapUrl||''}:null;
async function one(env,table,id){if(!id)return null;return (await rows(env,table,`id=eq.${enc(id)}&select=*&limit=1`))[0]||null}
async function buildCustomerBooking(env,bookingNo){
 const b=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0];if(!b)return null;
 const passengers=await rows(env,'booking_passengers',`booking_id=eq.${enc(b.id)}&select=*&order=passenger_order.asc&limit=200`);
 const [trip,returnTrip,branch]=await Promise.all([one(env,'trips',b.trip_id),one(env,'trips',b.return_trip_id),one(env,'branches',b.branch_id)]);
 const pids=passengers.map(p=>s(p.id)).filter(Boolean);let housing=[];
 if(pids.length){
  const pIn=pids.map(enc).join(',');
  const assignments=await rows(env,'room_assignments',`passenger_id=in.(${pIn})&status=neq.released&select=id,passenger_id,hotel_room_id,status&limit=500`);
  const roomIds=[...new Set(assignments.map(a=>s(a.hotel_room_id)).filter(Boolean))];
  const rooms=roomIds.length?await rows(env,'hotel_rooms',`id=in.(${roomIds.map(enc).join(',')})&select=id,trip_hotel_id,room_no,room_type,capacity,metadata&limit=500`):[];
  const thIds=[...new Set(rooms.map(r=>s(r.trip_hotel_id)).filter(Boolean))];
  const tripHotels=thIds.length?await rows(env,'trip_hotels',`id=in.(${thIds.map(enc).join(',')})&select=id,hotel_id,trip_id,check_in_date,check_out_date&limit=500`):[];
  const hotelIds=[...new Set(tripHotels.map(x=>s(x.hotel_id)).filter(Boolean))];
  const hotels=hotelIds.length?await rows(env,'hotels',`id=in.(${hotelIds.map(enc).join(',')})&select=id,name,city,address&limit=200`):[];
  const rm=new Map(rooms.map(x=>[s(x.id),x])),tm=new Map(tripHotels.map(x=>[s(x.id),x])),hm=new Map(hotels.map(x=>[s(x.id),x]));
  housing=assignments.map(a=>{const r=rm.get(s(a.hotel_room_id)),th=tm.get(s(r?.trip_hotel_id)),h=hm.get(s(th?.hotel_id));const actual=s(r?.metadata?.actual_room_no).trim();return {passenger_id:a.passenger_id,hotel_name:h?.name||'',hotel_city:h?.city||'',operational_room_no:r?.room_no||'',actual_room_no:actual||null,room_no:actual||r?.room_no||'',room_type:r?.room_type||'',check_in_date:th?.check_in_date||null,check_out_date:th?.check_out_date||null}});
 }
 const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};
 const booking={...snap,id:b.booking_number,number:b.booking_number,bookingNo:b.booking_number,tripId:b.trip_id,returnTripId:b.return_trip_id,branchId:b.branch_id,name:b.customer_name,gender:b.customer_gender,nationality:b.customer_nationality,phone:b.customer_phone,identity:b.customer_identity,travelers:b.travelers,journeyMode:b.journey_mode,accommodationType:b.accommodation_type,accommodationLabel:b.accommodation_label,privateRooms:b.private_rooms,privateRoomTypes:b.private_room_types||[],paymentMethod:b.payment_method,originalPrice:Number(b.original_price||0),totalPrice:Number(b.total_price||0),price:Number(b.total_price||0),paidAmount:Number(b.paid_amount||0),notes:b.notes||'',status:b.status,createdAt:b.created_at,passengerDetails:passengers.map(p=>({name:p.full_name||'',gender:p.gender||'',nationality:p.nationality||'',identity:p.identity_number||'',phone:p.phone||''})),cloudSynced:true,cloudBookingId:b.id};
 const safePassengers=passengers.map(p=>({id:p.id,passenger_order:p.passenger_order,full_name:p.full_name||'',gender:p.gender||'',nationality:p.nationality||'',identity_number:p.identity_number||'',phone:p.phone||'',status:p.status||'',accommodation_status:p.accommodation_status||'',preferred_language:p.preferred_language||'ar'}));
 return {booking,passengers:safePassengers,trip:safeTrip(trip),returnTrip:safeTrip(returnTrip),branch:safeBranch(branch),housing};
}
async function issueAccessLink(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'CUSTOMER_ACCESS_AUTH_REQUIRED'},401);
 if(!canIssue(actor))return json({error:'لا توجد صلاحية لإنشاء رابط بوابة العميل.',code:'CUSTOMER_ACCESS_FORBIDDEN'},403);
 const u=new URL(request.url),bookingNo=s(u.searchParams.get('booking_number')).trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب.',code:'CUSTOMER_ACCESS_BOOKING_REQUIRED'},400);
 const b=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id&limit=1`))[0];if(!b)return json({error:'الحجز غير موجود.',code:'CUSTOMER_ACCESS_BOOKING_NOT_FOUND'},404);
 if(!allBranches(actor)&&s(b.branch_id)!==s(actor.branch_id))return json({error:'الحجز خارج نطاق فرعك.',code:'CUSTOMER_ACCESS_BRANCH_FORBIDDEN'},403);
 const {token,exp}=await issueToken(env,bookingNo);const url=`${u.origin}/customer?access=${encodeURIComponent(token)}`;
 return json({ok:true,token,url,expires_at:new Date(exp*1000).toISOString()});
}
async function openAccess(request,env){
 const u=new URL(request.url),token=s(u.searchParams.get('token')).trim();if(!token)return json({error:'رابط بوابة العميل غير مكتمل.',code:'CUSTOMER_ACCESS_TOKEN_REQUIRED'},400);
 const payload=await verifyToken(env,token);if(!payload)return json({error:'رابط بوابة العميل غير صالح أو انتهت صلاحيته.',code:'CUSTOMER_ACCESS_TOKEN_INVALID'},403);
 const data=await buildCustomerBooking(env,payload.b);if(!data)return json({error:'الحجز غير موجود.',code:'CUSTOMER_ACCESS_BOOKING_NOT_FOUND'},404);
 return json({...data,access:{expires_at:new Date(Number(payload.exp)*1000).toISOString()}});
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.pathname==='/api/customer/access-link'){try{return await issueAccessLink(request,env)}catch(e){return json({error:e?.message||'تعذر إنشاء رابط بوابة العميل.',code:'CUSTOMER_ACCESS_LINK_FAILED'},502)}}
 if(request.method==='GET'&&u.pathname==='/api/customer/access'){try{return await openAccess(request,env)}catch(e){return json({error:e?.message||'تعذر فتح الحجز من بوابة العميل.',code:'CUSTOMER_ACCESS_OPEN_FAILED'},502)}}
 return appWorker.fetch(request,env,ctx);
}};
