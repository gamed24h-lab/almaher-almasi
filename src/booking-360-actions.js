import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const num=v=>Number(v||0);
const low=v=>text(v).toLowerCase();
const activeStatus=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
const isFemale=v=>['female','f','أنثى','انثى','امرأة','woman'].includes(low(v));
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
let queued=false;
const metaCache=new Map();

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return low(value)==='new'?'':value;
}

function el(tag,className,label){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(label!==undefined)node.textContent=label;
  return node;
}

function setMessage(center,message,tone=''){
  const box=center.querySelector('.booking-360-quick-message');
  if(!box)return;
  box.textContent=message||'';
  box.className=`booking-360-quick-message${tone?` ${tone}`:''}`;
}

function modalField(labelText,input,hint=''){
  const label=el('label','booking-360-modal-field');
  label.append(el('span','booking-360-modal-label',labelText),input);
  if(hint)label.append(el('small','booking-360-modal-hint',hint));
  return label;
}

function modalInput(type='text',placeholder=''){
  const input=el('input','booking-360-modal-input');
  input.type=type;
  input.placeholder=placeholder;
  return input;
}

function modalSelect(){
  return el('select','booking-360-modal-input');
}

function closeActiveModal(){
  const old=document.querySelector('.booking-360-modal-backdrop');
  if(old)old.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openQuickModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal');
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const titleWrap=el('div');
  titleWrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)titleWrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const close=el('button','booking-360-modal-close','×');
  close.type='button';
  head.append(titleWrap,close);
  const body=el('div','booking-360-modal-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);
  backdrop.append(dialog);
  document.body.append(backdrop);
  document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  close.addEventListener('click',destroy);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop)){destroy();window.removeEventListener('keydown',onKey)}};
  window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{
    notice.textContent=message||'';
    notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`;
  };
  return {backdrop,dialog,body,foot,close:destroy,setNotice};
}

function modalButton(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);
  b.type='button';
  b.addEventListener('click',onClick);
  return b;
}

function findByText(needles){
  const wanted=(Array.isArray(needles)?needles:[needles]).map(text).filter(Boolean);
  const selectors=['.card-title h3','.card-title small','label','.field-label','h3'];
  for(const selector of selectors){
    for(const node of document.querySelectorAll(selector)){
      const value=text(node.textContent);
      if(wanted.some(x=>value.includes(x)))return node;
    }
  }
  return null;
}

function focusEditorArea(center,needles){
  const node=findByText(needles);
  if(!node){setMessage(center,'تعذر تحديد الجزء المطلوب تلقائيًا. يمكنك الوصول إليه يدويًا داخل نموذج الحجز.','warn');return false}
  const target=node.closest('.card')||node.closest('[class*="card"]')||node.parentElement||node;
  target.classList.add('booking-360-editor-focus');
  target.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>target.classList.remove('booking-360-editor-focus'),2200);
  const field=node.closest('label')?.querySelector('input,select,textarea,button:not([disabled])')||target.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
  setTimeout(()=>field?.focus?.({preventScroll:true}),520);
  setMessage(center,'تم فتح الجزء المطلوب داخل نفس الحجز.','good');
  return true;
}

function bookingForm(){
  return [...document.querySelectorAll('form')].find(f=>text(f.textContent).includes('بيانات الحجز')||text(f.textContent).includes('الدفعات الحالية'))||null;
}

function submitBooking(center){
  const form=bookingForm();
  if(!form){setMessage(center,'لم يتم العثور على نموذج الحجز للحفظ.','warn');return}
  const buttons=[...form.querySelectorAll('button[type="submit"]')];
  const saveButton=buttons.find(b=>/حفظ|تحديث|واتساب/.test(text(b.textContent)))||buttons[0];
  setMessage(center,'جاري تشغيل حفظ الحجز بنفس التحقق والصلاحيات الحالية...','');
  if(saveButton)saveButton.click();
  else if(typeof form.requestSubmit==='function')form.requestSubmit();
}

async function loadMeta(bookingNo){
  const cached=metaCache.get(bookingNo);
  if(cached&&Date.now()-cached.at<15000)return cached.value;
  const raw=await api.bootstrap();
  const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  const snap=booking?.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const value=booking?{
    booking,
    bookingId:text(booking.id),
    tripId:text(booking.trip_id||snap.tripId),
    returnTripId:text(booking.return_trip_id||snap.returnTripId),
    mode:low(booking.journey_mode||snap.journeyMode),
    accommodation:low(booking.accommodation_type||snap.accommodationType||'none'),
    status:low(booking.status),
    raw
  }:{tripId:'',returnTripId:'',mode:'',accommodation:'none',status:'',raw};
  metaCache.set(bookingNo,{at:Date.now(),value});
  return value;
}

function activePassengers(meta){
  return (meta?.raw?.passengers||[])
    .filter(p=>text(p?.booking_id)===text(meta?.bookingId)&&activeStatus(p?.status))
    .sort((a,b)=>Number(a?.passenger_order||0)-Number(b?.passenger_order||0));
}

function refreshOverview(){
  const refresh=[...document.querySelectorAll('.booking-360-action')].find(b=>text(b.textContent).includes('تحديث Booking 360'));
  refresh?.click?.();
}

function afterQuickWrite(center,bookingNo,message){
  metaCache.delete(bookingNo);
  setMessage(center,message,'good');
  setTimeout(()=>refreshOverview(),350);
}

function quickButton(label,onClick,options={}){
  const b=el('button',`booking-360-quick-button${options.primary?' primary':''}`,label);
  b.type='button';
  if(options.disabled){b.disabled=true;b.title=options.title||''}
  b.addEventListener('click',onClick);
  return b;
}

async function openPaymentModal(center,bookingNo){
  const modal=openQuickModal('تحصيل سريع',`الحجز ${bookingNo} · التحصيل يتم مباشرة بعد التأكيد`);
  modal.body.append(el('div','booking-360-modal-loading','جاري قراءة الرصيد الحالي...'));
  try{
    const meta=await loadMeta(bookingNo);
    if(!meta.booking)throw new Error('الحجز غير موجود.');
    if(['cancelled','canceled','refunded'].includes(meta.status))throw new Error('لا يمكن التحصيل السريع على حجز ملغي أو مسترد.');
    const refundSummary=await api.bookingRefundSummaries().catch(()=>null);
    const refunded=num(refundSummary?.by_booking_id?.[meta.bookingId]??refundSummary?.by_booking_number?.[bookingNo]??meta.booking?.refunded_amount);
    const total=num(meta.booking?.total_price);
    const gross=num(meta.booking?.paid_amount);
    const netPaid=Math.max(0,gross-refunded);
    const remaining=Math.max(0,total-netPaid);
    modal.body.innerHTML='';
    if(remaining<=0){
      modal.body.append(el('div','booking-360-modal-empty','الحجز لا يوجد عليه مبلغ متبقٍ للتحصيل.'));
      modal.foot.append(modalButton('إغلاق',modal.close));
      return;
    }

    const stats=el('div','booking-360-modal-stats');
    [['الإجمالي',money(total)],['المحصل الصافي',money(netPaid)],['المتبقي',money(remaining)]].forEach(([a,b])=>{
      const box=el('div','booking-360-modal-stat');
      box.append(el('small','',a),el('strong','',b));
      stats.append(box);
    });

    const amount=modalInput('number');
    amount.min='0.01';amount.step='0.01';amount.max=String(remaining);amount.value=String(remaining);
    const method=modalSelect();
    [
      ['cash','نقدي'],['bank_transfer','تحويل بنكي'],['mada','مدى'],
      ['card','Visa / Mastercard'],['apple_pay','Apple Pay'],['online','دفع إلكتروني'],['other','أخرى']
    ].forEach(([v,l])=>method.append(new Option(l,v)));
    const reference=modalInput('text','رقم العملية — اختياري للنقدي');
    const custom=modalInput('text','اكتب طريقة الدفع الأخرى');
    const customField=modalField('طريقة الدفع الأخرى',custom);
    customField.hidden=true;
    method.addEventListener('change',()=>{customField.hidden=method.value!=='other'});
    modal.body.append(stats,modalField('المبلغ',amount,`الحد الأقصى الآن ${money(remaining)}`),modalField('طريقة الدفع',method),customField,modalField('مرجع الدفع / رقم العملية',reference));
    const cancel=modalButton('رجوع',modal.close);
    const save=modalButton('تأكيد التحصيل',async()=>{
      const value=num(amount.value);
      if(value<=0)return modal.setNotice('اكتب مبلغ تحصيل أكبر من صفر.','bad');
      if(value>remaining+0.001)return modal.setNotice(`لا يمكن تجاوز المتبقي ${money(remaining)}.`,'bad');
      if(method.value==='other'&&!text(custom.value))return modal.setNotice('اكتب اسم طريقة الدفع الأخرى.','bad');
      const paymentMethod=method.value==='other'?`other:${text(custom.value)}`:method.value;
      if(!confirm(`تأكيد تحصيل ${money(value)} على الحجز ${bookingNo}؟`))return;
      save.disabled=true;cancel.disabled=true;modal.setNotice('جاري تسجيل التحصيل...','');
      try{
        const targetPaid=gross+value;
        await api.admin({action:'update_booking',booking:{number:bookingNo,paidAmount:targetPaid,paymentMethod,paymentReference:text(reference.value)||null}});
        modal.setNotice(`تم تحصيل ${money(value)} بنجاح.`,'good');
        afterQuickWrite(center,bookingNo,`تم تحصيل ${money(value)} وتحديث الحجز.`);
        setTimeout(()=>modal.close(),700);
      }catch(e){save.disabled=false;cancel.disabled=false;modal.setNotice(e?.message||'تعذر تسجيل التحصيل.','bad')}
    },true);
    modal.foot.append(cancel,save);
  }catch(e){
    modal.body.innerHTML='';
    modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل بيانات التحصيل.'));
    modal.foot.append(modalButton('إغلاق',modal.close));
  }
}

function vehicleLabel(x){
  return `${text(x?.bus_label||x?.label)||'باص'} — سعة ${Number(x?.booking_capacity||x?.capacity||49)}`;
}

function seatRowsFor(source,tripVehicle){
  if(!tripVehicle)return [];
  const rows=(source?.vehicle_seats||[]).filter(x=>text(x?.vehicle_id)===text(tripVehicle?.vehicle_id)&&x?.active!==false);
  if(rows.length)return [...rows].sort((a,b)=>Number(a?.seat_index||a?.seat_no||0)-Number(b?.seat_index||b?.seat_no||0));
  const vehicle=(source?.vehicles||[]).find(v=>text(v?.id)===text(tripVehicle?.vehicle_id));
  const cap=Number(tripVehicle?.booking_capacity||tripVehicle?.capacity||vehicle?.booking_capacity||vehicle?.physical_capacity||49);
  return Array.from({length:Math.max(0,cap)},(_,i)=>({seat_no:String(i+1),seat_index:i+1}));
}

async function openSeatModal(center,bookingNo){
  const modal=openQuickModal('تغيير المقعد',`الحجز ${bookingNo} · الحفظ يتم مباشرة`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل المقاعد...'));
  try{
    const meta=await loadMeta(bookingNo);
    if(!meta.booking)throw new Error('الحجز غير موجود.');
    if(['cancelled','canceled','refunded'].includes(meta.status))throw new Error('لا يمكن تعديل مقاعد حجز ملغي أو مسترد.');
    const passengers=activePassengers(meta);
    if(!passengers.length)throw new Error('لا توجد بيانات مسافرين نشطة في الحجز.');
    const baseSeats=await api.module('seats');
    modal.body.innerHTML='';

    const passenger=modalSelect();
    passengers.forEach(p=>passenger.append(new Option(text(p.full_name)||'مسافر',text(p.id))));
    const segment=modalSelect();
    const segments=meta.mode==='returnonly'?[['return','العودة']]
      :meta.mode==='roundtrip'||meta.mode==='separate'?[['outbound','الذهاب'],['return','العودة']]
      :[['outbound','الذهاب']];
    segments.forEach(([v,l])=>segment.append(new Option(l,v)));
    const vehicle=modalSelect();
    const seat=modalSelect();
    const currentInfo=el('div','booking-360-modal-current');
    const passengerField=modalField('المسافر',passenger);
    const segmentField=modalField('الرجل',segment);
    const vehicleField=modalField('الباص',vehicle);
    const seatField=modalField('المقعد الجديد',seat,'اختر «بدون مقعد» لتحرير المقعد الحالي.');
    modal.body.append(passengerField,segmentField,vehicleField,seatField,currentInfo);

    let source=baseSeats;
    let currentAssignments=[];
    async function rebuild(){
      modal.setNotice('جاري تحديث المقاعد المتاحة...','');
      const seg=segment.value;
      const targetTripId=seg==='return'&&meta.mode==='separate'?meta.returnTripId:meta.tripId;
      if(seg==='return'&&meta.mode==='separate'){
        if(!targetTripId){vehicle.innerHTML='';seat.innerHTML='';currentInfo.textContent='لا توجد رحلة عودة منفصلة مرتبطة بالحجز.';return}
        source=await api.returnSeatContext(targetTripId).catch(()=>baseSeats);
      }else source=baseSeats;
      const vehicles=(source?.trip_vehicles||[]).filter(x=>text(x?.trip_id)===text(targetTripId)&&activeStatus(x?.status||'assigned'));
      const pid=passenger.value;
      currentAssignments=(source?.seat_assignments||[]).filter(a=>text(a?.passenger_id)===pid&&text(a?.segment_type||'outbound')===seg&&activeStatus(a?.status||'assigned'));
      const current=currentAssignments[0];
      vehicle.innerHTML='';
      vehicles.forEach(v=>vehicle.append(new Option(vehicleLabel(v),text(v.id))));
      if(current&&vehicles.some(v=>text(v.id)===text(current.trip_vehicle_id)))vehicle.value=text(current.trip_vehicle_id);
      if(!vehicle.value&&vehicles[0])vehicle.value=text(vehicles[0].id);
      rebuildSeats();
      currentInfo.textContent=current?`المقعد الحالي: ${text(current.seat_no||current.seat_number)||'—'}`:'لا يوجد مقعد حالي لهذا المسافر في هذه الرجل.';
      modal.setNotice(vehicles.length?'':'لا يوجد باص معيّن لهذه الرحلة حتى الآن.',vehicles.length?'':'warn');
    }
    function rebuildSeats(){
      const tv=(source?.trip_vehicles||[]).find(x=>text(x.id)===text(vehicle.value));
      const rows=seatRowsFor(source,tv);
      const assignments=(source?.seat_assignments||[]).filter(a=>text(a?.trip_vehicle_id)===text(vehicle.value)&&text(a?.segment_type||'outbound')===segment.value&&activeStatus(a?.status||'assigned'));
      const pid=passenger.value;
      const occupiedByOther=new Set(assignments.filter(a=>text(a?.passenger_id)!==pid).map(a=>text(a?.seat_no||a?.seat_number)));
      seat.innerHTML='';
      seat.append(new Option('بدون مقعد / تحرير الحالي',''));
      rows.filter(r=>!occupiedByOther.has(text(r.seat_no))).forEach(r=>seat.append(new Option(`مقعد ${text(r.seat_no)}`,text(r.seat_no))));
      const current=currentAssignments.find(a=>text(a.trip_vehicle_id)===text(vehicle.value));
      if(current&&[...seat.options].some(o=>o.value===text(current.seat_no)))seat.value=text(current.seat_no);
    }
    passenger.addEventListener('change',()=>rebuild().catch(e=>modal.setNotice(e.message,'bad')));
    segment.addEventListener('change',()=>rebuild().catch(e=>modal.setNotice(e.message,'bad')));
    vehicle.addEventListener('change',rebuildSeats);
    await rebuild();

    const cancel=modalButton('رجوع',modal.close);
    const save=modalButton('حفظ المقعد',async()=>{
      const pid=passenger.value,seg=segment.value,wanted=seat.value;
      const old=currentAssignments[0];
      if(!wanted&&!old)return modal.setNotice('المسافر لا يملك مقعدًا حاليًا بالفعل.','warn');
      if(wanted&&!vehicle.value)return modal.setNotice('لا يوجد باص صالح لتثبيت المقعد.','bad');
      const p=passengers.find(x=>text(x.id)===pid);
      const label=text(p?.full_name)||'المسافر';
      const actionText=wanted?`تعيين المقعد ${wanted} لـ ${label}`:`تحرير مقعد ${label}`;
      if(!confirm(`${actionText}؟`))return;
      save.disabled=true;cancel.disabled=true;modal.setNotice('جاري حفظ المقعد...','');
      try{
        if(wanted){
          await api.seatAtomicSilent({action:'assign',trip_vehicle_id:vehicle.value,segment_type:seg,seat_no:wanted,passenger_id:pid,booking_id:meta.bookingId});
        }else{
          await api.seatAtomicSilent({action:'released',trip_vehicle_id:old.trip_vehicle_id,segment_type:seg,seat_no:text(old.seat_no||old.seat_number)});
        }
        afterQuickWrite(center,bookingNo,wanted?`تم تحديث مقعد ${label} إلى ${wanted}.`:`تم تحرير مقعد ${label}.`);
        modal.setNotice(wanted?'تم حفظ المقعد بنجاح.':'تم تحرير المقعد بنجاح.','good');
        setTimeout(()=>modal.close(),650);
      }catch(e){save.disabled=false;cancel.disabled=false;modal.setNotice(e?.message||'تعذر حفظ المقعد.','bad')}
    },true);
    modal.foot.append(cancel,save);
  }catch(e){
    modal.body.innerHTML='';
    modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل بيانات المقاعد.'));
    modal.foot.append(modalButton('إغلاق',modal.close));
  }
}

function roomDisplay(room){
  const actual=text(room?.metadata?.actual_room_no);
  const no=text(room?.room_no)||'—';
  return actual?`${no} · الفعلية ${actual}`:no;
}

async function openHousingModal(center,bookingNo){
  const modal=openQuickModal('تغيير الغرفة',`الحجز ${bookingNo} · النقل يتم مباشرة بعد التأكيد`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل غرف الرحلة...'));
  try{
    const meta=await loadMeta(bookingNo);
    if(!meta.booking)throw new Error('الحجز غير موجود.');
    if(['cancelled','canceled','refunded'].includes(meta.status))throw new Error('لا يمكن تعديل تسكين حجز ملغي أو مسترد.');
    if(meta.accommodation==='none')throw new Error('الحجز مسجل بدون سكن. غيّر نوع السكن من بيانات الحجز أولًا.');
    const passengers=activePassengers(meta);
    if(!passengers.length)throw new Error('لا توجد بيانات مسافرين نشطة في الحجز.');
    const housing=await api.module('housing');
    const tripHotels=(housing?.trip_hotels||[]).filter(x=>text(x?.trip_id)===text(meta.tripId));
    if(!tripHotels.length)throw new Error('لا يوجد فندق مربوط بهذه الرحلة.');
    const hotels=housing?.hotels||[];
    const allRooms=housing?.hotel_rooms||[];
    const allAssignments=housing?.room_assignments||[];
    modal.body.innerHTML='';

    const passenger=modalSelect();
    passengers.forEach(p=>passenger.append(new Option(text(p.full_name)||'مسافر',text(p.id))));
    const hotel=modalSelect();
    tripHotels.forEach(th=>{
      const h=hotels.find(x=>text(x.id)===text(th.hotel_id));
      hotel.append(new Option(text(h?.name)||'فندق',text(th.id)));
    });
    const room=modalSelect();
    const currentInfo=el('div','booking-360-modal-current');
    modal.body.append(modalField('المسافر',passenger),modalField('الفندق',hotel),modalField('الغرفة الجديدة',room),currentInfo);

    function activeAssignments(){
      return allAssignments.filter(a=>activeStatus(a?.status||'assigned'));
    }
    function currentAssignment(){
      return activeAssignments().find(a=>text(a?.passenger_id)===text(passenger.value));
    }
    function rebuildRooms(){
      const pid=passenger.value;
      const p=passengers.find(x=>text(x.id)===pid);
      const current=currentAssignment();
      const currentRoom=allRooms.find(r=>text(r.id)===text(current?.hotel_room_id));
      if(currentRoom&&tripHotels.some(th=>text(th.id)===text(currentRoom.trip_hotel_id)))hotel.value=text(currentRoom.trip_hotel_id);
      const th=tripHotels.find(x=>text(x.id)===text(hotel.value));
      const locked=th?.rooming_locked===true;
      const typeNeeded=meta.accommodation==='shared'?'shared5':'private';
      const rooms=allRooms.filter(r=>text(r.trip_hotel_id)===text(hotel.value)&&low(r.room_type)===typeNeeded&&r.locked!==true);
      room.innerHTML='';
      rooms.forEach(r=>{
        const occ=activeAssignments().filter(a=>text(a.hotel_room_id)===text(r.id)).length;
        const same=current&&text(current.hotel_room_id)===text(r.id);
        const full=occ>=Number(r.capacity||0)&&!same;
        const suffix=full?' — مكتملة':` — ${occ}/${Number(r.capacity||0)}`;
        const option=new Option(`${roomDisplay(r)}${suffix}`,text(r.id));
        option.disabled=full;
        room.append(option);
      });
      if(currentRoom&&rooms.some(r=>text(r.id)===text(currentRoom.id)))room.value=text(currentRoom.id);
      currentInfo.textContent=currentRoom?`الغرفة الحالية: ${roomDisplay(currentRoom)}`:'المسافر غير مسكن حاليًا.';
      if(locked)modal.setNotice('التسكين مقفل لهذا الفندق/الرحلة. افتحه من شاشة السكن أولًا.','warn');
      else if(meta.accommodation==='shared'&&isFemale(p?.gender))modal.setNotice('لا يمكن تسكين مسافرة أنثى في غرفة مشتركة.','bad');
      else modal.setNotice(rooms.length?'':'لا توجد غرف مناسبة متاحة لهذا النوع من السكن.',rooms.length?'':'warn');
    }
    passenger.addEventListener('change',rebuildRooms);
    hotel.addEventListener('change',rebuildRooms);
    rebuildRooms();

    const cancel=modalButton('رجوع',modal.close);
    const save=modalButton('حفظ الغرفة',async()=>{
      const pid=passenger.value;
      const p=passengers.find(x=>text(x.id)===pid);
      const target=allRooms.find(r=>text(r.id)===text(room.value));
      const th=tripHotels.find(x=>text(x.id)===text(hotel.value));
      if(!target)return modal.setNotice('اختر غرفة صالحة أولًا.','bad');
      if(th?.rooming_locked===true)return modal.setNotice('التسكين مقفل لهذا الفندق/الرحلة.','bad');
      if(target.locked===true)return modal.setNotice('الغرفة المختارة مقفلة.','bad');
      if(meta.accommodation==='shared'&&isFemale(p?.gender))return modal.setNotice('السكن المشترك غير متاح للنساء.','bad');
      const assignments=activeAssignments();
      const old=assignments.find(a=>text(a.passenger_id)===pid);
      if(old&&text(old.hotel_room_id)===text(target.id))return modal.setNotice('المسافر موجود بالفعل في هذه الغرفة.','warn');
      const occ=assignments.filter(a=>text(a.hotel_room_id)===text(target.id)).length;
      if(occ>=Number(target.capacity||0))return modal.setNotice('الغرفة أصبحت مكتملة السعة. اختر غرفة أخرى.','bad');
      const label=text(p?.full_name)||'المسافر';
      if(!confirm(`نقل ${label} إلى الغرفة ${roomDisplay(target)}؟`))return;
      save.disabled=true;cancel.disabled=true;modal.setNotice('جاري تحديث التسكين...','');
      try{
        if(old)await api.moduleWrite({action:'update',table:'room_assignments',id:old.id,row:{status:'released'}});
        const same=allAssignments.find(a=>text(a.hotel_room_id)===text(target.id)&&text(a.passenger_id)===pid);
        if(same)await api.moduleWrite({action:'update',table:'room_assignments',id:same.id,row:{status:'assigned'}});
        else await api.moduleWrite({action:'insert',table:'room_assignments',row:{hotel_room_id:target.id,passenger_id:pid,status:'assigned'}});
        afterQuickWrite(center,bookingNo,`تم نقل ${label} إلى الغرفة ${roomDisplay(target)}.`);
        modal.setNotice('تم تحديث الغرفة بنجاح.','good');
        setTimeout(()=>modal.close(),650);
      }catch(e){save.disabled=false;cancel.disabled=false;modal.setNotice(e?.message||'تعذر تحديث الغرفة.','bad')}
    },true);
    modal.foot.append(cancel,save);
  }catch(e){
    modal.body.innerHTML='';
    modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل بيانات السكن.'));
    modal.foot.append(modalButton('إغلاق',modal.close));
  }
}

async function enhancePanel(panel,bookingNo){
  if(panel.dataset.quickActionsReady==='1')return;
  panel.dataset.quickActionsReady='1';

  const center=el('section','booking-360-quick-center');
  const head=el('div','booking-360-quick-head');
  const title=el('div');
  title.append(el('strong','booking-360-quick-title','مركز الإجراءات السريعة'),el('small','booking-360-quick-subtitle','تحصيل ومقاعد وتسكين مباشرة من Booking 360، مع بقاء التعديل الكامل متاحًا أسفل الصفحة.'));
  head.append(title);

  const grid=el('div','booking-360-quick-grid');
  grid.append(
    quickButton('تحصيل سريع',()=>openPaymentModal(center,bookingNo),{primary:true}),
    quickButton('تغيير المقعد',()=>openSeatModal(center,bookingNo)),
    quickButton('تغيير الغرفة',()=>openHousingModal(center,bookingNo)),
    quickButton('بيانات الحجز',()=>focusEditorArea(center,['بيانات الحجز'])),
    quickButton('حفظ التعديلات',()=>submitBooking(center))
  );

  const tripActions=el('div','booking-360-trip-actions');
  const seatsLink=el('a','booking-360-quick-link muted','خريطة مقاعد الرحلة');
  const housingLink=el('a','booking-360-quick-link muted','إدارة غرف الرحلة');
  seatsLink.href='#';housingLink.href='#';
  seatsLink.setAttribute('aria-disabled','true');housingLink.setAttribute('aria-disabled','true');
  tripActions.append(seatsLink,housingLink);

  const statusBox=el('div','booking-360-status-editor');
  const statusLabel=el('label','booking-360-status-label','الحالة التشغيلية');
  const select=el('select','booking-360-status-select');
  select.append(new Option('مؤكد','confirmed'),new Option('جديد','new'));
  const saveStatus=quickButton('حفظ الحالة',async()=>{
    const next=select.value;
    if(!next)return;
    if(!confirm(`تغيير حالة الحجز ${bookingNo} إلى «${next==='confirmed'?'مؤكد':'جديد'}»؟`))return;
    saveStatus.disabled=true;setMessage(center,'جاري حفظ حالة الحجز...','');
    try{
      await api.admin({action:'set_booking_status',booking_number:bookingNo,status:next});
      metaCache.delete(bookingNo);
      setMessage(center,'تم حفظ حالة الحجز بنجاح.','good');
      saveStatus.textContent='تم الحفظ ✓';
      setTimeout(()=>{saveStatus.textContent='حفظ الحالة';saveStatus.disabled=false;refreshOverview()},650);
    }catch(e){saveStatus.disabled=false;setMessage(center,e?.message||'تعذر تغيير حالة الحجز.','bad')}
  });
  statusBox.append(statusLabel,select,saveStatus);

  const message=el('div','booking-360-quick-message');
  center.append(head,grid,tripActions,statusBox,message);

  const actions=panel.querySelector('.booking-360-actions');
  if(actions)actions.insertAdjacentElement('afterend',center);else panel.append(center);

  try{
    const meta=await loadMeta(bookingNo);
    if(meta.status==='new'||meta.status==='confirmed')select.value=meta.status;
    if(['cancelled','canceled','refunded'].includes(meta.status)){
      select.disabled=true;saveStatus.disabled=true;saveStatus.title='الحالة لا تُغيّر من هنا للحجوزات الملغاة أو المستردة.';
    }
    if(meta.tripId){
      seatsLink.href=`/seats?trip=${encodeURIComponent(meta.tripId)}`;
      housingLink.href=`/housing?trip=${encodeURIComponent(meta.tripId)}`;
      seatsLink.classList.remove('muted');housingLink.classList.remove('muted');
      seatsLink.removeAttribute('aria-disabled');housingLink.removeAttribute('aria-disabled');
    }
  }catch{
    setMessage(center,'الإجراءات الأساسية جاهزة، وتعذر فقط تحميل روابط الرحلة المختصرة.','warn');
  }
}

function sync(){
  const bookingNo=bookingNoFromPath();
  if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  if(!panel||panel.dataset.booking!==bookingNo)return;
  enhancePanel(panel,bookingNo);
}

function queue(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;sync()});
}

export function installBooking360QuickActions(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();
  const observer=new MutationObserver(queue);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
}
