import seatWorker from './seat-atomic-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
async function actorFrom(request,env){try{const r=await seatWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const has=(a,...keys)=>!!a&&(elevated(a)||keys.some(k=>!!a.permissions?.[k]));
const legacyFleet=a=>has(a,'fleet','vehicles');
function requiredPermission(table,action){
  if(table==='drivers'){
    if(action==='insert')return ['addDrivers','manageDrivers'];
    if(action==='update')return ['editDrivers','manageDrivers'];
    if(action==='delete')return ['deleteDrivers','manageDrivers'];
  }
  if(table==='vehicles'){
    if(action==='insert')return ['addVehicles','vehicles'];
    if(action==='update')return ['editVehicles','vehicles'];
    if(action==='delete')return ['deleteVehicles','vehicles'];
  }
  if(table==='trip_vehicles')return ['assignFleet','fleet','vehicles'];
  if(table==='vehicle_maintenance')return ['manageMaintenance','fleet','vehicles'];
  return null;
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/module'){
    if(request.method==='GET'){
      const resource=String(u.searchParams.get('resource')||'');
      if(resource==='drivers'){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        if(!(has(actor,'viewDrivers','addDrivers','editDrivers','deleteDrivers','manageDrivers')||legacyFleet(actor)))return json({error:'لا توجد صلاحية لعرض السائقين.'},403);
      }
      if(resource==='fleet'){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        if(!(has(actor,'viewFleet','fleet','vehicles','addVehicles','editVehicles','deleteVehicles','assignFleet','manageMaintenance')||has(actor,'viewDrivers','manageDrivers')))return json({error:'لا توجد صلاحية لعرض الأسطول.'},403);
      }
    }
    if(request.method==='POST'){
      const clone=request.clone();const body=await clone.json().catch(()=>({}));const table=String(body?.table||''),action=String(body?.action||'');const need=requiredPermission(table,action);
      if(need){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        const allowed=has(actor,...need)||(table==='drivers'&&legacyFleet(actor));
        if(!allowed)return json({error:'لا توجد صلاحية لتنفيذ هذه العملية على الأسطول أو السائقين.'},403);
      }
    }
  }
  return seatWorker.fetch(request,env,ctx);
 }
};
