import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const num=v=>Number(v||0);
const money=v=>`${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(num(v))} ر.س`;
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

function modalField(labelText,input,hint=''){
  const label=el('label','booking-360-modal-field');
  label.append(el('span','booking-360-modal-label',labelText),input);
  if(hint)label.append(el('small','booking-360-modal-hint',hint));
  return label;
}

function modalSelect(){return el('select','booking-360-modal-input')}
function modalInput(type='text',placeholder=''){
  const input=el('input','booking-360-modal-input');
  input.type=type;input.placeholder=placeholder;return input;
}

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const titleWrap=el('div');
  titleWrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)titleWrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const closeButton=el('button','booking-360-modal-close','×');closeButton.type='button';
  head.append(titleWrap,closeButton);
  const body=el('div','booking-360-modal-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);
  document.body.classList.add('booking-360-modal-open');
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  closeButton.addEventListener('click',destroy);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});
  window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function modalButton(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b;
}

function setCenterMessage(center,message,tone=''){
  const box=center?.querySelector('.booking-360-quick-message');
  if(!box)return;
  box.textContent=message||'';
  box.className=`booking-360-quick-message${tone?` ${tone}`:''}`;
}

function refreshBooking360(){
  const refresh=[...document.querySelectorAll('.booking-360-action')].find(b=>text(b.textContent).includes('تحديث Booking 360'));
  refresh?.click?.();
}

function hasCancellationPermissionUI(){
  return [...document.querySelectorAll('.page-head button')].some(b=>text(b.textContent).includes('إلغاء الحجز'));
}

function stat(label,value){
  const box=el('div','booking-360-modal-stat');box.append(el('small','',label),el('strong','',value));return box;
}

