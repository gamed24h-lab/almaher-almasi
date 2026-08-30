import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const active=v=>!['cancelled','canceled','released','inactive','deleted','refunded'].includes(low(v?.status??v));
const scanOk=x=>low(x?.result||x?.metadata?.scan_result||'success')==='success';
let queued=false;
let currentTrip='';

function tripIdFromPath(){
  const m=window.location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);
  return m?decodeURIComponent(m[1]):'';
}
function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}
function roleElevated(user){return !!user&&(low(user.role)==='developer'||text(user.role)==='مدير عام'||user.permissions?.all===true)}
function canAssignFleet(user){return roleElevated(user)||user?.permissions?.assignFleet===true||user?.permissions?.fleet===true||user?.permissions?.vehicles===true}
function activeTripVehicle(v){return !['cancelled','released','inactive'].includes(low(v?.status||'assigned'))}
function dateTimeLabel(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA')}catch{return text(v)||'—'}}
function vehicleLabel(tv,vehicle,index=0){return text(tv?.bus_label||tv?.label||vehicle?.code||vehicle?.name||vehicle?.plate_no)||`باص ${index+1}`}
function driverLabel(d){return d?`${text(d.name)||'سائق'}${text(d.phone)?` — ${text(d.phone)}`:''}`:'—'}
function staffLabel(u){return u?`${text(u.name)||text(u.username)||'موظف'}${text(u.role)?` — ${text(u.role)}`:''}`:'—'}
function bookingSegment(b,tripId){const mode=low(b?.journey_mode||b?.snapshot?.journeyMode);if(mode==='returnonly')return 'return';if(text(b?.return_trip_id||b?.snapshot?.returnTripId)===text(tripId)&&text(b?.trip_id||b?.snapshot?.tripId)!==text(tripId))return 'return';return 'outbound'}
function bookingScanMode(b,tripId){return bookingSegment(b,tripId)==='return'?'return_boarding':'outbound_boarding'}
function boardingPoint(b,branchMap){const snap=b?.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};const point=text(bookingSegment(b,currentTrip)==='return'?(snap.returnBoardingPoint||b?.return_boarding_point):(snap.boardingPoint||b?.boarding_point));if(point)return point;const branch=branchMap.get(text(b?.branch_id));return text(branch?.name||branch?.city)||'غير محدد'}
function departurePassed(trip){const date=text(trip?.departure_date),time=text(trip?.departure_time)||'00:00';if(!date)return false;const d=new Date(`${date}T${time.length===5?`${time}:00`:time}`);return Number.isFinite(d.getTime())&&Date.now()>=d.getTime()}

