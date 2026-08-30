import {api} from './lib/api.js';

const txt=v=>String(v??'').trim();
let queued=false;

function tripIdFromPath(){
  const m=window.location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);
  return m?decodeURIComponent(m[1]):'';
}
function el(tag,className,label){
  const n=document.createElement(tag);
  if(className)n.className=className;
  if(label!==undefined)n.textContent=label;
  return n;
}
function timeLabel(v){
  if(!v)return '—';
  try{return new Date(v).toLocaleString('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
  catch{return txt(v)||'—'}
}
function button(label,onClick,primary=false){
  const b=el('button',`trip360-life-btn${primary?' primary':''}`,label);
  b.type='button';b.addEventListener('click',onClick);return b;
}
function modal(title,subtitle=''){
  document.querySelector('.trip360-life-backdrop')?.remove();
  const back=el('div','trip360-life-backdrop'),box=el('section','trip360-life-modal');
  box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const head=el('div','trip360-life-modal-head'),copy=el('div');
  copy.append(el('strong','',title));if(subtitle)copy.append(el('small','',subtitle));
  const close=el('button','','×');close.type='button';head.append(copy,close);
  const body=el('div','trip360-life-modal-body'),notice=el('div','trip360-life-notice'),foot=el('div','trip360-life-modal-foot');
  box.append(head,body,notice,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.addEventListener('click',destroy);back.addEventListener('click',e=>{if(e.target===back)destroy()});
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`trip360-life-notice ${tone}`.trim()};
  return {body,foot,close:destroy,setNotice};
}
function openTransition(host,state,tripId){
  if(!state?.next_status)return;
  const m=modal(`تسجيل: ${state.next_label||state.next_status}`,`المرحلة الحالية: ${state.current_label||state.current_status}`);
  const warnKeys=new Set(['departed_outbound','departed_return','completed']);
  if(warnKeys.has(state.next_status)){
    const w=el('div','trip360-life-warning',state.next_status==='completed'?'إكمال الرحلة يقفل دورة التشغيل ويثبتها كمكتملة. راجع حالة الوصول قبل الحفظ.':'تسجيل التحرك حدث تشغيلي مهم وسيظهر باسم الموظف ووقت التنفيذ.');
    m.body.append(w);
  }
  const label=el('label','trip360-life-field'),span=el('span','','ملاحظة تشغيلية — اختياري'),area=el('textarea','trip360-life-input');
  area.rows=4;area.maxLength=1000;area.placeholder='مثال: اكتمل الصعود وتم التأكد من كشف الركاب';
  label.append(span,area);m.body.append(label);
  const cancel=button('إلغاء',m.close),save=button(`تأكيد ${state.next_label||''}`,async()=>{
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري تسجيل المرحلة...');
    try{
      await api.admin({
        action:'set_trip_operations_status',
        trip_id:tripId,
        status:state.next_status,
        version_no:Number(state.trip?.version_no||1),
        note:area.value.trim()
      });
      m.setNotice('تم تسجيل المرحلة بنجاح.','good');
      try{window.dispatchEvent(new CustomEvent('almaher-trip-stage-changed',{detail:{tripId,status:state.next_status}}))}catch{}
      setTimeout(()=>{m.close();refresh(host,tripId)},450);
    }catch(e){
      save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر تسجيل المرحلة.','bad');
    }
  },true);
  m.foot.append(cancel,save);
}
function eventActor(ev){
  const name=txt(ev?.actor_name)||'النظام',role=txt(ev?.actor_role);
  return role?`${name} — ${role}`:name;
}
function render(host,state,tripId){
  host.innerHTML='';
  const currentIndex=Number(state.current_index),path=Array.isArray(state.path)?state.path:[],events=Array.isArray(state.events)?state.events:[];
  const latestByKey=new Map();
  for(const ev of events){if(!latestByKey.has(txt(ev.event_key)))latestByKey.set(txt(ev.event_key),ev)}
  const head=el('div','trip360-life-head'),copy=el('div');
  copy.append(el('strong','','دورة تشغيل الرحلة'),el('small','','كل مرحلة تُسجل بالوقت واسم الموظف وتظهر في سجل التشغيل.'));
  const actions=el('div','trip360-life-head-actions'),refreshBtn=button('تحديث',()=>refresh(host,tripId));
  actions.append(refreshBtn);head.append(copy,actions);host.append(head);

  const current=el('div',`trip360-life-current ${state.current_status==='completed'?'done':''}`);
  const currentCopy=el('div');
  currentCopy.append(el('small','','المرحلة الحالية'),el('strong','',state.current_label||state.current_status||'—'));
  const currentEvent=latestByKey.get(txt(state.current_status));
  currentCopy.append(el('span','',currentEvent?`${timeLabel(currentEvent.actual_at)} · ${eventActor(currentEvent)}`:'لم تُسجل لها حركة زمنية بعد'));
  current.append(currentCopy);
  if(state.can_write&&state.next_status)current.append(button(`التالي: ${state.next_label}`,()=>openTransition(host,state,tripId),true));
  else if(!state.next_status)current.append(el('span','trip360-life-complete','✓ الدورة مكتملة'));
  host.append(current);

  const track=el('div','trip360-life-track');
  path.forEach((stage,i)=>{
    const ev=latestByKey.get(txt(stage.key)),item=el('div',`trip360-life-stage ${i<currentIndex?'done':i===currentIndex?'current':'pending'}`);
    const mark=el('span','trip360-life-mark',i<currentIndex?'✓':i===currentIndex?'●':String(i+1));
    const body=el('div','trip360-life-stage-copy');
    body.append(el('strong','',stage.label||stage.key));
    if(ev)body.append(el('small','',`${timeLabel(ev.actual_at)} · ${eventActor(ev)}`));
    else if(i===0&&stage.key==='scheduled')body.append(el('small','','الحالة الابتدائية للرحلة'));
    else body.append(el('small','','لم تُسجل بعد'));
    item.append(mark,body);track.append(item);
  });
  host.append(track);

  const flags=el('div','trip360-life-flags');
  flags.append(
    el('span',state.has_housing?'good':'muted',state.has_housing?'السكن ضمن الدورة':'لا يوجد سكن مطلوب حاليًا'),
    el('span',state.has_return?'good':'muted',state.has_return?'العودة ضمن الدورة':'رحلة بدون عودة على نفس السجل'),
    el('span',state.trip?.data_environment==='training'?'training':'',state.trip?.data_environment==='training'?'بيانات تدريب':'بيئة التشغيل الحالية')
  );
  host.append(flags);

  const history=el('div','trip360-life-history'),historyHead=el('div','trip360-life-history-head');
  historyHead.append(el('strong','','سجل مراحل التشغيل'),el('small','',`${events.length} حدث مسجل`));history.append(historyHead);
  if(!events.length){
    history.append(el('div','trip360-life-empty','لا توجد مراحل مسجلة بعد. ابدأ من «التجهيز».'));
  }else{
    const list=el('div','trip360-life-history-list');
    events.slice(0,12).forEach(ev=>{
      const row=el('div','trip360-life-history-row'),dot=el('span','trip360-life-history-dot'),body=el('div');
      body.append(el('strong','',ev.label||ev.event_key),el('small','',`${timeLabel(ev.actual_at)} · ${eventActor(ev)}`));
      if(txt(ev.notes))body.append(el('p','',ev.notes));row.append(dot,body);list.append(row);
    });
    history.append(list);
  }
  host.append(history);
}
async function refresh(host,tripId){
  if(!host?.isConnected)return;
  host.classList.add('loading');host.dataset.trip=tripId;
  try{
    const state=await api.admin({action:'trip_operations_timeline',trip_id:tripId});
    if(host.isConnected&&host.dataset.trip===tripId)render(host,state,tripId);
  }catch(e){
    if(host.isConnected&&host.dataset.trip===tripId){
      host.innerHTML='';
      const err=el('div','trip360-life-error',e?.message||'تعذر تحميل دورة تشغيل الرحلة.');
      const retry=button('إعادة المحاولة',()=>refresh(host,tripId));host.append(err,retry);
    }
  }finally{host.classList.remove('loading')}
}
function sync(){
  const tripId=tripIdFromPath();
  if(!tripId){document.querySelector('.trip360-lifecycle')?.remove();return}
  const root=document.querySelector('.trip360'),tabs=root?.querySelector('.trip360-tabs');
  if(!root||!tabs)return;
  let host=root.querySelector('.trip360-lifecycle');
  if(host&&host.dataset.trip===tripId)return;
  host?.remove();host=el('section','trip360-lifecycle');host.dataset.trip=tripId;
  const live=root.querySelector('.trip360-liveops');
  if(live)live.insertAdjacentElement('beforebegin',host);else tabs.insertAdjacentElement('afterend',host);
  refresh(host,tripId);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installTrip360Lifecycle(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();
  const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',queue);
}