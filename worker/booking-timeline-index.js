import fleetWorker from './fleet-permissions-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await fleetWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const allBranches=a=>elevated(a)||!!a?.permissions?.allBranches;
const canView=a=>elevated(a)||!!a?.permissions?.viewBookingActivity||!!a?.permissions?.viewBookings||!!a?.permissions?.editBookings||!!a?.permissions?.branchBooking;
const text=v=>String(v??'');
const ts=v=>v?new Date(v).toISOString():null;
const AUDIT_TABLES=new Set(['bookings','booking_passengers','booking_accommodations','room_assignments','seat_assignments','transactions','refunds']);
const HIDDEN_FIELDS=new Set(['password','password_hash','token','session_token','security_meta','snapshot','id','uuid','version_no','versionNo','updated_at','created_at','last_modified_at','data_environment','entity_id','booking_id','passenger_id']);
const FIELD_LABELS={
 customer_name:'اسم العميل',customerName:'اسم العميل',customer_phone:'جوال العميل',customerPhone:'جوال العميل',customer_identity:'الهوية / الإقامة',customerIdentity:'الهوية / الإقامة',customer_nationality:'جنسية العميل',customerNationality:'جنسية العميل',customer_gender:'جنس العميل',customerGender:'جنس العميل',trip_id:'رحلة الذهاب',tripId:'رحلة الذهاب',return_trip_id:'رحلة العودة',returnTripId:'رحلة العودة',journey_mode:'نوع الرحلة',journeyMode:'نوع الرحلة',status:'الحالة',accommodation_type:'نوع السكن',accommodationType:'نوع السكن',accommodation_label:'تفاصيل السكن',accommodationLabel:'تفاصيل السكن',private_rooms:'عدد الغرف الخاصة',privateRooms:'عدد الغرف الخاصة',privateRoomType:'نوع الغرفة الخاصة',private_room_types:'أنواع الغرف الخاصة',housingDays:'عدد أيام السكن',accommodation_days:'عدد أيام السكن',total_price:'إجمالي الحجز',totalPrice:'إجمالي الحجز',original_price:'السعر الأصلي',originalPrice:'السعر الأصلي',paid_amount:'المبلغ المدفوع',paidAmount:'المبلغ المدفوع',payment_method:'طريقة الدفع',paymentMethod:'طريقة الدفع',payment_reference:'مرجع الدفع',paymentReference:'مرجع الدفع',notes:'الملاحظات',branch_id:'الفرع',branchId:'الفرع',travelers:'عدد المسافرين',passengerDetails:'بيانات المسافرين',full_name:'اسم المسافر',name:'الاسم',identity_number:'هوية المسافر',identity:'هوية المسافر',nationality:'الجنسية',gender:'الجنس',phone:'الجوال',preferred_language:'لغة التواصل',preferredLanguage:'لغة التواصل',document_status:'حالة المستند',documentStatus:'حالة المستند',seat_no:'رقم المقعد',seatNo:'رقم المقعد',segment_type:'اتجاه الرحلة',segmentType:'اتجاه الرحلة',hotel_room_id:'غرفة الفندق',hotelRoomId:'غرفة الفندق',trip_room_id:'غرفة الرحلة',tripRoomId:'غرفة الرحلة',room_id:'الغرفة',roomId:'الغرفة',amount:'المبلغ',transaction_type:'نوع الحركة المالية',refund_amount:'قيمة الاسترداد',reason:'السبب',driver_id:'السائق',vehicle_id:'المركبة',license_no:'رقم الرخصة',license_expiry:'انتهاء الرخصة',plate_no:'رقم اللوحة',physical_capacity:'السعة الفعلية',booking_capacity:'سعة الحجز',departure_date:'تاريخ الرحلة',departure_time:'وقت الرحلة',from_city:'مدينة المغادرة',to_city:'الوجهة'
};
const PAYMENT={cash:'نقدي',card:'بطاقة',bank:'تحويل بنكي',transfer:'تحويل بنكي',mada:'مدى',apple_pay:'Apple Pay'};
const ACCOMMODATION={none:'بدون سكن',shared:'سكن مشترك خماسي',private:'غرفة خاصة'};
const GENDER={male:'ذكر',female:'أنثى',m:'ذكر',f:'أنثى'};
const JOURNEY={oneway:'ذهاب فقط',roundtrip:'ذهاب وعودة',separate:'ذهاب + عودة منفصلة',returnonly:'عودة فقط'};
const SEGMENT={outbound:'ذهاب',return:'عودة'};
const STATUS={confirmed:'مؤكد',cancelled:'ملغي',pending:'قيد المراجعة',active:'نشط',inactive:'موقوف',available:'متاح',assigned:'مُعيّن',released:'محرر',blocked:'محجوب',hold:'محجوز مؤقتًا',completed:'مكتمل'};
const MONEY_FIELDS=new Set(['total_price','totalPrice','original_price','originalPrice','paid_amount','paidAmount','amount','refund_amount','cost']);
function personSummary(v){if(!Array.isArray(v))return null;const names=v.map(x=>x?.full_name||x?.name).filter(Boolean);return names.length?`${v.length} مسافر — ${names.slice(0,4).join('، ')}${names.length>4?'…':''}`:`${v.length} عنصر`;}
function cleanVal(field,v){
 if(v===undefined)return undefined;if(v===null||v==='')return null;if(v===true)return 'نعم';if(v===false)return 'لا';
 const f=String(field||''),raw=String(v);
 if(f==='journey_mode'||f==='journeyMode')return JOURNEY[raw.toLowerCase()]||raw;
 if(f==='gender'||f==='customer_gender'||f==='customerGender')return GENDER[raw.toLowerCase()]||raw;
 if(f==='accommodation_type'||f==='accommodationType')return ACCOMMODATION[raw.toLowerCase()]||raw;
 if(f==='payment_method'||f==='paymentMethod'||f==='method')return PAYMENT[raw.toLowerCase()]||raw;
 if(f==='segment_type'||f==='segmentType')return SEGMENT[raw.toLowerCase()]||raw;
 if(f==='status')return STATUS[raw.toLowerCase()]||raw;
 if(MONEY_FIELDS.has(f)){const n=Number(v);return Number.isFinite(n)?`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(n)} ر.س`:raw;}
 if(f==='trip_id'||f==='tripId'||f==='return_trip_id'||f==='returnTripId')return /^[-0-9a-f]{36}$/i.test(raw)?'رحلة محفوظة بالنظام':raw;
 if(f==='branch_id'||f==='branchId'||f.endsWith('_id')||f.endsWith('Id'))return /^[-0-9a-f]{36}$/i.test(raw)?'سجل محفوظ بالنظام':raw;
 if(Array.isArray(v))return personSummary(v)||`${v.length} عنصر`;
 if(typeof v==='object'){const name=v.name||v.full_name||v.label||v.code;return name?String(name):'بيانات محدثة';}
 if(/^[-0-9a-f]{36}$/i.test(raw))return 'سجل محفوظ بالنظام';
 return raw.length>160?`${raw.slice(0,157)}…`:raw;
}
function same(a,b){try{return JSON.stringify(a??null)===JSON.stringify(b??null)}catch{return String(a)===String(b)}}
function buildChanges(before={},after={}){
 const changes=[];
 for(const [field,afterValue] of Object.entries(after||{})){
  if(HIDDEN_FIELDS.has(field)||field.startsWith('_'))continue;
  if(afterValue===undefined)continue;
  const beforeValue=before?.[field];
  if(same(beforeValue,afterValue))continue;
  changes.push({field,label:FIELD_LABELS[field]||String(field).replace(/_/g,' '),before:cleanVal(field,beforeValue),after:cleanVal(field,afterValue)});
 }
 return changes.slice(0,80);
}

