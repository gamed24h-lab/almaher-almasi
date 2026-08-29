import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const active=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
let queued=false;
let accessPromise=null;

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return low(value)==='new'?'':value;
}
function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}
function select(){return el('select','booking-360-modal-input')}
function field(label,control,hint=''){const x=el('label','booking-360-modal-field');x.append(el('span','booking-360-modal-label',label),control);if(hint)x.append(el('small','booking-360-modal-hint',hint));return x}
function button(label,onClick,primary=false){const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}
function closeActiveModal(){document.querySelector('.booking-360-modal-backdrop')?.remove();document.body.classList.remove('booking-360-modal-open')}
function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');const dialog=el('section','booking-360-modal booking-360-trip-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head'),wrap=el('div');wrap.append(el('strong','booking-360-modal-title',title));if(subtitle)wrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(wrap,x);const body=el('div','booking-360-modal-body'),notice=el('div','booking-360-modal-notice'),foot=el('div','booking-360-modal-foot');dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};return {body,foot,close:destroy,setNotice};
}
function tripRoute(t){return t?`${text(t.from_city||t.origin)||'—'} ← ${text(t.to_city||t.destination)||'—'}`:'—'}
function tripLabel(t){return t?`${text(t.trip_code)||'رحلة'} · ${tripRoute(t)} · ${text(t.departure_date||t.return_date)||'—'}`:'—'}
function journeyLabel(v){return ({oneway:'ذهاب فقط',roundtrip:'ذهاب وعودة',separate:'ذهاب + عودة من رحلة أخرى',returnonly:'عودة فقط'})[low(v)]||text(v)||'—'}
function uniqueTrips(list){const m=new Map();for(const t of list||[])if(t?.id)m.set(String(t.id),t);return [...m.values()]}
function option(selectNode,value,label){selectNode.append(new Option(label,String(value)))}
function setCenterMessage(center,message,tone=''){const box=center?.querySelector('.booking-360-quick-message');if(!box)return;box.textContent=message||'';box.className=`booking-360-quick-message${tone?` ${tone}`:''}`}

async function access(){
  if(!accessPromise)accessPromise=api.me().then(out=>{const u=out?.user||out||{},p=u?.permissions||{},role=low(u?.role);return {allowed:role==='developer'||text(u?.role)==='مدير عام'||p.all===true||p.changeTrip===true,cross:role==='developer'||text(u?.role)==='مدير عام'||p.all===true||p.crossBranchReturn===true}}).catch(()=>({allowed:false,cross:false}));
  return accessPromise;
}
function currentBooking(raw,bookingNo){return (raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo))||null}
function currentTrip(raw,id){return (raw?.trips||[]).find(t=>text(t?.id)===text(id))||null}

