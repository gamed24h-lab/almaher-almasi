import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const digits=v=>text(v).replace(/\D/g,'');
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

function input(type='text',placeholder=''){
  const node=el('input','booking-360-modal-input');
  node.type=type;node.placeholder=placeholder;return node;
}

function select(){return el('select','booking-360-modal-input')}

function field(labelText,control,hint=''){
  const label=el('label','booking-360-modal-field');
  label.append(el('span','booking-360-modal-label',labelText),control);
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
  const dialog=el('section','booking-360-modal booking-360-customer-modal');
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

function refreshBooking360(){
  const refresh=[...document.querySelectorAll('.booking-360-action')].find(b=>text(b.textContent).includes('تحديث Booking 360'));
  refresh?.click?.();
}

async function openCustomerModal(center,bookingNo){
  const modal=openModal('تعديل بيانات العميل',`الحجز ${bookingNo} · تعديل مباشر مع حماية تعارض النسخ`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل بيانات العميل...'));
  try{
    const raw=await api.bootstrap();
    const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
    if(!booking)throw new Error('الحجز غير موجود.');
    if(['cancelled','canceled','refunded'].includes(low(booking.status)))throw new Error('لا يمكن تعديل بيانات العميل في حجز ملغي أو مسترد.');

    modal.body.innerHTML='';
    const name=input('text','اسم العميل');name.value=text(booking.customer_name);
    const phone=input('tel','رقم الجوال');phone.value=text(booking.customer_phone);
    const identity=input('text','الهوية / الإقامة');identity.value=text(booking.customer_identity);
    const nationality=input('text','الجنسية');nationality.value=text(booking.customer_nationality);
    const gender=select();gender.append(new Option('ذكر','male'),new Option('أنثى','female'));gender.value=low(booking.customer_gender)==='female'?'female':'male';
    const notes=el('textarea','booking-360-modal-input booking-360-customer-notes');notes.placeholder='ملاحظات الحجز — اختياري';notes.value=text(booking.notes);
    const walletInfo=el('div','booking-360-customer-wallet-note','جاري فحص ارتباط الهوية بمحفظة العميل...');
    let walletBalance=null;
    if(text(booking.customer_identity)){
      api.admin({action:'wallet_get',customer_identity:text(booking.customer_identity)}).then(r=>{
        walletBalance=Number(r?.balance||0);
        walletInfo.textContent=walletBalance>0?`تنبيه: الهوية الحالية مرتبطة بمحفظة رصيدها ${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(walletBalance)} ر.س. تغيير الهوية لا ينقل رصيد المحفظة تلقائيًا.`:'لا يوجد رصيد محفظة مرتبط بالهوية الحالية.';
        walletInfo.classList.toggle('warn',walletBalance>0);
      }).catch(()=>{walletBalance=null;walletInfo.textContent='تعذر فحص المحفظة الآن؛ لن يمنع ذلك تعديل بيانات العميل.'});
    }else walletInfo.textContent='لا توجد هوية حالية مرتبطة بمحفظة.';

    modal.body.append(
      field('اسم العميل',name),field('الجوال',phone),field('الهوية / الإقامة',identity),field('الجنسية',nationality),field('الجنس',gender),field('ملاحظات الحجز',notes),walletInfo
    );

    const back=button('رجوع',modal.close);
    const save=button('حفظ بيانات العميل',async()=>{
      const next={name:text(name.value),phone:text(phone.value),identity:text(identity.value),nationality:text(nationality.value),gender:gender.value,notes:text(notes.value)};
      if(!next.name||!next.phone||!next.identity)return modal.setNotice('اسم العميل والجوال والهوية مطلوبة.','bad');
      if(!next.nationality)return modal.setNotice('اختر أو اكتب جنسية العميل.','bad');
      if(!next.gender)return modal.setNotice('اختر جنس العميل.','bad');
      if(digits(next.phone).length<8)return modal.setNotice('رقم جوال العميل غير مكتمل.','bad');
      const changed=[];
      if(next.name!==text(booking.customer_name))changed.push('الاسم');
      if(next.phone!==text(booking.customer_phone))changed.push('الجوال');
      if(next.identity!==text(booking.customer_identity))changed.push('الهوية');
      if(next.nationality!==text(booking.customer_nationality))changed.push('الجنسية');
      if(next.gender!==low(booking.customer_gender))changed.push('الجنس');
      if(next.notes!==text(booking.notes))changed.push('الملاحظات');
      if(!changed.length)return modal.setNotice('لم يتم تغيير أي بيانات.','warn');
      const identityChanged=next.identity!==text(booking.customer_identity);
      let warning='';
      if(identityChanged&&Number(walletBalance||0)>0)warning=`\n\nتنبيه مهم: رصيد المحفظة ${new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(walletBalance)} ر.س سيظل مرتبطًا بالهوية القديمة ولن ينتقل تلقائيًا.`;
      if(!confirm(`تأكيد تعديل بيانات العميل؟\nسيتم تغيير: ${changed.join('، ')}${warning}`))return;
      save.disabled=true;back.disabled=true;modal.setNotice('جاري حفظ بيانات العميل...','');
      try{
        await api.admin({action:'update_booking',booking:{
          number:bookingNo,
          versionNo:Number(booking.version_no||1),
          name:next.name,
          phone:next.phone,
          identity:next.identity,
          nationality:next.nationality,
          gender:next.gender,
          notes:next.notes
        }});
        const message='تم تحديث بيانات العميل بنجاح.';
        modal.setNotice(message,'good');setCenterMessage(center,message,'good');
        setTimeout(()=>{modal.close();refreshBooking360()},700);
      }catch(e){save.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر حفظ بيانات العميل.','bad')}
    },true);
    modal.foot.append(back,save);
  }catch(e){
    modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل بيانات العميل.'));modal.foot.append(button('إغلاق',modal.close));
  }
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.customerEditReady==='1')return;
  grid.dataset.customerEditReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button customer','تعديل العميل');b.type='button';b.addEventListener('click',()=>openCustomerModal(center,bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360CustomerEdit(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
