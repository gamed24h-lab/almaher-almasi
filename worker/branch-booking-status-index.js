import appWorker from './refund-control-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const low=v=>String(v??'').trim().toLowerCase();

const normalizeBranchBookingStatus=async request=>{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/customer/book')return request;
  let body;
  try{body=await request.clone().json()}catch{return request}
  const booking=body?.booking&&typeof body.booking==='object'?{...body.booking}:null;
  if(!booking||String(booking.source||'').trim().toLowerCase()!=='branch')return request;
  const status=String(booking.status||'').trim().toLowerCase();
  if(status&&status!=='new')return request;
  booking.status='confirmed';
  booking.booking_status='confirmed';
  const headers=new Headers(request.headers);
  headers.set('Content-Type','application/json');
  return new Request(request,{headers,body:JSON.stringify({...body,booking})});
};

async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    return (await r.json().catch(()=>({})))?.user||null;
  }catch{return null}
}
const elevated=a=>!!a&&(low(a.role)==='developer'||String(a.role||'')==='مدير عام'||a.permissions?.all===true);
const canChangeStatus=a=>elevated(a)||a?.permissions?.editBookings===true||a?.permissions?.manageBookings===true;
const canChangeTrip=a=>elevated(a)||a?.permissions?.changeTrip===true;
const canAllBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canCrossBranchReturn=a=>elevated(a)||a?.permissions?.crossBranchReturn===true;
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:dbHeaders(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);
  return Array.isArray(out)?out:[];
}
async function tripRow(env,id){
  if(!id)return null;
  return (await rows(env,'trips',`id=eq.${enc(id)}&select=id,trip_code,branch_id,status,from_city,to_city,origin,destination,departure_date,departure_time,return_date,return_time&limit=1`))[0]||null;
}
async function canOperateTrip(env,actor,tripId){
  if(canAllBranches(actor))return true;
  const branchId=String(actor?.branch_id||''),id=String(tripId||'');
  if(!branchId||!id)return false;
  const trip=await tripRow(env,id);
  if(trip&&String(trip.branch_id||'')===branchId)return true;
  const rel=await rows(env,'trip_branches',`trip_id=eq.${enc(id)}&branch_id=eq.${enc(branchId)}&operations_access=eq.true&select=id&limit=1`).catch(()=>[]);
  return rel.length>0;
}
function tripSummary(t){
  if(!t)return null;
  return {id:t.id,trip_code:t.trip_code||'',from_city:t.from_city||t.origin||'',to_city:t.to_city||t.destination||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null};
}
async function releaseRows(env,table,filter,body){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify(body)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||`تعذر تحرير ${table}`);
  return Array.isArray(out)?out.length:0;
}
async function cleanupTripResources(env,booking){
  let seats=0,housing=0;
  const seatFilter=`booking_id=eq.${enc(booking.id)}&status=in.(assigned,hold,blocked)`;
  for(let attempt=0;attempt<2;attempt++){
    try{seats=await releaseRows(env,'seat_assignments',seatFilter,{status:'released'});break}catch(e){if(attempt===1)throw e}
  }
  const passengers=await rows(env,'booking_passengers',`booking_id=eq.${enc(booking.id)}&select=id&limit=5000`);
  const ids=passengers.map(x=>String(x.id||'')).filter(Boolean);
  if(ids.length){
    const list=ids.map(enc).join(',');
    const assignments=await rows(env,'room_assignments',`passenger_id=in.(${list})&select=id,status&limit=5000`);
    const active=assignments.filter(x=>!['released','cancelled','inactive'].includes(low(x.status||'assigned'))).map(x=>String(x.id||'')).filter(Boolean);
    if(active.length){
      const filter=`id=in.(${active.map(enc).join(',')})`;
      for(let attempt=0;attempt<2;attempt++){
        try{housing=await releaseRows(env,'room_assignments',filter,{status:'released'});break}catch(e){if(attempt===1)throw e}
      }
    }
  }
  return {seats,housing};
}

