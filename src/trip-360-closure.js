import {api} from './lib/api.js';

const txt=v=>String(v??'').trim();
let queued=false;
function tripIdFromPath(){const m=location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);return m?decodeURIComponent(m[1]):''}
function el(tag,cls,label){const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n}
function btn(label,fn,primary=false){const b=el('button',`trip360-close-btn${primary?' primary':''}`,label);b.type='button';b.onclick=fn;return b}
function scrollTo(selector){const n=document.querySelector(selector);if(n)n.scrollIntoView({behavior:'smooth',block:'start'})}
function render(host,state,tripId){
  host.innerHTML='';const c=state?.closure||{},trip=state?.trip||{},completed=c.completed||txt(trip.operations_status)==='completed';
  const tone=completed?'done':c.available===false?'bad':c.blocker_count>0?'bad':c.warning_count>0?'warn':'good';
  const title=completed?'تم إقفال الرحلة تشغيليًا':c.available===false?'تعذر التحقق من الإقفال':c.blocker_count>0?'الرحلة غير جاهزة للإقفال':c.warning_count>0?'الرحلة جاهزة بعد ملاحظة إقفال':'الرحلة جاهزة للإقفال';
  const head=el('div','trip360-close-head'),copy=el('div');copy.append(el('strong','', 'إقفال الرحلة التشغيلي'),el('small','',title));
  const actions=el('div','trip360-close-actions');actions.append(btn('تحديث',()=>refresh(host,tripId)));head.append(copy,actions);host.append(head);

  if(c.available===false){const err=el('div','trip360-close-message bad',c.error||'تعذر فحص التسليمات والمشاكل المفتوحة. الإقفال سيظل محميًا من السيرفر.');host.append(err);return}

  const stats=el('div','trip360-close-stats');
  const values=[
    ['تسليمات مفتوحة',c.handoffs?.open||0,c.handoffs?.open?'bad':'good'],
    ['حرجة/عالية',(Number(c.incidents?.critical||0)+Number(c.incidents?.high||0)),(Number(c.incidents?.critical||0)+Number(c.incidents?.high||0))?'bad':'good'],
    ['متوسطة/منخفضة',c.incidents?.warning||0,c.incidents?.warning?'warn':'good'],
    ['الحالة',completed?'مقفلة':c.blocker_count>0?'موقوف':c.warning_count>0?'مراجعة':'جاهز',tone]
  ];
  values.forEach(([label,value,t])=>{const box=el('div',`trip360-close-stat ${t}`);box.append(el('small','',label),el('strong','',String(value)));stats.append(box)});host.append(stats);

  const msg=el('div',`trip360-close-message ${tone}`);
  if(completed)msg.textContent='✓ تم تسجيل الرحلة كمكتملة واجتازت بوابة الإقفال وقت التنفيذ.';
  else if(c.blocker_count>0)msg.textContent=`يوجد ${c.blocker_count} مانع إقفال. اقفل التسليمات المفتوحة وعالج المشاكل العالية/الحرجة أولًا.`;
  else if(c.warning_count>0)msg.textContent=`لا توجد موانع إقفال، لكن يوجد ${c.warning_count} مشكلة متوسطة/منخفضة مفتوحة. عند اختيار «مكتملة» يلزم كتابة ملاحظة إقفال.`;
  else msg.textContent='✓ لا توجد تسليمات مفتوحة أو مشاكل عالية/حرجة. يمكنك إكمال الرحلة من دورة التشغيل.';
  host.append(msg);

  if(!completed){
    const list=el('div','trip360-close-list');
    if(Number(c.handoffs?.open||0)>0){const row=el('div','trip360-close-item bad');row.append(el('span','','التسليم والاستلام'),el('strong','',`${c.handoffs.open} سجل مفتوح`),btn('فتح السجل',()=>scrollTo('.trip360-handoff')));list.append(row)}
    if(Number(c.incidents?.critical||0)+Number(c.incidents?.high||0)>0){const n=Number(c.incidents?.critical||0)+Number(c.incidents?.high||0),row=el('div','trip360-close-item bad');row.append(el('span','','المشاكل التشغيلية'),el('strong','',`${n} مشكلة مانعة`),btn('فتح المشاكل',()=>scrollTo('.trip360-incidents')));list.append(row)}
    if(Number(c.incidents?.warning||0)>0){const row=el('div','trip360-close-item warn');row.append(el('span','','مشاكل غير مانعة'),el('strong','',`${c.incidents.warning} تحتاج توثيق`),btn('مراجعة',()=>scrollTo('.trip360-incidents')));list.append(row)}
    if(list.children.length)host.append(list);
    const foot=el('div','trip360-close-foot');
    if(c.blocker_count===0)foot.append(btn('الذهاب لدورة التشغيل',()=>scrollTo('.trip360-lifecycle'),true));
    else foot.append(el('span','trip360-close-policy','لن يسمح السيرفر بتسجيل «مكتملة» قبل إزالة الموانع.'));
    host.append(foot);
  }
  host.append(el('div','trip360-close-policy','السياسة: التسليم المفتوح أو المشكلة العالية/الحرجة تمنع الإقفال. المشاكل المتوسطة والمنخفضة تتطلب ملاحظة عند الإقفال.'));
}
async function refresh(host,tripId){
  if(!host?.isConnected)return;host.classList.add('loading');
  try{const state=await api.admin({action:'trip_closure_state',trip_id:tripId});if(host.isConnected)render(host,state,tripId)}
  catch(e){if(host.isConnected){host.innerHTML='';const box=el('div','trip360-close-error',e?.message||'تعذر تحميل فحص الإقفال.');box.append(btn('إعادة المحاولة',()=>refresh(host,tripId)));host.append(box)}}
  finally{host.classList.remove('loading')}
}
function sync(force=false){
  const tripId=tripIdFromPath();if(!tripId){document.querySelector('.trip360-closure')?.remove();return}
  const root=document.querySelector('.trip360'),life=root?.querySelector('.trip360-lifecycle');if(!root||!life)return;
  let host=root.querySelector('.trip360-closure');
  if(!host){host=el('section','trip360-closure');life.insertAdjacentElement('beforebegin',host)}
  if(!force&&host.dataset.trip===tripId)return;host.dataset.trip=tripId;refresh(host,tripId);
}
function queue(force=false){if(queued&&!force)return;queued=true;requestAnimationFrame(()=>{queued=false;sync(force)})}
export function installTrip360Closure(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue(true);const observer=new MutationObserver(()=>queue(false));observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>queue(true));window.addEventListener('almaher-trip-stage-changed',()=>queue(true));
}