async function openCancellationModal(center,bookingNo){
  const modal=openModal('إلغاء الحجز',`الحجز ${bookingNo} · معاينة التسوية أولًا ثم تأكيد نهائي`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تجهيز معاينة الإلغاء...'));
  try{
    const q=await api.admin({action:'cancel_quote',booking_number:bookingNo});
    const due=num(q?.settlement_due);
    const gross=num(q?.booking?.paid_amount);
    const refunded=num(q?.refunded_amount);
    const wallet=num(q?.wallet_balance);
    modal.body.innerHTML='';

    const stats=el('div','booking-360-modal-stats');
    stats.append(stat('إجمالي المحصل',money(gross)),stat('مسترد سابقًا',money(refunded)),stat('المستحق للعميل',money(due)),stat('رصيد المحفظة',money(wallet)));

    const reason=modalSelect();
    reason.append(new Option('اختر سبب الإلغاء',''),new Option('طلب العميل','طلب العميل'),new Option('تغيير الموعد','تغيير الموعد'),new Option('خطأ في الحجز','خطأ في الحجز'),new Option('إلغاء الرحلة','إلغاء الرحلة'),new Option('أخرى','other'));
    const other=modalInput('text','اكتب سبب الإلغاء');
    const otherField=modalField('سبب الإلغاء الآخر',other);otherField.hidden=true;
    reason.addEventListener('change',()=>{otherField.hidden=reason.value!=='other'});

    modal.body.append(stats,modalField('سبب الإلغاء',reason),otherField);

    let settlement=null,refundMethod=null,refundField=null;
    if(due>0){
      settlement=modalSelect();
      const direct=new Option('استرداد مباشر','direct_refund');direct.disabled=!q?.capabilities?.direct_refund;
      const walletOpt=new Option('إضافة إلى محفظة العميل','wallet');walletOpt.disabled=!q?.capabilities?.wallet_credit;
      settlement.append(new Option('اختر طريقة التسوية',''),direct,walletOpt);
      refundMethod=modalSelect();
      [['cash','نقدي'],['bank_transfer','تحويل بنكي'],['mada','مدى'],['card','بطاقة'],['other','أخرى']].forEach(([v,l])=>refundMethod.append(new Option(l,v)));
      refundField=modalField('طريقة الاسترداد',refundMethod);refundField.hidden=true;
      settlement.addEventListener('change',()=>{refundField.hidden=settlement.value!=='direct_refund'});
      modal.body.append(modalField('تسوية المستحق',settlement,`سيتم تسوية ${money(due)} عند تأكيد الإلغاء.`),refundField);
      if(!q?.capabilities?.direct_refund&&!q?.capabilities?.wallet_credit)modal.setNotice('لديك صلاحية معاينة الإلغاء، لكن لا توجد صلاحية متاحة لتسوية المبلغ المستحق للعميل.','warn');
    }else{
      modal.body.append(el('div','booking-360-modal-current','لا يوجد مبلغ مستحق للعميل؛ الإلغاء سيتم بدون تسوية مالية.'));
    }

    const back=modalButton('رجوع',modal.close);
    const confirmButton=modalButton('تأكيد إلغاء الحجز',async()=>{
      if(!reason.value)return modal.setNotice('اختر سبب الإلغاء.','bad');
      if(reason.value==='other'&&!text(other.value))return modal.setNotice('اكتب سبب الإلغاء الآخر.','bad');
      if(due>0&&!['direct_refund','wallet'].includes(settlement?.value))return modal.setNotice('اختر طريقة تسوية المبلغ المستحق للعميل.','bad');
      const modeLabel=settlement?.value==='wallet'?'إضافة إلى محفظة العميل':settlement?.value==='direct_refund'?'استرداد مباشر':'بدون تسوية مالية';
      const reasonLabel=reason.value==='other'?text(other.value):reason.value;
      if(!confirm(`تأكيد إلغاء الحجز ${bookingNo}؟\nالسبب: ${reasonLabel}\nالمستحق للعميل: ${money(due)}\nالتسوية: ${modeLabel}\n\nسيتم تحرير المقعد والسكن المرتبط بالحجز.`))return;
      confirmButton.disabled=true;back.disabled=true;modal.setNotice('جاري إلغاء الحجز وتنفيذ التسوية...','');
      try{
        const r=await api.admin({action:'cancel_booking_settle',booking_number:bookingNo,reason:reason.value,reason_other:text(other.value),settlement_mode:due>0?settlement.value:'none',refund_method:refundMethod?.value||'cash'});
        const resultMessage=r?.settlement?.mode==='wallet'?`تم إلغاء الحجز وإضافة ${money(r.settlement.amount)} إلى محفظة العميل.`:r?.settlement?.mode==='direct_refund'?`تم إلغاء الحجز وتنفيذ استرداد ${money(r.settlement.amount)}.`:'تم إلغاء الحجز بنجاح.';
        modal.setNotice(resultMessage,'good');setCenterMessage(center,resultMessage,'good');
        setTimeout(()=>{modal.close();refreshBooking360()},750);
      }catch(e){confirmButton.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر إلغاء الحجز.','bad')}
    },true);
    confirmButton.classList.add('danger');
    modal.foot.append(back,confirmButton);
  }catch(e){
    modal.body.innerHTML='';
    modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل معاينة الإلغاء.'));
    modal.foot.append(modalButton('إغلاق',modal.close));
  }
}

function sync(){
  const bookingNo=bookingNoFromPath();
  if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid)return;
  if(grid.dataset.cancelActionReady==='1')return;
  if(!hasCancellationPermissionUI())return;
  grid.dataset.cancelActionReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const button=el('button','booking-360-quick-button danger','إلغاء الحجز');
  button.type='button';
  button.addEventListener('click',()=>openCancellationModal(center,bookingNo));
  grid.append(button);
}

function queue(){
  if(queued)return;queued=true;
  requestAnimationFrame(()=>{queued=false;sync()});
}

export function installBooking360Cancellation(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();
  const observer=new MutationObserver(queue);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
}
