import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>Number(v||0);
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
const active=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
let queued=false;

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

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-readiness-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const wrap=el('div');wrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)wrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';
  head.append(wrap,x);
  const body=el('div','booking-360-modal-body booking-360-readiness-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);document.body.classList.add('booking-360-modal-open');
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function button(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b;
}

function activePassengers(raw,bookingId){
  return (raw?.passengers||[]).filter(p=>text(p?.booking_id)===text(bookingId)&&active(p?.status||'confirmed'));
}

function assignmentCount(source,passengerIds,segment){
  const seen=new Set();
  for(const a of source?.seat_assignments||[]){
    if(!active(a?.status||'assigned'))continue;
    if(text(a?.segment_type||'outbound')!==segment)continue;
    const pid=text(a?.passenger_id);
    if(passengerIds.has(pid))seen.add(pid);
  }
  return seen.size;
}

function housingCount(housing,passengerIds,tripId){
  const tripHotelIds=new Set((housing?.trip_hotels||[]).filter(x=>text(x?.trip_id)===text(tripId)).map(x=>text(x.id)));
  const roomIds=new Set((housing?.hotel_rooms||[]).filter(r=>tripHotelIds.has(text(r?.trip_hotel_id))).map(r=>text(r.id)));
  const seen=new Set();
  for(const a of housing?.room_assignments||[]){
    if(!active(a?.status||'assigned'))continue;
    if(!roomIds.has(text(a?.hotel_room_id)))continue;
    const pid=text(a?.passenger_id);
    if(passengerIds.has(pid))seen.add(pid);
  }
  return seen.size;
}

function checkRow(label,detail,state='good',action=''){
  const row=el('div',`booking-360-ready-row ${state}`);
  const icon=el('span','booking-360-ready-icon',state==='good'?'✓':state==='warn'?'!':'×');
  const copy=el('div','booking-360-ready-copy');copy.append(el('strong','',label),el('small','',detail));
  row.append(icon,copy);
  if(action){const a=el('button','booking-360-ready-action',action);a.type='button';row.append(a)}
  return row;
}

function triggerQuickAction(label){
  const target=[...document.querySelectorAll('.booking-360-quick-grid button')].find(b=>text(b.textContent).includes(label));
  target?.click?.();
}

async function inspectBooking(bookingNo){
  const raw=await api.bootstrap();
  const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  if(!booking)throw new Error('الحجز غير موجود.');
  const snap=booking?.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const bookingId=text(booking.id);
  const mode=low(booking.journey_mode||snap.journeyMode);
  const tripId=text(booking.trip_id||snap.tripId);
  const returnTripId=text(booking.return_trip_id||snap.returnTripId);
  const accommodation=low(booking.accommodation_type||snap.accommodationType||'none');
  const passengers=activePassengers(raw,bookingId);
  const passengerIds=new Set(passengers.map(p=>text(p.id)));
  const totalPassengers=passengers.length;

  const seats=await api.module('seats').catch(()=>null);
  let returnSeats=seats;
  if(mode==='separate'&&returnTripId) returnSeats=await api.returnSeatContext(returnTripId).catch(()=>null);
  const outboundRequired=mode!=='returnonly';
  const returnRequired=['roundtrip','separate','returnonly'].includes(mode);
  const outboundAssigned=outboundRequired?assignmentCount(seats,passengerIds,'outbound'):totalPassengers;
  const returnAssigned=returnRequired?assignmentCount(returnSeats,passengerIds,'return'):totalPassengers;

  const housing=accommodation==='none'?null:await api.module('housing').catch(()=>null);
  const housed=accommodation==='none'?totalPassengers:housingCount(housing,passengerIds,tripId);

  const refundSummary=await api.bookingRefundSummaries().catch(()=>null);
  const refunded=num(refundSummary?.by_booking_id?.[bookingId]??refundSummary?.by_booking_number?.[bookingNo]??booking?.refunded_amount);
  const total=num(booking?.total_price);
  const gross=num(booking?.paid_amount);
  const netPaid=Math.max(0,gross-refunded);
  const remaining=Math.max(0,total-netPaid);

  const missingIdentity=passengers.filter(p=>!text(p?.identity_number)).length;
  const missingPhone=!text(booking?.customer_phone);
  const status=low(booking?.status);
  const tripMissing=!tripId||(mode==='separate'&&!returnTripId);

  const blockers=[];const warnings=[];
  if(['cancelled','canceled','refunded'].includes(status))blockers.push('حالة الحجز لا تسمح بالتشغيل.');
  if(!totalPassengers)blockers.push('لا يوجد مسافرون نشطون.');
  if(tripMissing)blockers.push('بيانات الرحلة غير مكتملة.');
  if(missingIdentity)blockers.push(`${missingIdentity} مسافر بدون هوية.`);
  if(outboundRequired&&outboundAssigned<totalPassengers)blockers.push(`مقاعد الذهاب ناقصة ${totalPassengers-outboundAssigned}.`);
  if(returnRequired&&returnAssigned<totalPassengers)blockers.push(`مقاعد العودة ناقصة ${totalPassengers-returnAssigned}.`);
  if(accommodation!=='none'&&housed<totalPassengers)blockers.push(`التسكين ناقص ${totalPassengers-housed}.`);
  if(status==='new')warnings.push('الحجز حالته «جديد» ولم يتحول إلى مؤكد.');
  if(remaining>0.001)warnings.push(`يوجد متبقي ${money(remaining)}.`);
  if(missingPhone)warnings.push('رقم جوال العميل غير موجود.');

  return {booking,mode,accommodation,totalPassengers,outboundRequired,returnRequired,outboundAssigned,returnAssigned,housed,remaining,missingIdentity,missingPhone,status,tripMissing,blockers,warnings};
}

async function openReadiness(center,bookingNo,badge){
  const modal=openModal('فحص جاهزية الحجز',`الحجز ${bookingNo} · فحص تشغيلي بدون تعديل البيانات`);
  modal.body.append(el('div','booking-360-modal-loading','جاري فحص الحجز والمقاعد والسكن والمالية...'));
  try{
    const r=await inspectBooking(bookingNo);
    modal.body.innerHTML='';
    const ready=r.blockers.length===0;
    const hero=el('div',`booking-360-ready-hero ${ready?'good':'bad'}`);
    hero.append(el('strong','',ready?'جاهز للتشغيل':'يحتاج استكمال قبل التشغيل'),el('small','',ready?(r.warnings.length?`لا توجد نواقص تشغيلية حرجة · يوجد ${r.warnings.length} تنبيه`:'كل الفحوصات الأساسية مكتملة'):`يوجد ${r.blockers.length} نقص تشغيلي يحتاج إجراء`));
    modal.body.append(hero);

    const rows=el('div','booking-360-ready-list');
    rows.append(checkRow('بيانات المسافرين',r.totalPassengers?`${r.totalPassengers} مسافر نشط${r.missingIdentity?` · ${r.missingIdentity} بدون هوية`:''}`:'لا يوجد مسافرون نشطون',r.totalPassengers&&!r.missingIdentity?'good':'bad','بيانات الحجز'));
    rows.append(checkRow('رحلة الذهاب',r.tripMissing?'بيانات الرحلة غير مكتملة':r.outboundRequired?`${r.outboundAssigned}/${r.totalPassengers} لديهم مقعد`:'غير مطلوبة لهذا الحجز',r.tripMissing||(r.outboundRequired&&r.outboundAssigned<r.totalPassengers)?'bad':'good',r.outboundRequired&&r.outboundAssigned<r.totalPassengers?'تغيير المقعد':''));
    if(r.returnRequired)rows.append(checkRow('رحلة العودة',`${r.returnAssigned}/${r.totalPassengers} لديهم مقعد`,r.returnAssigned<r.totalPassengers?'bad':'good',r.returnAssigned<r.totalPassengers?'تغيير المقعد':''));
    rows.append(checkRow('التسكين',r.accommodation==='none'?'الحجز بدون سكن':`${r.housed}/${r.totalPassengers} تم تسكينهم`,r.accommodation==='none'||r.housed>=r.totalPassengers?'good':'bad',r.accommodation!=='none'&&r.housed<r.totalPassengers?'تغيير الغرفة':''));
    rows.append(checkRow('المالية',r.remaining>0.001?`متبقي ${money(r.remaining)}`:'لا يوجد مبلغ متبقٍ',r.remaining>0.001?'warn':'good',r.remaining>0.001?'تحصيل سريع':''));
    rows.append(checkRow('حالة الحجز',r.status==='confirmed'?'مؤكد':r.status==='new'?'جديد':text(r.booking?.status)||'غير محددة',r.status==='confirmed'?'good':r.status==='new'?'warn':'bad',''));
    modal.body.append(rows);

    for(const action of rows.querySelectorAll('.booking-360-ready-action')){
      action.addEventListener('click',()=>{const label=text(action.textContent);modal.close();setTimeout(()=>triggerQuickAction(label),80)});
    }

    if(r.warnings.length){const warns=el('div','booking-360-ready-warnings');r.warnings.forEach(w=>warns.append(el('div','',`• ${w}`)));modal.body.append(warns)}
    const close=button('إغلاق',modal.close);
    const refresh=button('إعادة الفحص',()=>{modal.close();setTimeout(()=>openReadiness(center,bookingNo,badge),80)},true);
    modal.foot.append(close,refresh);

    if(badge){badge.textContent=ready?(r.warnings.length?'جاهز مع تنبيه':'جاهز للتشغيل'):`ناقص ${r.blockers.length}`;badge.className=`booking-360-readiness-badge ${ready?(r.warnings.length?'warn':'good'):'bad'}`}
    setCenterMessage(center,ready?'فحص الجاهزية: لا توجد نواقص تشغيلية حرجة.':`فحص الجاهزية: يوجد ${r.blockers.length} نقص تشغيلي.` ,ready?'good':'warn');
  }catch(e){
    modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر فحص جاهزية الحجز.'));modal.foot.append(button('إغلاق',modal.close));
  }
}

function setCenterMessage(center,message,tone=''){
  const box=center?.querySelector('.booking-360-quick-message');if(!box)return;box.textContent=message||'';box.className=`booking-360-quick-message${tone?` ${tone}`:''}`;
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.readinessReady==='1')return;
  grid.dataset.readinessReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button readiness','فحص جاهزية الحجز');b.type='button';
  const badge=el('span','booking-360-readiness-badge','لم يُفحص');b.append(badge);
  b.addEventListener('click',()=>openReadiness(center,bookingNo,badge));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360Readiness(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