function eventLabel(action,entityType=''){
 const a=text(action).toLowerCase(),e=text(entityType).toLowerCase();
 if(/customer_book|create_booking|booking_created|insert_booking/.test(a))return 'تم إنشاء الحجز';
 if(/update_booking|booking_update|edit_booking/.test(a))return 'تم تعديل الحجز';
 if(/refund/.test(a+e))return 'تم تنفيذ / تعديل استرداد';
 if(/payment|transaction|receipt|collect/.test(a+e))return 'تم تسجيل حركة مالية';
 if(/seat/.test(a+e))return 'تم تغيير المقعد';
 if(/room|housing|accommodation/.test(a+e))return 'تم تغيير التسكين';
 if(/passenger/.test(a+e))return 'تم تعديل بيانات مسافر';
 if(/scan|qr/.test(a+e))return 'تم تسجيل حركة QR / ركوب';
 if(/cancel/.test(a))return 'تم الإلغاء';
 if(/approve/.test(a+e))return 'تم الاعتماد';
 return action||'نشاط على الحجز';
}

async function resolveBookingId(env,bookingNo){
 if(!bookingNo||!base(env))return null;
 try{const r=await fetch(`${base(env)}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=id&limit=1`,{headers:headers(env)});const b=await parse(r);return r.ok&&Array.isArray(b)?b[0]?.id||null:null}catch{return null}
}
async function fetchOne(env,table,{id,bookingNo}={}){
 if(!AUDIT_TABLES.has(table)||!base(env))return null;
 let filter='';
 if(id)filter=`id=eq.${encodeURIComponent(id)}`;
 else if(table==='bookings'&&bookingNo)filter=`booking_number=eq.${encodeURIComponent(bookingNo)}`;
 else return null;
 try{const r=await fetch(`${base(env)}/rest/v1/${table}?${filter}&select=*&limit=1`,{headers:headers(env)});const b=await parse(r);return r.ok&&Array.isArray(b)?b[0]||null:null}catch{return null}
}

