import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
let queued=false;

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return value.toLowerCase()==='new'?'':value;
}

function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}

function normalizeWhatsapp(phone){
  let d=text(phone).replace(/\D/g,'');
  if(d.startsWith('00'))d=d.slice(2);
  if(d.startsWith('0'))d=`966${d.slice(1)}`;
  return d;
}

function closeActiveModal(){document.querySelector('.booking-360-modal-backdrop')?.remove();document.body.classList.remove('booking-360-modal-open')}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-customer-link-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');const copy=el('div');copy.append(el('strong','booking-360-modal-title',title));if(subtitle)copy.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(copy,x);
  const body=el('div','booking-360-modal-body booking-360-customer-link-body');const notice=el('div','booking-360-modal-notice');const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function modalButton(label,onClick,primary=false){const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}

async function copyText(value){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return}
  const ta=document.createElement('textarea');ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();
}

async function bookingContext(bookingNo){
  const boot=await api.bootstrap();
  const booking=(boot?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
  return booking||null;
}

async function openCustomerLink(center,bookingNo){
  const modal=openModal('رابط العميل الآمن',`الحجز ${bookingNo} · دخول مباشر إلى بوابة العميل`);
  modal.body.append(el('div','booking-360-modal-loading','جاري إنشاء رابط العميل الآمن...'));
  modal.foot.append(modalButton('إغلاق',modal.close));
  try{
    const [linkInfo,booking]=await Promise.all([api.customerAccessLink(bookingNo),bookingContext(bookingNo).catch(()=>null)]);
    if(!linkInfo?.url)throw new Error('تعذر إنشاء رابط العميل.');
    const url=linkInfo.url;const days=Number(linkInfo.expires_in_days||180);const customer=text(booking?.customer_name)||'العميل';const phone=normalizeWhatsapp(booking?.customer_phone);
    modal.body.innerHTML='';modal.foot.innerHTML='';

    const hero=el('section','booking-360-customer-link-hero');
    hero.append(el('span','booking-360-customer-link-icon','🔐'),el('div','booking-360-customer-link-copy'));
    const heroCopy=hero.querySelector('.booking-360-customer-link-copy');heroCopy.append(el('strong','',`رابط ${customer}`),el('small','',`صالح لمدة ${days} يومًا من وقت الإنشاء`));modal.body.append(hero);

    const security=el('div','booking-360-customer-link-security');security.append(el('strong','','تنبيه أمان'),el('span','','الرابط يفتح الحجز مباشرة بدون طلب رقم الجوال أو الهوية؛ أرسله للعميل المقصود فقط ولا تنشره في مجموعة عامة.'));modal.body.append(security);

    const field=el('div','booking-360-customer-link-field');const input=el('input','booking-360-modal-input');input.readOnly=true;input.dir='ltr';input.value=url;const copyBtn=el('button','booking-360-customer-link-copy-button','نسخ الرابط');copyBtn.type='button';
    copyBtn.addEventListener('click',async()=>{try{await copyText(url);copyBtn.textContent='تم النسخ ✓';modal.setNotice('تم نسخ رابط العميل.','good');setTimeout(()=>{copyBtn.textContent='نسخ الرابط'},1400)}catch{modal.setNotice('تعذر نسخ الرابط تلقائيًا.','bad')}});
    field.append(input,copyBtn);modal.body.append(field);

    const waText=`شركة الماهر الماسي\nمرحبًا ${customer}\nيمكنك فتح تفاصيل حجزك رقم ${bookingNo} من الرابط الآمن التالي:\n${url}\n\nيرجى عدم مشاركة الرابط مع أي شخص آخر.`;
    const waHref=`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`;
    const open=modalButton('فتح بوابة العميل',()=>window.open(url,'_blank','noopener,noreferrer'),true);
    const copyFoot=modalButton('نسخ الرابط',async()=>{try{await copyText(url);modal.setNotice('تم نسخ رابط العميل.','good')}catch{modal.setNotice('تعذر نسخ الرابط.','bad')}});
    const whatsapp=modalButton(phone?'إرسال واتساب':'مشاركة عبر واتساب',()=>window.open(phone?waHref:`https://wa.me/?text=${encodeURIComponent(waText)}`,'_blank','noopener,noreferrer'));
    whatsapp.classList.add('whatsapp');
    modal.foot.append(modalButton('إغلاق',modal.close),copyFoot,whatsapp,open);
    if(!phone)modal.setNotice('لا يوجد جوال محفوظ للعميل؛ واتساب سيفتح بدون رقم محدد.','warn');
  }catch(e){modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر إنشاء رابط العميل الآمن.'));}
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.customerLinkReady==='1')return;
  grid.dataset.customerLinkReady='1';const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button customer-link','رابط العميل');b.type='button';b.addEventListener('click',()=>openCustomerLink(center,bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360CustomerLink(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
