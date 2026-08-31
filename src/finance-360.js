import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const sar=v=>`${num(v).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س`;
let queued=false;
let lastPath='';

function onFinance(){return /^\/finance(?:\/|$)/i.test(location.pathname)}
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n}
function btn(label,fn,primary=false){const b=el('button',`finance360-btn${primary?' primary':''}`,label);b.type='button';b.onclick=fn;return b}
function anomalyCount(a){return Object.values(a||{}).reduce((n,v)=>n+(Array.isArray(v)?v.length:0),0)}
function clickExisting(label){
  const wanted=text(label);
  const candidates=[...document.querySelectorAll('button')];
  const target=candidates.find(b=>text(b.textContent)===wanted)||candidates.find(b=>text(b.textContent).includes(wanted));
  if(target){target.click();setTimeout(()=>target.scrollIntoView({behavior:'smooth',block:'center'}),80);return true}
  return false;
}
async function reconciliation(){
  const r=await fetch('/api/finance/reconcile',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
  const raw=await r.text();let out={};try{out=raw?JSON.parse(raw):{}}catch{out={error:raw}}
  if(!r.ok)throw new Error(out?.error||`HTTP ${r.status}`);return out;
}
async function load(){
  const [fullR,briefR,recR]=await Promise.allSettled([
    api.module('finance_full'),
    api.mega('executive_brief',{},'GET'),
    reconciliation()
  ]);
  if(fullR.status!=='fulfilled')throw fullR.reason||new Error('تعذر تحميل بيانات المالية.');
  return {full:fullR.value||{},brief:briefR.status==='fulfilled'?briefR.value:null,reconcile:recR.status==='fulfilled'?recR.value:null,reconcileError:recR.status==='rejected'?recR.reason?.message||'غير متاح':''};
}
function metric(label,value,detail='',tone=''){const x=el('div',`finance360-metric ${tone}`);x.append(el('small','',label),el('strong','',value));if(detail)x.append(el('span','',detail));return x}
function signal(label,value,tone=''){const x=el('div',`finance360-signal ${tone}`);x.append(el('span','',label),el('b','',String(value)));return x}
function render(host,state){
  host.innerHTML='';const d=state.full||{},b=state.brief||{},rec=state.reconcile;
  const transactions=d.transactions||[],shifts=d.cash_shifts||[],registers=d.cash_registers||[],suppliers=d.supplier_payables||[];
  const pending=transactions.filter(x=>low(x.status)==='pending').length;
  const openShifts=shifts.filter(x=>low(x.status||'open')==='open').length;
  const shiftVariance=shifts.filter(x=>low(x.status)==='closed').reduce((n,x)=>n+Math.abs(num(x.variance)),0);
  const activeRegisters=registers.filter(x=>x.active!==false).length;
  const supplierOutstanding=suppliers.reduce((n,x)=>n+Math.max(0,num(x.amount)-num(x.paid_amount)),0);
  const issues=rec?anomalyCount(rec.anomalies):null;
  const healthTone=issues==null?'neutral':issues>0?'bad':pending>0||shiftVariance>0?'warn':'good';
  const healthLabel=issues==null?'الفحص غير متاح':issues>0?`${issues} حالة تحتاج مراجعة`:pending>0||shiftVariance>0?'توجد مؤشرات تحتاج متابعة':'الوضع المالي سليم في الفحص الحالي';

  const head=el('div','finance360-head'),copy=el('div');copy.append(el('b','','Finance 360'),el('strong','','مركز السيطرة المالية'),el('small','','ملخص موحد من السجل المالي الحقيقي والخزن والورديات والمطابقة — بدون إنشاء حركات مالية جديدة.'));
  const actions=el('div','finance360-head-actions');actions.append(btn('تحديث',()=>refresh(host),true));head.append(copy,actions);host.append(head);

  const metrics=el('div','finance360-metrics');
  metrics.append(
    metric('إجمالي الحجوزات',sar(b.revenue),'قيمة الحجوزات الظاهرة للنطاق الحالي'),
    metric('التحصيل التاريخي',sar(b.paid),'قبل خصم الاستردادات'),
    metric('صافي المحصل',sar(b.net),'بعد الاستردادات','good'),
    metric('المصروفات',sar(b.expenses),'المصروفات المسجلة','warn'),
    metric('المتبقي للتحصيل',sar(b.outstanding),'رصيد حجوزات غير محصل','warn'),
    metric('مستحقات الموردين',sar(supplierOutstanding),'المتبقي غير المدفوع للموردين')
  );host.append(metrics);

  const row=el('div','finance360-lower');
  const health=el('section',`finance360-health ${healthTone}`),hhead=el('div','finance360-block-head');hhead.append(el('strong','','صحة السجل المالي'),el('span','',healthLabel));health.append(hhead);
  const signals=el('div','finance360-signals');signals.append(
    signal('حركات Pending',pending,pending?'bad':'good'),
    signal('ورديات مفتوحة',openShifts,openShifts?'warn':'good'),
    signal('إجمالي فروقات الورديات',sar(shiftVariance),shiftVariance?'warn':'good'),
    signal('خزن نشطة',activeRegisters,activeRegisters?'good':'neutral'),
    signal('حالات المطابقة',issues==null?'—':issues,issues>0?'bad':issues===0?'good':'neutral')
  );health.append(signals);
  if(state.reconcileError)health.append(el('div','finance360-note',`فحص المطابقة غير متاح لهذا الحساب أو في هذه اللحظة: ${state.reconcileError}`));

  const quick=el('section','finance360-quick'),qhead=el('div','finance360-block-head');qhead.append(el('strong','','وصول سريع'),el('span','','يفتح الأدوات الحالية بدل تكرارها'));quick.append(qhead);
  const qbuttons=el('div','finance360-quick-actions');[
    ['الحركات المالية','الحركات'],['المصروفات','المصروفات'],['الخزن','الخزن'],['الورديات','الورديات'],['مستحقات الموردين','مستحقات الموردين'],['المطابقة المالية','فحص المطابقة المالية']
  ].forEach(([label,target])=>qbuttons.append(btn(label,()=>clickExisting(target))));quick.append(qbuttons);
  row.append(health,quick);host.append(row);

  const policy=el('div','finance360-policy','Finance 360 في هذه المرحلة قراءة ومراقبة فقط. التحصيل والاسترداد والمصروفات والورديات تستمر عبر المسارات الحالية ذات الصلاحيات والسجلات الرسمية.');host.append(policy);
}
async function refresh(host){
  if(!host?.isConnected)return;host.classList.add('loading');
  try{render(host,await load())}catch(e){host.innerHTML='';const box=el('div','finance360-error',e?.message||'تعذر تحميل مركز المالية.');box.append(btn('إعادة المحاولة',()=>refresh(host),true));host.append(box)}finally{host.classList.remove('loading')}
}
function sync(force=false){
  if(!onFinance()){document.querySelector('.finance360')?.remove();lastPath=location.pathname;return}
  const anchor=document.querySelector('.finance-stats');if(!anchor)return;
  let host=document.querySelector('.finance360');if(!host){host=el('section','finance360');anchor.insertAdjacentElement('beforebegin',host)}
  const path=location.pathname;if(!force&&host.dataset.path===path&&lastPath===path)return;host.dataset.path=path;lastPath=path;refresh(host);
}
function queue(force=false){if(queued&&!force)return;queued=true;requestAnimationFrame(()=>{queued=false;sync(force)})}
export function installFinance360(){
  if(typeof window==='undefined'||typeof document==='undefined')return;queue(true);
  const observer=new MutationObserver(()=>queue(false));observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>queue(true));window.addEventListener('focus',()=>{if(onFinance())queue(true)});
}
