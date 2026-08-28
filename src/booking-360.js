import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const num=v=>Number(v||0);
const low=v=>text(v).toLowerCase();
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
const statusLabel=v=>({new:'جديد',confirmed:'مؤكد',pending:'قيد المراجعة',cancelled:'ملغي',canceled:'ملغي',refunded:'مسترد',completed:'مكتمل'})[low(v)]||text(v)||'—';
const journeyLabel=v=>({oneway:'ذهاب فقط',roundtrip:'ذهاب وعودة',separate:'ذهاب + عودة منفصلة',returnonly:'عودة فقط'})[low(v)]||text(v)||'—';
const accommodationLabel=v=>({none:'بدون سكن',shared:'سكن مشترك',private:'غرفة خاصة'})[low(v)]||text(v)||'—';
const activeStatus=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
const route=t=>t?`${text(t.from_city||t.origin)||'—'} ← ${text(t.to_city||t.destination)||'—'}`:'—';
const dateTime=(d,t)=>[text(d),text(t)].filter(Boolean).join(' ')||'—';

let loading=false;
let queued=false;
let activeBooking='';
const cache=new Map();

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return low(value)==='new'?'':value;
}

function el(tag,className,textValue){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(textValue!==undefined)node.textContent=textValue;
  return node;
}

function metric(label,value,tone=''){
  const box=el('div',`booking-360-metric ${tone}`.trim());
  box.append(el('span','booking-360-metric-label',label),el('strong','booking-360-metric-value',value));
  return box;
}

function detail(label,value,sub=''){
  const box=el('div','booking-360-detail');
  box.append(el('span','booking-360-detail-label',label),el('strong','booking-360-detail-value',value||'—'));
  if(sub)box.append(el('small','booking-360-detail-sub',sub));
  return box;
}

function navAction(label,href,primary=false){
  const a=el('a',`booking-360-action${primary?' primary':''}`,label);
  a.href=href;
  return a;
}

function normalizeWhatsapp(phone){
  let d=text(phone).replace(/\D/g,'');
  if(d.startsWith('00'))d=d.slice(2);
  if(d.startsWith('0'))d=`966${d.slice(1)}`;
  return d;
}

function renderPanel(vm){
  document.querySelector('.booking-360-overview')?.remove();
  const header=document.querySelector('.page-head');
  if(!header)return;

  const panel=el('section','booking-360-overview');
  panel.dataset.booking=vm.bookingNo;

  const top=el('div','booking-360-top');
  const titleWrap=el('div','booking-360-title-wrap');
  titleWrap.append(el('div','booking-360-kicker','BOOKING 360°'),el('h2','booking-360-title',`ملخص الحجز ${vm.bookingNo}`),el('p','booking-360-subtitle','نظرة تشغيلية ومالية سريعة قبل الدخول في تفاصيل التعديل.'));
  const status=el('span',`booking-360-status ${vm.statusTone}`,vm.status);
  top.append(titleWrap,status);

  const metrics=el('div','booking-360-metrics');
  metrics.append(
    metric('المسافرون',String(vm.passengerCount)),
    metric('إجمالي الحجز',money(vm.total)),
    metric('المحصل الصافي',money(vm.netPaid),'good'),
    metric(vm.credit>0?'رصيد للعميل':'المتبقي',money(vm.credit>0?vm.credit:vm.remaining),vm.remaining>0?'warn':'good'),
    metric('المقاعد',vm.seatText,vm.seatReady?'good':'warn'),
    metric('التسكين',vm.housingText,vm.housingReady?'good':'warn')
  );

  const details=el('div','booking-360-details');
  details.append(
    detail('العميل',vm.customer,`${vm.phone||'—'} · ${vm.identity||'—'}`),
    detail('الرحلة',vm.tripRoute,`${vm.journey} · ${vm.tripDate}`),
    detail('العودة',vm.returnRoute,vm.returnDate),
    detail('السكن / الفرع',vm.housing,`${vm.hotel?`${vm.hotel} · `:''}${vm.branch}`)
  );

  const actions=el('div','booking-360-actions');
  actions.append(navAction('فتح التذكرة',`/ticket/${encodeURIComponent(vm.bookingNo)}`,true),navAction('الاسترداد',`/refunds?booking=${encodeURIComponent(vm.bookingNo)}`));
  if(vm.whatsapp){
    const wa=navAction('واتساب',`https://wa.me/${vm.whatsapp}?text=${encodeURIComponent(`شركة الماهر الماسي\nرقم الحجز: ${vm.bookingNo}\nالعميل: ${vm.customer}`)}`);
    wa.target='_blank';wa.rel='noopener noreferrer';actions.append(wa);
  }
  const copy=el('button','booking-360-action','نسخ رقم الحجز');
  copy.type='button';
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(vm.bookingNo);copy.textContent='تم النسخ ✓';setTimeout(()=>{copy.textContent='نسخ رقم الحجز'},1300)}catch{}});
  const refresh=el('button','booking-360-action','تحديث الملخص');
  refresh.type='button';
  refresh.addEventListener('click',()=>{cache.delete(vm.bookingNo);activeBooking='';syncBooking360(true)});
  actions.append(copy,refresh);

  panel.append(top,metrics,details,actions);
  header.insertAdjacentElement('afterend',panel);
}

