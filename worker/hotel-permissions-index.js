import bookingTimelineWorker from './booking-timeline-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const enc=v=>encodeURIComponent(String(v??''));

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

function supa(env){
  const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  return {url,key,headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
}

async function rows(env,table,query){
  const {url,key,headers}=supa(env);if(!url||!key)throw new Error('Server Supabase environment variables are missing');
  const r=await fetch(`${url}/rest/v1/${table}?${query}`,{headers});
  const b=await r.json().catch(()=>[]);
  if(!r.ok)throw new Error(b?.message||`تعذر قراءة ${table}`);
  return Array.isArray(b)?b:[];
}

async function canOperateTrip(env,actor,tripId){
  if(elevated(actor)||actor?.permissions?.allBranches)return true;
  const bid=String(actor?.branch_id||''),tid=String(tripId||'');if(!bid||!tid)return false;
  const t=(await rows(env,'trips',`id=eq.${enc(tid)}&select=id,branch_id&limit=1`))[0];
  if(t&&String(t.branch_id||'')===bid)return true;
  const rel=await rows(env,'trip_branches',`trip_id=eq.${enc(tid)}&branch_id=eq.${enc(bid)}&operations_access=eq.true&select=id&limit=1`).catch(()=>[]);
  return rel.length>0;
}

async function safeHousingDelete(request,env,actor,body){
  const table=String(body.table||''),id=String(body.id||'');
  if(!id)return json({error:'معرّف السجل المطلوب حذفه غير موجود.'},400);
  const allowed=new Set(['hotel_rooms','trip_hotels','hotels']);
  if(!allowed.has(table))return null;

  if(table==='hotel_rooms'){
    const room=(await rows(env,'hotel_rooms',`id=eq.${enc(id)}&select=id,room_no,trip_hotel_id&limit=1`))[0];
    if(!room)return json({error:'الغرفة غير موجودة.'},404);
    const th=(await rows(env,'trip_hotels',`id=eq.${enc(room.trip_hotel_id)}&select=id,trip_id&limit=1`))[0];
    if(!th||!await canOperateTrip(env,actor,th.trip_id))return json({error:'الغرفة خارج نطاق تشغيل فرعك.'},403);
    const assignments=await rows(env,'room_assignments',`hotel_room_id=eq.${enc(id)}&select=id,status&limit=500`);
    const active=assignments.filter(x=>!['released','cancelled','inactive'].includes(String(x.status||'assigned').toLowerCase()));
    if(active.length)return json({error:`لا يمكن حذف الغرفة ${room.room_no||''} وبها ${active.length} مسافر. أخرج المسافرين أولًا.`},409);
  }

  if(table==='trip_hotels'){
    const th=(await rows(env,'trip_hotels',`id=eq.${enc(id)}&select=id,trip_id,hotel_id&limit=1`))[0];
    if(!th)return json({error:'ربط الفندق بالرحلة غير موجود.'},404);
    if(!await canOperateTrip(env,actor,th.trip_id))return json({error:'الفندق مرتبط برحلة خارج نطاق تشغيل فرعك.'},403);
    const room=(await rows(env,'hotel_rooms',`trip_hotel_id=eq.${enc(id)}&select=id&limit=1`))[0];
    if(room)return json({error:'لا يمكن فك ربط الفندق من الرحلة قبل حذف/نقل الغرف التابعة له.'},409);
  }

  if(table==='hotels'){
    if(!any(actor,['manageHotels','deleteHotels']))return json({error:'لا توجد صلاحية حذف الفنادق.'},403);
    const hotel=(await rows(env,'hotels',`id=eq.${enc(id)}&select=id,name&limit=1`))[0];
    if(!hotel)return json({error:'الفندق غير موجود.'},404);
    const linked=(await rows(env,'trip_hotels',`hotel_id=eq.${enc(id)}&select=id&limit=1`))[0];
    if(linked)return json({error:'الفندق مرتبط برحلة أو أكثر. أوقفه أو فك الارتباطات أولًا بدل الحذف.'},409);
  }

  const {url,headers}=supa(env);
  const r=await fetch(`${url}/rest/v1/${table}?id=eq.${enc(id)}`,{method:'DELETE',headers:{...headers,Prefer:'return=representation'}});
  const b=await r.json().catch(()=>[]);
  if(!r.ok)return json({error:b?.message||b?.details||`تعذر حذف ${table}`},r.status>=400&&r.status<500?r.status:400);
  const deleted=Array.isArray(b)?b[0]||null:b;
  return json({ok:true,deleted:true,row:deleted});
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
        if(String(body.action||'').toLowerCase()==='delete'){
          try{
            const handled=await safeHousingDelete(request,env,actor,body);
            if(handled)return handled;
          }catch(e){return json({error:e?.message||'تعذر تنفيذ الحذف الآمن.'},500)}
        }
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
