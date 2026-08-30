import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
let queued=false;

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

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-notes-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const copy=el('div');copy.append(el('strong','booking-360-modal-title',title));if(subtitle)copy.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(copy,x);
  const body=el('div','booking-360-modal-body booking-360-notes-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function modalButton(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b;
}

function categoryLabel(v){
  return ({operations:'تشغيل',finance:'مالية',customer:'العميل',housing:'تسكين',seats:'مقاعد',other:'أخرى'})[low(v)]||text(v)||'تشغيل';
}

function dateLabel(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('ar-SA')}catch{return text(v)||'—'}
}

function render(modal,data,bookingNo){
  modal.body.innerHTML='';
  const notes=Array.isArray(data?.notes)?data.notes:[];
  const head=el('div','booking-360-notes-summary');
  head.append(el('strong','',`${notes.length} ملاحظة داخلية`),el('small','','داخلية للموظفين فقط ولا تظهر للعميل.'));
  modal.body.append(head);

  const list=el('div','booking-360-notes-list');
  if(!notes.length)list.append(el('div','booking-360-modal-empty','لا توجد ملاحظات داخلية على هذا الحجز حتى الآن.'));
  notes.forEach(n=>{
    const item=el('article',`booking-360-note-item${low(n.priority)==='important'?' important':''}`);
    const top=el('div','booking-360-note-top');
    const tags=el('div','booking-360-note-tags');
    tags.append(el('span','booking-360-note-category',categoryLabel(n.category)));
    if(low(n.priority)==='important')tags.append(el('span','booking-360-note-priority','مهمة'));
    top.append(tags,el('time','',dateLabel(n.created_at)));
    const copy=el('div','booking-360-note-copy',text(n.note));
    const meta=el('div','booking-360-note-meta',`${text(n.actor_name)||'موظف'}${text(n.actor_role)?` · ${text(n.actor_role)}`:''}`);
    item.append(top,copy,meta);list.append(item);
  });
  modal.body.append(list);

  if(data?.can_write){
    const form=el('section','booking-360-notes-add');
    form.append(el('strong','booking-360-notes-add-title','إضافة ملاحظة'));
    const textarea=el('textarea','booking-360-modal-input booking-360-notes-text');textarea.maxLength=2000;textarea.placeholder='اكتب ملاحظة داخلية عن الحجز...';
    const controls=el('div','booking-360-notes-controls');
    const category=el('select','booking-360-modal-input');[['operations','تشغيل'],['finance','مالية'],['customer','العميل'],['housing','تسكين'],['seats','مقاعد'],['other','أخرى']].forEach(([v,l])=>category.append(new Option(l,v)));
    const priority=el('select','booking-360-modal-input');priority.append(new Option('عادية','normal'),new Option('مهمة','important'));
    controls.append(category,priority);form.append(textarea,controls);
    const add=modalButton('حفظ الملاحظة',async()=>{
      const note=text(textarea.value);
      if(!note)return modal.setNotice('اكتب الملاحظة أولًا.','bad');
      add.disabled=true;modal.setNotice('جاري حفظ الملاحظة...','');
      try{
        await api.admin({action:'booking_internal_note_add',booking_number:bookingNo,note,category:category.value,priority:priority.value});
        modal.setNotice('تم حفظ الملاحظة الداخلية.','good');
        const fresh=await api.admin({action:'booking_internal_notes',booking_number:bookingNo});
        render(modal,fresh,bookingNo);
      }catch(e){add.disabled=false;modal.setNotice(e?.message||'تعذر حفظ الملاحظة.','bad')}
    },true);
    form.append(add);modal.body.append(form);
  }
}

async function openNotes(bookingNo){
  const modal=openModal('الملاحظات الداخلية',`الحجز ${bookingNo}`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل ملاحظات الحجز...'));
  modal.foot.append(modalButton('إغلاق',modal.close));
  try{render(modal,await api.admin({action:'booking_internal_notes',booking_number:bookingNo}),bookingNo)}
  catch(e){modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل الملاحظات.'));}
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.internalNotesReady==='1')return;
  grid.dataset.internalNotesReady='1';
  const b=el('button','booking-360-quick-button notes','ملاحظات داخلية');b.type='button';b.addEventListener('click',()=>openNotes(bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360InternalNotes(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