async function loadViewModel(bookingNo){
  const cached=cache.get(bookingNo);
  if(cached&&Date.now()-cached.at<15000)return cached.vm;

  const raw=await api.bootstrap();
  const bookings=Array.isArray(raw?.bookings)?raw.bookings:[];
  const passengers=Array.isArray(raw?.passengers)?raw.passengers:[];
  const trips=Array.isArray(raw?.trips)?raw.trips:[];
  const branches=Array.isArray(raw?.branches)?raw.branches:[];
  const booking=bookings.find(b=>text(b?.booking_number)===text(bookingNo));
  if(!booking)return null;

  const snap=booking?.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const bookingPassengers=passengers.filter(p=>text(p?.booking_id)===text(booking?.id)&&activeStatus(p?.status));
  const passengerIds=new Set(bookingPassengers.map(p=>text(p?.id)).filter(Boolean));
  const trip=trips.find(t=>text(t?.id)===text(booking?.trip_id));
  const returnTrip=trips.find(t=>text(t?.id)===text(booking?.return_trip_id));
  const branch=branches.find(b=>text(b?.id)===text(booking?.branch_id));

  let refunded=num(booking?.refunded_amount);
  try{const q=await api.admin({action:'refund_quote',booking_number:bookingNo});refunded=num(q?.refunded_amount??refunded)}catch{}
  const total=num(booking?.total_price);
  const gross=num(booking?.paid_amount);
  const netPaid=Math.max(0,gross-refunded);
  const remaining=Math.max(0,total-netPaid);
  const credit=Math.max(0,netPaid-total);

  let seatAssigned=0,housed=0;
  try{
    const seats=await api.module('seats');
    const assigned=new Set((seats?.seat_assignments||[]).filter(a=>passengerIds.has(text(a?.passenger_id))&&activeStatus(a?.status||'assigned')).map(a=>text(a?.passenger_id)));
    seatAssigned=assigned.size;
  }catch{}
  try{
    const housing=await api.module('housing');
    const assigned=new Set((housing?.room_assignments||[]).filter(a=>passengerIds.has(text(a?.passenger_id))&&activeStatus(a?.status||'assigned')).map(a=>text(a?.passenger_id)));
    housed=assigned.size;
  }catch{}

  const mode=booking?.journey_mode||snap?.journeyMode;
  const accommodation=booking?.accommodation_type||snap?.accommodationType||'none';
  const needsHousing=low(accommodation)!=='none';
  const count=bookingPassengers.length;
  const status=low(booking?.status);
  const vm={
    bookingNo:text(booking?.booking_number),
    status:statusLabel(booking?.status),
    statusTone:['cancelled','canceled','refunded'].includes(status)?'bad':['pending','new'].includes(status)?'warn':'good',
    passengerCount:count,total,netPaid,remaining,credit,
    customer:text(booking?.customer_name)||'—',phone:text(booking?.customer_phone),identity:text(booking?.customer_identity),
    journey:journeyLabel(mode),tripRoute:route(trip),tripDate:dateTime(trip?.departure_date,trip?.departure_time),
    returnRoute:mode==='separate'?route(returnTrip):['roundtrip','returnonly'].includes(low(mode))?route(trip):'لا توجد عودة',
    returnDate:mode==='separate'?dateTime(returnTrip?.return_date,returnTrip?.return_time):['roundtrip','returnonly'].includes(low(mode))?dateTime(trip?.return_date,trip?.return_time):'—',
    housing:accommodationLabel(accommodation),hotel:text(snap?.housingHotelName||booking?.hotel_name),branch:text(branch?.name||branch?.branch_name)||'—',
    seatText:count?`${seatAssigned}/${count}`:'—',seatReady:count===0||seatAssigned>=count,
    housingText:needsHousing?(count?`${housed}/${count}`:'—'):'غير مطلوب',housingReady:!needsHousing||count===0||housed>=count,
    whatsapp:normalizeWhatsapp(booking?.customer_phone)
  };
  cache.set(bookingNo,{at:Date.now(),vm});
  return vm;
}

async function syncBooking360(force=false){
  const bookingNo=bookingNoFromPath();
  if(!bookingNo){document.querySelector('.booking-360-overview')?.remove();activeBooking='';return}
  const header=document.querySelector('.page-head');
  if(!header)return;
  const current=document.querySelector('.booking-360-overview');
  if(!force&&activeBooking===bookingNo&&current?.dataset.booking===bookingNo)return;
  if(loading)return;
  loading=true;
  try{
    const vm=await loadViewModel(bookingNo);
    if(vm&&bookingNoFromPath()===bookingNo){renderPanel(vm);activeBooking=bookingNo}
  }catch{
    // Booking editor remains fully usable if the overview cannot load.
  }finally{loading=false}
}

function queueSync(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;syncBooking360()});
}

export function installBooking360Overview(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queueSync();
  const observer=new MutationObserver(queueSync);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queueSync);
}
