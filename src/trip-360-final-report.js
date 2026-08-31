import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const active=v=>!['cancelled','canceled','released','inactive','deleted','refunded'].includes(low(v?.status??v));
const activeTripVehicle=v=>!['cancelled','released','inactive'].includes(low(v?.status||'assigned'));
const scanOk=v=>low(v?.result||v?.metadata?.scan_result||'success')==='success';
let queued=false;

const stageLabels={scheduled:'مجدولة',preparing:'التجهيز',boarding_outbound:'صعود الذهاب',departed_outbound:'تحرك الذهاب',arrived_destination:'وصول الوجهة',housing:'التسكين',preparing_return:'تجهيز العودة',boarding_return:'صعود العودة',departed_return:'تحرك العودة',arrived_return:'وصول العودة',completed:'مكتملة'};
const severityLabels={critical:'حرجة',high:'عالية',medium:'متوسطة',low:'منخفضة'};
const areaLabels={operations:'التشغيل',supervisor:'المشرف',housing:'التسكين',branch:'الفرع',finance:'المالية',fleet:'الأسطول'};
const handoffAreas={branch:'موظف الفرع',supervisor:'المشرف',operations:'التشغيل',housing:'التسكين'};

function tripIdFromPath(){const m=location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);return m?decodeURIComponent(m[1]):''}
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n}
function button(label,fn,primary=false){const b=el('button',`trip360-report-btn${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',fn);return b}
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return text(v)||'—'}}
function dateOnly(v){if(!v)return '—';try{return new Date(`${v}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory')}catch{return text(v)||'—'}}
function h(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function bookingSegment(b,tripId){const mode=low(b?.journey_mode||b?.snapshot?.journeyMode);if(mode==='returnonly')return 'return';if(text(b?.return_trip_id||b?.snapshot?.returnTripId)===text(tripId)&&text(b?.trip_id||b?.snapshot?.tripId)!==text(tripId))return 'return';return 'outbound'}
function bookingScanMode(b,tripId){return bookingSegment(b,tripId)==='return'?'return_boarding':'outbound_boarding'}
function boardingPoint(b,tripId,branchMap){const snap=b?.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};const point=text(bookingSegment(b,tripId)==='return'?(snap.returnBoardingPoint||b?.return_boarding_point):(snap.boardingPoint||b?.boarding_point));if(point)return point;const branch=branchMap.get(text(b?.branch_id));return text(branch?.name||branch?.city)||'غير محدد'}
function vehicleLabel(tv,vehicle,index){return text(tv?.bus_label||tv?.label||vehicle?.code||vehicle?.name||vehicle?.plate_no)||`باص ${index+1}`}
function driverLabel(d,id){return d?text(d.name)||text(d.full_name)||text(d.phone)||id||'—':id||'—'}
function staffLabel(u,id){return u?text(u.name)||text(u.username)||text(u.full_name)||id||'—':id||'—'}
function actorLabel(ev){const name=text(ev?.actor_name)||text(ev?.created?.actor_name)||'—',role=text(ev?.actor_role)||text(ev?.created?.actor_role);return role?`${name} — ${role}`:name}

async function loadReport(tripId){
  const calls=[
    api.admin({action:'trip_operational_data',trip_id:tripId}),
    api.admin({action:'trip_operations_timeline',trip_id:tripId}),
    api.admin({action:'trip_incidents_state',trip_id:tripId}),
    api.admin({action:'trip_handoff_state',trip_id:tripId}),
    api.admin({action:'trip_closure_state',trip_id:tripId}),
    api.module('seats'),api.module('scanner'),api.module('drivers'),api.bootstrap()
  ];
  const [opsR,timelineR,incidentsR,handoffsR,closureR,seatsR,scannerR,driversR,bootR]=await Promise.allSettled(calls);
  if(opsR.status!=='fulfilled')throw opsR.reason||new Error('تعذر تحميل بيانات الرحلة.');
  return buildReport(tripId,opsR.value,
    timelineR.status==='fulfilled'?timelineR.value:null,
    incidentsR.status==='fulfilled'?incidentsR.value:null,
    handoffsR.status==='fulfilled'?handoffsR.value:null,
    closureR.status==='fulfilled'?closureR.value:null,
    seatsR.status==='fulfilled'?seatsR.value:null,
    scannerR.status==='fulfilled'?scannerR.value:null,
    driversR.status==='fulfilled'?driversR.value:null,
    bootR.status==='fulfilled'?bootR.value:null
  );
}

function buildReport(tripId,ops,timeline,incidents,handoffs,closure,seats,scanner,drivers,boot){
  const trip=ops?.trip||timeline?.trip||{};
  const bookings=(ops?.bookings||[]).filter(active);
  const bookingIds=new Set(bookings.map(b=>text(b.id)));
  const passengers=(ops?.passengers||[]).filter(p=>active(p)&&bookingIds.has(text(p.booking_id)));
  const passengerCountByBooking=new Map();for(const p of passengers){const k=text(p.booking_id);passengerCountByBooking.set(k,(passengerCountByBooking.get(k)||0)+1)}
  const branchMap=new Map((boot?.branches||[]).map(b=>[text(b.id),b]));
  const branchStats=new Map();for(const b of bookings){const k=text(b.branch_id)||'none',x=branchStats.get(k)||{id:k,bookings:0,passengers:0};x.bookings++;x.passengers+=passengerCountByBooking.get(text(b.id))||0;branchStats.set(k,x)}
  const branches=[...branchStats.values()].map(x=>({...x,name:text(branchMap.get(x.id)?.name||branchMap.get(x.id)?.city)||'فرع'})).sort((a,b)=>b.passengers-a.passengers);

  const tripVehicles=(seats?.trip_vehicles||[]).filter(v=>text(v.trip_id)===text(tripId)&&activeTripVehicle(v));
  const vehicleMap=new Map((seats?.vehicles||[]).map(v=>[text(v.id),v]));
  const driverRows=drivers?.drivers||drivers?.rows||[];const driverMap=new Map(driverRows.map(d=>[text(d.id),d]));
  const staffMap=new Map((boot?.users||[]).map(u=>[text(u.id),u]));
  const buses=tripVehicles.map((tv,i)=>{const v=vehicleMap.get(text(tv.vehicle_id));return {label:vehicleLabel(tv,v,i),plate:text(v?.plate_no)||'—',capacity:Number(tv.booking_capacity||tv.capacity||v?.booking_capacity||v?.physical_capacity||0),driver:driverLabel(driverMap.get(text(tv.driver_id)),text(tv.driver_id)),extra_driver:driverLabel(driverMap.get(text(tv.extra_driver_id)),text(tv.extra_driver_id)),supervisor:staffLabel(staffMap.get(text(tv.supervisor_id)),text(tv.supervisor_id)),status:text(tv.status)||'assigned'}});

  const scanEvents=(scanner?.scan_events||[]).filter(ev=>text(ev.trip_id)===text(tripId)&&scanOk(ev));
  const latestScan=new Map();for(const ev of scanEvents){const key=`${text(ev.booking_id)}|${text(ev.scan_mode)}`;const old=latestScan.get(key);if(!old||String(ev.created_at||'')>String(old.created_at||''))latestScan.set(key,ev)}
  const boardingRows=bookings.map(b=>{const mode=bookingScanMode(b,tripId),scan=latestScan.get(`${text(b.id)}|${mode}`),pax=passengerCountByBooking.get(text(b.id))||0;return {booking_number:text(b.booking_number||b.booking_no||b.code||b.id),point:boardingPoint(b,tripId,branchMap),mode,passengers:pax,boarded:!!scan,scanned_at:scan?.created_at||null}});
  const boardingPoints=new Map();for(const r of boardingRows){const x=boardingPoints.get(r.point)||{point:r.point,bookings:0,passengers:0,boarded_bookings:0,boarded_passengers:0,pending_bookings:0};x.bookings++;x.passengers+=r.passengers;if(r.boarded){x.boarded_bookings++;x.boarded_passengers+=r.passengers}else x.pending_bookings++;boardingPoints.set(r.point,x)}
  const points=[...boardingPoints.values()].sort((a,b)=>b.passengers-a.passengers);
  const boardedBookings=boardingRows.filter(r=>r.boarded).length,boardedPassengers=boardingRows.filter(r=>r.boarded).reduce((n,r)=>n+r.passengers,0);

  const events=(timeline?.events||[]).slice().reverse();
  const incidentRows=incidents?.incidents||[];
  const handoffRows=handoffs?.handoffs||[];
  const currentStage=low(timeline?.current_status||trip.operations_status||'scheduled');
  const isFinal=currentStage==='completed'||trip.operational_closed===true;
  return {tripId,trip,bookings,passengers,branches,buses,boardingRows,points,boardedBookings,boardedPassengers,events,incidents:incidentRows,handoffs:handoffRows,closure:closure?.closure||timeline?.closure||null,currentStage,isFinal,availability:{timeline:!!timeline,incidents:!!incidents,handoffs:!!handoffs,seats:!!seats,scanner:!!scanner,drivers:!!drivers,boot:!!boot},generatedAt:new Date().toISOString()};
}

function modalShell(model){
  document.querySelector('.trip360-report-backdrop')?.remove();
  const back=el('div','trip360-report-backdrop'),box=el('section','trip360-report-modal');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const head=el('div','trip360-report-modal-head'),copy=el('div');copy.append(el('strong','',model.isFinal?'تقرير الرحلة النهائي':'مسودة تقرير الرحلة'),el('small','',`${text(model.trip.trip_code)||'رحلة'} · تم التوليد ${fmtDate(model.generatedAt)}`));
  const close=el('button','','×');close.type='button';head.append(copy,close);const body=el('div','trip360-report-body'),foot=el('div','trip360-report-modal-foot');box.append(head,body,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.onclick=destroy;back.onclick=e=>{if(e.target===back)destroy()};
  foot.append(button('إغلاق',destroy),button('طباعة التقرير',()=>printReport(model),true));
  return {body};
}
function stat(label,value,tone=''){const x=el('div',`trip360-report-stat ${tone}`);x.append(el('small','',label),el('strong','',String(value)));return x}
function section(title,subtitle=''){const s=el('section','trip360-report-section'),head=el('div','trip360-report-section-head');head.append(el('strong','',title));if(subtitle)head.append(el('small','',subtitle));s.append(head);return s}
function table(headers,rows){const wrap=el('div','trip360-report-table-wrap'),t=el('table','trip360-report-table'),thead=el('thead'),tr=el('tr');headers.forEach(x=>tr.append(el('th','',x)));thead.append(tr);t.append(thead);const tb=el('tbody');if(rows.length)rows.forEach(r=>{const row=el('tr');r.forEach(c=>row.append(el('td','',c)));tb.append(row)});else{const row=el('tr');const cell=el('td','trip360-report-empty','لا توجد بيانات مسجلة.');cell.colSpan=headers.length;row.append(cell);tb.append(row)}t.append(tb);wrap.append(t);return wrap}
function renderReport(model){
  const {body}=modalShell(model),trip=model.trip;
  const hero=el('div',`trip360-report-hero ${model.isFinal?'final':'draft'}`),heroText=el('div');heroText.append(el('b','',model.isFinal?'تقرير نهائي':'مسودة تشغيلية'),el('strong','',`${text(trip.from_city)||'—'} ← ${text(trip.to_city)||'—'}`),el('small','',`كود الرحلة: ${text(trip.trip_code)||'—'} · التاريخ: ${dateOnly(trip.departure_date)} · المرحلة: ${stageLabels[model.currentStage]||model.currentStage||'—'}`));hero.append(heroText);body.append(hero);
  const stats=el('div','trip360-report-stats');stats.append(stat('الحجوزات',model.bookings.length),stat('الركاب',model.passengers.length),stat('الباصات',model.buses.length),stat('صعود مسجل',model.availability.scanner?`${model.boardedBookings}/${model.bookings.length}`:'—'),stat('مشاكل مفتوحة',model.availability.incidents?model.incidents.filter(x=>x.status==='open').length:'—'),stat('تسليمات مفتوحة',model.availability.handoffs?model.handoffs.filter(x=>x.status!=='closed').length:'—'));body.append(stats);
  const closure=model.closure;if(closure){const c=el('div',`trip360-report-closure ${closure.blocker_count>0?'bad':closure.warning_count>0?'warn':'good'}`,closure.completed?'تم إقفال الرحلة تشغيليًا.':closure.blocker_count>0?`الإقفال موقوف: ${closure.blocker_count} مانع.`:closure.warning_count>0?`الإقفال يحتاج توثيق ${closure.warning_count} تنبيه.`:'بوابة الإقفال لا تحتوي موانع حالية.');body.append(c)}

  const route=section('مسار التشغيل','التوقيت الفعلي والمستخدم الذي سجل كل مرحلة');route.append(table(['المرحلة','التوقيت','المسؤول','الملاحظة'],model.events.map(e=>[e.label||stageLabels[text(e.event_key)]||text(e.event_key)||'حدث',fmtDate(e.actual_at||e.created_at),actorLabel(e),text(e.notes)||'—'])));body.append(route);
  const branches=section('الفروع المشاركة');branches.append(table(['الفرع','الحجوزات','الركاب'],model.branches.map(x=>[x.name,String(x.bookings),String(x.passengers)])));body.append(branches);
  const fleet=section('الباصات والطاقم');fleet.append(table(['الباص','اللوحة','السعة','السائق','إضافي','المشرف'],model.buses.map(x=>[x.label,x.plate,String(x.capacity||'—'),x.driver,x.extra_driver,x.supervisor])));body.append(fleet);
  const boarding=section('الصعود ونقاط التجمع',model.availability.scanner?`سجل صعود ${model.boardedBookings} حجز يشمل ${model.boardedPassengers} راكبًا`:'بيانات QR غير متاحة لهذا الحساب');boarding.append(table(['النقطة','الحجوزات','الركاب','صعد','لم يسجل'],model.points.map(x=>[x.point,String(x.bookings),String(x.passengers),String(x.boarded_bookings),String(x.pending_bookings)])));body.append(boarding);
  const incidents=section('المشاكل التشغيلية');incidents.append(table(['الحالة','الخطورة','العنوان','المسؤول','وقت الفتح'],model.incidents.map(x=>[x.status==='closed'?'مغلقة':'مفتوحة',severityLabels[x.severity]||x.severity||'—',text(x.title)||'—',areaLabels[x.responsible_area]||x.responsible_area||'—',fmtDate(x.created?.created_at)])));body.append(incidents);
  const handoffs=section('التسليم والاستلام');handoffs.append(table(['الحالة','من','إلى','المسلّم','المستلم','بنود مفتوحة'],model.handoffs.map(x=>[x.status==='closed'?'مغلق':x.status==='received'?'تم الاستلام':'بانتظار الاستلام',handoffAreas[x.from_area]||x.from_area||'—',handoffAreas[x.to_area]||x.to_area||'—',actorLabel(x.created),x.received?actorLabel(x.received):'—',text(x.open_items)||'—'])));body.append(handoffs);
  const unavailable=Object.entries(model.availability).filter(([,v])=>!v).map(([k])=>k);if(unavailable.length)body.append(el('div','trip360-report-note','ملاحظة: بعض مصادر البيانات غير متاحة لهذا الحساب، لذلك قد تظهر أقسام ناقصة في هذا التقرير.'));
}

function rowsHtml(headers,rows){return `<table><thead><tr>${headers.map(x=>`<th>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${h(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">لا توجد بيانات مسجلة.</td></tr>`}</tbody></table>`}
function printReport(model){
  const w=window.open('','_blank','noopener,noreferrer');if(!w){alert('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');return}
  const trip=model.trip,closure=model.closure;
  const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${h(model.isFinal?'تقرير الرحلة النهائي':'مسودة تقرير الرحلة')}</title><style>
  @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,"Tahoma",sans-serif;color:#172033;background:#fff;font-size:10px}.page{width:100%}.head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #173f76;padding-bottom:10px;margin-bottom:12px}.brand{display:flex;align-items:center;gap:10px}.brand img{width:54px;height:54px;object-fit:contain}.brand h1{font-size:16px;margin:0;color:#173f76}.brand p{margin:3px 0 0;color:#64748b}.badge{padding:7px 11px;border-radius:999px;font-weight:700;background:${model.isFinal?'#dcfce7':'#fef3c7'};color:${model.isFinal?'#166534':'#92400e'}}.trip{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}.trip div,.stats div{border:1px solid #dbe4ee;border-radius:7px;padding:7px}.trip small,.stats small{display:block;color:#64748b;font-size:8px}.trip b,.stats b{display:block;margin-top:3px;color:#1e3a5f;font-size:10px}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px}.closure{padding:8px 10px;border-radius:7px;margin-bottom:10px;background:${closure?.blocker_count>0?'#fff1f2':closure?.warning_count>0?'#fffbeb':'#ecfdf3'};color:${closure?.blocker_count>0?'#9f1239':closure?.warning_count>0?'#92400e':'#166534'};border:1px solid ${closure?.blocker_count>0?'#fecdd3':closure?.warning_count>0?'#fde68a':'#bbf7d0'}}section{break-inside:avoid;margin:0 0 12px}h2{font-size:11px;color:#173f76;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #dbe4ee}table{width:100%;border-collapse:collapse;font-size:8.4px}th,td{border:1px solid #dbe4ee;padding:5px 6px;text-align:right;vertical-align:top}th{background:#f1f5f9;color:#334155}.empty{text-align:center;color:#64748b}.foot{margin-top:12px;border-top:1px solid #dbe4ee;padding-top:7px;display:flex;justify-content:space-between;color:#64748b;font-size:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><div class="page"><header class="head"><div class="brand"><img src="${h(location.origin+'/almaher-logo.jpeg')}" alt=""><div><h1>الماهر الماسي</h1><p>${h(model.isFinal?'تقرير الرحلة النهائي':'مسودة تقرير الرحلة')}</p></div></div><div class="badge">${h(model.isFinal?'نهائي':'مسودة تشغيلية')}</div></header>
  <div class="trip"><div><small>كود الرحلة</small><b>${h(trip.trip_code||'—')}</b></div><div><small>المسار</small><b>${h(`${text(trip.from_city)||'—'} ← ${text(trip.to_city)||'—'}`)}</b></div><div><small>تاريخ الذهاب</small><b>${h(dateOnly(trip.departure_date))}</b></div><div><small>مرحلة التشغيل</small><b>${h(stageLabels[model.currentStage]||model.currentStage||'—')}</b></div></div>
  <div class="stats"><div><small>الحجوزات</small><b>${model.bookings.length}</b></div><div><small>الركاب</small><b>${model.passengers.length}</b></div><div><small>الباصات</small><b>${model.buses.length}</b></div><div><small>حجوزات صعدت</small><b>${model.availability.scanner?`${model.boardedBookings}/${model.bookings.length}`:'—'}</b></div><div><small>مشاكل مفتوحة</small><b>${model.availability.incidents?model.incidents.filter(x=>x.status==='open').length:'—'}</b></div><div><small>تسليمات مفتوحة</small><b>${model.availability.handoffs?model.handoffs.filter(x=>x.status!=='closed').length:'—'}</b></div></div>
  ${closure?`<div class="closure">${h(closure.completed?'تم إقفال الرحلة تشغيليًا.':closure.blocker_count>0?`الإقفال موقوف: ${closure.blocker_count} مانع.`:closure.warning_count>0?`الإقفال يحتاج توثيق ${closure.warning_count} تنبيه.`:'بوابة الإقفال لا تحتوي موانع حالية.')}</div>`:''}
  <section><h2>مسار التشغيل</h2>${rowsHtml(['المرحلة','التوقيت','المسؤول','الملاحظة'],model.events.map(e=>[e.label||stageLabels[text(e.event_key)]||text(e.event_key)||'حدث',fmtDate(e.actual_at||e.created_at),actorLabel(e),text(e.notes)||'—']))}</section>
  <section><h2>الفروع المشاركة</h2>${rowsHtml(['الفرع','الحجوزات','الركاب'],model.branches.map(x=>[x.name,String(x.bookings),String(x.passengers)]))}</section>
  <section><h2>الباصات والطاقم</h2>${rowsHtml(['الباص','اللوحة','السعة','السائق','إضافي','المشرف'],model.buses.map(x=>[x.label,x.plate,String(x.capacity||'—'),x.driver,x.extra_driver,x.supervisor]))}</section>
  <section><h2>الصعود ونقاط التجمع</h2>${rowsHtml(['النقطة','الحجوزات','الركاب','صعد','لم يسجل'],model.points.map(x=>[x.point,String(x.bookings),String(x.passengers),String(x.boarded_bookings),String(x.pending_bookings)]))}</section>
  <section><h2>المشاكل التشغيلية</h2>${rowsHtml(['الحالة','الخطورة','العنوان','المسؤول','وقت الفتح'],model.incidents.map(x=>[x.status==='closed'?'مغلقة':'مفتوحة',severityLabels[x.severity]||x.severity||'—',text(x.title)||'—',areaLabels[x.responsible_area]||x.responsible_area||'—',fmtDate(x.created?.created_at)]))}</section>
  <section><h2>التسليم والاستلام</h2>${rowsHtml(['الحالة','من','إلى','المسلّم','المستلم','بنود مفتوحة'],model.handoffs.map(x=>[x.status==='closed'?'مغلق':x.status==='received'?'تم الاستلام':'بانتظار الاستلام',handoffAreas[x.from_area]||x.from_area||'—',handoffAreas[x.to_area]||x.to_area||'—',actorLabel(x.created),x.received?actorLabel(x.received):'—',text(x.open_items)||'—']))}</section>
  <footer class="foot"><span>تقرير تشغيلي صادر من نظام الماهر الماسي</span><span>${h(fmtDate(model.generatedAt))}</span></footer></div><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`;
  w.document.open();w.document.write(html);w.document.close();
}

async function openReport(tripId){
  const old=document.querySelector('.trip360-report-backdrop');old?.remove();
  const back=el('div','trip360-report-backdrop'),box=el('section','trip360-report-modal loading'),head=el('div','trip360-report-modal-head'),body=el('div','trip360-report-loading','جاري تجهيز تقرير الرحلة من السجلات الحالية…');head.append(el('strong','','تقرير الرحلة'),el('small','','تجميع مراحل التشغيل والصعود والطاقم والمشاكل والتسليمات'));box.append(head,body);back.append(box);document.body.append(back);
  try{const model=await loadReport(tripId);back.remove();renderReport(model)}catch(e){box.classList.remove('loading');body.className='trip360-report-error';body.textContent=e?.message||'تعذر تجهيز تقرير الرحلة.';const close=button('إغلاق',()=>back.remove());body.append(close)}
}
function sync(){
  const tripId=tripIdFromPath();if(!tripId)return;
  const actions=document.querySelector('.trip360 .trip360-actions');if(!actions)return;
  let launch=actions.querySelector('.trip360-final-report-launch');if(launch)return;
  launch=document.createElement('button');launch.type='button';launch.className='trip360-final-report-launch';launch.textContent='تقرير الرحلة';launch.addEventListener('click',()=>openReport(tripId));actions.append(launch);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installTrip360FinalReport(){
  if(typeof window==='undefined'||typeof document==='undefined')return;queue();
  const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);window.addEventListener('almaher-trip-stage-changed',queue);
}