function bookingWriteDescriptor(path,body={}){
 const action=text(body.action||'');
 if(path==='/api/customer/book')return {action:'booking_created',bookingNo:body?.booking?.booking_number||body?.booking?.number||null,bookingId:body?.booking?.id||null,entityType:'bookings',table:'bookings',after:body?.booking||{}};
 if(path==='/api/admin'&&action==='update_booking')return {action:'update_booking',bookingNo:body?.booking?.booking_number||body?.booking?.number||null,bookingId:body?.booking?.id||null,entityType:'bookings',table:'bookings',recordId:body?.booking?.id||null,after:body?.booking||{}};
 const row=body?.row&&typeof body.row==='object'?body.row:{};
 const table=text(body.table||'');
 const bookingId=body?.booking_id||body?.bookingId||row.booking_id||row.bookingId||null;
 const bookingNo=body?.booking_number||body?.bookingNumber||row.booking_number||row.bookingNumber||null;
 if(bookingId||bookingNo){
  return {action:action||`${table||'booking'}_write`,bookingId,bookingNo,entityType:table||'booking',table,recordId:body?.id||row.id||null,after:row};
 }
 return null;
}

async function enrichDescriptorBefore(env,descriptor){
 if(!descriptor)return descriptor;
 let before=null;
 if(descriptor.table==='bookings')before=await fetchOne(env,'bookings',{id:descriptor.recordId||descriptor.bookingId,bookingNo:descriptor.bookingNo});
 else if(descriptor.recordId&&AUDIT_TABLES.has(descriptor.table))before=await fetchOne(env,descriptor.table,{id:descriptor.recordId});
 return {...descriptor,before};
}

async function appendBookingEvent(env,actor,descriptor,path,method,status){
 if(!descriptor||!base(env))return;
 let bookingId=descriptor.bookingId||descriptor.before?.booking_id||descriptor.after?.booking_id||null;
 if(!bookingId&&descriptor.bookingNo)bookingId=await resolveBookingId(env,descriptor.bookingNo);
 if(!bookingId&&!descriptor.bookingNo)return;
 const changes=buildChanges(descriptor.before||{},descriptor.after||{});
 const row={actor_id:text(actor?.id||''),actor_name:text(actor?.name||actor?.username||'النظام'),actor_role:text(actor?.role||''),branch_id:actor?.branch_id||null,action:text(descriptor.action||'booking_activity'),entity_type:text(descriptor.entityType||'bookings'),entity_id:text(bookingId||descriptor.bookingNo),metadata:{booking_id:bookingId||null,booking_number:descriptor.bookingNo||descriptor.before?.booking_number||descriptor.after?.booking_number||null,path,method,status:Number(status||0),source:'booking_timeline_wrapper',record_id:descriptor.recordId||descriptor.before?.id||descriptor.after?.id||null,changes,change_count:changes.length}};
 try{await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify([row])})}catch{}
}