async function setBookingStatus(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canChangeStatus(actor))return json({error:'لا توجد صلاحية لتغيير حالة الحجز.'},403);
  const bookingNo=String(body?.booking_number||'').trim();
  const next=low(body?.status);
  if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
  if(!['new','confirmed'].includes(next))return json({error:'الحالة اليدوية المسموحة هي «جديد» أو «مؤكد». الإلغاء يتم من مسار إلغاء الحجز.'},400);
  const h=dbHeaders(env),b=base(env);
  const q=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id,status,booking_status&limit=1`,{headers:h});
  const found=await parse(q);if(!q.ok)return json({error:found?.message||'تعذر قراءة الحجز.'},502);
  const booking=Array.isArray(found)?found[0]:null;if(!booking)return json({error:'الحجز غير موجود.'},404);
  if(!canAllBranches(actor)&&String(booking.branch_id||'')!==String(actor.branch_id||''))return json({error:'لا يمكنك تغيير حالة حجز تابع لفرع آخر.'},403);
  const current=low(booking.status||booking.booking_status);
  if(['cancelled','canceled','refunded'].includes(current))return json({error:'الحجز الملغي أو المسترد لا يُغيّر يدويًا من هنا. استخدم مسار إعادة التفعيل المخصص.'},409);
  if(current===next&&low(booking.booking_status)===next)return json({ok:true,unchanged:true,status:next});
  const r=await fetch(`${b}/rest/v1/bookings?id=eq.${enc(booking.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({status:next,booking_status:next,last_modified_at:new Date().toISOString()})});
  const out=await parse(r);if(!r.ok)return json({error:out?.message||out?.details||'تعذر تحديث حالة الحجز.'},r.status>=500?502:r.status);
  const audit={actor_id:String(actor.id||''),actor_name:String(actor.name||actor.username||''),actor_role:String(actor.role||''),branch_id:booking.branch_id||actor.branch_id||null,action:'booking_status_changed',entity_type:'booking',entity_id:String(booking.id),metadata:{booking_number:bookingNo,before:current||null,after:next,source:'booking_status_control'}};
  try{await fetch(`${b}/rest/v1/activity_events`,{method:'POST',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify([audit])})}catch{}
  return json({ok:true,booking:Array.isArray(out)?out[0]:out,status:next});
}