async function openTripModal(center,bookingNo){
  const modal=openModal('تغيير رحلة الحجز',`الحجز ${bookingNo} · نقل تشغيلي محمي مع تحرير الموارد القديمة`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تجهيز الرحلات وفحص المقاعد والتسكين الحالي...'));
  try{
    const perm=await access();if(!perm.allowed)throw new Error('لا توجد صلاحية لتغيير رحلة الحجز.');
    const [raw,seats,housing,cross]=await Promise.all([api.bootstrap(),api.module('seats').catch(()=>null),api.module('housing').catch(()=>null),perm.cross?api.returnTripOptions().catch(()=>({trips:[]})):Promise.resolve({trips:[]})]);
    const booking=currentBooking(raw,bookingNo);if(!booking)throw new Error('الحجز غير موجود.');
    const state=low(booking.status||booking.booking_status);if(['cancelled','canceled','refunded','completed'].includes(state))throw new Error('لا يمكن تغيير رحلة حجز ملغي أو مسترد أو مكتمل.');

    const baseTrips=uniqueTrips(raw?.trips||[]);const returnTrips=uniqueTrips([...baseTrips,...(cross?.trips||[])]);
    const today=new Date().toISOString().slice(0,10);const currentIds=new Set([text(booking.trip_id),text(booking.return_trip_id)].filter(Boolean));
    const usable=t=>currentIds.has(text(t.id))||(!['cancelled','canceled','completed'].includes(low(t.status))&&(!t.departure_date||t.departure_date>=today||t.return_date>=today));
    const primaryTrips=baseTrips.filter(usable);const separateReturns=returnTrips.filter(t=>usable(t)&&!!t.return_date);
    const oldTrip=currentTrip(raw,booking.trip_id);const oldReturn=returnTrips.find(t=>text(t.id)===text(booking.return_trip_id))||null;
    const passengerIds=new Set((raw?.passengers||[]).filter(p=>text(p.booking_id)===text(booking.id)&&active(p.status)).map(p=>text(p.id)));
    const activeSeats=(seats?.seat_assignments||[]).filter(a=>text(a.booking_id)===text(booking.id)&&['assigned','hold','blocked'].includes(low(a.status||'assigned')));
    const activeRooms=(housing?.room_assignments||[]).filter(a=>passengerIds.has(text(a.passenger_id))&&active(a.status||'assigned'));

    modal.body.innerHTML='';
    const current=el('div','booking-360-trip-current');current.append(el('span','booking-360-trip-current-label','المسار الحالي'),el('strong','',`${journeyLabel(booking.journey_mode)} · ${tripRoute(oldTrip)}`));if(oldReturn)current.append(el('small','',`العودة المنفصلة: ${tripRoute(oldReturn)} · ${text(oldReturn.return_date)||'—'}`));
    const stats=el('div','booking-360-trip-stats');[['المسافرون',String(passengerIds.size)],['مقاعد مرتبطة',String(activeSeats.length)],['تسكينات مرتبطة',String(activeRooms.length)],['نسخة الحجز',String(booking.version_no||1)]].forEach(([a,b])=>{const d=el('div');d.append(el('small','',a),el('strong','',b));stats.append(d)});
    const impact=el('div','booking-360-trip-impact');impact.append(el('strong','','تأثير التغيير'),el('span','',`عند تأكيد تغيير الرحلة سيتم تحرير ${activeSeats.length} مقعد و${activeRooms.length} تسكين قديم مرتبط بالحجز.`),el('span','','لن يتم تغيير إجمالي سعر الحجز تلقائيًا. بعد النقل راجع السعر ثم أعد تعيين المقاعد والتسكين حسب الرحلة الجديدة.'));

    const mode=select();[['oneway','ذهاب فقط'],['roundtrip','ذهاب وعودة'],['separate','ذهاب + عودة من رحلة أخرى'],['returnonly','عودة فقط']].forEach(([v,l])=>option(mode,v,l));mode.value=low(booking.journey_mode)||'oneway';
    const trip=select(),ret=select();const retField=field('رحلة العودة المنفصلة',ret,perm.cross?'يمكن اختيار عودة متاحة من فرع آخر إذا كانت صلاحية العودة بين الفروع موجودة.':'تظهر رحلات العودة المتاحة ضمن نطاقك الحالي.');
    const preview=el('div','booking-360-trip-preview');

    function fillPrimary(){const previous=trip.value;trip.innerHTML='';option(trip,'','اختر الرحلة');let list=primaryTrips.filter(t=>mode.value==='returnonly'?!!t.return_date:mode.value==='roundtrip'?!!t.return_date:true);for(const t of list)option(trip,t.id,tripLabel(t));const desired=previous||text(booking.trip_id);if(list.some(t=>text(t.id)===desired))trip.value=desired}
    function fillReturn(){const previous=ret.value;ret.innerHTML='';option(ret,'','اختر رحلة العودة');for(const t of separateReturns.filter(t=>text(t.id)!==text(trip.value)))option(ret,t.id,`${tripLabel(t)} · العودة ${text(t.return_date)||'—'} ${text(t.return_time)||''}`);const desired=previous||text(booking.return_trip_id);if([...ret.options].some(o=>o.value===desired))ret.value=desired}
    function updatePreview(){retField.hidden=mode.value!=='separate';fillReturn();const pt=primaryTrips.find(t=>text(t.id)===text(trip.value)),rt=returnTrips.find(t=>text(t.id)===text(ret.value));preview.innerHTML='';preview.append(el('strong','',`المسار الجديد: ${journeyLabel(mode.value)}`),el('small','',pt?`الرحلة الأساسية: ${tripRoute(pt)} · ${text(pt.departure_date||pt.return_date)||'—'}`:'اختر الرحلة الأساسية'));if(mode.value==='separate')preview.append(el('small','',rt?`العودة: ${tripRoute(rt)} · ${text(rt.return_date)||'—'} ${text(rt.return_time)||''}`:'اختر رحلة العودة المنفصلة'));preview.append(el('small','booking-360-trip-price-note','السعر الحالي سيظل كما هو حتى تراجعه يدويًا.'))}
    mode.addEventListener('change',()=>{fillPrimary();updatePreview()});trip.addEventListener('change',updatePreview);ret.addEventListener('change',updatePreview);fillPrimary();fillReturn();updatePreview();
    modal.body.append(current,stats,impact,field('نوع الرحلة',mode),field(mode.value==='returnonly'?'رحلة العودة':'الرحلة الأساسية / الذهاب',trip),retField,preview);
    mode.addEventListener('change',()=>{const label=modal.body.querySelectorAll('.booking-360-modal-field .booking-360-modal-label')[1];if(label)label.textContent=mode.value==='returnonly'?'رحلة العودة':'الرحلة الأساسية / الذهاب'});

    const back=button('رجوع',modal.close);const save=button('تأكيد تغيير الرحلة',async()=>{
      const tripId=text(trip.value),returnId=mode.value==='separate'?text(ret.value):'';if(!tripId)return modal.setNotice('اختر الرحلة الجديدة.','bad');
      const pt=primaryTrips.find(t=>text(t.id)===tripId),rt=returnTrips.find(t=>text(t.id)===returnId);
      if(['roundtrip','returnonly'].includes(mode.value)&&!pt?.return_date)return modal.setNotice('الرحلة المختارة لا تحتوي على تاريخ عودة.','bad');
      if(mode.value==='separate'&&!returnId)return modal.setNotice('اختر رحلة العودة المنفصلة.','bad');if(mode.value==='separate'&&returnId===tripId)return modal.setNotice('رحلة العودة يجب أن تكون مختلفة عن رحلة الذهاب.','bad');if(mode.value==='separate'&&!rt?.return_date)return modal.setNotice('رحلة العودة المختارة لا تحتوي على تاريخ عودة.','bad');
      const newText=`${journeyLabel(mode.value)} · ${tripRoute(pt)}${mode.value==='separate'?` · عودة ${tripRoute(rt)}`:''}`;
      if(!confirm(`تأكيد نقل الحجز ${bookingNo}؟\n\nالمسار الجديد: ${newText}\nسيتم تحرير ${activeSeats.length} مقعد و${activeRooms.length} تسكين قديم.\nالسعر لن يتغير تلقائيًا ويجب مراجعته بعد النقل.`))return;
      save.disabled=true;back.disabled=true;modal.setNotice('جاري تغيير الرحلة وتحرير الموارد القديمة...','');
      try{
        const out=await api.admin({action:'change_booking_trip',booking_number:bookingNo,journey_mode:mode.value,trip_id:tripId,return_trip_id:returnId||null,version_no:Number(booking.version_no||1)});
        const released=out?.released||{};const msg=out?.unchanged?'الرحلة المختارة هي نفس الرحلة الحالية.':`تم تغيير الرحلة وتحرير ${Number(released.seats||0)} مقعد و${Number(released.housing||0)} تسكين. راجع السعر ثم أعد التسكين والمقاعد.`;modal.setNotice(msg,out?.unchanged?'warn':'good');setCenterMessage(center,msg,out?.unchanged?'warn':'good');if(out?.unchanged){save.disabled=false;back.disabled=false}else setTimeout(()=>modal.close(),1000);
      }catch(e){save.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر تغيير رحلة الحجز.','bad')}
    },true);modal.foot.append(back,save);
  }catch(e){modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تجهيز تغيير الرحلة.'));modal.foot.append(button('إغلاق',modal.close))}
}

async function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;const panel=document.querySelector('.booking-360-overview'),grid=panel?.querySelector('.booking-360-quick-grid');if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.tripChangeReady)return;grid.dataset.tripChangeReady='loading';
  const perm=await access();if(!document.body.contains(grid))return;if(!perm.allowed){grid.dataset.tripChangeReady='blocked';return}
  try{const raw=await api.bootstrap(),booking=currentBooking(raw,bookingNo),state=low(booking?.status||booking?.booking_status);if(!booking||['cancelled','canceled','refunded','completed'].includes(state)){grid.dataset.tripChangeReady='blocked';return}const center=grid.closest('.booking-360-quick-center'),b=el('button','booking-360-quick-button trip','تغيير الرحلة');b.type='button';b.addEventListener('click',()=>openTripModal(center,bookingNo));grid.append(b);grid.dataset.tripChangeReady='1'}catch{grid.dataset.tripChangeReady='blocked'}
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installBooking360TripChange(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue)}
