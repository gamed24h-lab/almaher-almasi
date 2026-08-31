import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const money=v=>`${num(v).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س`;
const dt=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(v))}catch{return text(v)||'—'}};
const activeBooking=b=>!['cancelled','canceled','deleted'].includes(low(b?.status));
let queued=false;

function onFinance(){return /^\/finance(?:\/|$)/i.test(location.pathname)}
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n}
function button(label,fn,primary=false){const b=el('button',`finance360-ledger-btn${primary?' primary':''}`,label);b.type='button';b.onclick=fn;return b}
function bookingNo(b){return text(b?.booking_number||b?.booking_no||b?.code||b?.reference||b?.id)}
function customerKey(b){const identity=text(b?.customer_identity);if(identity)return {kind:'identity',value:identity,label:`هوية ${identity}`};const phone=text(b?.customer_phone);if(phone)return {kind:'phone',value:phone,label:`جوال ${phone}`};return null}
function transactionType(r){return low(r?.transaction_type||r?.type||r?.kind)}
function txRef(r){return text(r?.reference_no||r?.reference||r?.booking_number)}
function isPayment(r){return transactionType(r)==='payment'||txRef(r).startsWith('PAY-')}
function refundStatus(v){return ({pending:'قيد المراجعة',approved:'معتمد',completed:'مكتمل',rejected:'مرفوض',reversed:'معكوس',cancelled:'ملغي'})[low(v)]||text(v)||'—'}
function paymentMethod(v){return ({cash:'نقدي',bank:'تحويل بنكي',bank_transfer:'تحويل بنكي',transfer:'تحويل بنكي',mada:'مدى',card:'بطاقة',apple_pay:'Apple Pay',online:'دفع إلكتروني',wallet:'محفظة العميل',mixed:'متعدد'})[low(v)]||text(v)||'—'}

