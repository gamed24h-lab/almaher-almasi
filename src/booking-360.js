import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const num=v=>Number(v||0);
const low=v=>text(v).toLowerCase();
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
const statusLabel=v=>({new:'جديد',confirmed:'مؤكد',pending:'قيد المراجعة',cancelled:'ملغي',canceled:'ملغي',refunded:'مسترد',completed:'مكتمل',posted:'مرحّل',paid:'مسدد',open:'مفتوح',closed:'مغلق'})[low(v)]||text(v)||'—';
const journeyLabel=v=>({oneway:'ذهاب فقط',roundtrip:'ذهاب وعودة',separate:'ذهاب + عودة منفصلة',returnonly:'عودة فقط'})[low(v)]||text(v)||'—';
const accommodationLabel=v=>({none:'بدون سكن',shared:'سكن مشترك',private:'غرفة خاصة'})[low(v)]||text(v)||'—';
const activeStatus=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
const route=t=>t?`${text(t.from_city||t.origin)||'—'} ← ${text(t.to_city||t.destination)||'—'}`:'—';
const dateTime=(d,t)=>[text(d),text(t)].filter(Boolean).join(' ')||'—';
const safeJson=v=>{try{return JSON.stringify(v)}catch{return ''}};

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

function eventTime(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('ar-SA')}catch{return text(v)||'—'}
}

function eventTitle(e){
  const raw=text(e?.title||e?.label||e?.event_type||e?.type||e?.action||e?.operation||e?.event);
  const x=low(raw);
  if(!raw)return 'حركة على الحجز';
  if(x.includes('reactivat'))return 'إعادة تفعيل الحجز';
  if(x.includes('cancel'))return 'إلغاء الحجز';
  if(x.includes('refund'))return 'استرداد';
  if(x.includes('payment')||x.includes('collect'))return 'تحصيل دفعة';
  if(x.includes('status'))return 'تغيير حالة الحجز';
  if(x.includes('seat'))return 'تعديل المقعد';
  if(x.includes('housing')||x.includes('room'))return 'تعديل التسكين';
  if(x.includes('create')||x.includes('insert'))return 'إنشاء الحجز';
  if(x.includes('update')||x.includes('edit'))return 'تعديل الحجز';
  return raw;
}

function compactObject(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return '';
  const entries=Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null&&v!=='').slice(0,4);
  return entries.map(([k,v])=>`${k}: ${typeof v==='object'?safeJson(v):text(v)}`).join(' · ');
}

function eventDescription(e){
  const direct=e?.description||e?.message||e?.summary||e?.note||e?.notes||e?.details;
  if(typeof direct==='string'&&text(direct))return text(direct).slice(0,220);
  if(direct&&typeof direct==='object')return compactObject(direct).slice(0,220);
  const changes=e?.changes||e?.diff||e?.payload;
  if(changes&&typeof changes==='object')return compactObject(changes).slice(0,220);
  return '';
}

function eventActor(e){
  return text(e?.actor_name||e?.staff_name||e?.user_name||e?.created_by_name||e?.actor||e?.created_by)||'النظام';
}

function renderPassengers(vm){
  const wrap=el('div','booking-360-passengers');
  if(!vm.passengers.length){wrap.append(el('div','booking-360-empty','لا توجد بيانات مسافرين مرتبطة بهذا الحجز.'));return wrap}
  const table=el('div','booking-360-table-wrap');
  const t=el('table','booking-360-table');
  const head=el('thead');const hr=el('tr');
  ['#','المسافر','الهوية / الجنسية','المقعد','الغرفة / الفندق','الحالة'].forEach(x=>hr.append(el('th','',x)));
  head.append(hr);const body=el('tbody');
  vm.passengers.forEach((p,i)=>{
    const tr=el('tr');
    tr.append(el('td','booking-360-index',String(i+1)));
    const name=el('td');name.append(el('strong','booking-360-pax-name',p.name||'—'));if(p.phone)name.append(el('small','booking-360-cell-sub',p.phone));tr.append(name);
    const identity=el('td');identity.append(el('span','',p.identity||'—'));if(p.nationality)identity.append(el('small','booking-360-cell-sub',p.nationality));tr.append(identity);
    tr.append(el('td',p.seatReady?'booking-360-cell-good':'booking-360-cell-warn',p.seatText));
    const room=el('td',p.housingReady?'booking-360-cell-good':'booking-360-cell-warn',p.roomText);if(p.hotel)room.append(el('small','booking-360-cell-sub',p.hotel));tr.append(room);
    tr.append(el('td','',statusLabel(p.status)));
    body.append(tr);
  });
  t.append(head,body);table.append(t);wrap.append(table);return wrap;
}

