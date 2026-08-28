import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>Number(v||0);
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
const active=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
let queued=false;
let generation=0;

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

function activePassengers(raw,bookingId){
  return (raw?.passengers||[]).filter(p=>text(p?.booking_id)===text(bookingId)&&active(p?.status||'confirmed'));
}

function assignedPassengers(source,passengerIds,segment){
  const seen=new Set();
  for(const a of source?.seat_assignments||[]){
    if(!active(a?.status||'assigned'))continue;
    if(text(a?.segment_type||'outbound')!==segment)continue;
    const pid=text(a?.passenger_id);
    if(passengerIds.has(pid))seen.add(pid);
  }
  return seen.size;
}

function housedPassengers(housing,passengerIds,tripId){
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

function triggerQuickAction(label){
  const button=[...document.querySelectorAll('.booking-360-quick-grid button')].find(b=>text(b.textContent).includes(label));
  button?.click?.();
}

function alertRow(alert){
  const row=el('div',`booking-360-live-alert ${alert.level}`);
  const icon=el('span','booking-360-live-alert-icon',alert.level==='bad'?'!':'•');
  const copy=el('div','booking-360-live-alert-copy');
  copy.append(el('strong','',alert.title),el('small','',alert.detail));
  row.append(icon,copy);
  if(alert.action){
    const action=el('button','booking-360-live-alert-action',alert.action);action.type='button';
    action.addEventListener('click',()=>triggerQuickAction(alert.action));
    row.append(action);
  }
  return row;
}

async function buildAlerts(bookingNo){
  const raw=await api.bootstrap();
  const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  if(!booking)throw new Error('تعذر قراءة الحجز.');
  const snap=booking?.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const bookingId=text(booking.id);
  const mode=low(booking.journey_mode||snap.journeyMode);
  const tripId=text(booking.trip_id||snap.tripId);
  const returnTripId=text(booking.return_trip_id||snap.returnTripId);
  const accommodation=low(booking.accommodation_type||snap.accommodationType||'none');
  const status=low(booking.status);
  const passengers=activePassengers(raw,bookingId);
  const ids=new Set(passengers.map(p=>text(p.id)));
  const count=passengers.length;

  const [seats,housing,refundSummary]=await Promise.all([
    api.module('seats').catch(()=>null),
    accommodation==='none'?Promise.resolve(null):api.module('housing').catch(()=>null),
    api.bookingRefundSummaries().catch(()=>null)
  ]);
  let returnSeats=seats;
  if(mode==='separate'&&returnTripId)returnSeats=await api.returnSeatContext(returnTripId).catch(()=>null);

  const outboundRequired=mode!=='returnonly';
  const returnRequired=['roundtrip','separate','returnonly'].includes(mode);
  const outboundAssigned=outboundRequired?assignedPassengers(seats,ids,'outbound'):count;
  const returnAssigned=returnRequired?assignedPassengers(returnSeats,ids,'return'):count;
  const housed=accommodation==='none'?count:housedPassengers(housing,ids,tripId);
  const missingIdentity=passengers.filter(p=>!text(p?.identity_number)).length;
  const missingPhone=!text(booking?.customer_phone);
  const refunded=num(refundSummary?.by_booking_id?.[bookingId]??refundSummary?.by_booking_number?.[bookingNo]??booking?.refunded_amount);
  const remaining=Math.max(0,num(booking?.total_price)-Math.max(0,num(booking?.paid_amount)-refunded));

  const alerts=[];
  if(['cancelled','canceled','refunded'].includes(status))alerts.push({level:'bad',title:'الحجز غير نشط للتشغيل',detail:`الحالة الحالية: ${text(booking.status)||'غير محددة'}`});
  if(!count)alerts.push({level:'bad',title:'لا يوجد مسافرون نشطون',detail:'أضف أو راجع بيانات المسافرين قبل التشغيل.',action:'بيانات الحجز'});
  if(!tripId||(mode==='separate'&&!returnTripId))alerts.push({level:'bad',title:'الرحلة غير مكتملة',detail:mode==='separate'?'راجع رحلة الذهاب والعودة المنفصلة.':'راجع الرحلة المرتبطة بالحجز.',action:'بيانات الحجز'});
  if(missingIdentity)alerts.push({level:'bad',title:'هويات المسافرين ناقصة',detail:`يوجد ${missingIdentity} مسافر بدون رقم هوية.`,action:'بيانات الحجز'});
  if(outboundRequired&&outboundAssigned<count)alerts.push({level:'bad',title:'مقاعد الذهاب ناقصة',detail:`متبقي ${count-outboundAssigned} مسافر بدون مقعد ذهاب.`,action:'تغيير المقعد'});
  if(returnRequired&&returnAssigned<count)alerts.push({level:'bad',title:'مقاعد العودة ناقصة',detail:`متبقي ${count-returnAssigned} مسافر بدون مقعد عودة.`,action:'تغيير المقعد'});
  if(accommodation!=='none'&&housed<count)alerts.push({level:'bad',title:'التسكين غير مكتمل',detail:`متبقي ${count-housed} مسافر بدون غرفة.`,action:'تغيير الغرفة'});
  if(status==='new')alerts.push({level:'warn',title:'الحجز ما زال «جديد»',detail:'اعتمده كمؤكد بعد مراجعة البيانات.'});
  if(remaining>0.001)alerts.push({level:'warn',title:'يوجد مبلغ متبقٍ',detail:`المتبقي الحالي ${money(remaining)}.`,action:'تحصيل سريع'});
  if(missingPhone)alerts.push({level:'warn',title:'جوال العميل غير موجود',detail:'أكمل رقم الجوال لسهولة التواصل وإرسال التذكرة.',action:'بيانات الحجز'});
  return alerts;
}

async function renderAlerts(panel,bookingNo,force=false){
  const box=panel.querySelector('.booking-360-live-alerts');
  if(!box)return;
  if(box.dataset.loading==='1')return;
  if(box.dataset.loaded==='1'&&!force)return;
  const run=++generation;
  box.dataset.loading='1';box.dataset.loaded='0';
  const list=box.querySelector('.booking-360-live-alert-list');
  const badge=box.querySelector('.booking-360-live-alert-badge');
  list.innerHTML='';list.append(el('div','booking-360-live-alert-loading','جاري فحص التنبيهات التشغيلية...'));
  badge.textContent='فحص...';badge.className='booking-360-live-alert-badge';
  try{
    const alerts=await buildAlerts(bookingNo);
    if(run!==generation||bookingNoFromPath()!==bookingNo)return;
    list.innerHTML='';
    if(!alerts.length){
      list.append(el('div','booking-360-live-alert-empty','لا توجد تنبيهات تشغيلية على الحجز الآن.'));
      badge.textContent='0 تنبيه';badge.className='booking-360-live-alert-badge good';
    }else{
      alerts.forEach(a=>list.append(alertRow(a)));
      const critical=alerts.filter(a=>a.level==='bad').length;
      badge.textContent=`${alerts.length} تنبيه${critical?` · ${critical} مهم`:''}`;
      badge.className=`booking-360-live-alert-badge ${critical?'bad':'warn'}`;
    }
    box.dataset.loaded='1';
  }catch(e){
    list.innerHTML='';list.append(el('div','booking-360-live-alert-empty',e?.message||'تعذر فحص التنبيهات حاليًا.'));
    badge.textContent='تعذر الفحص';badge.className='booking-360-live-alert-badge warn';
  }finally{box.dataset.loading='0'}
}

function mount(panel,bookingNo){
  if(panel.querySelector('.booking-360-live-alerts'))return;
  const box=el('section','booking-360-live-alerts');
  const head=el('div','booking-360-live-alert-head');
  const title=el('div');title.append(el('strong','','تنبيهات الحجز'),el('small','','تظهر تلقائيًا أهم النواقص التي تحتاج تدخل الموظف.'));
  const tools=el('div','booking-360-live-alert-tools');
  const badge=el('span','booking-360-live-alert-badge','فحص...');
  const refresh=el('button','booking-360-live-alert-refresh','تحديث');refresh.type='button';
  tools.append(badge,refresh);head.append(title,tools);
  const list=el('div','booking-360-live-alert-list');box.append(head,list);
  const quick=panel.querySelector('.booking-360-quick-center');
  if(quick)quick.insertAdjacentElement('afterend',box);else panel.append(box);
  refresh.addEventListener('click',()=>renderAlerts(panel,bookingNo,true));
  renderAlerts(panel,bookingNo,true);
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  if(!panel||panel.dataset.booking!==bookingNo)return;
  mount(panel,bookingNo);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360LiveAlerts(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();
  const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
}
