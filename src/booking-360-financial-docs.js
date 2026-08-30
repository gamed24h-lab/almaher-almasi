import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>Number(v||0);
const money=v=>`${new Intl.NumberFormat('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(num(v))} ر.س`;
let queued=false;

function bookingNoFromPath(){
  const m=window.location.pathname.match(/^\/bookings\/([^/?#]+)\/?$/i);
  if(!m)return '';
  const value=decodeURIComponent(m[1]);
  return low(value)==='new'?'':value;
}

function el(tag,className,label){const node=document.createElement(tag);if(className)node.className=className;if(label!==undefined)node.textContent=label;return node}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function methodLabel(v){return ({cash:'نقدي',bank:'تحويل بنكي',bank_transfer:'تحويل بنكي',transfer:'تحويل بنكي',mada:'مدى',card:'بطاقة',apple_pay:'Apple Pay',online:'دفع إلكتروني',wallet:'محفظة العميل',same_method:'نفس وسيلة الدفع',other:'أخرى',mixed:'متعدد'})[low(v)]||text(v)||'—'}
function refundStatus(v){return ({pending:'قيد المراجعة',approved:'معتمد',completed:'مكتمل',rejected:'مرفوض',reversed:'معكوس',cancelled:'ملغي'})[low(v)]||text(v)||'—'}
function dateLabel(v){if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(v))}catch{return text(v)||'—'}}

function closeActiveModal(){document.querySelector('.booking-360-modal-backdrop')?.remove();document.body.classList.remove('booking-360-modal-open')}
function openModal(title,subtitle=''){
  closeActiveModal();
  const backdrop=el('div','booking-360-modal-backdrop');
  const dialog=el('section','booking-360-modal booking-360-financial-docs-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const head=el('div','booking-360-modal-head');const copy=el('div');copy.append(el('strong','booking-360-modal-title',title));if(subtitle)copy.append(el('small','booking-360-modal-subtitle',subtitle));
  const x=el('button','booking-360-modal-close','×');x.type='button';head.append(copy,x);
  const body=el('div','booking-360-modal-body booking-360-financial-docs-body');const notice=el('div','booking-360-modal-notice');const foot=el('div','booking-360-modal-foot');
  dialog.append(head,body,notice,foot);backdrop.append(dialog);document.body.append(backdrop);document.body.classList.add('booking-360-modal-open');
  const destroy=()=>{window.removeEventListener('keydown',onKey);backdrop.remove();document.body.classList.remove('booking-360-modal-open')};
  const onKey=e=>{if(e.key==='Escape'&&document.body.contains(backdrop))destroy()};x.addEventListener('click',destroy);backdrop.addEventListener('click',e=>{if(e.target===backdrop)destroy()});window.addEventListener('keydown',onKey);
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`booking-360-modal-notice${tone?` ${tone}`:''}`};
  return {body,foot,close:destroy,setNotice};
}
function modalButton(label,onClick,primary=false){const b=el('button',`booking-360-modal-button${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}
function stat(label,value,tone=''){const box=el('div',`booking-360-modal-stat ${tone}`.trim());box.append(el('small','',label),el('strong','',value));return box}

function paymentRowsFromTimeline(timeline){
  const map=new Map();
  for(const e of timeline?.events||[]){
    const m=e?.metadata&&typeof e.metadata==='object'?e.metadata:{};
    const receipt=text(m.receipt_no||m.receiptNo);
    if(!receipt||!receipt.startsWith('PAY-'))continue;
    if(!map.has(receipt))map.set(receipt,{receipt_no:receipt,amount:num(m.amount),payment_method:m.payment_method||m.paymentMethod||'',payment_reference:m.payment_reference||m.paymentReference||'',actor_name:e.actor_name||'',created_at:e.created_at||m.created_at||null});
  }
  return [...map.values()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
}

async function openPaymentReceipt(modal,ref,mode='view'){
  const popup=window.open('about:blank','_blank');
  if(!popup){modal.setNotice('المتصفح منع فتح نافذة السند. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.','bad');return}
  try{
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:Arial;padding:24px">جاري التحقق من صلاحية السند...</body></html>');
    const check=await fetch(`/api/payments/receipt?receipt_no=${encodeURIComponent(ref)}`,{credentials:'include',headers:{Accept:'application/json'},cache:'no-store'});
    const raw=await check.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}}
    if(!check.ok)throw new Error(data?.error||data?.message||'تعذر فتح سند القبض.');
    popup.location.href=`/api/payments/receipt/${mode==='print'?'print':'view'}?receipt_no=${encodeURIComponent(ref)}`;
  }catch(e){try{popup.close()}catch{}modal.setNotice(e?.message||'تعذر فتح سند القبض.','bad')}
}

function refundHtml(row,booking,branch){
  const name=text(row.customer_name||row.customer_ack_name||booking?.customer_name)||'—';
  const receipt=text(row.receipt_no)||'—';
  const created=row.completed_at||row.requested_at||row.created_at||Date.now();
  const logo=`${window.location.origin}/almaher-logo.jpeg`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>سند استرداد ${esc(receipt)}</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:Arial,Tahoma,sans-serif;color:#14213d;margin:0;background:#f8fafc}.toolbar{max-width:760px;margin:18px auto 8px;display:flex;gap:8px}.toolbar button{border:1px solid #cbd5e1;border-radius:9px;background:white;padding:9px 14px;cursor:pointer}.sheet{max-width:760px;margin:auto;background:white;border:1px solid #d9e1ea;border-radius:16px;padding:24px}.head{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:2px solid #14213d;padding-bottom:14px;margin-bottom:18px}.head img{width:150px;max-height:82px;object-fit:contain}.head h1{margin:0 0 5px;font-size:25px}.head p{margin:3px 0;color:#5b6472}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}.item{border-bottom:1px solid #e6ebf0;padding:8px 0}.item span{display:block;color:#667085;font-size:12px}.item b{display:block;margin-top:4px}.amount{margin:20px 0;text-align:center;border:2px solid #b28b31;border-radius:14px;padding:16px;background:#fffdf7}.amount span{display:block;color:#667085}.amount strong{font-size:28px}.reason{margin-top:14px;border:1px solid #e6ebf0;border-radius:10px;padding:12px}.reason span{display:block;color:#667085;font-size:12px;margin-bottom:6px}.foot{margin-top:35px;display:grid;grid-template-columns:1fr 1fr;gap:30px}.sig{border-top:1px solid #667085;padding-top:8px;text-align:center;color:#667085}@media print{body{background:white}.toolbar{display:none}.sheet{border:0;border-radius:0;padding:0}}</style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / PDF</button><button onclick="window.close()">إغلاق</button></div><div class="sheet"><div class="head"><div><h1>سند استرداد / صرف</h1><p>شركة الماهر الماسي</p><p>${esc(branch?.name||'')}${branch?.address?` — ${esc(branch.address)}`:''}</p></div><img src="${esc(logo)}" alt="الماهر الماسي"></div><div class="grid"><div class="item"><span>رقم السند</span><b>${esc(receipt)}</b></div><div class="item"><span>التاريخ</span><b>${esc(dateLabel(created))}</b></div><div class="item"><span>رقم الحجز</span><b>${esc(row.booking_number||booking?.booking_number||'—')}</b></div><div class="item"><span>العميل / المستلم</span><b>${esc(name)}</b></div><div class="item"><span>طريقة الاسترداد</span><b>${esc(methodLabel(row.refund_method))}</b></div><div class="item"><span>الحالة</span><b>${esc(refundStatus(row.status))}</b></div><div class="item"><span>المنفذ</span><b>${esc(row.completed_by||'—')}</b></div><div class="item"><span>مرجع العملية</span><b>${esc(row.client_request_id||row.id||'—')}</b></div></div><div class="amount"><span>المبلغ المصروف للعميل</span><strong>${esc(money(row.amount))}</strong></div><div class="reason"><span>سبب الاسترداد</span><b>${esc(row.reason||'—')}</b></div><div class="foot"><div class="sig">توقيع الموظف / الختم</div><div class="sig">توقيع المستلم</div></div></div></body></html>`;
}
function printRefundReceipt(modal,row,booking,branch){
  if(low(row.status)!=='completed'){modal.setNotice('طباعة سند الاسترداد متاحة بعد اكتمال تنفيذ الاسترداد فقط.','warn');return}
  const popup=window.open('about:blank','_blank');if(!popup){modal.setNotice('المتصفح منع فتح نافذة الطباعة.','bad');return}
  popup.document.open();popup.document.write(refundHtml(row,booking,branch));popup.document.close();
  popup.addEventListener('load',()=>setTimeout(()=>popup.print(),250),{once:true});
}

async function loadFinancialDocs(bookingNo){
  const results=await Promise.allSettled([api.bookingTimeline(bookingNo),api.admin({action:'refund_list'}),api.bootstrap()]);
  const timeline=results[0].status==='fulfilled'?results[0].value:null;
  const refundsPayload=results[1].status==='fulfilled'?results[1].value:null;
  const boot=results[2].status==='fulfilled'?results[2].value:null;
  const booking=(boot?.bookings||[]).find(b=>text(b?.booking_number)===text(bookingNo))||timeline?.booking||null;
  const branch=(boot?.branches||[]).find(b=>text(b?.id)===text(booking?.branch_id))||null;
  const refunds=(refundsPayload?.rows||[]).filter(r=>text(r?.booking_number)===text(bookingNo)).sort((a,b)=>String(b.completed_at||b.requested_at||'').localeCompare(String(a.completed_at||a.requested_at||'')));
  const warnings=[];
  if(results[0].status==='rejected')warnings.push('تعذر قراءة سجل سندات القبض.');
  if(results[1].status==='rejected')warnings.push('تعذر قراءة سندات الاسترداد أو لا توجد صلاحية لعرضها.');
  return {payments:paymentRowsFromTimeline(timeline),refunds,canPrintRefund:!!refundsPayload?.can_print,booking,branch,warnings};
}

function renderFinancialDocs(modal,ctx,bookingNo){
  modal.body.innerHTML='';modal.foot.innerHTML='';
  const paymentTotal=ctx.payments.reduce((s,x)=>s+num(x.amount),0);
  const refundTotal=ctx.refunds.filter(x=>low(x.status)==='completed').reduce((s,x)=>s+num(x.amount),0);
  const stats=el('div','booking-360-modal-stats booking-360-financial-docs-stats');
  stats.append(stat('سندات القبض',String(ctx.payments.length),ctx.payments.length?'good':''),stat('إجمالي السندات',money(paymentTotal)),stat('سندات الاسترداد',String(ctx.refunds.length),ctx.refunds.length?'warn':''),stat('استرداد مكتمل',money(refundTotal),refundTotal?'warn':''));modal.body.append(stats);

  if(ctx.warnings.length){const warning=el('div','booking-360-financial-docs-warning',ctx.warnings.join(' '));modal.body.append(warning)}
  const section=(title,count)=>{const s=el('section','booking-360-financial-docs-section');const h=el('div','booking-360-financial-docs-section-head');h.append(el('strong','',title),el('span','',String(count)));s.append(h);return s};

  const paySection=section('سندات القبض',ctx.payments.length);
  if(!ctx.payments.length)paySection.append(el('div','booking-360-financial-docs-empty','لا توجد سندات قبض مسجلة لهذا الحجز حتى الآن.'));
  ctx.payments.forEach(row=>{
    const card=el('article','booking-360-financial-doc-card payment');const copy=el('div','booking-360-financial-doc-copy');
    copy.append(el('strong','',row.receipt_no),el('small','',`${money(row.amount)} · ${methodLabel(row.payment_method)} · ${dateLabel(row.created_at)}`));if(row.actor_name)copy.append(el('small','',`الموظف: ${row.actor_name}`));
    const actions=el('div','booking-360-financial-doc-actions');const view=el('button','','عرض');view.type='button';view.addEventListener('click',()=>openPaymentReceipt(modal,row.receipt_no,'view'));const print=el('button','','طباعة');print.type='button';print.addEventListener('click',()=>openPaymentReceipt(modal,row.receipt_no,'print'));actions.append(view,print);card.append(copy,actions);paySection.append(card);
  });
  modal.body.append(paySection);

  const refundSection=section('سندات الاسترداد',ctx.refunds.length);
  if(!ctx.refunds.length)refundSection.append(el('div','booking-360-financial-docs-empty','لا توجد طلبات أو سندات استرداد لهذا الحجز.'));
  ctx.refunds.forEach(row=>{
    const tone=low(row.status)==='completed'?'completed':low(row.status)==='reversed'?'reversed':'pending';const card=el('article',`booking-360-financial-doc-card refund ${tone}`);const copy=el('div','booking-360-financial-doc-copy');
    copy.append(el('strong','',text(row.receipt_no)||`استرداد ${text(row.id).slice(0,8)}`),el('small','',`${money(row.amount)} · ${methodLabel(row.refund_method)} · ${refundStatus(row.status)}`),el('small','',dateLabel(row.completed_at||row.requested_at||row.created_at)));
    const actions=el('div','booking-360-financial-doc-actions');if(low(row.status)==='completed'&&ctx.canPrintRefund){const print=el('button','','طباعة');print.type='button';print.addEventListener('click',()=>printRefundReceipt(modal,row,ctx.booking,ctx.branch));actions.append(print)}
    if(low(row.status)==='reversed')actions.append(el('span','booking-360-financial-doc-state','تم عكس السند'));
    card.append(copy,actions);refundSection.append(card);
  });
  modal.body.append(refundSection);
  modal.foot.append(modalButton('إغلاق',modal.close),modalButton('تحديث',async()=>{modal.setNotice('جاري تحديث السندات...','');try{const fresh=await loadFinancialDocs(bookingNo);renderFinancialDocs(modal,fresh,bookingNo);modal.setNotice('تم تحديث السندات.','good')}catch(e){modal.setNotice(e?.message||'تعذر تحديث السندات.','bad')}}));
}

async function openFinancialDocs(center,bookingNo){
  const modal=openModal('السندات المالية',`الحجز ${bookingNo} · قبض واسترداد من مكان واحد`);
  modal.body.append(el('div','booking-360-modal-loading','جاري تحميل السندات المالية...'));modal.foot.append(modalButton('إغلاق',modal.close));
  try{renderFinancialDocs(modal,await loadFinancialDocs(bookingNo),bookingNo)}catch(e){modal.body.innerHTML='';modal.body.append(el('div','booking-360-modal-empty',e?.message||'تعذر تحميل السندات المالية.'))}
}

function sync(){
  const bookingNo=bookingNoFromPath();if(!bookingNo)return;
  const panel=document.querySelector('.booking-360-overview');const grid=panel?.querySelector('.booking-360-quick-grid');
  if(!panel||panel.dataset.booking!==bookingNo||!grid||grid.dataset.financialDocsReady==='1')return;
  grid.dataset.financialDocsReady='1';const center=grid.closest('.booking-360-quick-center');const b=el('button','booking-360-quick-button financial-docs','السندات المالية');b.type='button';b.addEventListener('click',()=>openFinancialDocs(center,bookingNo));grid.append(b);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installBooking360FinancialDocuments(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue)}
