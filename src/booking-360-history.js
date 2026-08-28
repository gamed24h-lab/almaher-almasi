import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
let queued=false;

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return value.toLowerCase()==='new'?'':value;
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
  const dialog=el('section','booking-360-modal booking-360-history-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const wrap=el('div');
  wrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)wrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const close=el('button','booking-360-modal-close','×');close.type='button';
  head.append(wrap,close);
  const body=el('div','booking-360-modal-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);
  document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  close.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function modalButton(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b;
}

function dateTime(value){
  if(!value)return '—';
  const d=new Date(value);if(Number.isNaN(d.getTime()))return text(value)||'—';
  try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(d)}catch{return d.toLocaleString('ar-SA')}
}

function actorLabel(event){
  const name=text(event?.actor_name)||'النظام';
  const role=text(event?.actor_role);
  return role?`${name} · ${role}`:name;
}

function changeRow(change){
  const row=el('div','booking-360-history-change');
  const label=el('strong','',text(change?.label)||text(change?.field)||'بيان');
  const values=el('div','booking-360-history-values');
  const before=el('span','booking-360-history-before',change?.before===null||change?.before===undefined||change?.before===''?'—':text(change.before));
  const arrow=el('b','booking-360-history-arrow','←');
  const after=el('span','booking-360-history-after',change?.after===null||change?.after===undefined||change?.after===''?'—':text(change.after));
  values.append(after,arrow,before);row.append(label,values);return row;
}

function eventCard(event,index){
  const card=el('article','booking-360-history-event');
  const marker=el('div','booking-360-history-marker',String(index+1));
  const content=el('div','booking-360-history-content');
  const head=el('div','booking-360-history-event-head');
  const titleWrap=el('div');
  titleWrap.append(el('strong','booking-360-history-title',text(event?.title||event?.action)||'نشاط على الحجز'),el('small','booking-360-history-actor',actorLabel(event)));
  head.append(titleWrap,el('time','booking-360-history-time',dateTime(event?.created_at)));
  content.append(head);
  const changes=Array.isArray(event?.changes)?event.changes:[];
  if(changes.length){
    const details=el('details','booking-360-history-details');
    const summary=el('summary','',`عرض ${changes.length} ${changes.length===1?'تغيير':'تغييرات'}`);
    const list=el('div','booking-360-history-changes');changes.forEach(c=>list.append(changeRow(c)));
    details.append(summary,list);content.append(details);
  }
  card.append(marker,content);return card;
}

function renderTimeline(modal,data){
  modal.body.innerHTML='';
  const summary=el('div','booking-360-history-summary');
  summary.append(
    (()=>{const x=el('div');x.append(el('small','','العميل'),el('strong','',text(data?.booking?.customer_name)||'—'));return x})(),
    (()=>{const x=el('div');x.append(el('small','','عدد الحركات'),el('strong','',String(Number(data?.count||0))));return x})(),
    (()=>{const x=el('div');x.append(el('small','','حالة السجل'),el('strong','',data?.audit_available===false?'جزئي':'متاح'));return x})()
  );
  modal.body.append(summary);
  const events=[...(Array.isArray(data?.events)?data.events:[])].sort((a,b)=>String(b?.created_at||'').localeCompare(String(a?.created_at||'')));
  if(!events.length){modal.body.append(el('div','booking-360-modal-empty','لا توجد حركات مسجلة على هذا الحجز حتى الآن.'));return}
  const list=el('div','booking-360-history-list');
  events.slice(0,50).forEach((event,index)=>list.append(eventCard(event,index)));
  modal.body.append(list);
  if(events.length>50)modal.body.append(el('div','booking-360-history-note',`يتم عرض أحدث 50 حركة من أصل ${events.length}.`));
}

async function loadTimeline(modal,bookingNo,refreshButton){
  refreshButton.disabled=true;modal.setNotice('جاري تحميل سجل الحجز...','');
  modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-loading','جاري قراءة سجل النشاط والتعديلات...'));
  try{
    const data=await api.bookingTimeline(bookingNo);
    renderTimeline(modal,data);modal.setNotice(data?.audit_available===false?'السجل متاح جزئيًا لأن مصدر التدقيق لم يُقرأ بالكامل.':'تم تحديث سجل الحجز.','good');
  }catch(e){
    modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل سجل الحجز.'));modal.setNotice('تعذر تحديث السجل.','bad');
  }finally{refreshButton.disabled=false}
}

function openHistoryModal(bookingNo){
  const modal=openModal('سجل الحجز',`الحجز ${bookingNo} · أحدث التعديلات والحركات من Booking 360`);
  const close=modalButton('إغلاق',modal.close);
  const refresh=modalButton('تحديث السجل',()=>loadTimeline(modal,bookingNo,refresh),true);
  modal.foot.append(close,refresh);loadTimeline(modal,bookingNo,refresh);
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.historyActionReady==='1')return;
  grid.dataset.historyActionReady='1';
  const b=el('button','booking-360-quick-button history','سجل الحجز');b.type='button';
  b.addEventListener('click',()=>openHistoryModal(bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360History(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
