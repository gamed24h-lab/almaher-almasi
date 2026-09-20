import appWorker from './finance-budget-management-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const elevated=u=>!!u&&(lower(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranches===true);
const canPreview=u=>!!u&&(elevated(u)||u.permissions?.viewBookings===true||u.permissions?.editBookings===true||u.permissions?.editPassenger===true);
const canMerge=u=>!!u&&(elevated(u)||u.permissions?.editBookings===true||u.permissions?.editPassenger===true);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||('HTTP '+r.status)}}}
async function actor(request,env,ctx){
 try{
  const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);
  if(!r.ok)return null;
  return (await readJson(r))?.user||null;
 }catch{return null}
}
async function rows(env,table,query){
 const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});
 const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[];
}
async function rpc(env,name,body){
 const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});
 const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||'تعذر تنفيذ العملية');e.code=String(b?.message||'');throw e}return b;
}
const digits=v=>text(v).replace(/\D/g,'');
const compact=v=>lower(v).replace(/\s+/g,'');
function strongMatch(a,b){
 const ai=compact(a?.identity_number),bi=compact(b?.identity_number);
 if(ai&&bi&&ai===bi)return {ok:true,type:'identity',label:'نفس رقم الهوية / الإقامة'};
 const ap=digits(a?.phone),bp=digits(b?.phone),an=compact(a?.full_name),bn=compact(b?.full_name);
 if(ap&&bp&&ap===bp&&an&&bn&&an===bn)return {ok:true,type:'phone_name',label:'نفس الاسم والجوال'};
 return {ok:false,type:'none',label:'لا توجد مطابقة قوية كافية'};
}
function activeStatus(v){return !['released','cancelled','canceled'].includes(lower(v||'assigned'))}
function conflictPreview(refs,a,b){
 const conflicts=[];
 const seats=refs.seat_assignments||[],tripSeats=refs.trip_seat_assignments||[],rooms=refs.room_assignments||[],housing=refs.housing_assignments||[];
 const ca=seats.filter(x=>String(x.passenger_id)===String(a.id)&&activeStatus(x.status)),da=seats.filter(x=>String(x.passenger_id)===String(b.id)&&activeStatus(x.status));
 if(ca.some(x=>da.some(y=>String(x.trip_vehicle_id)===String(y.trip_vehicle_id)&&lower(x.segment_type)===lower(y.segment_type))))conflicts.push('يوجد تعارض مقاعد فعّال لنفس الاتجاه.');
 const cta=tripSeats.filter(x=>String(x.booking_passenger_id)===String(a.id)&&activeStatus(x.assignment_status)),dta=tripSeats.filter(x=>String(x.booking_passenger_id)===String(b.id)&&activeStatus(x.assignment_status));
 if(cta.some(x=>dta.some(y=>String(x.trip_bus_id)===String(y.trip_bus_id)&&lower(x.direction)===lower(y.direction))))conflicts.push('يوجد تعارض في مقاعد الرحلة لنفس الاتجاه.');
 if(rooms.some(x=>String(x.passenger_id)===String(a.id)&&activeStatus(x.status))&&rooms.some(x=>String(x.passenger_id)===String(b.id)&&activeStatus(x.status)))conflicts.push('السجلان مرتبطان بتسكين فعّال؛ راجع الغرف أولًا.');
 if(housing.some(x=>String(x.booking_passenger_id)===String(a.id)&&activeStatus(x.assignment_status))&&housing.some(x=>String(x.booking_passenger_id)===String(b.id)&&activeStatus(x.assignment_status)))conflicts.push('السجلان مرتبطان بتوزيع سكن فعّال؛ راجع التسكين أولًا.');
 return conflicts;
}
async function referenceRows(env,a,b){
 const ids=`(${a.id},${b.id})`;
 const specs=[
  ['housing_assignments','booking_passenger_id','id,booking_passenger_id,assignment_status,room_id,housing_id'],
  ['ticket_scan_events','booking_passenger_id','id,booking_passenger_id'],
  ['notification_jobs','booking_passenger_id','id,booking_passenger_id'],
  ['trip_seat_assignments','booking_passenger_id','id,booking_passenger_id,trip_bus_id,direction,assignment_status,seat_number'],
  ['ticket_print_log','booking_passenger_id','id,booking_passenger_id'],
  ['room_assignments','passenger_id','id,passenger_id,trip_room_id,hotel_room_id,status'],
  ['seat_assignments','passenger_id','id,passenger_id,trip_vehicle_id,segment_type,status,seat_no'],
  ['print_events','passenger_id','id,passenger_id'],
  ['passenger_documents','passenger_id','id,passenger_id'],
  ['passenger_meeting_points','passenger_id','id,passenger_id'],
  ['passenger_qr_tokens','passenger_id','id,passenger_id'],
  ['lost_found','passenger_id','id,passenger_id'],
  ['refunds','passenger_id','id,passenger_id'],
  ['scan_events','passenger_id','id,passenger_id']
 ];
 const out={};
 await Promise.all(specs.map(async([table,col,select])=>{out[table]=await rows(env,table,`${col}=in.${ids}&select=${enc(select)}&limit=500`)}));
 return out;
}
function refCounts(refs,id){
 const out={};
 for(const [table,list] of Object.entries(refs))out[table]=(list||[]).filter(x=>String(x.booking_passenger_id||x.passenger_id)===String(id)).length;
 return out;
}
function friendlyMergeError(e){
 const m=String(e?.message||e||'');
 if(/MERGE_REASON_REQUIRED/i.test(m))return 'اكتب سبب الدمج بوضوح (5 أحرف على الأقل).';
 if(/MERGE_SAME_BOOKING_ONLY/i.test(m))return 'الدمج مسموح فقط لسجلين مكررين داخل نفس الحجز. تكرار نفس الشخص في حجوزات مختلفة يُعتبر تاريخ سفر وليس سجلًا مكررًا.';
 if(/MERGE_STRONG_MATCH_REQUIRED/i.test(m))return 'لا توجد مطابقة قوية كافية بين السجلين.';
 if(/MERGE_(SEAT|TRIP_SEAT)_CONFLICT/i.test(m))return 'يوجد تعارض مقاعد بين السجلين. عالج المقاعد أولًا ثم أعد المحاولة.';
 if(/MERGE_(ROOM|HOUSING)_CONFLICT/i.test(m))return 'يوجد تعارض تسكين بين السجلين. عالج التسكين أولًا ثم أعد المحاولة.';
 if(/MERGE_ENVIRONMENT_MISMATCH/i.test(m))return 'لا يمكن دمج سجلين من بيئتين مختلفتين.';
 if(/MERGE_PASSENGER_NOT_FOUND|MERGE_BOOKING_NOT_FOUND/i.test(m))return 'أحد السجلات لم يعد موجودًا.';
 return m||'تعذر دمج السجلين.';
}
async function inspectPair(env,u,canonicalId,duplicateId){
 if(!canonicalId||!duplicateId||canonicalId===duplicateId)return {can_merge:false,reasons:['اختر سجلين مختلفين.']};
 const pair=await rows(env,'booking_passengers',`id=in.(${enc(canonicalId)},${enc(duplicateId)})&select=*&limit=2`);
 const canonical=pair.find(x=>String(x.id)===String(canonicalId)),duplicate=pair.find(x=>String(x.id)===String(duplicateId));
 if(!canonical||!duplicate)return {can_merge:false,reasons:['أحد السجلين غير موجود.']};
 const bookingRows=await rows(env,'bookings',`id=eq.${enc(canonical.booking_id)}&select=id,booking_number,branch_id,data_environment&limit=1`);
 const booking=bookingRows[0]||null;
 if(!booking)return {can_merge:false,reasons:['الحجز غير موجود.'],canonical,duplicate};
 if(!elevated(u)&&String(booking.branch_id||'')!==String(u?.branch_id||''))return {forbidden:true,can_merge:false,reasons:['الحجز خارج نطاق فرعك.']};
 const reasons=[];
 if(String(canonical.booking_id)!==String(duplicate.booking_id))reasons.push('السجلان ليسا داخل نفس الحجز.');
 if(String(canonical.data_environment||'')!==String(duplicate.data_environment||''))reasons.push('السجلان من بيئتين مختلفتين.');
 if(['merged','deleted'].includes(lower(canonical.status))||['merged','deleted'].includes(lower(duplicate.status)))reasons.push('أحد السجلين مدموج أو محذوف بالفعل.');
 const match=strongMatch(canonical,duplicate);if(!match.ok)reasons.push(match.label);
 const refs=await referenceRows(env,canonical,duplicate);
 reasons.push(...conflictPreview(refs,canonical,duplicate));
 return {can_merge:reasons.length===0,match,reasons,canonical,duplicate,booking,references:{canonical:refCounts(refs,canonical.id),duplicate:refCounts(refs,duplicate.id)}};
}
async function handle(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canPreview(u))return json({error:'لا توجد صلاحية مراجعة تكرارات المسافرين.'},403);
 const preview=await inspectPair(env,u,String(body.canonical_id||''),String(body.duplicate_id||''));
 if(preview.forbidden)return json({error:preview.reasons?.[0]||'خارج نطاق الفرع.'},403);
 if(body.action==='passenger_duplicate_preview')return json({ok:true,...preview,can_execute:canMerge(u)});
 if(!canMerge(u))return json({error:'دمج سجلات المسافرين يتطلب صلاحية تعديل المسافر أو الحجز.'},403);
 if(!preview.can_merge)return json({error:preview.reasons?.join(' ')||'لا يمكن دمج السجلين.',preview},409);
 if(text(body.confirm_booking_number)!==text(preview.booking?.booking_number))return json({error:'اكتب رقم الحجز كما هو لتأكيد عملية الدمج.'},400);
 if(text(body.reason).length<5)return json({error:'سبب الدمج مطلوب (5 أحرف على الأقل).'},400);
 try{
  const result=await rpc(env,'merge_booking_passenger_duplicates',{
   p_canonical:preview.canonical.id,p_duplicate:preview.duplicate.id,
   p_actor_id:String(u.id||''),p_actor_name:String(u.name||u.username||''),p_actor_role:String(u.role||''),
   p_reason:text(body.reason)
  });
  return json({ok:true,result,preview});
 }catch(e){return json({error:friendlyMergeError(e)},409)}
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(body?.action==='passenger_duplicate_preview'||body?.action==='passenger_duplicate_merge')return handle(request,env,ctx,body);
  }
  return appWorker.fetch(request,env,ctx);
 }
};