function renderFinance(vm){
  const wrap=el('div','booking-360-finance');
  const stats=el('div','booking-360-finance-stats');
  stats.append(metric('إجمالي الحجز',money(vm.total)),metric('التحصيل التاريخي',money(vm.grossPaid)),metric('المسترد',money(vm.refunded),vm.refunded>0?'warn':''),metric('المحصل الصافي',money(vm.netPaid),'good'),metric(vm.credit>0?'رصيد للعميل':'المتبقي',money(vm.credit>0?vm.credit:vm.remaining),vm.remaining>0?'warn':'good'));
  wrap.append(stats);
  const title=el('div','booking-360-section-heading');title.append(el('strong','',`الحركات المالية المرتبطة بالحجز (${vm.financeTransactions.length})`));wrap.append(title);
  if(!vm.financeAvailable){wrap.append(el('div','booking-360-empty','الحركات المالية التفصيلية غير متاحة ضمن صلاحيات الحساب الحالية.'));return wrap}
  if(!vm.financeTransactions.length){wrap.append(el('div','booking-360-empty','لا توجد حركات مالية تفصيلية مرتبطة بهذا الحجز حتى الآن.'));return wrap}
  const tableWrap=el('div','booking-360-table-wrap');const t=el('table','booking-360-table');const head=el('thead');const hr=el('tr');['التاريخ','النوع','المبلغ','الحالة','المرجع'].forEach(x=>hr.append(el('th','',x)));head.append(hr);const body=el('tbody');
  vm.financeTransactions.slice(0,15).forEach(r=>{const tr=el('tr');tr.append(el('td','',eventTime(r.created_at||r.transaction_date||r.date)),el('td','',statusLabel(r.type||r.transaction_type||'حركة')),el('td','booking-360-money-cell',money(r.amount)),el('td','',statusLabel(r.status||'posted')),el('td','',text(r.reference||r.reference_no||r.receipt_no||r.booking_number)||'—'));body.append(tr)});
  t.append(head,body);tableWrap.append(t);wrap.append(tableWrap);return wrap;
}

function renderTimeline(vm){
  const wrap=el('div','booking-360-timeline');
  if(!vm.timelineAvailable){wrap.append(el('div','booking-360-empty','سجل النشاط غير متاح ضمن صلاحيات الحساب الحالية.'));return wrap}
  if(!vm.timeline.length){wrap.append(el('div','booking-360-empty','لا توجد أحداث مسجلة لهذا الحجز حتى الآن.'));return wrap}
  vm.timeline.slice(0,15).forEach(e=>{
    const item=el('div','booking-360-event');
    const dot=el('span','booking-360-event-dot');
    const content=el('div','booking-360-event-content');
    const head=el('div','booking-360-event-head');head.append(el('strong','',eventTitle(e)),el('time','',eventTime(e.created_at||e.event_at||e.timestamp||e.at)));
    const meta=el('div','booking-360-event-meta',`بواسطة: ${eventActor(e)}`);
    const desc=eventDescription(e);content.append(head,meta);if(desc)content.append(el('div','booking-360-event-desc',desc));item.append(dot,content);wrap.append(item);
  });
  return wrap;
}

