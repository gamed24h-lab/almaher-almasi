import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>Number(v||0);
const active=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
let queued=false;
let generation=0;

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return low(value)==='new'?'':value;
}

function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}

function triggerQuickAction(label){
  const target=[...document.querySelectorAll('.booking-360-quick-grid button')].find(b=>text(b.textContent).includes(label));
  target?.click?.();
}

function activePassengers(raw,bookingId){
  return (raw?.passengers||[]).filter(p=>text(p?.booking_id)===text(bookingId)&&active(p?.status||'confirmed'));
}

function seatCoverage(source,passengerIds,segment,tripId){
  if(!source)return null;
  const vehicleIds=new Set((source?.trip_vehicles||[]).filter(v=>text(v?.trip_id)===text(tripId)&&active(v?.status||'assigned')).map(v=>text(v.id)));
  if(!vehicleIds.size)return 0;
  const seen=new Set();
  for(const a of source?.seat_assignments||[]){
    if(!active(a?.status||'assigned'))continue;
    if(text(a?.segment_type||'outbound')!==segment)continue;
    if(!vehicleIds.has(text(a?.trip_vehicle_id)))continue;
    const pid=text(a?.passenger_id);if(passengerIds.has(pid))seen.add(pid);
  }
  return seen.size;
}

function housingCoverage(housing,passengerIds,tripId){
  if(!housing)return null;
  const tripHotelIds=new Set((housing?.trip_hotels||[]).filter(x=>text(x?.trip_id)===text(tripId)).map(x=>text(x.id)));
  const roomIds=new Set((housing?.hotel_rooms||[]).filter(r=>tripHotelIds.has(text(r?.trip_hotel_id))).map(r=>text(r.id)));
  const seen=new Set();
  for(const a of housing?.room_assignments||[]){
    if(!active(a?.status||'assigned')||!roomIds.has(text(a?.hotel_room_id)))continue;
    const pid=text(a?.passenger_id);if(passengerIds.has(pid))seen.add(pid);
  }
  return seen.size;
}

function documentCoverage(docPayload,passengers){
  if(!docPayload)return null;
  const passengerIds=new Set(passengers.map(p=>text(p.id)));
  const rows=(docPayload?.passenger_documents||[]).filter(r=>passengerIds.has(text(r?.passenger_id)));
  const byPassenger=new Map();
  rows.forEach(r=>{const id=text(r.passenger_id),arr=byPassenger.get(id)||[];arr.push(r);byPassenger.set(id,arr)});
  const covered=passengers.filter(p=>(byPassenger.get(text(p.id))||[]).some(r=>!['rejected','expired','deleted'].includes(low(r.status)))).length;
  const rejected=rows.filter(r=>['rejected','expired'].includes(low(r.status))).length;
  const verifiedPassengers=passengers.filter(p=>(byPassenger.get(text(p.id))||[]).some(r=>['approved','verified'].includes(low(r.status)))).length;
  return {covered,rejected,verifiedPassengers,totalRows:rows.length};
}

