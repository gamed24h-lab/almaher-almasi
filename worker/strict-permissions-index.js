import appWorker from './hotel-permissions-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}

const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const has=(a,key)=>elevated(a)||!!a?.permissions?.[key];
const any=(a,keys)=>keys.some(k=>has(a,k));

function writeRule(table,action){
  if(table==='hotels'){
    if(action==='insert')return ['addHotels','manageHotels'];
    if(action==='update')return ['editHotels','manageHotels'];
    if(action==='delete')return ['deleteHotels','manageHotels'];
  }
  if(table==='trip_hotels')return ['linkHotels','manageHotels'];
  if(table==='hotel_rooms')return ['manageHotelRooms','manageHotels'];
  if(table==='room_assignments')return ['housing'];
  if(table==='drivers'){
    if(action==='insert')return ['addDrivers','manageDrivers'];
    if(action==='update')return ['editDrivers','manageDrivers'];
    if(action==='delete')return ['deleteDrivers','manageDrivers'];
  }
  if(table==='vehicles'){
    if(action==='insert')return ['addVehicles'];
    if(action==='update')return ['editVehicles'];
    if(action==='delete')return ['deleteVehicles'];
  }
  if(table==='trip_vehicles')return ['assignFleet'];
  if(table==='vehicle_maintenance')return ['manageMaintenance'];
  return null;
}

function readRule(resource){
  if(resource==='drivers')return ['viewDrivers','addDrivers','editDrivers','deleteDrivers','manageDrivers'];
  if(resource==='fleet')return ['viewFleet','addVehicles','editVehicles','deleteVehicles','assignFleet','manageMaintenance','viewDrivers','addDrivers','editDrivers','deleteDrivers','manageDrivers'];
  if(resource==='housing')return ['housing','viewHotels','addHotels','editHotels','deleteHotels','linkHotels','manageHotelRooms','manageHotels'];
  return null;
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/module'){
      if(request.method==='GET'){
        const rule=readRule(String(u.searchParams.get('resource')||''));
        if(rule){
          const actor=await actorFrom(request,env);
          if(!actor)return json({error:'انتهت الجلسة.'},401);
          if(!any(actor,rule))return json({error:'لا توجد لديك صلاحية عرض هذه الوحدة.'},403);
        }
      }
      if(request.method==='POST'){
        const body=await request.clone().json().catch(()=>({}));
        const rule=writeRule(String(body?.table||''),String(body?.action||'').toLowerCase());
        if(rule){
          const actor=await actorFrom(request,env);
          if(!actor)return json({error:'انتهت الجلسة.'},401);
          if(!any(actor,rule))return json({error:'لا توجد لديك الصلاحية الدقيقة المطلوبة لتنفيذ هذه العملية.'},403);
        }
      }
    }
    return appWorker.fetch(request,env,ctx);
  }
};
