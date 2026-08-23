import runtimeModeWorker from './runtime-mode-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await runtimeModeWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const isDeveloper=a=>String(a?.role||'').toLowerCase()==='developer';
const isGM=a=>String(a?.role||'')==='مدير عام';
const has=(a,k)=>!!a&&(isDeveloper(a)||isGM(a)||a.permissions?.all||a.permissions?.[k]);

async function canAccessTripVehicle(actor,env,tripVehicleId){
  if(isDeveloper(actor)||isGM(actor)||actor?.permissions?.all||actor?.permissions?.allBranches)return true;
  if(!actor?.branch_id)return false;
  const h=headers(env),b=base(env);
  const vr=await fetch(`${b}/rest/v1/trip_vehicles?id=eq.${encodeURIComponent(tripVehicleId)}&select=trip_id&limit=1`,{headers:h});
  const vb=await parse(vr);if(!vr.ok||!Array.isArray(vb)||!vb[0]?.trip_id)return false;
  const tr=await fetch(`${b}/rest/v1/trip_branches?trip_id=eq.${encodeURIComponent(vb[0].trip_id)}&branch_id=eq.${encodeURIComponent(actor.branch_id)}&select=id&limit=1`,{headers:h});
  const tb=await parse(tr);return tr.ok&&Array.isArray(tb)&&tb.length>0;
}

async function atomicSeat(request,env){
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!(has(actor,'seats')||has(actor,'operations')||has(actor,'trips')))return json({error:'لا توجد صلاحية لإدارة المقاعد.'},403);
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const body=await request.json().catch(()=>({}));
  const action=String(body?.action||'');
  const tripVehicleId=String(body?.trip_vehicle_id||'');
  const segment=String(body?.segment_type||'outbound');
  const seatNo=String(body?.seat_no||'').trim();
  if(!tripVehicleId||!seatNo)return json({error:'بيانات المقعد أو الباص غير مكتملة.'},400);
  if(!(await canAccessTripVehicle(actor,env,tripVehicleId)))return json({error:'المركبة/الرحلة خارج نطاق تشغيل فرعك.'},403);
  const assignedBy=actor.name||actor.id||null;
  let rpc,payload;
  if(action==='assign'){
    rpc='almaher_assign_seat_atomic';
    payload={p_trip_vehicle_id:tripVehicleId,p_segment_type:segment,p_seat_no:seatNo,p_passenger_id:body.passenger_id||null,p_booking_id:body.booking_id||null,p_assigned_by:assignedBy};
  }else if(['hold','blocked','released'].includes(action)){
    rpc='almaher_set_seat_state_atomic';
    payload={p_trip_vehicle_id:tripVehicleId,p_segment_type:segment,p_seat_no:seatNo,p_status:action,p_assigned_by:assignedBy};
  }else return json({error:'عملية المقعد غير معروفة.'},400);
  const r=await fetch(`${base(env)}/rest/v1/rpc/${rpc}`,{method:'POST',headers:headers(env),body:JSON.stringify(payload)});
  const out=await parse(r);
  if(!r.ok){const raw=String(out?.message||out?.details||out?.hint||'تعذر تنفيذ عملية المقعد.');if(/SEAT_ALREADY_ASSIGNED|SEAT_CONCURRENCY_CONFLICT|duplicate key/i.test(raw))return json({error:'المقعد تم اختياره بالفعل من مستخدم آخر. حدّث الخريطة واختر مقعدًا آخر.',code:'SEAT_CONFLICT'},409);return json({error:raw},502)}
  return json({ok:true,result:out});
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/seats/atomic')return atomicSeat(request,env);return runtimeModeWorker.fetch(request,env,ctx)}};