async function loadContext(tripId){
  const [ops,seats,scanner,drivers,boot,me]=await Promise.all([
    api.admin({action:'trip_operational_data',trip_id:tripId}),
    api.module('seats').catch(()=>null),
    api.module('scanner').catch(()=>null),
    api.module('drivers').catch(()=>null),
    api.bootstrap().catch(()=>null),
    api.me().catch(()=>null)
  ]);
  const user=me?.user||me||null;
  const bookings=(ops?.bookings||[]).filter(active);
  const bookingIds=new Set(bookings.map(b=>text(b.id)));
  const passengers=(ops?.passengers||[]).filter(p=>active(p)&&bookingIds.has(text(p.booking_id)));
  const tripVehicles=(seats?.trip_vehicles||[]).filter(v=>text(v.trip_id)===text(tripId)&&activeTripVehicle(v));
  const vehicleMap=new Map((seats?.vehicles||[]).map(v=>[text(v.id),v]));
  const driverRows=drivers?.drivers||drivers?.rows||[];
  const driverMap=new Map(driverRows.map(d=>[text(d.id),d]));
  const staffRows=(boot?.users||[]).filter(u=>!['inactive','موقوف'].includes(low(u?.status)));
  const staffMap=new Map(staffRows.map(u=>[text(u.id),u]));
  const branchMap=new Map((boot?.branches||[]).map(b=>[text(b.id),b]));
  const scanEvents=(scanner?.scan_events||[]).filter(ev=>text(ev.trip_id)===text(tripId)&&scanOk(ev));
  const latestScan=new Map();
  for(const ev of scanEvents){const key=`${text(ev.booking_id)}|${text(ev.scan_mode)}`;const old=latestScan.get(key);if(!old||String(ev.created_at||'')>String(old.created_at||''))latestScan.set(key,ev)}
  const passengerCountByBooking=new Map();for(const p of passengers){const k=text(p.booking_id);passengerCountByBooking.set(k,(passengerCountByBooking.get(k)||0)+1)}
  const rows=bookings.map(b=>{const mode=bookingScanMode(b,tripId),scan=latestScan.get(`${text(b.id)}|${mode}`),point=boardingPoint(b,branchMap);return {booking:b,mode,scan,point,passengers:passengerCountByBooking.get(text(b.id))||0,boarded:!!scan}});
  const pointMap=new Map();for(const r of rows){const key=r.point||'غير محدد',x=pointMap.get(key)||{point:key,bookings:0,passengers:0,boarded:0,pending:0};x.bookings++;x.passengers+=r.passengers;if(r.boarded)x.boarded++;else x.pending++;pointMap.set(key,x)}
  const usedVehicleIds=new Set(tripVehicles.map(v=>text(v.vehicle_id)));
  const swapCandidates=(seats?.vehicles||[]).filter(v=>!usedVehicleIds.has(text(v.id))&&!['maintenance','out_of_service','inactive'].includes(low(v.status)));
  return {ops,seats,scanner,scannerAvailable:!!scanner,drivers:driverRows,boot,user,bookings,passengers,tripVehicles,vehicleMap,driverMap,staffRows,staffMap,branchMap,rows,points:[...pointMap.values()].sort((a,b)=>b.passengers-a.passengers),swapCandidates,departed:departurePassed(ops?.trip)};
}

