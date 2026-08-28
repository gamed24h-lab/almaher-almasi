import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
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
  const value=booking?{tripId:text(booking.trip_id),status:low(booking.status)}:{tripId:'',status:''};
  metaCache.set(bookingNo,{at:Date.now(),value});
  return value;
}

function refreshOverview(){
  const refresh=[...document.querySelectorAll('.booking-360-action')].find(b=>text(b.textContent).includes('تحديث Booking 360'));
  refresh?.click?.();
}

function quickButton(label,onClick,options={}){
  const b=el('button',`booking-360-quick-button${options.primary?' primary':''}`,label);
  b.type='button';
  if(options.disabled){b.disabled=true;b.title=options.title||''}
  b.addEventListener('click',onClick);
  return b;
}

async function enhancePanel(panel,bookingNo){
  if(panel.dataset.quickActionsReady==='1')return;
  panel.dataset.quickActionsReady='1';

  const center=el('section','booking-360-quick-center');
  const head=el('div','booking-360-quick-head');
  const title=el('div');
  title.append(el('strong','booking-360-quick-title','مركز الإجراءات السريعة'),el('small','booking-360-quick-subtitle','افتح جزء التعديل المطلوب أو نفّذ الحالة والحفظ من أعلى الحجز.'));
  head.append(title);

  const grid=el('div','booking-360-quick-grid');
  grid.append(
    quickButton('تحصيل دفعة',()=>focusEditorArea(center,['الدفعات الحالية','إجمالي التحصيل التاريخي']),{primary:true}),
    quickButton('تعديل المقاعد',()=>focusEditorArea(center,['مقاعد الذهاب','مقاعد العودة','المقاعد الاختيارية','المقاعد'])),
    quickButton('تعديل السكن',()=>focusEditorArea(center,['نوع السكن','الفندق'])),
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
