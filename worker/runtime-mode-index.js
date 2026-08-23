import inventoryWorker from './inventory-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await inventoryWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const isDeveloper=actor=>String(actor?.role||'').toLowerCase()==='developer';
const canDestinations=actor=>!!actor&&(isDeveloper(actor)||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.trips||actor.permissions?.operations||actor.permissions?.manageDestinations);

async function getMode(env){
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return {ok:false,mode:'training',schema_missing:false,error:'إعدادات Supabase على الخادم غير مكتملة.'};
  const r=await fetch(`${base(env)}/rest/v1/system_runtime_state?id=eq.main&select=id,runtime_mode,changed_at,changed_by,details&limit=1`,{headers:headers(env)});const b=await parse(r);
  if(!r.ok){const msg=String(b?.message||'');if(/system_runtime_state|relation .* does not exist|schema cache/i.test(msg))return {ok:true,mode:'training',schema_missing:true,row:null};return {ok:false,mode:'training',schema_missing:false,error:msg||`HTTP ${r.status}`}}
  const row=Array.isArray(b)?b[0]:null;return {ok:true,mode:String(row?.runtime_mode||'training'),schema_missing:false,row};
}

async function runtimeMode(request,env){
  if(request.method==='GET'){
    const x=await getMode(env);if(!x.ok)return json({error:x.error},500);
    return json({ok:true,mode:x.mode,schema_missing:x.schema_missing,changed_at:x.row?.changed_at||null,changed_by:x.row?.changed_by||null});
  }
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'تغيير وضع النظام متاح للمطور الحقيقي فقط.'},403);
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({}));const target=String(body?.mode||'').toLowerCase();
  if(target!=='training')return json({error:'العودة إلى Production ما زالت مقفولة داخل بوابة الإطلاق الآمن.',code:'PRODUCTION_ACTIVATION_LOCKED'},409);
  const current=await getMode(env);if(!current.ok)return json({error:current.error},500);if(current.schema_missing)return json({error:'جدول system_runtime_state غير مثبت بعد. شغّل Migration الخاصة بوضع النظام أولًا.',code:'RUNTIME_MODE_SCHEMA_MISSING'},409);
  const now=new Date().toISOString(),rec={runtime_mode:'training',changed_at:now,changed_by:actor.name||actor.id,details:{reason:'developer_manual_switch_to_training',preserve_production_data:true}};
  const r=await fetch(`${base(env)}/rest/v1/system_runtime_state?id=eq.main`,{method:'PATCH',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(rec)});const b=await parse(r);if(!r.ok)return json({error:b?.message||'تعذر تحويل النظام إلى وضع التدريب.'},502);
  return json({ok:true,mode:'training',changed_at:now,changed_by:actor.name||actor.id,production_data_preserved:true,warnings:['لم يتم حذف أو تحويل أي بيانات Production.','أي سجلات تشغيلية جديدة ستُوسم training بواسطة Trigger قاعدة البيانات.','العودة إلى Production تظل عبر بوابة الإطلاق الآمن فقط.']});
}

function cleanDestination(row={}){return {name:String(row.name||'').trim(),city:String(row.city||'').trim(),destination_type:String(row.destination_type||'city'),address:String(row.address||'').trim()||null,map_url:String(row.map_url||'').trim()||null,notes:String(row.notes||'').trim()||null,active:row.active!==false,updated_at:new Date().toISOString()}}
function cleanRoute(row={}){return {name:String(row.name||'').trim(),from_destination_id:String(row.from_destination_id||''),to_destination_id:String(row.to_destination_id||''),route_stops:Array.isArray(row.route_stops)?row.route_stops:[],branch_ids:Array.isArray(row.branch_ids)?row.branch_ids:[],return_reverse_stops:row.return_reverse_stops!==false,default_bus_capacity:Math.max(1,Number(row.default_bus_capacity||49)),price_one_way:Number(row.price_one_way||0),price_no_accommodation:Number(row.price_no_accommodation||0),price_shared:Number(row.price_shared||0),price_private_room:Number(row.price_private_room||0),active:row.active!==false,notes:String(row.notes||'').trim()||null,updated_at:new Date().toISOString()}}
async function destinationRequest(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canDestinations(actor))return json({error:'لا توجد صلاحية لإدارة الوجهات.'},403);
  const h=headers(env),b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  if(request.method==='GET'){
    const [dr,rr]=await Promise.all([
      fetch(`${b}/rest/v1/travel_destinations?select=*&order=city.asc,name.asc`,{headers:h}),
      fetch(`${b}/rest/v1/destination_routes?select=*&order=name.asc`,{headers:h})
    ]);const [dests,routes]=await Promise.all([parse(dr),parse(rr)]);
    if(!dr.ok||!rr.ok){const msg=String((!dr.ok?dests:routes)?.message||'');if(/travel_destinations|destination_routes|schema cache|does not exist/i.test(msg))return json({error:'جداول إدارة الوجهات غير مثبتة بعد. شغّل Migration الخاصة بإدارة الوجهات في Supabase.',code:'DESTINATIONS_SCHEMA_MISSING'},409);return json({error:msg||'تعذر تحميل إدارة الوجهات.'},502)}
    return json({ok:true,destinations:Array.isArray(dests)?dests:[],routes:Array.isArray(routes)?routes:[]});
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=String(body.action||'');
  if(action==='save_destination'){
    const row=cleanDestination(body.row||{});if(!row.name||!row.city)return json({error:'اسم الوجهة والمدينة مطلوبان.'},400);
    const id=String(body.row?.id||'');const url=id?`${b}/rest/v1/travel_destinations?id=eq.${encodeURIComponent(id)}`:`${b}/rest/v1/travel_destinations`;const method=id?'PATCH':'POST';const r=await fetch(url,{method,headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حفظ الوجهة.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='save_route'){
    const row=cleanRoute(body.row||{});if(!row.name||!row.from_destination_id||!row.to_destination_id)return json({error:'اسم المسار ووجهتا الانطلاق والوصول مطلوبة.'},400);if(row.from_destination_id===row.to_destination_id)return json({error:'وجهة الانطلاق والوصول يجب أن تكونا مختلفتين.'},400);
    const id=String(body.row?.id||'');const url=id?`${b}/rest/v1/destination_routes?id=eq.${encodeURIComponent(id)}`:`${b}/rest/v1/destination_routes`;const method=id?'PATCH':'POST';const r=await fetch(url,{method,headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حفظ المسار.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='toggle_destination'||action==='toggle_route'){
    const table=action==='toggle_destination'?'travel_destinations':'destination_routes',id=String(body.id||'');if(!id)return json({error:'معرّف السجل مطلوب.'},400);const r=await fetch(`${b}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({active:body.active===true,updated_at:new Date().toISOString()})});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر تحديث الحالة.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  return json({error:'إجراء غير مدعوم.'},400);
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/system/runtime-mode')return runtimeMode(request,env);if(u.pathname==='/api/destinations')return destinationRequest(request,env);return inventoryWorker.fetch(request,env,ctx)}};
