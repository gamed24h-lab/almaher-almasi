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

function modalInput(type='text',placeholder=''){
  const input=el('input','booking-360-modal-input');
  input.type=type;
  input.placeholder=placeholder;
  return input;
}

function modalSelect(){return el('select','booking-360-modal-input')}

function modalField(labelText,input,hint=''){
  const label=el('label','booking-360-modal-field');
  label.append(el('span','booking-360-modal-label',labelText),input);
  if(hint)label.append(el('small','booking-360-modal-hint',hint));
  return label;
}

function closeActiveModal(){
  document.querySelector('.booking-360-modal-backdrop')?.remove();
  document.body.classList.remove('booking-360-modal-open');
}

function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-refund-modal');
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');
  const wrap=el('div');
  wrap.append(el('strong','booking-360-modal-title',title));
  if(subtitle)wrap.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';
  head.append(wrap,x);
  const body=el('div','booking-360-modal-body');
  const notice=el('div','booking-360-modal-notice');
  const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);
  document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};
  x.addEventListener('click',destroy);
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});
  window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}

function button(label,onClick,primary=false){
  const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);
  b.type='button';b.addEventListener('click',onClick);return b;
}

function stat(label,value){
  const box=el('div','booking-360-modal-stat');
  box.append(el('small','',label),el('strong','',value));
  return box;
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

function makeRequestId(){
  return globalThis.crypto?.randomUUID?.()||`refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function methodLabel(value){
  return ({cash:'نقدي',bank_transfer:'تحويل بنكي',mada:'مدى',card:'بطاقة',same_method:'نفس وسيلة الدفع',other:'أخرى'})[value]||value;
}

async function openRefundModal(center,bookingNo){
  const modal=openModal('استرداد مبلغ',`الحجز ${bookingNo} · بدون إلغاء الحجز`);
  modal.body.append(el('div','booking-360-modal-loading','جاري حساب المبلغ المتاح للاسترداد...'));
  try{
    const quote=await api.admin({action:'refund_quote',booking_number:bookingNo});
    const paid=num(quote?.booking?.paid_amount);
    const refunded=num(quote?.refunded_amount);
    const available=num(quote?.available_refund);
    const caps=quote?.capabilities||{};
    modal.body.innerHTML='';

    const stats=el('div','booking-360-modal-stats booking-360-refund-stats');
    stats.append(stat('المدفوع',money(paid)),stat('سبق استرداده',money(refunded)),stat('المتاح للاسترداد',money(available)));
    modal.body.append(stats);

    if(available<=0.001){
      modal.body.append(el('div','booking-360-modal-empty','لا يوجد مبلغ متاح للاسترداد على هذا الحجز.'));
      modal.foot.append(button('إغلاق',modal.close));
      return;
    }
    if(!caps.request){
      modal.body.append(el('div','booking-360-modal-empty','لا توجد لديك صلاحية إنشاء طلب استرداد لهذا الحجز.'));
      modal.foot.append(button('إغلاق',modal.close));
      return;
    }

    const amount=modalInput('number');
    amount.min='0.01';amount.step='0.01';amount.max=String(available);amount.value=String(available);
    const method=modalSelect();
    [['cash','نقدي'],['bank_transfer','تحويل بنكي'],['mada','مدى'],['card','بطاقة'],['same_method','نفس وسيلة الدفع'],['other','أخرى']]
      .forEach(([v,l])=>method.append(new Option(l,v)));
    const recipient=modalInput('text','اسم المستلم');
    recipient.value=text(quote?.booking?.customer_name);
    const reason=el('textarea','booking-360-modal-input booking-360-refund-reason');
    reason.placeholder='اكتب سبب الاسترداد';

    modal.body.append(
      modalField('المبلغ',amount,`الحد الأقصى المتاح الآن ${money(available)}`),
      modalField('طريقة الاسترداد',method),
      modalField('اسم المستلم',recipient),
      modalField('سبب الاسترداد',reason)
    );

    let direct=null;
    if(caps.approve&&caps.complete){
      const row=el('label','booking-360-refund-direct');
      direct=el('input');direct.type='checkbox';
      const copy=el('span');copy.append(el('strong','','تنفيذ مباشر'),el('small','','إنشاء الطلب واعتماده وتنفيذه فورًا لأن صلاحياتك تسمح بذلك.'));
      row.append(direct,copy);modal.body.append(row);
    }else{
      modal.body.append(el('div','booking-360-refund-note','سيتم إنشاء طلب استرداد ليمر بمسار الاعتماد والتنفيذ حسب الصلاحيات.'));
    }

    const back=button('رجوع',modal.close);
    const save=button('تأكيد الاسترداد',async()=>{
      const value=num(amount.value);
      if(value<=0)return modal.setNotice('اكتب مبلغ استرداد أكبر من صفر.','bad');
      if(value>available+0.001)return modal.setNotice(`المبلغ يتجاوز المتاح ${money(available)}.`,'bad');
      if(!text(reason.value))return modal.setNotice('سبب الاسترداد إلزامي.','bad');
      const directExecute=!!direct?.checked;
      const mode=directExecute?'تنفيذ مباشر':'إنشاء طلب استرداد';
      if(!confirm(`تأكيد ${mode}؟\nالحجز: ${bookingNo}\nالمبلغ: ${money(value)}\nالطريقة: ${methodLabel(method.value)}\n\nلن يتم إلغاء الحجز من هذه العملية.`))return;
      save.disabled=true;back.disabled=true;modal.setNotice(directExecute?'جاري تنفيذ الاسترداد...':'جاري إنشاء طلب الاسترداد...','');
      try{
        const out=await api.admin({
          action:'refund_request',
          booking_number:bookingNo,
          amount:value,
          reason:text(reason.value),
          refund_method:method.value,
          customer_ack_name:text(recipient.value)||text(quote?.booking?.customer_name),
          cancel_booking:false,
          client_request_id:makeRequestId(),
          direct_execute:directExecute
        });
        const status=String(out?.status||out?.refund?.status||out?.row?.status||'').toLowerCase();
        const completed=directExecute&&['completed','complete','executed','paid'].includes(status);
        const message=completed?`تم تنفيذ استرداد ${money(value)} بنجاح.`:directExecute?`تم إرسال استرداد ${money(value)} للتنفيذ بنجاح.`:`تم إنشاء طلب استرداد بقيمة ${money(value)}.`;
        modal.setNotice(message,'good');setCenterMessage(center,message,'good');
        setTimeout(()=>{modal.close();refreshBooking360()},800);
      }catch(e){
        save.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر إنشاء طلب الاسترداد.','bad');
      }
    },true);
    modal.foot.append(back,save);
  }catch(e){
    modal.body.innerHTML='';
    modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر حساب المبلغ المتاح للاسترداد.'));
    modal.foot.append(button('إغلاق',modal.close));
  }
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');
  const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.refundActionReady==='1')return;
  grid.dataset.refundActionReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button refund','استرداد مبلغ');b.type='button';
  b.addEventListener('click',()=>openRefundModal(center,bookingNo));
  grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360Refund(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();
  const observer=new MutationObserver(queue);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
}