async function inspect(bookingNo){
  const raw=await api.bootstrap();
  const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  if(!booking)throw new Error('الحجز غير موجود.');
  const snap=booking?.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const bookingId=text(booking.id),mode=low(booking.journey_mode||snap.journeyMode),tripId=text(booking.trip_id||snap.tripId),returnTripId=text(booking.return_trip_id||snap.returnTripId),accommodation=low(booking.accommodation_type||snap.accommodationType||'none');
  const passengers=activePassengers(raw,bookingId),passengerIds=new Set(passengers.map(p=>text(p.id))),count=passengers.length;
  const [seatsResult,housingResult,docsResult,refundResult]=await Promise.allSettled([
    api.module('seats'),
    accommodation==='none'?Promise.resolve(null):api.module('housing'),
    api.module('documents'),
    api.bookingRefundSummaries()
  ]);
  const seats=seatsResult.status==='fulfilled'?seatsResult.value:null;
  const housing=housingResult.status==='fulfilled'?housingResult.value:null;
  const docs=docsResult.status==='fulfilled'?docsResult.value:null;
  const refundSummary=refundResult.status==='fulfilled'?refundResult.value:null;
  let returnSeats=seats;
  if(mode==='separate'&&returnTripId){try{returnSeats=await api.returnSeatContext(returnTripId)}catch{returnSeats=null}}
  const outboundRequired=mode!=='returnonly';
  const returnRequired=['roundtrip','separate','returnonly'].includes(mode);
  const outbound=outboundRequired?seatCoverage(seats,passengerIds,'outbound',tripId):count;
  const returnTripForSeats=mode==='separate'?returnTripId:tripId;
  const inbound=returnRequired?seatCoverage(returnSeats,passengerIds,'return',returnTripForSeats):count;
  const housed=accommodation==='none'?count:housingCoverage(housing,passengerIds,tripId);
  const doc=documentsSafe(docs,passengers);
  const refunded=num(refundSummary?.by_booking_id?.[bookingId]??refundSummary?.by_booking_number?.[bookingNo]??booking?.refunded_amount);
  const remaining=Math.max(0,num(booking.total_price)-Math.max(0,num(booking.paid_amount)-refunded));
  const missingIdentity=passengers.filter(p=>!text(p?.identity_number)).length;
  const status=low(booking.status);
  const tripIncomplete=!tripId||(mode==='separate'&&!returnTripId);

  const items=[];
  items.push({key:'data',label:'البيانات',state:count>0&&!missingIdentity?'good':'bad',detail:count?`${count} مسافر${missingIdentity?` · ${missingIdentity} بدون هوية`:''}`:'لا يوجد مسافرون',action:'تعديل مسافر'});
  items.push({key:'status',label:'الحالة',state:status==='confirmed'?'good':status==='new'?'warn':'bad',detail:status==='confirmed'?'مؤكد':status==='new'?'جديد':text(booking.status)||'غير محددة',action:'تغيير الحالة'});
  items.push({key:'finance',label:'المالية',state:remaining<=0.001?'good':'warn',detail:remaining<=0.001?'مكتمل السداد':`متبقي ${money(remaining)}`,action:remaining>0.001?'تحصيل سريع':'السندات المالية'});

  let seatState='good',seatDetail='غير مطلوبة';
  if(tripIncomplete){seatState='bad';seatDetail='بيانات الرحلة ناقصة'}
  else if((outboundRequired&&outbound===null)||(returnRequired&&inbound===null)){seatState='warn';seatDetail='تعذر التحقق الآن'}
  else{
    const missing=(outboundRequired?Math.max(0,count-outbound):0)+(returnRequired?Math.max(0,count-inbound):0);
    seatState=missing?'bad':'good';seatDetail=missing?`${missing} تعيين مقعد ناقص`:'المقاعد مكتملة';
  }
  items.push({key:'seats',label:'المقاعد',state:seatState,detail:seatDetail,action:'تغيير المقعد'});

  const housingState=accommodation==='none'?'good':housed===null?'warn':housed>=count?'good':'bad';
  const housingDetail=accommodation==='none'?'بدون سكن':housed===null?'تعذر التحقق الآن':`${housed}/${count} تم تسكينهم`;
  items.push({key:'housing',label:'السكن',state:housingState,detail:housingDetail,action:'تغيير الغرفة'});

  let docsState='warn',docsDetail='تعذر التحقق الآن';
  if(doc){
    if(!count){docsState='bad';docsDetail='لا يوجد مسافرون'}
    else if(doc.covered<count){docsState='bad';docsDetail=`${count-doc.covered} بدون مستند`}
    else if(doc.rejected){docsState='bad';docsDetail=`${doc.rejected} مرفوض / منتهي`}
    else if(doc.verifiedPassengers<count){docsState='warn';docsDetail=`${doc.verifiedPassengers}/${count} تم التحقق`}
    else{docsState='good';docsDetail='مستندات المسافرين مكتملة'}
  }
  items.push({key:'documents',label:'المستندات',state:docsState,detail:docsDetail,action:'مستندات الحجز'});
  return {booking,items};
}

function documentsSafe(payload,passengers){try{return documentCoverage(payload,passengers)}catch{return null}}

function chip(item){
  const b=el('button',`booking-360-completion-chip ${item.state}`);b.type='button';b.dataset.key=item.key;
  const icon=el('span','booking-360-completion-icon',item.state==='good'?'✓':item.state==='warn'?'!':'×');
  const copy=el('span','booking-360-completion-copy');copy.append(el('strong','',item.label),el('small','',item.detail));b.append(icon,copy);
  if(item.action)b.addEventListener('click',()=>triggerQuickAction(item.action));
  return b;
}

async function refreshStrip(strip,bookingNo){
  const my=++generation;strip.classList.add('loading');
  const summary=strip.querySelector('.booking-360-completion-summary');if(summary)summary.textContent='جاري فحص اكتمال ملف الحجز...';
  try{
    const result=await inspect(bookingNo);if(my!==generation||!document.body.contains(strip))return;
    const grid=strip.querySelector('.booking-360-completion-grid');grid.innerHTML='';result.items.forEach(x=>grid.append(chip(x)));
    const good=result.items.filter(x=>x.state==='good').length,bad=result.items.filter(x=>x.state==='bad').length,warn=result.items.filter(x=>x.state==='warn').length,total=result.items.length;
    strip.dataset.state=bad?'bad':warn?'warn':'good';
    summary.textContent=bad?`اكتمال الملف ${good}/${total} · يوجد ${bad} نقص يحتاج استكمال`:warn?`اكتمال الملف ${good}/${total} · يوجد ${warn} تنبيه للمراجعة`:`ملف الحجز مكتمل ${total}/${total}`;
  }catch(e){if(my!==generation)return;strip.dataset.state='warn';if(summary)summary.textContent=e?.message||'تعذر فحص اكتمال الحجز الآن.'}
  finally{if(my===generation)strip.classList.remove('loading')}
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview'),center=panel?.querySelector('.booking-360-quick-center'),grid=center?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!center||!grid||center.querySelector('.booking-360-completion-strip'))return;
  const strip=el('section','booking-360-completion-strip');strip.dataset.state='loading';
  const head=el('div','booking-360-completion-head');const title=el('div');title.append(el('strong','','اكتمال ملف الحجز'),el('small','booking-360-completion-summary','جاري فحص اكتمال ملف الحجز...'));
  const refresh=el('button','booking-360-completion-refresh','تحديث');refresh.type='button';refresh.addEventListener('click',()=>refreshStrip(strip,bookingNo));head.append(title,refresh);
  const completionGrid=el('div','booking-360-completion-grid');strip.append(head,completionGrid);center.insertBefore(strip,grid);
  refreshStrip(strip,bookingNo);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360Completion(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