async function bookingTimeline(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
 if(!canView(actor))return json({error:'لا توجد صلاحية لعرض سجل نشاط الحجز.'},403);
 const u=new URL(request.url),bookingNo=text(u.searchParams.get('bookingNo')).trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
 const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات قاعدة البيانات على الخادم غير مكتملة.'},500);
 const h=headers(env);
 const br=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=*&limit=1`,{headers:h});const bb=await parse(br);const booking=Array.isArray(bb)?bb[0]:null;
 if(!br.ok)return json({error:bb?.message||'تعذر قراءة الحجز.'},502);if(!booking)return json({error:'الحجز غير موجود.'},404);
 if(!allBranches(actor)&&actor.branch_id&&String(booking.branch_id||'')!==String(actor.branch_id))return json({error:'لا توجد صلاحية لعرض نشاط حجز تابع لفرع آخر.'},403);
 const ar=await fetch(`${b}/rest/v1/activity_events?select=id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at&order=created_at.asc&limit=2000`,{headers:h});const ab=await parse(ar);
 let audit=ar.ok&&Array.isArray(ab)?ab:[];
 const bookingId=text(booking.id);
 audit=audit.filter(x=>{const m=x?.metadata&&typeof x.metadata==='object'?x.metadata:{};return [x.entity_id,m.booking_id,m.bookingId,m.booking_number,m.bookingNumber,m.entity_id].some(v=>text(v)===bookingId||text(v)===bookingNo)});
 const events=audit.map(x=>({id:`audit-${x.id}`,kind:'audit',title:eventLabel(x.action,x.entity_type),action:eventLabel(x.action,x.entity_type),entity_type:x.entity_type||'',actor_name:x.actor_name||'',actor_role:x.actor_role||'',created_at:ts(x.created_at),metadata:x.metadata||{},changes:Array.isArray(x?.metadata?.changes)?x.metadata.changes.filter(c=>!HIDDEN_FIELDS.has(String(c?.field||''))).map(c=>({field:c.field,label:FIELD_LABELS[c.field]||c.label||String(c.field||'بيان').replace(/_/g,' '),before:cleanVal(c.field,c.before),after:cleanVal(c.field,c.after)})):[]}));
 if(booking.created_at&&!events.some(x=>x.action==='تم إنشاء الحجز'||x.title==='تم إنشاء الحجز'))events.push({id:`booking-created-${booking.id}`,kind:'booking',title:'تم إنشاء الحجز',action:'تم إنشاء الحجز',entity_type:'bookings',actor_name:booking.created_by||'',actor_role:'',created_at:ts(booking.created_at),metadata:{status:booking.status,total_price:booking.total_price,paid_amount:booking.paid_amount},changes:[]});
 events.sort((a,b2)=>String(a.created_at||'').localeCompare(String(b2.created_at||'')));
 return json({ok:true,booking:{id:booking.id,booking_number:booking.booking_number,customer_name:booking.customer_name,branch_id:booking.branch_id,status:booking.status,created_at:booking.created_at},events,count:events.length,audit_available:ar.ok});
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/bookings/timeline'&&request.method==='GET')return bookingTimeline(request,env);
  let actor=null,descriptor=null;
  if(request.method!=='GET'&&['/api/customer/book','/api/admin','/api/module','/api/mega','/api/platform','/api/seats/atomic'].includes(u.pathname)){
    let body={};try{body=await request.clone().json()}catch{}
    descriptor=bookingWriteDescriptor(u.pathname,body);
    if(descriptor){actor=await actorFrom(request,env);descriptor=await enrichDescriptorBefore(env,descriptor)}
  }
  const response=await fleetWorker.fetch(request,env,ctx);
  if(descriptor&&response.ok){const task=appendBookingEvent(env,actor,descriptor,u.pathname,request.method,response.status);if(ctx?.waitUntil)ctx.waitUntil(task);else await task}
  return response;
 }
};