async function loadSources(){
  const [financeR,refundR,bootR]=await Promise.allSettled([api.module('finance_full'),api.admin({action:'refund_list'}),api.bootstrap()]);
  if(financeR.status!=='fulfilled')throw financeR.reason||new Error('تعذر قراءة السجل المالي.');
  if(bootR.status!=='fulfilled')throw bootR.reason||new Error('تعذر قراءة الحجوزات.');
  return {finance:financeR.value||{},refunds:refundR.status==='fulfilled'?(refundR.value?.rows||[]):[],refundsAvailable:refundR.status==='fulfilled',boot:bootR.value||{},canPrintRefund:refundR.status==='fulfilled'&&!!refundR.value?.can_print};
}
function shell(){
  document.querySelector('.finance360-ledger-backdrop')?.remove();
  const back=el('div','finance360-ledger-backdrop'),box=el('section','finance360-ledger-modal');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const head=el('div','finance360-ledger-head'),copy=el('div');copy.append(el('strong','','كشف الحركة المالي الموحد'),el('small','','الحجز / العميل — قراءة من السجل المالي الرسمي بدون تعديل أي حركة.'));const close=el('button','finance360-ledger-close','×');close.type='button';head.append(copy,close);
  const body=el('div','finance360-ledger-body'),notice=el('div','finance360-ledger-notice'),foot=el('div','finance360-ledger-foot');box.append(head,body,notice,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.onclick=destroy;back.onclick=e=>{if(e.target===back)destroy()};foot.append(button('إغلاق',destroy));
  const setNotice=(m,t='')=>{notice.textContent=m||'';notice.className=`finance360-ledger-notice ${t}`.trim()};return {body,foot,setNotice,close:destroy};
}
function stat(label,value,tone=''){const x=el('div',`finance360-ledger-stat ${tone}`);x.append(el('small','',label),el('strong','',String(value)));return x}
function openPaymentReceipt(modal,ref,mode='view'){
  const popup=window.open('about:blank','_blank');if(!popup){modal.setNotice('المتصفح منع فتح نافذة السند.','bad');return}
  fetch(`/api/payments/receipt?receipt_no=${encodeURIComponent(ref)}`,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}}).then(async r=>{const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{}if(!r.ok)throw new Error(d?.error||'تعذر فتح سند القبض.');popup.location.href=`/api/payments/receipt/${mode==='print'?'print':'view'}?receipt_no=${encodeURIComponent(ref)}`}).catch(e=>{try{popup.close()}catch{}modal.setNotice(e.message||'تعذر فتح سند القبض.','bad')});
}
function scopeBookings(selected,all){
  if(!all)return [selected];const k=customerKey(selected);if(!k)return [selected];
  return (all||[]).filter(activeBooking).filter(b=>k.kind==='identity'?text(b.customer_identity)===k.value:text(b.customer_phone)===k.value);
}
function buildTimeline(ctx,selected,useCustomer){
  const books=scopeBookings(selected,ctx.boot?.bookings||[]),ids=new Set(books.map(b=>text(b.id))),nos=new Set(books.map(bookingNo));
  const tx=(ctx.finance?.transactions||[]).filter(r=>ids.has(text(r.booking_id))||nos.has(text(r.booking_number)));
  const refunds=ctx.refunds.filter(r=>ids.has(text(r.booking_id))||nos.has(text(r.booking_number)));
  const entries=[];
  tx.forEach(r=>entries.push({kind:isPayment(r)?'payment':'transaction',date:r.created_at||r.transaction_date||null,amount:num(r.amount),status:low(r.status||'posted'),ref:txRef(r),method:r.payment_method||'',booking:books.find(b=>text(b.id)===text(r.booking_id))||books.find(b=>bookingNo(b)===text(r.booking_number)),raw:r}));
  refunds.forEach(r=>entries.push({kind:'refund',date:r.completed_at||r.approved_at||r.requested_at||r.created_at||null,amount:num(r.amount),status:low(r.status),ref:text(r.receipt_no||r.id),method:r.refund_method||'',booking:books.find(b=>text(b.id)===text(r.booking_id))||books.find(b=>bookingNo(b)===text(r.booking_number)),raw:r}));
  entries.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  return {books,entries,tx,refunds};
}
function renderLedger(modal,ctx,selected,useCustomer=false){
  modal.body.innerHTML='';const model=buildTimeline(ctx,selected,useCustomer),key=customerKey(selected);
  const title=el('div','finance360-ledger-title');const copy=el('div');copy.append(el('strong','',useCustomer?'كشف العميل':'كشف الحجز'),el('small','',useCustomer?(key?.label||'لا يوجد معرّف عميل ثابت'):bookingNo(selected)));
  const scope=el('div','finance360-ledger-scope');scope.append(button('الحجز فقط',()=>renderLedger(modal,ctx,selected,false),!useCustomer));if(key)scope.append(button(`كل حجوزات العميل (${model.books.length})`,()=>renderLedger(modal,ctx,selected,true),useCustomer));title.append(copy,scope);modal.body.append(title);

  const officialTotal=model.books.reduce((n,b)=>n+num(b.total_price),0),officialPaid=model.books.reduce((n,b)=>n+num(b.paid_amount),0),officialRemaining=Math.max(0,officialTotal-officialPaid);
  const postedPayments=model.tx.filter(r=>isPayment(r)&&!['pending','failed','cancelled','reversed'].includes(low(r.status))).reduce((n,r)=>n+num(r.amount),0);
  const completedRefunds=model.refunds.filter(r=>low(r.status)==='completed').reduce((n,r)=>n+num(r.amount),0);
  const pending=model.tx.filter(r=>low(r.status)==='pending').length;
  const stats=el('div','finance360-ledger-stats');stats.append(stat('قيمة الحجوزات',money(officialTotal)),stat('المدفوع الرسمي',money(officialPaid),'good'),stat('المتبقي الرسمي',money(officialRemaining),officialRemaining?'warn':'good'),stat('تحصيلات Posted بالسجل',money(postedPayments)),stat('استرداد مكتمل',money(completedRefunds),completedRefunds?'warn':''),stat('حركات Pending',String(pending),pending?'bad':'good'));modal.body.append(stats);

  const note=el('div','finance360-ledger-policy','«المدفوع الرسمي» و«المتبقي الرسمي» مأخوذان من الحجز نفسه. إجماليات الـTimeline للتدقيق فقط ولا تعيد احتساب رصيد الحجز.');modal.body.append(note);
  if(!ctx.refundsAvailable)modal.body.append(el('div','finance360-ledger-warning','سجل الاستردادات غير متاح لهذا الحساب؛ كشف الحركة يعرض المصادر المسموح بها فقط.'));

  const list=el('div','finance360-ledger-list');
  if(!model.entries.length)list.append(el('div','finance360-ledger-empty','لا توجد حركات مالية مرتبطة بالنطاق المختار.'));
  model.entries.forEach(e=>{
    const row=el('article',`finance360-ledger-row ${e.kind} ${e.status==='pending'?'pending':''}`),icon=el('div','finance360-ledger-icon',e.kind==='refund'?'↩':e.kind==='payment'?'↓':'•'),main=el('div','finance360-ledger-main');
    const label=e.kind==='refund'?'استرداد':e.kind==='payment'?'تحصيل':'حركة مالية';main.append(el('strong','',`${label} · ${money(e.amount)}`),el('small','',`${bookingNo(e.booking)||'—'} · ${dt(e.date)} · ${paymentMethod(e.method)}`),el('small','',`المرجع: ${e.ref||'—'} · الحالة: ${e.kind==='refund'?refundStatus(e.status):text(e.status||'posted')}`));
    const acts=el('div','finance360-ledger-row-actions');if(e.kind==='payment'&&e.ref.startsWith('PAY-')){acts.append(button('عرض السند',()=>openPaymentReceipt(modal,e.ref,'view')),button('طباعة',()=>openPaymentReceipt(modal,e.ref,'print')))}
    if(e.kind==='refund')acts.append(button('فتح الحجز',()=>{modal.close();location.assign(`/bookings/${encodeURIComponent(bookingNo(e.booking))}`)}));
    row.append(icon,main,acts);list.append(row);
  });modal.body.append(list);
}
function renderChooser(modal,ctx){
  modal.body.innerHTML='';const bookings=(ctx.boot?.bookings||[]).filter(activeBooking).slice().sort((a,b)=>bookingNo(a).localeCompare(bookingNo(b),'ar',{numeric:true}));
  const wrap=el('div','finance360-ledger-search'),input=el('input','finance360-ledger-input');input.type='search';input.placeholder='ابحث برقم الحجز، اسم العميل، الجوال أو الهوية';const results=el('div','finance360-ledger-results');wrap.append(input,results);modal.body.append(wrap);
  const paint=()=>{results.innerHTML='';const q=low(input.value),rows=(q?bookings.filter(b=>[bookingNo(b),b.customer_name,b.customer_phone,b.customer_identity].some(v=>low(v).includes(q))):bookings).slice(0,60);if(!rows.length){results.append(el('div','finance360-ledger-empty','لا توجد نتائج مطابقة.'));return}rows.forEach(b=>{const r=el('button','finance360-ledger-result');r.type='button';const c=el('div');c.append(el('strong','',bookingNo(b)),el('small','',`${text(b.customer_name)||'—'} · ${text(b.customer_phone)||'—'}${text(b.customer_identity)?` · ${text(b.customer_identity)}`:''}`));r.append(c,el('span','',money(b.total_price)));r.onclick=()=>renderLedger(modal,ctx,b,false);results.append(r)})};input.oninput=paint;paint();setTimeout(()=>input.focus(),80);
}
async function openLedger(){const modal=shell();modal.body.append(el('div','finance360-ledger-loading','جاري تحميل السجل المالي والحجوزات…'));try{const ctx=await loadSources();renderChooser(modal,ctx)}catch(e){modal.body.innerHTML='';modal.body.append(el('div','finance360-ledger-error',e?.message||'تعذر تحميل كشف الحركة المالي.'))}}
function sync(){if(!onFinance())return;const host=document.querySelector('.finance360');if(!host)return;const actions=host.querySelector('.finance360-head-actions');if(!actions||actions.querySelector('.finance360-ledger-launch'))return;const b=button('كشف حركة حجز / عميل',openLedger);b.classList.add('finance360-ledger-launch');actions.prepend(b)}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installFinance360Ledger(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const o=new MutationObserver(queue);o.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue)}
