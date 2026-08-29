let installed=false;
let reloadTimer=null;

const text=v=>String(v??'').trim();

function isBookingEditorPath(){return /^\/bookings\/[^/?#]+\/?$/i.test(window.location.pathname)&&!/^\/bookings\/new\/?$/i.test(window.location.pathname)}

function requestMeta(input,init={}){
  try{
    const url=new URL(typeof input==='string'?input:input?.url||'',window.location.origin);
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    let body=init?.body;
    if(body===undefined&&input instanceof Request)body=null;
    let parsed=null;
    if(typeof body==='string'&&body.trim().startsWith('{')){try{parsed=JSON.parse(body)}catch{}}
    return {path:url.pathname,method,body:parsed};
  }catch{return {path:'',method:'GET',body:null}}
}

function quickUiActive(){
  const active=document.activeElement;
  if(!active?.closest)return false;
  const center=active.closest('.booking-360-quick-center');
  const modal=active.closest('.booking-360-modal');
  if(!center&&!modal)return false;
  const label=text(active.textContent);
  if(label.includes('حفظ التعديلات'))return false;
  return true;
}

function isObservedMutation(meta){
  if(meta.method!=='POST')return false;
  const action=text(meta.body?.action).toLowerCase();
  if(meta.path==='/api/admin'){
    if(!action)return false;
    if(/quote|get|list|preview|check|search|lookup/.test(action))return false;
    return ['update_booking','set_booking_status','change_booking_trip','refund_request','cancel_booking_settle','wallet_pay_booking'].includes(action)||/^(refund_|cancel_|wallet_)/.test(action);
  }
  if(meta.path==='/api/module')return ['insert','update','delete','remove'].includes(action);
  if(meta.path==='/api/seats/atomic')return ['assign','assigned','release','released','move','swap','clear','delete'].includes(action);
  if(meta.path==='/api/bookings/auto-house')return true;
  return false;
}

function scheduleReload(){
  if(!isBookingEditorPath())return;
  if(reloadTimer)clearTimeout(reloadTimer);
  reloadTimer=setTimeout(()=>{
    reloadTimer=null;
    try{sessionStorage.setItem('almaher-booking360-reloaded','1')}catch{}
    window.location.reload();
  },1650);
}

function restorePosition(){
  let should=false;
  try{should=sessionStorage.getItem('almaher-booking360-reloaded')==='1';if(should)sessionStorage.removeItem('almaher-booking360-reloaded')}catch{}
  if(!should)return;
  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    const panel=document.querySelector('.booking-360-overview');
    if(panel){clearInterval(timer);panel.scrollIntoView({block:'start'});return}
    if(attempts>20)clearInterval(timer);
  },120);
}

export function installBooking360SyncGuard(){
  if(typeof window==='undefined'||typeof document==='undefined'||installed)return;
  installed=true;
  const original=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const quick=quickUiActive();
    const meta=requestMeta(input,init||{});
    const response=await original(input,init);
    if(quick&&response?.ok&&isObservedMutation(meta))scheduleReload();
    return response;
  };
  restorePosition();
}
