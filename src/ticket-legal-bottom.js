import {api} from './lib/api.js';

const text=v=>String(v??'').trim();
let activeBooking='';
let loading=false;

function bookingNumberFromTicket(ticket){
  return text(ticket?.querySelector('.ticket-meta-card > b')?.textContent);
}

function legalItem(label,value){
  const div=document.createElement('div');
  div.className='ticket-branch-legal-item';
  const span=document.createElement('span');
  span.textContent=`${label}: ${value}`;
  div.appendChild(span);
  return div;
}

async function syncTicketLegal(){
  const ticket=document.querySelector('.ticket-page');
  if(!ticket)return;
  const branchCard=ticket.querySelector('.ticket-branch-card');
  if(!branchCard)return;

  const oldLicense=ticket.querySelector('.ticket-footer-license');
  if(oldLicense)oldLicense.style.setProperty('display','none','important');

  const bookingNo=bookingNumberFromTicket(ticket);
  if(!bookingNo||loading)return;
  if(activeBooking===bookingNo&&branchCard.querySelector('.ticket-branch-legal-data'))return;

  loading=true;
  try{
    const raw=await api.bootstrap();
    const bookings=Array.isArray(raw?.bookings)?raw.bookings:[];
    const branches=Array.isArray(raw?.branches)?raw.branches:[];
    const booking=bookings.find(b=>[b?.booking_number,b?.booking_no,b?.code,b?.reference,b?.id].some(v=>text(v)===bookingNo));
    const branch=branches.find(b=>text(b?.id)===text(booking?.branch_id));
    if(!branch)return;

    const license=text(branch?.license_number||branch?.license_no||branch?.travel_license_number||branch?.travel_license_no)||text(text(branch?.notes).match(/\[ALMAHER_BRANCH_LICENSE:([^\]]*)\]/i)?.[1]);
    const commercialRegistration=text(branch?.commercial_registration||branch?.commercialRegistration||branch?.cr_number||branch?.commercial_register);
    const showLegal=branch?.show_legal_on_ticket!==false;

    branchCard.querySelector('.ticket-branch-legal-data')?.remove();
    if(showLegal&&(license||commercialRegistration)){
      const wrap=document.createElement('div');
      wrap.className='ticket-branch-legal-data';
      if(license)wrap.appendChild(legalItem('رقم الترخيص',license));
      if(commercialRegistration)wrap.appendChild(legalItem('السجل التجاري',commercialRegistration));
      branchCard.appendChild(wrap);
    }
    activeBooking=bookingNo;
  }catch{
    // Keep ticket usable if legal-data refresh is unavailable.
  }finally{
    loading=false;
  }
}

let queued=false;
function queueSync(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;syncTicketLegal()});
}

export function installTicketLegalBottom(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queueSync();
  const observer=new MutationObserver(queueSync);
  observer.observe(document.documentElement,{childList:true,subtree:true});
}
