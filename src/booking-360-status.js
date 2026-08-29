import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
let queued=false;
let accessPromise=null;

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

function statusLabel(v){
  return ({new:'جديد',confirmed:'مؤكد',pending:'قيد المراجعة',cancelled:'ملغي',canceled:'ملغي',refunded:'مسترد',completed:'مكتمل'})[low(v)]||text(v)||'—';
}

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-status-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const wrap=el('div');wrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)wrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(wrap,x);
  const body=el('div','booking-360-modal-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);
  document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function button(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b;
}

function setCenterMessage(center,message,tone=''){
  const box=center?.querySelector('.booking-360-quick-message');
  if(!box)return;
  box.textContent=message||'';box.className=`booking-360-quick-message${tone?` ${tone}`:''}`;
}

async function canChangeStatus(){
  if(!accessPromise)accessPromise=api.me().then(out=>{
    const u=out?.user||out||{};const p=u?.permissions||{};const role=low(u?.role);
    return role==='developer'||text(u?.role)==='مدير عام'||p.all===true||p.editBookings===true||p.manageBookings===true;
  }).catch(()=>false);
  return accessPromise;
}

async function currentBooking(bookingNo){
  const raw=await api.bootstrap();
  return (raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo))||null;
}

async function openStatusModal(center,bookingNo){
  const modal=openModal('تغيير حالة الحجز',`الحجز ${bookingNo} · تغيير إداري آمن مع تسجيل الحركة`);
  modal.body.append(el('div','booking-360-modal-loading','جاري قراءة الحالة الحالية...'));
  try{
    const booking=await currentBooking(bookingNo);
    if(!booking)throw new Error('الحجز غير موجود.');
    const current=low(booking.status||booking.booking_status);
    if(['cancelled','canceled','refunded'].includes(current))throw new Error('الحجز الملغي أو المسترد لا تتغير حالته من هنا.');
    if(current==='completed')throw new Error('الحجز المكتمل لا يُعاد لحالة تشغيلية من هذا المسار.');

    modal.body.innerHTML='';
    const currentBox=el('div','booking-360-status-current');
    currentBox.append(el('span','','الحالة الحالية'),el('strong','',statusLabel(current)));
    const select=el('select','booking-360-modal-input');
    select.append(new Option('جديد','new'),new Option('مؤكد','confirmed'));
    select.value=current==='new'?'confirmed':'confirmed';
    if(current==='confirmed')select.value='new';
    const field=el('label','booking-360-modal-field');
    field.append(el('span','booking-360-modal-label','الحالة الجديدة'),select,el('small','booking-360-modal-hint','الإلغاء والاسترداد لا يتمان من تغيير الحالة؛ لهما مسارات منفصلة ومحميّة.'));
    modal.body.append(currentBox,field);

    const back=button('رجوع',modal.close);
    const save=button('تأكيد تغيير الحالة',async()=>{
      const next=select.value;
      if(next===current)return modal.setNotice('الحالة المختارة هي نفس الحالة الحالية.','warn');
      if(!confirm(`تأكيد تغيير حالة الحجز ${bookingNo} من «${statusLabel(current)}» إلى «${statusLabel(next)}»؟`))return;
      save.disabled=true;back.disabled=true;modal.setNotice('جاري تغيير حالة الحجز...','');
      try{
        const out=await api.admin({action:'set_booking_status',booking_number:bookingNo,status:next});
        const message=out?.unchanged?`الحجز بالفعل ${statusLabel(next)}.`:`تم تغيير حالة الحجز إلى «${statusLabel(next)}» بنجاح.`;
        modal.setNotice(message,'good');setCenterMessage(center,message,'good');
        setTimeout(()=>modal.close(),900);
      }catch(e){save.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر تغيير حالة الحجز.','bad')}
    },true);
    modal.foot.append(back,save);
  }catch(e){
    modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر قراءة حالة الحجز.'));modal.foot.append(button('إغلاق',modal.close));
  }
}

async function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.statusActionReady)return;
  grid.dataset.statusActionReady='loading';
  const allowed=await canChangeStatus();
  if(!document.body.contains(grid))return;
  if(!allowed){grid.dataset.statusActionReady='blocked';return}
  try{
    const booking=await currentBooking(bookingNo);const current=low(booking?.status||booking?.booking_status);
    if(!booking||['cancelled','canceled','refunded','completed'].includes(current)){grid.dataset.statusActionReady='blocked';return}
    const center=grid.closest('.booking-360-quick-center');
    const label=current==='new'?'تأكيد الحجز':current==='confirmed'?'إرجاع لجديد':'تغيير الحالة';
    const b=el('button','booking-360-quick-button status',label);b.type='button';
    b.addEventListener('click',()=>openStatusModal(center,bookingNo));grid.append(b);grid.dataset.statusActionReady='1';
  }catch{grid.dataset.statusActionReady='blocked'}
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360Status(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
