import {journeyLabel,money,statusLabel,tripDisplay} from './format.js';

const FIELD_LABELS={
  customer_name:'اسم العميل',customerName:'اسم العميل',customer_phone:'جوال العميل',customerPhone:'جوال العميل',customer_identity:'هوية / إقامة العميل',customerIdentity:'هوية / إقامة العميل',customer_nationality:'جنسية العميل',customerNationality:'جنسية العميل',customer_gender:'جنس العميل',customerGender:'جنس العميل',
  journey_mode:'نوع الرحلة',journeyMode:'نوع الرحلة',trip_id:'رحلة الذهاب',tripId:'رحلة الذهاب',return_trip_id:'رحلة العودة',returnTripId:'رحلة العودة',branch_id:'الفرع',branchId:'الفرع',
  total_price:'إجمالي الحجز',totalPrice:'إجمالي الحجز',original_price:'السعر الأصلي',originalPrice:'السعر الأصلي',paid_amount:'المبلغ المدفوع',paidAmount:'المبلغ المدفوع',payment_method:'طريقة الدفع',paymentMethod:'طريقة الدفع',payment_reference:'مرجع الدفع',paymentReference:'مرجع الدفع',
  accommodation_type:'نوع السكن',accommodationType:'نوع السكن',accommodation_label:'تفاصيل السكن',accommodationLabel:'تفاصيل السكن',housingDays:'عدد أيام السكن',private_rooms:'عدد الغرف الخاصة',privateRooms:'عدد الغرف الخاصة',privateRoomType:'نوع الغرفة الخاصة',private_room_types:'أنواع الغرف الخاصة',
  status:'الحالة',notes:'الملاحظات',full_name:'اسم المسافر',name:'الاسم',phone:'الجوال',identity_number:'رقم الهوية / الإقامة',identity:'رقم الهوية / الإقامة',nationality:'الجنسية',gender:'الجنس',preferred_language:'لغة التواصل',preferredLanguage:'لغة التواصل',document_status:'حالة المستند',documentStatus:'حالة المستند',
  seat_no:'رقم المقعد',seatNo:'رقم المقعد',segment_type:'اتجاه الرحلة',segmentType:'اتجاه الرحلة',room_id:'الغرفة',roomId:'الغرفة',hotel_room_id:'غرفة الفندق',hotelRoomId:'غرفة الفندق',trip_room_id:'غرفة الرحلة',tripRoomId:'غرفة الرحلة',
  amount:'المبلغ',method:'طريقة الدفع',reference:'المرجع',transaction_type:'نوع الحركة',refund_amount:'قيمة الاسترداد',reason:'السبب',driver_id:'السائق',vehicle_id:'المركبة',license_no:'رقم الرخصة',license_expiry:'انتهاء الرخصة',plate_no:'رقم اللوحة',physical_capacity:'السعة الفعلية',booking_capacity:'سعة الحجز',departure_date:'تاريخ الرحلة',departure_time:'وقت الرحلة',from_city:'مدينة المغادرة',to_city:'الوجهة'
};

const ACTION_LABELS={
  booking_created:'تم إنشاء الحجز',booking_updated:'تم تعديل الحجز',booking_cancelled:'تم إلغاء الحجز',booking_deleted:'تم حذف الحجز',passenger_created:'تمت إضافة مسافر',passenger_updated:'تم تعديل بيانات مسافر',passenger_deleted:'تم حذف مسافر',transaction_created:'تم تسجيل تحصيل',payment_created:'تم تسجيل دفعة',refund_created:'تم تنفيذ استرداد',room_assignment_created:'تم تسكين مسافر',room_assignment_updated:'تم تعديل التسكين',room_assignment_deleted:'تم إلغاء التسكين',seat_assignment_created:'تم تعيين مقعد',seat_assignment_updated:'تم تعديل المقعد',seat_assignment_deleted:'تم تحرير المقعد',trip_created:'تم إنشاء رحلة',trip_updated:'تم تعديل رحلة',trip_cancelled:'تم إلغاء رحلة',driver_created:'تمت إضافة سائق',driver_updated:'تم تعديل سائق',driver_deleted:'تم حذف سائق',vehicle_created:'تمت إضافة مركبة',vehicle_updated:'تم تعديل مركبة',vehicle_deleted:'تم حذف مركبة',permission_updated:'تم تعديل الصلاحيات',staff_updated:'تم تعديل موظف',staff_created:'تمت إضافة موظف',destination_created:'تمت إضافة وجهة',destination_updated:'تم تعديل وجهة',destination_deleted:'تم حذف وجهة',route_created:'تمت إضافة مسار',route_updated:'تم تعديل مسار',route_deleted:'تم حذف مسار'};

