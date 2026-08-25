import {api} from './api.js';

let installed=false;
const inflight=new Map();
const recentSuccess=new Map();
const RECENT_TTL_MS=120000;

function stable(value){
  if(value===undefined)return 'undefined';
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

function runOnce(key,fn){
  const now=Date.now();
  const cached=recentSuccess.get(key);
  if(cached&&now-cached.at<RECENT_TTL_MS)return Promise.resolve(cached.value);
  if(cached)recentSuccess.delete(key);
  if(inflight.has(key))return inflight.get(key);
  const task=Promise.resolve().then(fn).then(value=>{
    recentSuccess.set(key,{at:Date.now(),value});
    setTimeout(()=>{
      const current=recentSuccess.get(key);
      if(current&&Date.now()-current.at>=RECENT_TTL_MS)recentSuccess.delete(key);
    },RECENT_TTL_MS+1000);
    return value;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,task);
  return task;
}

function savedBookingNumberFromAdmin(body){
  return String(body?.booking?.number||body?.booking?.booking_number||'').trim();
}

function openSavedBooking(bookingNumber){
  if(typeof window==='undefined'||!bookingNumber)return;
  const target=`/bookings/${encodeURIComponent(bookingNumber)}`;
  queueMicrotask(()=>{
    try{
      if(window.location.pathname!==target){
        window.history.replaceState({},'',target);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      window.scrollTo({top:0,behavior:'auto'});
    }catch{}
  });
}

export function installBookingSaveRuntimeGuard(){
  if(installed)return;
  installed=true;

  const originalAdmin=api.admin.bind(api);
  api.admin=(body)=>{
    if(body?.action!=='update_booking')return originalAdmin(body);
    const bookingNumber=savedBookingNumberFromAdmin(body);
    const key=`update:${bookingNumber}:${stable(body)}`;
    return runOnce(key,()=>originalAdmin(body)).then(result=>{
      openSavedBooking(bookingNumber);
      return result;
    });
  };

  const originalCustomerBook=api.customerBook.bind(api);
  api.customerBook=(booking,passengers)=>{
    const bookingNumber=String(booking?.booking_number||'').trim();
    const key=`create:${bookingNumber}:${stable({booking,passengers})}`;
    return runOnce(key,()=>originalCustomerBook(booking,passengers)).then(result=>{
      openSavedBooking(bookingNumber);
      return result;
    });
  };
}