async function changeBookingTrip(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canChangeTrip(actor))return json({error:'لا توجد صلاحية لتغيير رحلة الحجز.'},403);
  const bookingNo=String(body?.booking_number||'').trim();
  const mode=low(body?.journey_mode);
  const tripId=String(body?.trip_id||'').trim();
  const returnTripId=String(body?.return_trip_id||'').trim();
  const expectedVersion=Number(body?.version_no||0);
  if(!bookingNo||!tripId)return json({error:'رقم الحجز والرحلة الجديدة مطلوبان.'},400);
  if(!['oneway','roundtrip','separate','returnonly'].includes(mode))return json({error:'نوع الرحلة الجديد غير صالح.'},400);
  if(mode==='separate'&&!returnTripId)return json({error:'اختر رحلة العودة المنفصلة.'},400);
  if(mode!=='separate'&&returnTripId)return json({error:'رحلة العودة المنفصلة تُستخدم فقط مع نوع «ذهاب + عودة من رحلة أخرى».'},400);
  if(mode==='separate'&&tripId===returnTripId)return json({error:'رحلة العودة المنفصلة يجب أن تكون مختلفة عن رحلة الذهاب.'},400);

  const existing=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=*&limit=1`))[0];
  if(!existing)return json({error:'الحجز غير موجود.'},404);
  if(!canAllBranches(actor)&&String(existing.branch_id||'')!==String(actor.branch_id||''))return json({error:'لا يمكنك تغيير رحلة حجز تابع لفرع آخر.'},403);
  const currentStatus=low(existing.status||existing.booking_status);
  if(['cancelled','canceled','refunded','completed'].includes(currentStatus))return json({error:'لا يمكن تغيير رحلة حجز ملغي أو مسترد أو مكتمل.'},409);
  const currentVersion=Number(existing.version_no||1);
  if(expectedVersion&&expectedVersion!==currentVersion)return json({error:'تم تعديل الحجز من مستخدم آخر. حدّث الحجز قبل تغيير الرحلة.',code:'VERSION_CONFLICT',expected_version:expectedVersion,current_version:currentVersion},409);

  const [newTrip,newReturn]=await Promise.all([tripRow(env,tripId),mode==='separate'?tripRow(env,returnTripId):Promise.resolve(null)]);
  if(!newTrip)return json({error:'الرحلة الجديدة غير موجودة.'},404);
  if(['cancelled','canceled','completed'].includes(low(newTrip.status)))return json({error:'الرحلة الجديدة ملغية أو مكتملة ولا يمكن نقل الحجز إليها.'},409);
  if(!(await canOperateTrip(env,actor,tripId)))return json({error:'الرحلة الجديدة خارج نطاق تشغيل فرعك.'},403);
  if(['roundtrip','returnonly'].includes(mode)&&!newTrip.return_date)return json({error:'الرحلة المختارة لا تحتوي على تاريخ عودة.'},409);
  if(mode==='separate'){
    if(!newReturn)return json({error:'رحلة العودة المختارة غير موجودة.'},404);
    if(['cancelled','canceled','completed'].includes(low(newReturn.status)))return json({error:'رحلة العودة المختارة ملغية أو مكتملة.'},409);
    if(!newReturn.return_date)return json({error:'رحلة العودة المختارة لا تحتوي على تاريخ عودة.'},409);
    const normalReturnScope=await canOperateTrip(env,actor,returnTripId);
    if(!normalReturnScope&&!canCrossBranchReturn(actor))return json({error:'رحلة العودة خارج نطاق فرعك وتحتاج صلاحية العودة بين الفروع.'},403);
  }

  const oldTripId=String(existing.trip_id||'');
  const oldReturnTripId=String(existing.return_trip_id||'');
  const oldMode=low(existing.journey_mode);
  if(oldTripId===tripId&&oldReturnTripId===(mode==='separate'?returnTripId:'')&&oldMode===mode)return json({ok:true,unchanged:true,booking:existing,released:{seats:0,housing:0},pricing_review_required:false,total_price_unchanged:Number(existing.total_price||0)});

  const previousSnapshot=existing.snapshot&&typeof existing.snapshot==='object'?existing.snapshot:{};
  const nextSnapshot={...previousSnapshot,journeyMode:mode,tripId,returnTripId:mode==='separate'?returnTripId:null,tripHotelId:null,housingHotelName:null,boardingPoint:null,boardingTime:null,returnBoardingPoint:null,tripChangeRequiresReview:true,tripChangeAt:new Date().toISOString()};
  const patch={trip_id:tripId,return_trip_id:mode==='separate'?returnTripId:null,journey_mode:mode,snapshot:nextSnapshot,version_no:currentVersion+1,last_modified_at:new Date().toISOString(),last_modified_by:actor.name||actor.id||null};
  const h=dbHeaders(env),b=base(env);
  const update=await fetch(`${b}/rest/v1/bookings?id=eq.${enc(existing.id)}&version_no=eq.${enc(currentVersion)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(patch)});
  const updated=await parse(update);
  if(!update.ok)return json({error:updated?.message||updated?.details||'تعذر تغيير رحلة الحجز.'},update.status>=500?502:update.status);
  if(!Array.isArray(updated)||!updated.length)return json({error:'تم تعديل الحجز من مستخدم آخر. حدّث الحجز ثم أعد المحاولة.',code:'VERSION_CONFLICT'},409);

  let released;
  try{released=await cleanupTripResources(env,existing)}catch(cleanupError){
    const rollback={trip_id:existing.trip_id||null,return_trip_id:existing.return_trip_id||null,journey_mode:existing.journey_mode||'oneway',snapshot:previousSnapshot,version_no:currentVersion+2,last_modified_at:new Date().toISOString(),last_modified_by:actor.name||actor.id||null};
    let rolledBack=false;
    try{
      const rb=await fetch(`${b}/rest/v1/bookings?id=eq.${enc(existing.id)}&version_no=eq.${enc(currentVersion+1)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(rollback)});
      rolledBack=rb.ok;
    }catch{}
    if(rolledBack)return json({error:'تعذر تحرير المقاعد أو التسكين القديم، لذلك تم التراجع عن تغيير الرحلة. راجع الموارد ثم أعد المحاولة.',code:'TRIP_CHANGE_CLEANUP_ROLLBACK'},409);
    return json({error:'تم تغيير الرحلة لكن تعذر تأكيد تحرير بعض الموارد ولم ينجح التراجع التلقائي. يجب مراجعة الحجز فورًا.',code:'TRIP_CHANGE_REVIEW_REQUIRED'},500);
  }

  const after=Array.isArray(updated)?updated[0]:updated;
  const audit={actor_id:String(actor.id||''),actor_name:String(actor.name||actor.username||''),actor_role:String(actor.role||''),branch_id:existing.branch_id||actor.branch_id||null,action:'booking_trip_changed',entity_type:'booking',entity_id:String(existing.id),metadata:{booking_number:bookingNo,before:{journey_mode:oldMode,trip:tripSummary(await tripRow(env,oldTripId).catch(()=>null)),return_trip:tripSummary(await tripRow(env,oldReturnTripId).catch(()=>null))},after:{journey_mode:mode,trip:tripSummary(newTrip),return_trip:tripSummary(newReturn)},released,price_unchanged:Number(existing.total_price||0),pricing_review_required:true,source:'booking_360'}};
  try{await fetch(`${b}/rest/v1/activity_events`,{method:'POST',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify([audit])})}catch{}
  return json({ok:true,booking:after,released,pricing_review_required:true,total_price_unchanged:Number(existing.total_price||0)});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=String(body?.action||'');
      if(action==='set_booking_status')return setBookingStatus(request,env,body);
      if(action==='change_booking_trip')return changeBookingTrip(request,env,body);
    }
    return appWorker.fetch(await normalizeBranchBookingStatus(request),env,ctx);
  }
};
