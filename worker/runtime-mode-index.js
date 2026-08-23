import inventoryWorker from './inventory-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await inventoryWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const isDeveloper=actor=>String(actor?.role||'').toLowerCase()==='developer';
const isGeneralManager=actor=>String(actor?.role||'')==='مدير عام';
const p=(actor,key)=>!!actor&&(isDeveloper(actor)||isGeneralManager(actor)||actor.permissions?.all||actor.permissions?.[key]);
const canViewDestinations=actor=>p(actor,'viewDestinations')||p(actor,'manageDestinations')||p(actor,'addDestinations')||p(actor,'editDestinations')||p(actor,'deleteDestinations')||p(actor,'manageDestinationRoutes')||p(actor,'trips')||p(actor,'operations');
const canAddDestination=actor=>p(actor,'addDestinations')||p(actor,'manageDestinations');
const canEditDestination=actor=>p(actor,'editDestinations')||p(actor,'manageDestinations');
const canDeleteDestination=actor=>p(actor,'deleteDestinations')||p(actor,'manageDestinations');
const canManageRoutes=actor=>p(actor,'manageDestinationRoutes')||p(actor,'manageDestinations');

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
const norm=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
const LEGACY_CITIES=['مكة المكرمة','المدينة المنورة','تبوك','تيماء','عرعر','سكاكا','دومة الجندل','طبرجل','القريات','طريف','جدة','الرياض'];

async function syncExistingDestinationData(env){
  const h=headers(env),b=base(env);
  const [dr,rr,tr,tbr]=await Promise.all([
    fetch(`${b}/rest/v1/travel_destinations?select=*`,{headers:h}),
    fetch(`${b}/rest/v1/destination_routes?select=*`,{headers:h}),
    fetch(`${b}/rest/v1/trips?select=id,from_city,to_city,price_one_way,price_no_accommodation,price_shared,price_private_room,bus_capacity,booking_capacity,default_bus_capacity,created_at&order=created_at.desc`,{headers:h}),
    fetch(`${b}/rest/v1/trip_branches?select=trip_id,branch_id,boarding_point,boarding_time,return_drop_time,stop_order`,{headers:h})
  ]);
  const [destBody,routeBody,tripBody,branchBody]=await Promise.all([parse(dr),parse(rr),parse(tr),parse(tbr)]);
  if(!dr.ok||!rr.ok)return {ok:false,schemaMissing:true,error:String((!dr.ok?destBody:routeBody)?.message||'تعذر قراءة جداول الوجهات.')};
  if(!tr.ok)return {ok:false,error:String(tripBody?.message||'تعذر قراءة الرحلات الحالية.')};
  const destinations=Array.isArray(destBody)?destBody:[],routes=Array.isArray(routeBody)?routeBody:[],trips=Array.isArray(tripBody)?tripBody:[],tripBranches=Array.isArray(branchBody)?branchBody:[];
  const existingDest=new Map(destinations.map(x=>[`${norm(x.name)}|${norm(x.city)}`,x]));
  const cityNames=new Set(LEGACY_CITIES);
  for(const t of trips){if(String(t.from_city||'').trim())cityNames.add(String(t.from_city).trim());if(String(t.to_city||'').trim())cityNames.add(String(t.to_city).trim())}
  const missing=[...cityNames].filter(city=>!existingDest.has(`${norm(city)}|${norm(city)}`)).map(city=>({name:city,city,destination_type:'city',active:true,notes:'مستورد تلقائيًا من قائمة إنشاء الرحلات/الرحلات الموجودة بالنظام'}));
  let importedDestinations=0;
  if(missing.length){const r=await fetch(`${b}/rest/v1/travel_destinations`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(missing)});const out=await parse(r);if(!r.ok)return {ok:false,error:String(out?.message||'تعذر استيراد الوجهات الحالية.')};importedDestinations=Array.isArray(out)?out.length:missing.length}
  const freshR=await fetch(`${b}/rest/v1/travel_destinations?select=*`,{headers:h}),fresh=await parse(freshR);if(!freshR.ok)return {ok:false,error:String(fresh?.message||'تعذر إعادة قراءة الوجهات.')};
  const allDest=Array.isArray(fresh)?fresh:[];const byCity=new Map();for(const d of allDest){const k=norm(d.city||d.name);if(k&&!byCity.has(k))byCity.set(k,d)}
  const branchesByTrip=new Map();for(const x of tripBranches){const k=String(x.trip_id||'');const a=branchesByTrip.get(k)||[];a.push(x);branchesByTrip.set(k,a)}
  const existingPairs=new Set(routes.map(r=>`${r.from_destination_id}|${r.to_destination_id}`));const routeCandidates=[];const seenPairs=new Set();
  for(const t of trips){const from=byCity.get(norm(t.from_city)),to=byCity.get(norm(t.to_city));if(!from||!to||from.id===to.id)continue;const pair=`${from.id}|${to.id}`;if(existingPairs.has(pair)||seenPairs.has(pair))continue;seenPairs.add(pair);const rel=(branchesByTrip.get(String(t.id))||[]).slice().sort((a,b)=>Number(a.stop_order||0)-Number(b.stop_order||0));routeCandidates.push({name:`${t.from_city} ← ${t.to_city}`,from_destination_id:from.id,to_destination_id:to.id,route_stops:rel.map(x=>({name:x.boarding_point||'',city:x.boarding_point||'',branch_id:x.branch_id||'',outbound_time:x.boarding_time||'',return_time:x.return_drop_time||''})),branch_ids:[...new Set(rel.map(x=>x.branch_id).filter(Boolean))],return_reverse_stops:true,default_bus_capacity:Number(t.booking_capacity||t.default_bus_capacity||t.bus_capacity||49),price_one_way:Number(t.price_one_way||0),price_no_accommodation:Number(t.price_no_accommodation||0),price_shared:Number(t.price_shared||0),price_private_room:Number(t.price_private_room||0),active:true,notes:'مسار مستورد تلقائيًا من الرحلات الموجودة بالنظام'});}
  let importedRoutes=0;if(routeCandidates.length){const r=await fetch(`${b}/rest/v1/destination_routes`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(routeCandidates)});const out=await parse(r);if(!r.ok)return {ok:false,error:String(out?.message||'تعذر استيراد المسارات الحالية.')};importedRoutes=Array.isArray(out)?out.length:routeCandidates.length}
  return {ok:true,importedDestinations,importedRoutes,sourceTrips:trips.length};
}

