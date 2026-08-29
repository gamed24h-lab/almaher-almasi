import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const activeStatus=v=>!['cancelled','canceled','released','refunded','deleted','inactive'].includes(low(v));
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
  const dialog=el('section','booking-360-modal booking-360-passenger-modal');
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

function passengerName(p){return text(p?.full_name||p?.name)||'مسافر'}
function passengerIdentity(p){return text(p?.identity_number||p?.identity)}
function passengerPhone(p){return text(p?.phone)}
function passengerNationality(p){return text(p?.nationality)}
function passengerGender(p){return low(p?.gender)}
function passengerLanguage(p){return low(p?.preferred_language||p?.preferredLanguage)||'ar'}

async function openPassengerModal(center,bookingNo){
  const modal=openModal('تعديل بيانات مسافر',`الحجز ${bookingNo} · تعديل مباشر مع تسجيل الحركة في سجل الحجز`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل بيانات المسافرين...'));
  try{
    const raw=await api.bootstrap();
    const booking=(raw?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo));
    if(!booking)throw new Error('الحجز غير موجود.');
    if(['cancelled','canceled','refunded'].includes(low(booking.status)))throw new Error('لا يمكن تعديل بيانات مسافر في حجز ملغي أو مسترد.');
    const passengers=(raw?.passengers||[])
      .filter(p=>text(p?.booking_id)===text(booking.id)&&activeStatus(p?.status))
      .sort((a,b)=>Number(a?.passenger_order||0)-Number(b?.passenger_order||0));
    if(!passengers.length)throw new Error('لا توجد بيانات مسافرين نشطة في هذا الحجز.');

    modal.body.innerHTML='';
    const passenger=select();
    passengers.forEach((p,i)=>passenger.append(new Option(`${i+1}. ${passengerName(p)}${passengerIdentity(p)?` — ${passengerIdentity(p)}`:''}`,text(p.id))));
    const name=input('text','اسم المسافر');
    const identity=input('text','الهوية / الإقامة');
    const nationality=input('text','الجنسية');
    const phone=input('tel','رقم الجوال');
    const gender=select();gender.append(new Option('ذكر','male'),new Option('أنثى','female'));
    const language=select();
    [['ar','العربية'],['en','English'],['tr','Türkçe'],['hi','हिन्दी'],['it','Italiano'],['fr','Français'],['ur','اردو']].forEach(([v,l])=>language.append(new Option(l,v)));
    const requirements=el('textarea','booking-360-modal-input booking-360-passenger-notes');requirements.placeholder='احتياجات أو ملاحظات خاصة بالمسافر — اختياري';
    const snapshot=el('div','booking-360-passenger-snapshot');

    modal.body.append(
      field('المسافر',passenger),snapshot,
      field('الاسم',name),field('الهوية / الإقامة',identity),field('الجنسية',nationality),field('الجوال',phone),field('الجنس',gender),field('لغة التواصل',language),field('احتياجات خاصة',requirements)
    );

    function current(){return passengers.find(p=>text(p.id)===text(passenger.value))||passengers[0]}
    function fill(){
      const p=current();if(!p)return;
      name.value=passengerName(p);identity.value=passengerIdentity(p);nationality.value=passengerNationality(p);phone.value=passengerPhone(p);
      gender.value=passengerGender(p)==='female'?'female':'male';language.value=passengerLanguage(p);requirements.value=text(p?.special_requirements);
      snapshot.textContent=`المسافر رقم ${Number(p?.passenger_order||passengers.indexOf(p)+1)} · الهوية الحالية: ${passengerIdentity(p)||'غير مسجلة'} · الجوال: ${passengerPhone(p)||'غير مسجل'}`;
      modal.setNotice('','');
    }
    passenger.addEventListener('change',fill);fill();

    const back=button('رجوع',modal.close);
    const save=button('حفظ بيانات المسافر',async()=>{
      const p=current();if(!p)return modal.setNotice('اختر مسافرًا أولًا.','bad');
      const fullName=text(name.value),idNo=text(identity.value),nat=text(nationality.value),mobile=text(phone.value);
      if(!fullName)return modal.setNotice('اسم المسافر مطلوب.','bad');
      if(!idNo)return modal.setNotice('هوية المسافر مطلوبة.','bad');
      const duplicate=passengers.find(x=>text(x.id)!==text(p.id)&&passengerIdentity(x)===idNo);
      if(duplicate)return modal.setNotice(`رقم الهوية مستخدم بالفعل للمسافر ${passengerName(duplicate)} داخل نفس الحجز.`,'bad');
      const changes=[];
      if(fullName!==passengerName(p))changes.push('الاسم');
      if(idNo!==passengerIdentity(p))changes.push('الهوية');
      if(nat!==passengerNationality(p))changes.push('الجنسية');
      if(mobile!==passengerPhone(p))changes.push('الجوال');
      if(gender.value!==passengerGender(p))changes.push('الجنس');
      if(language.value!==passengerLanguage(p))changes.push('لغة التواصل');
      if(text(requirements.value)!==text(p?.special_requirements))changes.push('الاحتياجات الخاصة');
      if(!changes.length)return modal.setNotice('لم يتم تغيير أي بيانات.','warn');
      if(!confirm(`تأكيد تعديل بيانات ${passengerName(p)}؟\nسيتم تغيير: ${changes.join('، ')}`))return;
      save.disabled=true;back.disabled=true;modal.setNotice('جاري حفظ بيانات المسافر...','');
      try{
        await api.moduleWrite({action:'update',table:'booking_passengers',id:p.id,row:{
          booking_id:booking.id,
          full_name:fullName,
          identity_number:idNo,
          nationality:nat||null,
          phone:mobile||null,
          gender:gender.value,
          preferred_language:language.value,
          special_requirements:text(requirements.value)||null
        }});
        const message=`تم تحديث بيانات ${fullName} بنجاح.`;
        modal.setNotice(message,'good');setCenterMessage(center,message,'good');
        setTimeout(()=>{modal.close();refreshBooking360()},750);
      }catch(e){save.disabled=false;back.disabled=false;modal.setNotice(e?.message||'تعذر حفظ بيانات المسافر.','bad')}
    },true);
    modal.foot.append(back,save);
  }catch(e){
    modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل بيانات المسافرين.'));modal.foot.append(button('إغلاق',modal.close));
  }
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.passengerEditReady==='1')return;
  grid.dataset.passengerEditReady='1';
  const center=grid.closest('.booking-360-quick-center');
  const b=el('button','booking-360-quick-button passenger','تعديل مسافر');b.type='button';b.addEventListener('click',()=>openPassengerModal(center,bookingNo));grid.append(b);
}

function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}

export function installBooking360PassengerEdit(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);
}
