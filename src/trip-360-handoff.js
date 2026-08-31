import {api} from './lib/api.js';

const txt=v=>String(v??'').trim();
let queued=false;
const labels={branch:'موظف الفرع',supervisor:'المشرف',operations:'التشغيل',housing:'التسكين'};
function tripIdFromPath(){const m=window.location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);return m?decodeURIComponent(m[1]):''}
function el(tag,className,label){const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=label;return n}
function timeLabel(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return txt(v)||'—'}}
function areaLabel(v){return labels[txt(v)]||txt(v)||'—'}
function button(label,onClick,primary=false){const b=el('button',`trip360-handoff-btn${primary?' primary':''}`,label);b.type='button';b.addEventListener('click',onClick);return b}
function modal(title,subtitle=''){
  document.querySelector('.trip360-handoff-backdrop')?.remove();
  const back=el('div','trip360-handoff-backdrop'),box=el('section','trip360-handoff-modal');
  box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  const head=el('div','trip360-handoff-modal-head'),copy=el('div');copy.append(el('strong','',title));if(subtitle)copy.append(el('small','',subtitle));
  const close=el('button','','×');close.type='button';head.append(copy,close);
  const body=el('div','trip360-handoff-modal-body'),notice=el('div','trip360-handoff-notice'),foot=el('div','trip360-handoff-modal-foot');
  box.append(head,body,notice,foot);back.append(box);document.body.append(back);
  const destroy=()=>back.remove();close.addEventListener('click',destroy);back.addEventListener('click',e=>{if(e.target===back)destroy()});
  const setNotice=(message,tone='')=>{notice.textContent=message||'';notice.className=`trip360-handoff-notice ${tone}`.trim()};
  return {body,foot,close:destroy,setNotice};
}
function field(label,node){const wrap=el('label','trip360-handoff-field');wrap.append(el('span','',label),node);return wrap}
function selectArea(value='branch'){
  const s=el('select','trip360-handoff-input');
  Object.entries(labels).forEach(([k,v])=>{const o=el('option','',v);o.value=k;if(k===value)o.selected=true;s.append(o)});return s;
}
function textarea(placeholder,rows=4){const n=el('textarea','trip360-handoff-input');n.rows=rows;n.maxLength=2200;n.placeholder=placeholder;return n}
function actor(ev){const name=txt(ev?.actor_name)||'النظام',role=txt(ev?.actor_role);return role?`${name} — ${role}`:name}
function statusLabel(v){return v==='closed'?'مغلق':v==='received'?'تم الاستلام':'بانتظار الاستلام'}
function statusTone(v){return v==='closed'?'done':v==='received'?'received':'pending'}
function openCreate(host,state,tripId){
  const m=modal('تسليم الرحلة','سجّل من يسلّم وإلى أي جهة وما الذي يحتاج متابعة.');
  const from=selectArea('branch'),to=selectArea('operations'),note=textarea('مثال: تم إنهاء مراجعة الركاب وتسليم الرحلة للتشغيل'),items=textarea('مثال:\n- راكب رقم 4 لم يرفع الهوية\n- انتظار تأكيد الغرفة 203',5);
  m.body.append(field('أنا أسلّم بصفتي',from),field('جهة الاستلام',to),field('ملاحظة التسليم — مطلوبة',note),field('بنود مفتوحة للمتابعة — اختياري',items));
  const cancel=button('إلغاء',m.close),save=button('تسجيل التسليم',async()=>{
    if(from.value===to.value)return m.setNotice('اختر جهتين مختلفتين للتسليم والاستلام.','bad');
    if(note.value.trim().length<5)return m.setNotice('اكتب ملاحظة تسليم واضحة لا تقل عن 5 أحرف.','bad');
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري تسجيل التسليم...');
    try{
      await api.admin({action:'create_trip_handoff',trip_id:tripId,from_area:from.value,to_area:to.value,note:note.value.trim(),open_items:items.value.trim()});
      m.setNotice('تم تسجيل التسليم.','good');setTimeout(()=>{m.close();refresh(host,tripId)},400);
    }catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر تسجيل التسليم.','bad')}
  },true);m.foot.append(cancel,save);setTimeout(()=>note.focus(),50);
}
function openReceive(host,item,tripId){
  const m=modal('تأكيد استلام الرحلة',`${areaLabel(item.from_area)} ← ${areaLabel(item.to_area)}`),note=textarea('ملاحظة عند الاستلام — اختياري',3);
  if(txt(item.open_items)){const box=el('div','trip360-handoff-open-items');box.append(el('strong','','بنود مفتوحة'),el('p','',item.open_items));m.body.append(box)}
  m.body.append(field('ملاحظة الاستلام',note));
  const cancel=button('إلغاء',m.close),save=button('تأكيد الاستلام',async()=>{
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري تسجيل الاستلام...');
    try{await api.admin({action:'receive_trip_handoff',trip_id:tripId,handoff_id:item.handoff_id,note:note.value.trim()});m.setNotice('تم تسجيل الاستلام.','good');setTimeout(()=>{m.close();refresh(host,tripId)},400)}
    catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر تسجيل الاستلام.','bad')}
  },true);m.foot.append(cancel,save);
}
function openClose(host,item,tripId){
  const m=modal('إغلاق التسليم والاستلام','اكتب نتيجة المتابعة قبل إغلاق السجل.'),note=textarea('مثال: تم إنهاء البنود المفتوحة وتسليم المسؤولية للمرحلة التالية',4);m.body.append(field('ملاحظة الإغلاق — مطلوبة',note));
  const cancel=button('إلغاء',m.close),save=button('إغلاق السجل',async()=>{
    if(note.value.trim().length<5)return m.setNotice('اكتب ملاحظة إغلاق واضحة لا تقل عن 5 أحرف.','bad');
    save.disabled=true;cancel.disabled=true;m.setNotice('جاري إغلاق السجل...');
    try{await api.admin({action:'close_trip_handoff',trip_id:tripId,handoff_id:item.handoff_id,note:note.value.trim()});m.setNotice('تم إغلاق السجل.','good');setTimeout(()=>{m.close();refresh(host,tripId)},400)}
    catch(e){save.disabled=false;cancel.disabled=false;m.setNotice(e?.message||'تعذر إغلاق السجل.','bad')}
  },true);m.foot.append(cancel,save);setTimeout(()=>note.focus(),50);
}
function render(host,state,tripId){
  host.innerHTML='';host.dataset.trip=tripId;
  const summary=state?.summary||{},items=Array.isArray(state?.handoffs)?state.handoffs:[];
  const head=el('div','trip360-handoff-head'),copy=el('div');copy.append(el('strong','','تسليم واستلام الرحلة'),el('small','','سجل مسؤولية واضح بين الفرع والمشرف والتشغيل والتسكين.'));
  const actions=el('div','trip360-handoff-head-actions');actions.append(button('تحديث',()=>refresh(host,tripId)));if(state?.can_create)actions.append(button('تسليم جديد',()=>openCreate(host,state,tripId),true));head.append(copy,actions);host.append(head);
  const stats=el('div','trip360-handoff-stats');[['بانتظار الاستلام',summary.pending||0,'pending'],['تم الاستلام',summary.received||0,'received'],['مفتوح',summary.open||0,'open'],['مغلق',summary.closed||0,'done']].forEach(([label,value,tone])=>{const n=el('div',`trip360-handoff-stat ${tone}`);n.append(el('small','',label),el('strong','',String(value)));stats.append(n)});host.append(stats);
  host.append(el('div','trip360-handoff-policy','هذا السجل يوثق المسؤولية والمتابعة فقط؛ لا يغيّر مرحلة الرحلة ولا يتجاوز بوابة الجاهزية أو حارس الصعود.'));
  if(!items.length){host.append(el('div','trip360-handoff-empty','لا يوجد تسليم أو استلام مسجل لهذه الرحلة حتى الآن.'));return}
  const list=el('div','trip360-handoff-list');
  items.slice(0,12).forEach(item=>{
    const card=el('article',`trip360-handoff-item ${statusTone(item.status)}`),top=el('div','trip360-handoff-item-top'),route=el('div','trip360-handoff-route');
    route.append(el('span','',areaLabel(item.from_area)),el('b','','←'),el('span','',areaLabel(item.to_area)));
    top.append(route,el('span',`trip360-handoff-status ${statusTone(item.status)}`,statusLabel(item.status)));card.append(top);
    const meta=el('div','trip360-handoff-meta');meta.append(el('strong','',`سلّم: ${actor(item.created)}`),el('span','',`${timeLabel(item.created?.created_at)} · مرحلة ${txt(item.operations_status)||'—'}`));card.append(meta);
    if(txt(item.note))card.append(el('p','trip360-handoff-note',item.note));
    if(txt(item.open_items)){const open=el('div','trip360-handoff-open-items');open.append(el('strong','','بنود مفتوحة'),el('p','',item.open_items));card.append(open)}
    if(item.received){const r=el('div','trip360-handoff-event');r.append(el('strong','','استلم'),el('span','',`${actor(item.received)} · ${timeLabel(item.received.created_at)}`));if(txt(item.received?.metadata?.note))r.append(el('small','',item.received.metadata.note));card.append(r)}
    if(item.closed){const c=el('div','trip360-handoff-event closed');c.append(el('strong','','أغلق'),el('span','',`${actor(item.closed)} · ${timeLabel(item.closed.created_at)}`));if(txt(item.closed?.metadata?.note))c.append(el('small','',item.closed.metadata.note));card.append(c)}
    const foot=el('div','trip360-handoff-item-actions');if(item.can_receive)foot.append(button('تأكيد الاستلام',()=>openReceive(host,item,tripId),true));if(item.can_close)foot.append(button('إغلاق المتابعة',()=>openClose(host,item,tripId),true));if(foot.children.length)card.append(foot);list.append(card);
  });host.append(list);
}
async function refresh(host,tripId){
  if(!host?.isConnected)return;host.classList.add('loading');
  try{const state=await api.admin({action:'trip_handoff_state',trip_id:tripId});if(host.isConnected&&host.dataset.trip===tripId)render(host,state,tripId)}
  catch(e){if(host.isConnected){host.innerHTML='';const err=el('div','trip360-handoff-error',e?.message||'تعذر تحميل سجل التسليم والاستلام.');err.append(button('إعادة المحاولة',()=>refresh(host,tripId)));host.append(err)}}finally{host.classList.remove('loading')}
}
function sync(){
  const tripId=tripIdFromPath();if(!tripId){document.querySelector('.trip360-handoff')?.remove();return}
  const root=document.querySelector('.trip360'),tabs=root?.querySelector('.trip360-tabs');if(!root||!tabs)return;
  let host=root.querySelector('.trip360-handoff');if(host&&host.dataset.trip===tripId)return;host?.remove();host=el('section','trip360-handoff');host.dataset.trip=tripId;
  const life=root.querySelector('.trip360-lifecycle'),live=root.querySelector('.trip360-liveops');if(life)life.insertAdjacentElement('afterend',host);else if(live)live.insertAdjacentElement('beforebegin',host);else tabs.insertAdjacentElement('afterend',host);refresh(host,tripId);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installTrip360Handoff(){if(typeof window==='undefined'||typeof document==='undefined')return;queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',queue);window.addEventListener('almaher-trip-stage-changed',()=>{const host=document.querySelector('.trip360-handoff'),id=tripIdFromPath();if(host&&id)refresh(host,id)})}