const ENTITY_LABELS={bookings:'الحجز',booking:'الحجز',booking_passengers:'المسافر',passenger:'المسافر',trips:'الرحلة',trip:'الرحلة',transactions:'التحصيل',refunds:'الاسترداد',room_assignments:'التسكين',seat_assignments:'المقاعد',drivers:'السائق',vehicles:'المركبة',staff_users:'الموظف',travel_destinations:'الوجهة',destination_routes:'المسار'};
const TECHNICAL=new Set(['id','uuid','snapshot','version_no','versionNo','updated_at','created_at','last_modified_at','data_environment','entity_id','booking_id','passenger_id']);
const PAYMENT={cash:'نقدي',card:'بطاقة',bank:'تحويل بنكي',transfer:'تحويل بنكي',mada:'مدى',apple_pay:'Apple Pay'};
const ACCOMMODATION={none:'بدون سكن',shared:'سكن مشترك خماسي',private:'غرفة خاصة'};
const GENDER={male:'ذكر',female:'أنثى',m:'ذكر',f:'أنثى'};
const SEGMENT={outbound:'ذهاب',return:'عودة'};

export const auditFieldLabel=field=>FIELD_LABELS[field]||String(field||'بيان').replace(/_/g,' ');
export const auditActionLabel=action=>ACTION_LABELS[String(action||'')]||String(action||'').replace(/_/g,' ')||'نشاط مسجل';
export const auditEntityLabel=entity=>ENTITY_LABELS[String(entity||'')]||String(entity||'').replace(/_/g,' ');
export const isTechnicalAuditField=field=>TECHNICAL.has(String(field||''));

function personSummary(arr){if(!Array.isArray(arr))return '';const names=arr.map(x=>x?.full_name||x?.name).filter(Boolean);if(names.length)return `${arr.length} مسافر — ${names.slice(0,4).join('، ')}${names.length>4?'…':''}`;return `${arr.length} عنصر`;}
function objectSummary(v){if(Array.isArray(v))return personSummary(v);if(v&&typeof v==='object'){const name=v.name||v.full_name||v.label||v.code;return name?String(name):'بيانات محدثة';}return ''}
export function auditValue(field,value,context={}){
  if(value===null||value===undefined||value==='')return '—';
  if(value===true)return 'نعم';if(value===false)return 'لا';
  const f=String(field||'');const raw=String(value);
  if(f==='journey_mode'||f==='journeyMode')return journeyLabel(raw);
  if(f==='status')return statusLabel(raw);
  if(f==='gender'||f==='customer_gender'||f==='customerGender')return GENDER[raw.toLowerCase()]||raw;
  if(f==='accommodation_type'||f==='accommodationType')return ACCOMMODATION[raw.toLowerCase()]||raw;
  if(f==='payment_method'||f==='paymentMethod'||f==='method')return PAYMENT[raw.toLowerCase()]||raw;
  if(f==='segment_type'||f==='segmentType')return SEGMENT[raw.toLowerCase()]||raw;
  if(['total_price','totalPrice','original_price','originalPrice','paid_amount','paidAmount','amount','refund_amount','cost'].includes(f))return money(value);
  if((f==='trip_id'||f==='tripId'||f==='return_trip_id'||f==='returnTripId')&&context.tripMap){const t=context.tripMap.get(String(value));return t?tripDisplay(t):'رحلة محفوظة بالنظام';}
  if((f==='branch_id'||f==='branchId')&&context.branchMap){const b=context.branchMap.get(String(value));return b?.name||b?.branch_name||'فرع محفوظ بالنظام';}
  if(typeof value==='object')return objectSummary(value)||'بيانات محدثة';
  if(/^[-0-9a-f]{36}$/i.test(raw))return 'سجل محفوظ بالنظام';
  if(raw.length>120)return `${raw.slice(0,117)}…`;
  return raw;
}

export function normalizeAuditChanges(changes,context={}){
  if(!Array.isArray(changes))return [];
  return changes.filter(c=>!isTechnicalAuditField(c?.field)).map(c=>({field:c?.field,label:c?.label||auditFieldLabel(c?.field),before:auditValue(c?.field,c?.before,context),after:auditValue(c?.field,c?.after,context)}));
}
