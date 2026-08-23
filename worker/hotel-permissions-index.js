import bookingTimelineWorker from './booking-timeline-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

async function actorFrom(request,env){
  try{
    const r=await bookingTimelineWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}

const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const has=(a,k)=>elevated(a)||!!a?.permissions?.[k];
const any=(a,keys)=>keys.some(k=>has(a,k));

function requiredPermission(body={}){
  const table=String(body.table||'');
  const action=String(body.action||'').toLowerCase();
  if(table==='hotels'){
    if(action==='insert')return ['manageHotels','addHotels'];
    if(action==='update')return ['manageHotels','editHotels'];
    if(action==='delete')return ['manageHotels','deleteHotels'];
  }
  if(table==='trip_hotels')return ['manageHotels','linkHotels','housing'];
  if(table==='hotel_rooms')return ['manageHotels','manageHotelRooms','housing'];
  if(table==='room_assignments')return ['housing'];
  return null;
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/module'&&request.method==='POST'){
      let body={};
      try{body=await request.clone().json()}catch{}
      const needed=requiredPermission(body);
      if(needed){
        const actor=await actorFrom(request,env);
        if(!actor)return json({error:'انتهت الجلسة.'},401);
        if(!any(actor,needed))return json({error:'لا توجد لديك الصلاحية المطلوبة لتنفيذ هذه العملية.'},403);
      }
    }
    if(u.pathname==='/api/module'&&request.method==='GET'&&u.searchParams.get('resource')==='housing'){
      const actor=await actorFrom(request,env);
      if(!actor)return json({error:'انتهت الجلسة.'},401);
      if(!any(actor,['housing','viewHotels','manageHotels','addHotels','editHotels','deleteHotels','linkHotels','manageHotelRooms']))return json({error:'لا توجد لديك صلاحية عرض التسكين أو الفنادق.'},403);
    }
    return bookingTimelineWorker.fetch(request,env,ctx);
  }
};