function modal(title,subtitle=''){
  document.querySelector('.trip360-ops-backdrop')?.remove();
  const back=el('div','trip360-ops-backdrop'),box=el('section','trip360-ops-modal');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const head=el('div','trip360-ops-modal-head'),copy=el('div');copy.append(el('strong','',title));if(subtitle)copy.append(el('small','',subtitle));const close=el('button','','×');close.type='button';head.append(copy,close);
  const body=el('div','trip360-ops-modal-body'),notice=el('div','trip360-ops-modal-notice'),foot=el('div','trip360-ops-modal-foot');box.append(head,body,notice,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.addEventListener('click',destroy);back.addEventListener('click',e=>{if(e.target===back)destroy()});
  const setNotice=(m,tone='')=>{notice.textContent=m||'';notice.className=`trip360-ops-modal-notice ${tone}`.trim()};return {body,foot,close:destroy,setNotice};
}
function field(label,input){const w=el('label','trip360-ops-field');w.append(el('span','',label),input);return w}
function selectInput(){return el('select','trip360-ops-input')}
function actionButton(label,onClick,primary=false){const b=el('button',`trip360-ops-btn${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}

async function openCrewEditor(ctx,tv,refresh){
  const vehicle=ctx.vehicleMap.get(text(tv.vehicle_id));const m=modal('تعديل طاقم الباص',`${vehicleLabel(tv,vehicle)}${vehicle?.plate_no?` · ${vehicle.plate_no}`:''}`);
  const driver=selectInput(),extra=selectInput(),supervisor=selectInput();driver.append(new Option('بدون سائق',''));extra.append(new Option('بدون سائق إضافي',''));supervisor.append(new Option('بدون مشرف',''));
  ctx.drivers.filter(d=>low(d.status)!=='inactive').forEach(d=>{driver.append(new Option(driverLabel(d),text(d.id)));extra.append(new Option(driverLabel(d),text(d.id)))});
  const supervisors=ctx.staffRows.filter(u=>/مشرف|مدير/.test(text(u.role))||u?.permissions?.operations===true||u?.permissions?.all===true);
  supervisors.forEach(u=>supervisor.append(new Option(staffLabel(u),text(u.id))));
  for(const [sel,value,label] of [[driver,text(tv.driver_id),'السائق الحالي'],[extra,text(tv.extra_driver_id),'السائق الإضافي الحالي'],[supervisor,text(tv.supervisor_id),'المشرف الحالي']]){if(value&&![...sel.options].some(o=>o.value===value))sel.append(new Option(`${label} — ${value}`,value));sel.value=value}
  m.body.append(field('السائق الأساسي',driver),field('السائق الإضافي',extra),field('مشرف الرحلة / الباص',supervisor));
  const cancel=actionButton('إلغاء',m.close),save=actionButton('حفظ الطاقم',async()=>{
    if(driver.value&&extra.value&&driver.value===extra.value)return m.setNotice('لا يمكن اختيار نفس السائق كأساسي وإضافي.','bad');
    const conflict=ctx.tripVehicles.find(x=>text(x.id)!==text(tv.id)&&[driver.value,extra.value].filter(Boolean).some(d=>text(x.driver_id)===d||text(x.extra_driver_id)===d));
    if(conflict)return m.setNotice('أحد السائقين المختارين معيّن بالفعل على باص آخر في نفس الرحلة.','bad');
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري حفظ الطاقم...');
    try{await api.moduleWrite({action:'update',table:'trip_vehicles',id:tv.id,row:{driver_id:driver.value||null,extra_driver_id:extra.value||null,supervisor_id:supervisor.value||null}});m.setNotice('تم تحديث الطاقم بنجاح.','good');setTimeout(()=>{m.close();refresh()},500)}catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر تحديث الطاقم.','bad')}
  },true);m.foot.append(cancel,save);
}

async function openBusSwap(ctx,tv,refresh){
  const current=ctx.vehicleMap.get(text(tv.vehicle_id));const m=modal('تبديل الباص',`الحالي: ${vehicleLabel(tv,current)}${current?.plate_no?` · ${current.plate_no}`:''}`),sel=selectInput();sel.append(new Option('اختر الباص البديل',''));
  ctx.swapCandidates.forEach(v=>sel.append(new Option(`${text(v.code||v.name)||'باص'}${v.plate_no?` — ${v.plate_no}`:''} · سعة ${Number(v.booking_capacity||v.physical_capacity||0)}`,text(v.id))));m.body.append(field('الباص البديل',sel));
  if(!ctx.swapCandidates.length)m.setNotice('لا يوجد باص بديل متاح في نطاقك حاليًا.','warn');
  const cancel=actionButton('إلغاء',m.close),save=actionButton('تبديل آمن',async()=>{if(!sel.value)return m.setNotice('اختر الباص البديل أولًا.','bad');if(!confirm('سيتم تنفيذ تبديل الباص عبر مسار التبديل الآمن مع الحفاظ على تكامل المقاعد. متابعة؟'))return;save.disabled=true;cancel.disabled=true;m.setNotice('جاري تبديل الباص...');try{await api.mega('bus_swap',{trip_vehicle_id:tv.id,new_vehicle_id:sel.value});m.setNotice('تم تبديل الباص بنجاح.','good');setTimeout(()=>{m.close();refresh()},600)}catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر تبديل الباص.','bad')}},true);save.disabled=!ctx.swapCandidates.length;m.foot.append(cancel,save);
}

function stat(label,value,tone=''){const x=el('div',`trip360-ops-stat ${tone}`.trim());x.append(el('small','',label),el('strong','',String(value)));return x}
function nav(path){window.location.assign(path)}

function renderPanel(host,ctx,tripId){
  host.innerHTML='';const canAssign=canAssignFleet(ctx.user),driverMissing=ctx.tripVehicles.filter(v=>!text(v.driver_id)).length,supervisorMissing=ctx.tripVehicles.filter(v=>!text(v.supervisor_id)).length,boarded=ctx.scannerAvailable?ctx.rows.filter(r=>r.boarded).length:null,pending=ctx.scannerAvailable?ctx.rows.length-boarded:null;
  const head=el('div','trip360-ops-head'),copy=el('div');copy.append(el('strong','','التشغيل المباشر'),el('small','',`إدارة الطاقم ومتابعة نقاط التجمع والصعود للرحلة ${text(ctx.ops?.trip?.trip_code)||''}`));const refresh=actionButton('تحديث',()=>refreshPanel(host,tripId));head.append(copy,refresh);host.append(head);
  const stats=el('div','trip360-ops-stats');stats.append(stat('الباصات',ctx.tripVehicles.length,ctx.tripVehicles.length?'good':'bad'),stat('بدون سائق',driverMissing,driverMissing?'bad':'good'),stat('صعد',boarded===null?'—':boarded,boarded?'good':''),stat(ctx.departed?'متأخر / لم يصعد':'لم يسجل صعود',pending===null?'—':pending,pending&&ctx.departed?'bad':pending?'warn':'good'));host.append(stats);
  const notices=el('div','trip360-ops-notices');if(!ctx.tripVehicles.length&&ctx.passengers.length)notices.append(el('div','bad','لا يوجد باص مسند للرحلة حتى الآن.'));if(driverMissing)notices.append(el('div','bad',`يوجد ${driverMissing} باص بدون سائق أساسي.`));if(supervisorMissing&&ctx.tripVehicles.length)notices.append(el('div','warn',`يوجد ${supervisorMissing} باص بدون مشرف محدد.`));if(ctx.scannerAvailable&&ctx.departed&&pending)notices.append(el('div','bad',`موعد التحرك بدأ ويوجد ${pending} حجز لم يسجل صعوده.`));if(!ctx.scannerAvailable)notices.append(el('div','warn','بيانات QR غير متاحة لهذا الحساب؛ لم يتم احتساب الصعود أو التأخير.'));if(notices.children.length)host.append(notices);
  const tools=el('div','trip360-ops-tools');tools.append(actionButton('فتح QR والصعود',()=>nav(`/scanner?trip=${encodeURIComponent(tripId)}`),true),actionButton('كشف التشغيل',()=>nav(`/operations?trip=${encodeURIComponent(tripId)}`)),actionButton('الأسطول الكامل',()=>nav('/fleet')));host.append(tools);
  const grid=el('div','trip360-ops-grid');
  const crew=el('section','trip360-ops-card'),crewHead=el('div','trip360-ops-card-head');crewHead.append(el('div','','الباصات والطاقم'),el('small','',canAssign?'يمكن تعديل السائق والمشرف من هنا.':'عرض فقط حسب صلاحياتك.'));crew.append(crewHead);
  if(!ctx.tripVehicles.length)crew.append(el('div','trip360-ops-empty','لا يوجد باص مربوط بالرحلة.'));
  else for(const [i,tv] of ctx.tripVehicles.entries()){
    const vehicle=ctx.vehicleMap.get(text(tv.vehicle_id)),row=el('div','trip360-ops-crew-row'),info=el('div','trip360-ops-crew-info');
    info.append(el('strong','',`${vehicleLabel(tv,vehicle,i)}${vehicle?.plate_no?` · ${vehicle.plate_no}`:''}`),el('small','',`السائق: ${driverLabel(ctx.driverMap.get(text(tv.driver_id)))}`),el('small','',`الإضافي: ${driverLabel(ctx.driverMap.get(text(tv.extra_driver_id)))}`),el('small','',`المشرف: ${staffLabel(ctx.staffMap.get(text(tv.supervisor_id)))}`));row.append(info);
    const actions=el('div','trip360-ops-row-actions');if(canAssign){actions.append(actionButton('الطاقم',()=>openCrewEditor(ctx,tv,()=>refreshPanel(host,tripId))),actionButton('تبديل الباص',()=>openBusSwap(ctx,tv,()=>refreshPanel(host,tripId))))}else actions.append(el('span','trip360-ops-readonly','عرض فقط'));row.append(actions);crew.append(row)
  }
  const boarding=el('section','trip360-ops-card'),boardingHead=el('div','trip360-ops-card-head');boardingHead.append(el('div','','الصعود والمتأخرون'),el('small','',ctx.scannerAvailable?(ctx.departed?'بعد موعد التحرك: غير المسجلين يظهرون كمتأخرين.':'قبل موعد التحرك: نتابع حالة المسح فقط.'):'لا توجد صلاحية/بيانات QR متاحة.'));boarding.append(boardingHead);
  if(!ctx.rows.length)boarding.append(el('div','trip360-ops-empty','لا توجد حجوزات نشطة على الرحلة.'));
  else{const list=el('div','trip360-ops-boarding-list');for(const r of ctx.rows){const b=r.booking,row=el('button',`trip360-ops-booking ${ctx.scannerAvailable?(r.boarded?'good':ctx.departed?'bad':'warn'):'muted'}`);row.type='button';row.addEventListener('click',()=>nav(`/bookings/${encodeURIComponent(b.booking_number||b.id)}`));const top=el('div');top.append(el('strong','',b.booking_number||'حجز'),el('span','',r.boarded?'تم الصعود':ctx.scannerAvailable?(ctx.departed?'متأخر / لم يصعد':'لم يسجل صعود'):'غير متاح'));row.append(top,el('small','',`${text(b.customer_name)||'عميل'} · ${r.passengers} مسافر · ${r.point}`),el('small','',r.scan?`آخر مسح: ${dateTimeLabel(r.scan.created_at)}`:`${r.mode==='return_boarding'?'عودة':'ذهاب'} · بدون مسح ناجح`));list.append(row)}boarding.append(list)}
  grid.append(crew,boarding);host.append(grid);
  const points=el('section','trip360-ops-card trip360-ops-points'),pointsHead=el('div','trip360-ops-card-head');pointsHead.append(el('div','','نقاط التجمع'),el('small','','تجميع تلقائي من بيانات الحجوزات النشطة'));points.append(pointsHead);
  if(!ctx.points.length)points.append(el('div','trip360-ops-empty','لا توجد نقاط تجمع مسجلة.'));else{const pg=el('div','trip360-ops-point-grid');for(const p of ctx.points){const c=el('div','trip360-ops-point');c.append(el('strong','',p.point),el('span','',`${p.bookings} حجز · ${p.passengers} مسافر`),el('small','',ctx.scannerAvailable?`صعد ${p.boarded} · متبقي ${p.pending}`:'حالة الصعود غير متاحة'));pg.append(c)}points.append(pg)}host.append(points);
}

async function refreshPanel(host,tripId){host.classList.add('loading');host.innerHTML='<div class="trip360-ops-loading">جاري تحديث التشغيل المباشر...</div>';try{const ctx=await loadContext(tripId);if(currentTrip!==tripId)return;renderPanel(host,ctx,tripId)}catch(e){host.innerHTML='';const box=el('div','trip360-ops-error',e?.message||'تعذر تحميل التشغيل المباشر.');const retry=actionButton('إعادة المحاولة',()=>refreshPanel(host,tripId));host.append(box,retry)}finally{host.classList.remove('loading')}}

function sync(){
  const tripId=tripIdFromPath();if(!tripId){currentTrip='';document.querySelector('.trip360-liveops')?.remove();return}
  const root=document.querySelector('.trip360'),tabs=root?.querySelector('.trip360-tabs');if(!root||!tabs)return;
  let host=root.querySelector('.trip360-liveops');if(host&&host.dataset.trip===tripId)return;
  host?.remove();host=el('section','trip360-liveops');host.dataset.trip=tripId;tabs.insertAdjacentElement('afterend',host);currentTrip=tripId;refreshPanel(host,tripId);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installTrip360LiveOperations(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue)}
