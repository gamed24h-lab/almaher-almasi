import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const activeStatus=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
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

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('تعذر قراءة الملف.'));
    reader.readAsDataURL(file);
  });
}

function typeLabel(v){
  return ({identity:'هوية / إقامة',passport:'جواز سفر',visa:'تأشيرة',other:'أخرى'})[low(v)]||text(v)||'مستند';
}

function statusLabel(v){
  return ({uploaded:'مرفوع',approved:'معتمد',verified:'تم التحقق',rejected:'مرفوض',expired:'منتهي',pending:'قيد المراجعة'})[low(v)]||text(v)||'مرفوع';
}

function dateLabel(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('ar-SA')}catch{return text(v)||'—'}
}

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-documents-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const copy=el('div');copy.append(el('strong','booking-360-modal-title',title));if(subtitle)copy.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(copy,x);
  const body=el('div','booking-360-modal-body booking-360-documents-body');
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

function stat(label,value,tone=''){
  const box=el('div',`booking-360-modal-stat ${tone}`.trim());box.append(el('small','',label),el('strong','',value));return box;
}

async function loadContext(bookingNo){
  const [boot,docs]=await Promise.all([api.bootstrap(),api.module('documents')]);
  const booking=(boot?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  if(!booking)throw new Error('تعذر العثور على الحجز.');
  const passengers=(boot?.passengers||[]).filter(p=>text(p?.booking_id)===text(booking.id)&&activeStatus(p?.status));
  const passengerIds=new Set(passengers.map(p=>text(p.id)));
  const rows=(docs?.passenger_documents||[]).filter(r=>passengerIds.has(text(r?.passenger_id)));
  return {booking,passengers,rows};
}

function renderList(modal,ctx,bookingNo){
  modal.body.innerHTML='';
  const docsByPassenger=new Map();
  ctx.rows.forEach(r=>{const key=text(r.passenger_id),arr=docsByPassenger.get(key)||[];arr.push(r);docsByPassenger.set(key,arr)});
  const covered=ctx.passengers.filter(p=>(docsByPassenger.get(text(p.id))||[]).length>0).length;
  const verified=ctx.rows.filter(r=>['approved','verified'].includes(low(r.status))).length;
  const rejected=ctx.rows.filter(r=>['rejected','expired'].includes(low(r.status))).length;

  const stats=el('div','booking-360-modal-stats booking-360-documents-stats');
  stats.append(stat('المسافرون',String(ctx.passengers.length)),stat('لهم مستندات',`${covered}/${ctx.passengers.length}`,covered>=ctx.passengers.length&&ctx.passengers.length?'good':'warn'),stat('تم التحقق',String(verified),'good'),stat('مرفوض / منتهي',String(rejected),rejected?'bad':''));
  modal.body.append(stats);

  const note=el('div','booking-360-documents-note',covered>=ctx.passengers.length&&ctx.passengers.length?'كل المسافرين لديهم مستند واحد على الأقل.':'يوجد مسافرون بدون مستندات مرفوعة حتى الآن.');
  note.classList.add(covered>=ctx.passengers.length&&ctx.passengers.length?'good':'warn');modal.body.append(note);

  const list=el('div','booking-360-documents-list');
  ctx.passengers.forEach((p,index)=>{
    const docs=docsByPassenger.get(text(p.id))||[];
    const card=el('section','booking-360-document-passenger');
    const head=el('div','booking-360-document-passenger-head');
    const name=el('div');name.append(el('strong','',`${index+1}. ${text(p.full_name)||'مسافر'}`),el('small','',text(p.identity_number)||'بدون رقم هوية'));
    head.append(name,el('span',`booking-360-document-badge ${docs.length?'good':'warn'}`,docs.length?`${docs.length} مستند`:'لا يوجد مستند'));
    card.append(head);
    if(!docs.length){card.append(el('div','booking-360-document-empty','لم يتم رفع مستند لهذا المسافر بعد.'));}
    else{
      docs.sort((a,b)=>String(b?.created_at||'').localeCompare(String(a?.created_at||''))).forEach(d=>{
        const row=el('div','booking-360-document-row');
        const info=el('div','booking-360-document-info');
        info.append(el('strong','',typeLabel(d.document_type)),el('small','',[text(d.document_number)||'بدون رقم',statusLabel(d.status),dateLabel(d.created_at)].join(' · ')));
        const open=el('button','booking-360-document-open','فتح');open.type='button';open.disabled=!d.storage_path;
        open.addEventListener('click',async()=>{
          open.disabled=true;const old=open.textContent;open.textContent='جاري الفتح...';
          try{const out=await api.moduleWrite({action:'document_signed_url',storage_path:d.storage_path,expires_in:600});if(out?.signed_url)window.open(out.signed_url,'_blank','noopener,noreferrer');else throw new Error('تعذر إنشاء رابط المستند.')}catch(e){modal.setNotice(e?.message||'تعذر فتح المستند.','bad')}finally{open.disabled=false;open.textContent=old}
        });
        row.append(info,open);card.append(row);
      });
    }
    list.append(card);
  });
  modal.body.append(list);

  const uploadBox=el('section','booking-360-documents-upload');
  uploadBox.append(el('strong','booking-360-documents-upload-title','رفع مستند جديد'));
  const fields=el('div','booking-360-documents-upload-grid');
  const passenger=el('select','booking-360-modal-input');passenger.append(new Option('اختر المسافر',''));
  ctx.passengers.forEach(p=>passenger.append(new Option(text(p.full_name)||'مسافر',text(p.id))));
  const type=el('select','booking-360-modal-input');[['identity','هوية / إقامة'],['passport','جواز سفر'],['visa','تأشيرة'],['other','أخرى']].forEach(([v,l])=>type.append(new Option(l,v)));
  const number=el('input','booking-360-modal-input');number.placeholder='رقم المستند — اختياري';
  const file=el('input','booking-360-modal-input');file.type='file';file.accept='image/*,.pdf';
  fields.append(passenger,type,number,file);uploadBox.append(fields);
  const upload=modalButton('رفع المستند',async()=>{
    const selected=file.files?.[0];
    if(!passenger.value)return modal.setNotice('اختر المسافر أولًا.','bad');
    if(!selected)return modal.setNotice('اختر ملف المستند.','bad');
    if(selected.size>6*1024*1024)return modal.setNotice('الحد الأقصى للملف 6MB.','bad');
    upload.disabled=true;modal.setNotice('جاري رفع المستند...','');
    try{
      await api.moduleWrite({action:'upload_passenger_document',passenger_id:passenger.value,document_type:type.value,document_number:text(number.value)||null,file_name:selected.name,mime_type:selected.type||'application/octet-stream',base64:await fileToDataUrl(selected)});
      modal.setNotice('تم رفع المستند بنجاح.','good');
      const fresh=await loadContext(bookingNo);renderList(modal,fresh,bookingNo);
    }catch(e){modal.setNotice(e?.message||'تعذر رفع المستند.','bad');upload.disabled=false}
  },true);
  uploadBox.append(upload);modal.body.append(uploadBox);
}

async function openDocuments(center,bookingNo){
  const modal=openModal('مستندات الحجز',`الحجز ${bookingNo} · المستندات الداخلية للمسافرين`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل مستندات الحجز...'));
  modal.foot.append(modalButton('إغلاق',modal.close));
  try{const ctx=await loadContext(bookingNo);renderList(modal,ctx,bookingNo)}
  catch(e){modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل المستندات.'));}
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.documentsReady==='1')return;
  grid.dataset.documentsReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button documents','مستندات الحجز');b.type='button';b.addEventListener('click',()=>openDocuments(center,bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360Documents(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