async function destinationRequest(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canViewDestinations(actor))return json({error:'لا توجد صلاحية لعرض إدارة الوجهات.'},403);
  const h=headers(env),b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  if(request.method==='GET'){
    const sync=await syncExistingDestinationData(env);if(!sync.ok){if(sync.schemaMissing)return json({error:'جداول إدارة الوجهات غير مثبتة بعد. شغّل Migration الخاصة بإدارة الوجهات في Supabase.',code:'DESTINATIONS_SCHEMA_MISSING'},409);return json({error:sync.error||'تعذر مزامنة الوجهات مع الرحلات الحالية.'},502)}
    const [dr,rr]=await Promise.all([fetch(`${b}/rest/v1/travel_destinations?select=*&order=city.asc,name.asc`,{headers:h}),fetch(`${b}/rest/v1/destination_routes?select=*&order=name.asc`,{headers:h})]);const [dests,routes]=await Promise.all([parse(dr),parse(rr)]);if(!dr.ok||!rr.ok)return json({error:String((!dr.ok?dests:routes)?.message||'تعذر تحميل إدارة الوجهات.')},502);
    return json({ok:true,destinations:Array.isArray(dests)?dests:[],routes:Array.isArray(routes)?routes:[],sync:{source_trips:sync.sourceTrips,imported_destinations:sync.importedDestinations,imported_routes:sync.importedRoutes}});
  }
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=String(body.action||'');
  if(action==='sync_existing'){
    if(!canEditDestination(actor)&&!canManageRoutes(actor))return json({error:'لا توجد صلاحية لمزامنة الوجهات والمسارات.'},403);
    const sync=await syncExistingDestinationData(env);if(!sync.ok)return json({error:sync.error||'تعذر قراءة الوجهات الحالية من النظام.'},502);return json({ok:true,...sync});
  }
  if(action==='save_destination'){
    const id=String(body.row?.id||'');if(id&&!canEditDestination(actor))return json({error:'لا توجد صلاحية لتعديل الوجهات.'},403);if(!id&&!canAddDestination(actor))return json({error:'لا توجد صلاحية لإضافة الوجهات.'},403);
    const row=cleanDestination(body.row||{});if(!row.name||!row.city)return json({error:'اسم الوجهة والمدينة مطلوبان.'},400);
    const url=id?`${b}/rest/v1/travel_destinations?id=eq.${encodeURIComponent(id)}`:`${b}/rest/v1/travel_destinations`;const method=id?'PATCH':'POST';const r=await fetch(url,{method,headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حفظ الوجهة.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='save_route'){
    if(!canManageRoutes(actor))return json({error:'لا توجد صلاحية لإدارة المسارات.'},403);
    const row=cleanRoute(body.row||{});if(!row.name||!row.from_destination_id||!row.to_destination_id)return json({error:'اسم المسار ووجهتا الانطلاق والوصول مطلوبة.'},400);if(row.from_destination_id===row.to_destination_id)return json({error:'وجهة الانطلاق والوصول يجب أن تكونا مختلفتين.'},400);
    const id=String(body.row?.id||'');const url=id?`${b}/rest/v1/destination_routes?id=eq.${encodeURIComponent(id)}`:`${b}/rest/v1/destination_routes`;const method=id?'PATCH':'POST';const r=await fetch(url,{method,headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حفظ المسار.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='toggle_destination'){
    if(!canEditDestination(actor))return json({error:'لا توجد صلاحية لتفعيل أو إيقاف الوجهات.'},403);
    const id=String(body.id||'');if(!id)return json({error:'معرّف السجل مطلوب.'},400);const r=await fetch(`${b}/rest/v1/travel_destinations?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({active:body.active===true,updated_at:new Date().toISOString()})});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر تحديث الحالة.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='toggle_route'){
    if(!canManageRoutes(actor))return json({error:'لا توجد صلاحية لتفعيل أو إيقاف المسارات.'},403);
    const id=String(body.id||'');if(!id)return json({error:'معرّف السجل مطلوب.'},400);const r=await fetch(`${b}/rest/v1/destination_routes?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({active:body.active===true,updated_at:new Date().toISOString()})});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر تحديث الحالة.'},502);return json({ok:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='delete_route'){
    if(!canDeleteDestination(actor)&&!canManageRoutes(actor))return json({error:'لا توجد صلاحية لحذف المسارات.'},403);
    const id=String(body.id||'');if(!id)return json({error:'معرّف المسار مطلوب.'},400);const r=await fetch(`${b}/rest/v1/destination_routes?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{...h,Prefer:'return=representation'}});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حذف المسار.'},502);return json({ok:true,deleted:true,row:Array.isArray(out)?out[0]:out});
  }
  if(action==='delete_destination'){
    if(!canDeleteDestination(actor))return json({error:'لا توجد صلاحية لحذف الوجهات.'},403);
    const id=String(body.id||'');if(!id)return json({error:'معرّف الوجهة مطلوب.'},400);
    const refR=await fetch(`${b}/rest/v1/destination_routes?or=(from_destination_id.eq.${encodeURIComponent(id)},to_destination_id.eq.${encodeURIComponent(id)})&select=id,name&limit=1`,{headers:h});const refs=await parse(refR);if(!refR.ok)return json({error:refs?.message||'تعذر التحقق من ارتباط الوجهة.'},502);if(Array.isArray(refs)&&refs.length)return json({error:`لا يمكن حذف الوجهة لأنها مرتبطة بالمسار «${refs[0].name||'مسار محفوظ'}». أوقفها بدلًا من الحذف أو احذف المسار أولًا.`,code:'DESTINATION_IN_USE'},409);
    const r=await fetch(`${b}/rest/v1/travel_destinations?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{...h,Prefer:'return=representation'}});const out=await parse(r);if(!r.ok)return json({error:out?.message||'تعذر حذف الوجهة.'},502);return json({ok:true,deleted:true,row:Array.isArray(out)?out[0]:out});
  }
  return json({error:'إجراء غير مدعوم.'},400);
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/system/runtime-mode')return runtimeMode(request,env);if(u.pathname==='/api/destinations')return destinationRequest(request,env);return inventoryWorker.fetch(request,env,ctx)}};
