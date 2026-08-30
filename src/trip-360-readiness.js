import {api} from './lib/api.js';

const txt=v=>String(v??'').trim();
let queued=false;

function tripIdFromPath(){
  const m=window.location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);
  return m?decodeURIComponent(m[1]):'';
}
function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}
function count(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0}
function timeLabel(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return txt(v)||'—'}}
function stageLabel(v){
  const map={scheduled:'مجدولة',preparing:'التجهيز',boarding_outbound:'صعود الذهاب',departed_outbound:'تحرك الذهاب',arrived_destination:'الوصول',housing:'التسكين',preparing_return:'تجهيز العودة',boarding_return:'صعود العودة',departed_return:'تحرك العودة',arrived_return:'وصول العودة',completed:'مكتملة'};
  return map[txt(v).toLowerCase()]||txt(v)||'—';
}
function readCounts(root){
  const box=root?.querySelector('.trip360-exception-summary');
  if(box){
    const values=[...box.querySelectorAll('strong')].map(n=>count(n.textContent));
    if(values.length>=3)return {critical:values[0],warnings:values[1],total:values[2]};
  }
  const critical=root?.querySelectorAll('.trip360-exception.bad').length||0;
  const warnings=root?.querySelectorAll('.trip360-exception.warn').length||0;
  return {critical,warnings,total:critical+warnings};
}
function ackMatches(ack,counts,stage){
  const m=ack?.metadata||{};
  return count(m.critical_count)===counts.critical&&count(m.warning_count)===counts.warnings&&count(m.exception_total)===counts.total&&txt(m.operations_status).toLowerCase()===txt(stage).toLowerCase();
}
function openExceptions(root){
  const btn=[...root.querySelectorAll('.trip360-tabs button')].find(b=>txt(b.textContent).startsWith('الاستثناءات'));
  if(btn){btn.click();setTimeout(()=>root.querySelector('.trip360-exceptions-card')?.scrollIntoView({behavior:'smooth',block:'start'}),80)}
}
function modal(title,subtitle=''){
  document.querySelector('.trip360-ready-backdrop')?.remove();
  const back=el('div','trip360-ready-backdrop'),box=el('section','trip360-ready-modal');
  const head=el('div','trip360-ready-modal-head'),copy=el('div');copy.append(el('strong','',title));if(subtitle)copy.append(el('small','',subtitle));
  const close=el('button','','×');close.type='button';head.append(copy,close);
  const body=el('div','trip360-ready-modal-body'),notice=el('div','trip360-ready-notice'),foot=el('div','trip360-ready-modal-foot');
  box.append(head,body,notice,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.addEventListener('click',destroy);back.addEventListener('click',e=>{if(e.target===back)destroy()});
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`trip360-ready-notice ${tone}`.trim()};
  return {body,foot,close:destroy,setNotice};
}
function button(label,onClick,primary=false){const b=el('button',`trip360-ready-btn${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}
function openAck(host,state,tripId,counts){
  const m=modal('اعتماد مراجعة الاستثناءات',`${counts.critical} حرجة · ${counts.warnings} تحتاج مراجعة · المرحلة ${stageLabel(state?.trip?.operations_status)}`);
  const warn=el('div','trip360-ready-warning','هذا الاعتماد يوثق قرار مسؤول التشغيل فقط. لا يلغي حارس QR، ولا صلاحية المشرف، ولا أي منع من السيرفر.');m.body.append(warn);
  const label=el('label','trip360-ready-field'),span=el('span','','سبب الاعتماد — مطلوب'),area=el('textarea','trip360-ready-input');
  area.rows=4;area.maxLength=1000;area.placeholder='مثال: تمت مراجعة الحالات المتبقية والتواصل مع المسؤولين وسيتم استكمالها قبل التحرك';label.append(span,area);m.body.append(label);
  const cancel=button('إلغاء',m.close),save=button('توثيق الاعتماد',async()=>{
    const note=area.value.trim();if(note.length<5)return m.setNotice('اكتب سبب اعتماد واضح لا يقل عن 5 أحرف.','bad');
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري توثيق الاعتماد...');
    try{
      const out=await api.admin({action:'ack_trip_readiness_exception',trip_id:tripId,critical_count:counts.critical,warning_count:counts.warnings,exception_total:counts.total,note});
      m.setNotice(out?.notice||'تم توثيق الاعتماد.','good');
      setTimeout(()=>{m.close();render(host,{...state,ack:out?.ack||state?.ack},tripId,counts)},450);
    }catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر توثيق الاعتماد.','bad')}
  },true);
  m.foot.append(cancel,save);setTimeout(()=>area.focus(),50);
}
function render(host,state,tripId,counts){
  host.innerHTML='';host.dataset.trip=tripId;host.dataset.countKey=`${counts.critical}|${counts.warnings}|${counts.total}|${txt(state?.trip?.operations_status)}`;
  const currentAck=ackMatches(state?.ack,counts,state?.trip?.operations_status),hasIssues=counts.total>0;
  const tone=counts.critical?'bad':counts.warnings?'warn':'good';
  const title=counts.critical?'غير جاهز للتحرك حسب الفحص الحالي':counts.warnings?'جاهز بعد مراجعة التنبيهات':'جاهز تشغيليًا حسب الفحص الحالي';
  const head=el('div','trip360-ready-head'),copy=el('div');
  copy.append(el('small','',`بوابة الجاهزية · ${stageLabel(state?.trip?.operations_status)}`),el('strong','',title));
  const badge=el('span',`trip360-ready-badge ${tone}`,counts.critical?'غير جاهز':counts.warnings?'مراجعة':'جاهز');head.append(copy,badge);host.append(head);

  const stats=el('div','trip360-ready-stats');
  [['حرجة',counts.critical,'bad'],['تحتاج مراجعة',counts.warnings,'warn'],['الإجمالي',counts.total,'neutral']].forEach(([label,value,t])=>{const n=el('div',`trip360-ready-stat ${value?t:'good'}`);n.append(el('small','',label),el('strong','',String(value)));stats.append(n)});host.append(stats);

  const message=el('div',`trip360-ready-message ${tone}`);
  if(!hasIssues)message.textContent='✓ لا توجد استثناءات ظاهرة. لا يحتاج هذا الفحص إلى اعتماد استثناء.';
  else if(currentAck)message.textContent='✓ تمت مراجعة الاستثناءات الحالية وتوثيق الاعتماد لنفس المرحلة ونفس أعداد الفحص.';
  else if(state?.ack)message.textContent='الاعتماد السابق أصبح قديمًا لأن المرحلة أو أعداد الاستثناءات تغيرت. يلزم مراجعة جديدة إذا قررت الاستمرار.';
  else message.textContent='راجع مركز الاستثناءات قبل أي قرار تشغيل. يمكن توثيق مراجعتك بسبب واضح من هنا.';
  host.append(message);

  if(state?.ack){
    const m=state.ack.metadata||{},audit=el('div',`trip360-ready-audit ${currentAck?'current':'stale'}`);
    audit.append(el('strong','',currentAck?'آخر اعتماد مطابق للفحص الحالي':'آخر اعتماد سابق'),el('span','',`${txt(state.ack.actor_name)||'موظف'}${txt(state.ack.actor_role)?` — ${txt(state.ack.actor_role)}`:''} · ${timeLabel(state.ack.created_at)}`));
    if(txt(m.note))audit.append(el('small','',m.note));host.append(audit);
  }

  const foot=el('div','trip360-ready-actions');
  foot.append(button('فتح الاستثناءات',()=>{const root=host.closest('.trip360');if(root)openExceptions(root)}));
  if(hasIssues&&state?.can_ack&&!currentAck)foot.append(button(state?.ack?'تجديد الاعتماد':'اعتماد المراجعة',()=>openAck(host,state,tripId,counts),true));
  if(hasIssues&&currentAck)foot.append(el('span','trip360-ready-approved','✓ مراجعة موثقة'));
  host.append(foot);
  host.append(el('div','trip360-ready-policy','اعتماد المراجعة لا يتجاوز حارس الصعود أو صلاحيات التحرك والمشرف.'));
}
async function refresh(host,tripId,counts){
  if(!host?.isConnected)return;
  host.classList.add('loading');
  try{
    const state=await api.admin({action:'trip_readiness_state',trip_id:tripId});
    if(host.isConnected)render(host,state,tripId,counts);
  }catch(e){
    host.innerHTML='';const err=el('div','trip360-ready-error',e?.message||'تعذر تحميل بوابة الجاهزية.');
    err.append(button('إعادة المحاولة',()=>refresh(host,tripId,counts)));host.append(err);
  }finally{host.classList.remove('loading')}
}
function sync(force=false){
  const tripId=tripIdFromPath();
  if(!tripId){document.querySelector('.trip360-readiness-gate')?.remove();return}
  const root=document.querySelector('.trip360'),tabs=root?.querySelector('.trip360-tabs');if(!root||!tabs)return;
  const counts=readCounts(root);let host=root.querySelector('.trip360-readiness-gate');
  if(!host){host=el('section','trip360-readiness-gate');const life=root.querySelector('.trip360-lifecycle'),live=root.querySelector('.trip360-liveops');if(life)life.insertAdjacentElement('beforebegin',host);else if(live)live.insertAdjacentElement('beforebegin',host);else tabs.insertAdjacentElement('afterend',host)}
  const simpleKey=`${counts.critical}|${counts.warnings}|${counts.total}`;
  if(!force&&host.dataset.trip===tripId&&host.dataset.simpleKey===simpleKey)return;
  host.dataset.trip=tripId;host.dataset.simpleKey=simpleKey;refresh(host,tripId,counts);
}
function queue(force=false){if(queued&&!force)return;queued=true;requestAnimationFrame(()=>{queued=false;sync(force)})}
export function installTrip360ReadinessGate(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue(true);
  const observer=new MutationObserver(()=>queue(false));observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  window.addEventListener('popstate',()=>queue(true));
  window.addEventListener('almaher-trip-stage-changed',()=>queue(true));
}
