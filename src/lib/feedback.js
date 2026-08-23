const EVENT='almaher:feedback';

export function notify(type,message,options={}){
  if(typeof window==='undefined'||!message)return;
  window.dispatchEvent(new CustomEvent(EVENT,{detail:{id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,type,message,duration:options.duration??3600,title:options.title||''}}));
}
export const notifySuccess=(message,options)=>notify('success',message,options);
export const notifyError=(message,options)=>notify('error',message,{duration:options?.duration??6000,...options});
export const notifyInfo=(message,options)=>notify('info',message,options);
export const notifyWarning=(message,options)=>notify('warning',message,{duration:options?.duration??5000,...options});
export const feedbackEvent=EVENT;

const TABLE_LABELS={
  bookings:'الحجز',booking_passengers:'المسافر',trips:'الرحلة',trip_branches:'فرع الرحلة',drivers:'السائق',vehicles:'المركبة',trip_vehicles:'ربط المركبة بالرحلة',vehicle_maintenance:'سجل الصيانة',room_assignments:'التسكين',seat_assignments:'المقعد',transactions:'الحركة المالية',expenses:'المصروف',refunds:'الاسترداد',branches:'الفرع',hotels:'الفندق',hotel_rooms:'الغرفة',staff_users:'الموظف',roles:'الدور',permissions:'الصلاحية',partners:'المورد/الوكيل',notifications:'الإشعار',approval_requests:'طلب الموافقة',travel_destinations:'الوجهة',destination_routes:'المسار'};

function actionWord(action){
  const a=String(action||'').toLowerCase();
  if(['insert','create','add'].includes(a)||a.startsWith('create_')||a.startsWith('add_'))return 'تمت إضافة';
  if(['update','edit'].includes(a)||a.startsWith('update_')||a.startsWith('edit_'))return 'تم تعديل';
  if(['delete','remove'].includes(a)||a.startsWith('delete_')||a.startsWith('remove_'))return 'تم حذف';
  if(a.includes('cancel'))return 'تم إلغاء';
  if(a.includes('approve'))return 'تم اعتماد';
  if(a.includes('refund'))return 'تم تنفيذ الاسترداد';
  return 'تم تنفيذ العملية على';
}

export function mutationSuccessMessage(path,body){
  const p=String(path||'');const b=body||{};const action=String(b.action||'').toLowerCase();
  if(p.includes('/api/auth/'))return '';
  if(p==='/api/customer/book')return 'تم إنشاء الحجز بنجاح.';
  if(p==='/api/admin'){
    if(action==='update_booking')return 'تم تعديل الحجز بنجاح.';
    if(action==='sync_trips')return 'تم حفظ الرحلات بنجاح.';
    if(action.includes('booking')&&action.includes('cancel'))return 'تم إلغاء الحجز بنجاح.';
    if(action.includes('trip')&&action.includes('create'))return 'تم إنشاء الرحلة بنجاح.';
    if(action.includes('trip')&&action.includes('update'))return 'تم تعديل الرحلة بنجاح.';
  }
  if(p==='/api/module'){
    const label=TABLE_LABELS[b.table]||'السجل';
    const word=actionWord(action);
    return `${word} ${label} بنجاح.`;
  }
  if(p==='/api/destinations'){
    const label=String(b.entity||b.table||'').includes('route')?'المسار':'الوجهة';
    return `${actionWord(action)} ${label} بنجاح.`;
  }
  if(p==='/api/seats/atomic'){
    if(action.includes('release'))return 'تم تحرير المقعد بنجاح.';
    if(action.includes('hold'))return 'تم حجز المقعد مؤقتًا بنجاح.';
    if(action.includes('block'))return 'تم حجب المقعد بنجاح.';
    return 'تم تحديث المقعد بنجاح.';
  }
  if(p==='/api/mega'){
    if(action==='bus_swap')return 'تم تبديل المركبة على الرحلة بنجاح.';
    if(action.includes('refund'))return 'تم تنفيذ الاسترداد بنجاح.';
    return 'تم تنفيذ العملية بنجاح.';
  }
  if(p==='/api/platform')return 'تم حفظ إعدادات النظام بنجاح.';
  if(p==='/api/push')return 'تم إرسال الإشعار بنجاح.';
  return '';
}
