import appWorker from './booking-cycle-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const s=v=>String(v??'');
const enc=v=>encodeURIComponent(s(v));
const headers=env=>{const key=s(env.SUPABASE_SERVICE_ROLE_KEY);return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}

async function housingForPassengers(env,passengers=[]){
 const passengerIds=[...new Set(passengers.map(p=>s(p?.id)).filter(Boolean))];
 if(!passengerIds.length)return [];
 const assignments=await rows(env,'room_assignments',`passenger_id=in.(${passengerIds.map(enc).join(',')})&status=neq.released&select=id,passenger_id,hotel_room_id,status&limit=500`);
 const roomIds=[...new Set(assignments.map(a=>s(a.hotel_room_id)).filter(Boolean))];
 if(!roomIds.length)return [];
 const rooms=await rows(env,'hotel_rooms',`id=in.(${roomIds.map(enc).join(',')})&select=id,trip_hotel_id,room_no,room_type,capacity,metadata&limit=500`);
 const tripHotelIds=[...new Set(rooms.map(r=>s(r.trip_hotel_id)).filter(Boolean))];
 const tripHotels=tripHotelIds.length?await rows(env,'trip_hotels',`id=in.(${tripHotelIds.map(enc).join(',')})&select=id,hotel_id,trip_id,check_in_date,check_out_date&limit=500`):[];
 const hotelIds=[...new Set(tripHotels.map(x=>s(x.hotel_id)).filter(Boolean))];
 const hotels=hotelIds.length?await rows(env,'hotels',`id=in.(${hotelIds.map(enc).join(',')})&select=id,name,city,address&limit=200`):[];
 const roomMap=new Map(rooms.map(x=>[s(x.id),x]));
 const tripHotelMap=new Map(tripHotels.map(x=>[s(x.id),x]));
 const hotelMap=new Map(hotels.map(x=>[s(x.id),x]));
 return assignments.map(a=>{
   const room=roomMap.get(s(a.hotel_room_id));
   const tripHotel=tripHotelMap.get(s(room?.trip_hotel_id));
   const hotel=hotelMap.get(s(tripHotel?.hotel_id));
   const actual=s(room?.metadata?.actual_room_no).trim();
   const operational=s(room?.room_no).trim();
   return {
     passenger_id:a.passenger_id,
     hotel_name:hotel?.name||'',
     hotel_city:hotel?.city||'',
     operational_room_no:operational||null,
     actual_room_no:actual||null,
     room_no:actual||operational||'',
     room_type:room?.room_type||'',
     check_in_date:tripHotel?.check_in_date||null,
     check_out_date:tripHotel?.check_out_date||null
   };
 });
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.pathname==='/api/customer/access'){
   const inner=await appWorker.fetch(request,env,ctx);
   if(!inner.ok)return inner;
   const body=await inner.json().catch(()=>null);
   if(!body||!Array.isArray(body.passengers))return json(body||{},inner.status||200);
   try{
     const housing=await housingForPassengers(env,body.passengers);
     return json({...body,housing},inner.status||200);
   }catch(e){
     return json({...body,housing:[],housing_warning:e?.message||'تعذر تحميل بيانات السكن.'},inner.status||200);
   }
 }
 return appWorker.fetch(request,env,ctx);
}};
