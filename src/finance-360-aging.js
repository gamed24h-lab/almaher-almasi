import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const money=v=>`${num(v).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س`;
const activeBooking=b=>!['cancelled','canceled','deleted','refunded'].includes(low(b?.status));
let queued=false;

function onFinance(){return /^\/finance(?:\/|$)/i.test(location.pathname)}
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n}
function btn(label,fn,primary=false){const b=el('button',`finance360-aging-btn${primary?' primary':''}`,label);b.type='button';b.onclick=fn;return b}
function bookingNo(b){return text(b?.booking_number||b?.booking_no||b?.code||b?.reference||b?.id)}
function debt(b){return Math.max(0,num(b?.total_price)-num(b?.paid_amount))}
function ageAnchor(b){return b?.payment_due_date||b?.due_date||b?.created_at||b?.booking_date||null}
function ageDays(b){const v=ageAnchor(b);if(!v)return null;const d=new Date(v);if(!Number.isFinite(d.getTime()))return null;return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000))}
function bucket(days){if(days==null)return 'unknown';if(days<=7)return '0-7';if(days<=30)return '8-30';if(days<=60)return '31-60';return '60+'}
const bucketLabel={'0-7':'0–7 أيام','8-30':'8–30 يوم','31-60':'31–60 يوم','60+':'أكثر من 60 يوم',unknown:'غير محدد'};
function customerKey(b){const id=text(b?.customer_identity);if(id)return `id:${id}`;const phone=text(b?.customer_phone);if(phone)return `phone:${phone}`;return `booking:${bookingNo(b)}`}
function customerLabel(b){return text(b?.customer_name)||text(b?.customer_phone)||bookingNo(b)||'عميل'}
function tripLabel(b,tripMap){const t=tripMap.get(text(b?.trip_id));return text(t?.trip_code||t?.code)||'—'}
function dateLabel(v){if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium'}).format(new Date(v))}catch{return text(v)||'—'}}

async function load(){const boot=await api.bootstrap();return boot||{}}
function shell(){
 document.querySelector('.finance360-aging-backdrop')?.remove();
 const back=el('div','finance360-aging-backdrop'),box=el('section','finance360-aging-modal');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
 const head=el('div','finance360-aging-head'),copy=el('div');copy.append(el('strong','','مركز التحصيل والمتأخرات'),el('small','','الرصيد الرسمي للحجوزات · أعمار الأرصدة · أعلى العملاء مديونية · بدون تعديل أي مبلغ.'));const close=el('button','finance360-aging-close','×');close.type='button';head.append(copy,close);
 const body=el('div','finance360-aging-body'),foot=el('div','finance360-aging-foot');box.append(head,body,foot);back.append(box);document.body.append(back);const destroy=()=>back.remove();close.onclick=destroy;back.onclick=e=>{if(e.target===back)destroy()};foot.append(btn('إغلاق',destroy));return {body,close:destroy};
}
function stat(label,value,tone=''){const x=el('div',`finance360-aging-stat ${tone}`);x.append(el('small','',label),el('strong','',String(value)));return x}
function openBooking(modal,b){modal.close();location.assign(`/bookings/${encodeURIComponent(bookingNo(b))}`)}
function filterModel(all,filters){return all.filter(r=>{
 if(filters.branch&&text(r.branch_id)!==filters.branch)return false;
 if(filters.trip&&text(r.trip_id)!==filters.trip)return false;
 if(filters.bucket&&r.age_bucket!==filters.bucket)return false;
 if(filters.q){const q=low(filters.q);if(![r.booking_number,r.customer_name,r.customer_phone,r.customer_identity,r.branch_name,r.trip_code].some(v=>low(v).includes(q)))return false}
 return true;
})}
function build(boot){
 const branches=new Map((boot.branches||[]).map(x=>[text(x.id),x])),trips=new Map((boot.trips||[]).map(x=>[text(x.id),x]));
 const rows=(boot.bookings||[]).filter(activeBooking).map(b=>{const balance=debt(b),days=ageDays(b);return {booking:b,booking_number:bookingNo(b),customer_name:text(b.customer_name)||'—',customer_phone:text(b.customer_phone)||'—',customer_identity:text(b.customer_identity)||'',branch_id:text(b.branch_id),branch_name:text(branches.get(text(b.branch_id))?.name||branches.get(text(b.branch_id))?.city)||'—',trip_id:text(b.trip_id),trip_code:tripLabel(b,trips),balance,age_days:days,age_bucket:bucket(days),age_anchor:ageAnchor(b)}}).filter(r=>r.balance>0.001);
 const customers=new Map();for(const r of rows){const k=customerKey(r.booking),x=customers.get(k)||{key:k,name:customerLabel(r.booking),phone:text(r.booking.customer_phone),identity:text(r.booking.customer_identity),balance:0,bookings:0,max_age:0,rows:[]};x.balance+=r.balance;x.bookings++;x.max_age=Math.max(x.max_age,r.age_days||0);x.rows.push(r);customers.set(k,x)}
 return {rows,customers:[...customers.values()].sort((a,b)=>b.balance-a.balance),branches:[...branches.values()],trips:[...trips.values()]};
}
function render(modal,boot){
 const model=build(boot),filters={branch:'',trip:'',bucket:'',q:''};modal.body.innerHTML='';
 const controls=el('div','finance360-aging-controls'),q=el('input','finance360-aging-input');q.type='search';q.placeholder='ابحث بحجز أو عميل أو جوال أو هوية';
 const branch=el('select','finance360-aging-input'),trip=el('select','finance360-aging-input'),age=el('select','finance360-aging-input');branch.append(new Option('كل الفروع',''));model.branches.forEach(x=>branch.append(new Option(text(x.name||x.city)||'فرع',text(x.id))));trip.append(new Option('كل الرحلات',''));model.trips.forEach(x=>trip.append(new Option(text(x.trip_code||x.code)||'رحلة',text(x.id))));age.append(new Option('كل الأعمار',''));Object.entries(bucketLabel).forEach(([k,v])=>age.append(new Option(v,k)));controls.append(q,branch,trip,age);modal.body.append(controls);
 const summary=el('div','finance360-aging-summary'),customersBox=el('section','finance360-aging-section'),tableBox=el('section','finance360-aging-section');modal.body.append(summary,customersBox,tableBox);
 function paint(){
   filters.q=q.value;filters.branch=branch.value;filters.trip=trip.value;filters.bucket=age.value;const rows=filterModel(model.rows,filters),total=rows.reduce((n,r)=>n+r.balance,0);summary.innerHTML='';
   const c60=rows.filter(r=>r.age_bucket==='60+'),c3060=rows.filter(r=>r.age_bucket==='31-60');summary.append(stat('حجوزات عليها رصيد',rows.length),stat('إجمالي المتبقي',money(total),'warn'),stat('أكثر من 60 يوم',money(c60.reduce((n,r)=>n+r.balance,0)),c60.length?'bad':'good'),stat('31–60 يوم',money(c3060.reduce((n,r)=>n+r.balance,0)),c3060.length?'warn':'good'));
   const visibleIds=new Set(rows.map(r=>r.booking_number));const customerRows=model.customers.map(c=>{const rs=c.rows.filter(r=>visibleIds.has(r.booking_number));return {...c,rows:rs,balance:rs.reduce((n,r)=>n+r.balance,0),bookings:rs.length,max_age:Math.max(0,...rs.map(r=>r.age_days||0))}}).filter(c=>c.bookings>0).sort((a,b)=>b.balance-a.balance).slice(0,10);
   customersBox.innerHTML='';const ch=el('div','finance360-aging-section-head');ch.append(el('strong','','أعلى العملاء مديونية'),el('small','','حسب الحجوزات الظاهرة في الفلاتر الحالية'));customersBox.append(ch);const cg=el('div','finance360-aging-customers');if(!customerRows.length)cg.append(el('div','finance360-aging-empty','لا توجد مديونيات ضمن الفلاتر الحالية.'));customerRows.forEach(c=>{const card=el('article','finance360-aging-customer');card.append(el('strong','',c.name),el('small','',`${c.bookings} حجز · أقدم رصيد ${c.max_age||0} يوم`),el('b','',money(c.balance)));cg.append(card)});customersBox.append(cg);
   tableBox.innerHTML='';const th=el('div','finance360-aging-section-head');th.append(el('strong','','الحجوزات المطلوب تحصيلها'),el('small','',`${rows.length} حجز`));tableBox.append(th);const wrap=el('div','finance360-aging-table-wrap'),table=el('table','finance360-aging-table'),thead=el('thead'),hr=el('tr');['الحجز','العميل','الفرع','الرحلة','المتبقي','عمر الرصيد','مرجع العمر',''].forEach(x=>hr.append(el('th','',x)));thead.append(hr);table.append(thead);const tb=el('tbody');
   rows.sort((a,b)=>(b.age_days||-1)-(a.age_days||-1)||b.balance-a.balance).forEach(r=>{const tr=el('tr');const cells=[r.booking_number,`${r.customer_name}\n${r.customer_phone}`,r.branch_name,r.trip_code,money(r.balance),r.age_days==null?'غير محدد':`${r.age_days} يوم`,dateLabel(r.age_anchor)];cells.forEach((v,i)=>{const td=el('td',i===1?'finance360-aging-customer-cell':'');td.textContent=v;tr.append(td)});const td=el('td');td.append(btn('فتح الحجز للتحصيل',()=>openBooking(modal,r.booking),true));tr.append(td);tb.append(tr)});if(!rows.length){const tr=el('tr'),td=el('td','finance360-aging-empty','لا توجد حجوزات عليها رصيد ضمن الاختيارات الحالية.');td.colSpan=8;tr.append(td);tb.append(tr)}table.append(tb);wrap.append(table);tableBox.append(wrap);
 }
 [q,branch,trip,age].forEach(x=>x.addEventListener(x===q?'input':'change',paint));paint();
 const policy=el('div','finance360-aging-policy','عمر الرصيد يعتمد على تاريخ استحقاق الحجز إذا كان موجودًا في البيانات، وإلا على تاريخ إنشاء الحجز. هذه الشاشة لا تغيّر الرصيد ولا تنشئ تحصيلًا؛ التحصيل يتم من الحجز عبر المسار المالي الرسمي.');modal.body.append(policy);
}
async function openAging(){const modal=shell();modal.body.append(el('div','finance360-aging-loading','جاري تجهيز أعمار الأرصدة والمتأخرات…'));try{render(modal,await load())}catch(e){modal.body.innerHTML='';modal.body.append(el('div','finance360-aging-error',e?.message||'تعذر تحميل مركز التحصيل والمتأخرات.'))}}
function sync(){if(!onFinance())return;const host=document.querySelector('.finance360'),actions=host?.querySelector('.finance360-head-actions');if(!actions||actions.querySelector('.finance360-aging-launch'))return;const b=btn('التحصيل والمتأخرات',openAging);b.classList.add('finance360-aging-launch');actions.prepend(b)}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installFinance360Aging(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const o=new MutationObserver(queue);o.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue)}