function renderWorkspace(vm){
  const workspace=el('div','booking-360-workspace');
  const tabs=el('div','booking-360-tabs');
  const body=el('div','booking-360-tab-body');
  const definitions=[
    ['passengers',`المسافرون (${vm.passengers.length})`,()=>renderPassengers(vm)],
    ['finance',`المالية (${vm.financeTransactions.length})`,()=>renderFinance(vm)],
    ['timeline',`سجل النشاط (${vm.timeline.length})`,()=>renderTimeline(vm)]
  ];
  const buttons=new Map(),panels=new Map();
  function activate(key){
    buttons.forEach((b,k)=>{b.classList.toggle('active',k===key);b.setAttribute('aria-selected',k===key?'true':'false')});
    panels.forEach((p,k)=>p.hidden=k!==key);
  }
  definitions.forEach(([key,label,renderer],index)=>{
    const b=el('button','booking-360-tab',label);b.type='button';b.setAttribute('role','tab');b.addEventListener('click',()=>activate(key));buttons.set(key,b);tabs.append(b);
    const p=el('section','booking-360-panel');p.dataset.tab=key;p.hidden=index!==0;p.append(renderer());panels.set(key,p);body.append(p);
  });
  workspace.append(tabs,body);activate('passengers');return workspace;
}

function renderPanel(vm){
  document.querySelector('.booking-360-overview')?.remove();
  const header=document.querySelector('.page-head');
  if(!header)return;

  const panel=el('section','booking-360-overview');
  panel.dataset.booking=vm.bookingNo;

  const top=el('div','booking-360-top');
  const titleWrap=el('div','booking-360-title-wrap');
  titleWrap.append(el('div','booking-360-kicker','BOOKING 360°'),el('h2','booking-360-title',`ملخص الحجز ${vm.bookingNo}`),el('p','booking-360-subtitle','العميل والرحلة والمالية والمقاعد والتسكين وسجل النشاط في مكان واحد.'));
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
  const refresh=el('button','booking-360-action','تحديث Booking 360');
  refresh.type='button';
  refresh.addEventListener('click',()=>{cache.delete(vm.bookingNo);activeBooking='';syncBooking360(true)});
  actions.append(copy,refresh);

  panel.append(top,metrics,details,actions,renderWorkspace(vm));
  header.insertAdjacentElement('afterend',panel);
}

async function loadViewModel(bookingNo){
  const cached=cache.get(bookingNo);
  if(cached&&Date.now()-cached.at<12000)return cached.vm;

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

  const [refundSummary,seats,housing,timelineResult,financeResult]=await Promise.all([
    api.bookingRefundSummaries().catch(()=>null),
    api.module('seats').catch(()=>null),
    api.module('housing').catch(()=>null),
    api.bookingTimeline(bookingNo).catch(()=>null),
    api.module('finance_full').catch(()=>null)
  ]);

  const refunded=num(refundSummary?.by_booking_id?.[text(booking?.id)]??refundSummary?.by_booking_number?.[bookingNo]??booking?.refunded_amount);
  const total=num(booking?.total_price);
  const gross=num(booking?.paid_amount);
  const netPaid=Math.max(0,gross-refunded);
  const remaining=Math.max(0,total-netPaid);
  const credit=Math.max(0,netPaid-total);

  const seatAssignments=(seats?.seat_assignments||[]).filter(a=>passengerIds.has(text(a?.passenger_id))&&activeStatus(a?.status||'assigned'));
  const seatMap=new Map();
  for(const a of seatAssignments){const pid=text(a?.passenger_id),arr=seatMap.get(pid)||[];arr.push(a);seatMap.set(pid,arr)}

  const rooms=housing?.hotel_rooms||[];
  const tripHotels=housing?.trip_hotels||[];
  const hotels=housing?.hotels||[];
  const roomAssignments=(housing?.room_assignments||[]).filter(a=>passengerIds.has(text(a?.passenger_id))&&activeStatus(a?.status||'assigned'));
  const roomMap=new Map();
  for(const a of roomAssignments){const pid=text(a?.passenger_id),arr=roomMap.get(pid)||[];arr.push(a);roomMap.set(pid,arr)}
  const roomById=new Map(rooms.map(r=>[text(r?.id),r]));
  const tripHotelById=new Map(tripHotels.map(r=>[text(r?.id),r]));
  const hotelById=new Map(hotels.map(r=>[text(r?.id),r]));

  const passengerRows=bookingPassengers.map(p=>{
    const seatRows=seatMap.get(text(p?.id))||[];
    const seatText=seatRows.length?seatRows.map(a=>`${low(a?.segment_type)==='return'?'عودة':'ذهاب'} ${text(a?.seat_no||a?.seat_number)||'—'}`).join(' · '):'غير محدد';
    const housingRows=roomMap.get(text(p?.id))||[];
    const roomLabels=[],hotelNames=[];
    for(const a of housingRows){
      const room=roomById.get(text(a?.hotel_room_id||a?.room_id));
      if(room)roomLabels.push(`غرفة ${text(room?.room_no)||'—'}`);
      const th=tripHotelById.get(text(room?.trip_hotel_id));
      const hotel=hotelById.get(text(th?.hotel_id));
      if(text(hotel?.name)&&!hotelNames.includes(text(hotel.name)))hotelNames.push(text(hotel.name));
    }
    const needsHousing=low(booking?.accommodation_type||snap?.accommodationType||'none')!=='none';
    return {name:text(p?.full_name)||'—',phone:text(p?.phone),identity:text(p?.identity_number),nationality:text(p?.nationality),status:text(p?.status)||'confirmed',seatText,seatReady:seatRows.length>0,roomText:needsHousing?(roomLabels.length?roomLabels.join(' · '):'غير مسكن'):'غير مطلوب',hotel:hotelNames.join(' · '),housingReady:!needsHousing||roomLabels.length>0};
  });

  const seatAssigned=passengerRows.filter(p=>p.seatReady).length;
  const housed=passengerRows.filter(p=>p.housingReady).length;
  const mode=booking?.journey_mode||snap?.journeyMode;
  const accommodation=booking?.accommodation_type||snap?.accommodationType||'none';
  const needsHousing=low(accommodation)!=='none';
  const count=bookingPassengers.length;
  const status=low(booking?.status);

  const timelineEvents=Array.isArray(timelineResult?.events)?[...timelineResult.events]:[];
  timelineEvents.sort((a,b)=>String(b?.created_at||b?.event_at||b?.timestamp||'').localeCompare(String(a?.created_at||a?.event_at||a?.timestamp||'')));

  const allTransactions=Array.isArray(financeResult?.transactions)?financeResult.transactions:[];
  const financeTransactions=allTransactions.filter(r=>{
    const fields=[r?.booking_number,r?.booking_no,r?.reference,r?.reference_no,r?.receipt_no,r?.notes,r?.description].map(text).filter(Boolean);
    return fields.some(v=>v===bookingNo||v.includes(bookingNo));
  }).sort((a,b)=>String(b?.created_at||b?.transaction_date||b?.date||'').localeCompare(String(a?.created_at||a?.transaction_date||a?.date||'')));

  const vm={
    bookingNo:text(booking?.booking_number),
    status:statusLabel(booking?.status),
    statusTone:['cancelled','canceled','refunded'].includes(status)?'bad':['pending','new'].includes(status)?'warn':'good',
    passengerCount:count,total,grossPaid:gross,refunded,netPaid,remaining,credit,
    customer:text(booking?.customer_name)||'—',phone:text(booking?.customer_phone),identity:text(booking?.customer_identity),
    journey:journeyLabel(mode),tripRoute:route(trip),tripDate:dateTime(trip?.departure_date,trip?.departure_time),
    returnRoute:mode==='separate'?route(returnTrip):['roundtrip','returnonly'].includes(low(mode))?route(trip):'لا توجد عودة',
    returnDate:mode==='separate'?dateTime(returnTrip?.return_date,returnTrip?.return_time):['roundtrip','returnonly'].includes(low(mode))?dateTime(trip?.return_date,trip?.return_time):'—',
    housing:accommodationLabel(accommodation),hotel:text(snap?.housingHotelName||booking?.hotel_name),branch:text(branch?.name||branch?.branch_name)||'—',
    seatText:count?`${seatAssigned}/${count}`:'—',seatReady:count===0||seatAssigned>=count,
    housingText:needsHousing?(count?`${housed}/${count}`:'—'):'غير مطلوب',housingReady:!needsHousing||count===0||housed>=count,
    whatsapp:normalizeWhatsapp(booking?.customer_phone),
    passengers:passengerRows,
    timeline:timelineEvents,timelineAvailable:!!timelineResult,
    financeTransactions,financeAvailable:!!financeResult
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
    // Booking editor remains fully usable if Booking 360 cannot load.
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
