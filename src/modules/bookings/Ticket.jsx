import React,{useEffect,useMemo,useState} from 'react';
import QRCode from 'qrcode';
import {ArrowRight,Printer,MessageCircle,MapPin,BusFront,Hotel,Armchair,Phone} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {PageHeader,Button,Card,Loading,ErrorBox,Badge} from '../../components/UI.jsx';
import {money,phoneWa,journeyLabel} from '../../lib/format.js';
import {branchLogo} from '../../lib/branding.js';

const str=v=>String(v??'');
const lower=v=>str(v).toLowerCase();
const DAY_NAMES=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayAr=d=>d?DAY_NAMES[new Date(d+'T12:00:00').getDay()]||'':'';
function first(...vals){return vals.find(v=>v!==undefined&&v!==null&&str(v).trim()!=='')??''}

export default function TicketPage({bookingNo,go}){
 const {data}=useAppData();
 const b=data.bookings.find(x=>str(x.booking_number)===str(bookingNo));
 const passengers=data.passengers.filter(x=>str(x.booking_id)===str(b?.id));
 const [qr,setQr]=useState(''),[locationQr,setLocationQr]=useState(''),[ops,setOps]=useState(null),[terms,setTerms]=useState([]),[error,setError]=useState('');
 const trip=data.trips.find(x=>str(x.id)===str(b?.trip_id));
 const returnTrip=data.trips.find(x=>str(x.id)===str(b?.return_trip_id));
 const branch=data.branches.find(x=>str(x.id)===str(b?.branch_id));
 const branchContact=data.branchContacts.find(x=>str(x.branch_id)===str(b?.branch_id));
 const tripBranch=(data.tripBranches||[]).find(x=>str(x.trip_id)===str(b?.trip_id)&&str(x.branch_id)===str(b?.branch_id));
 const locationText=first(tripBranch?.boarding_point,branch?.address,branchContact?.address);
 const locationUrl=first(branch?.map_url,branch?.mapUrl,branchContact?.map_url,branchContact?.mapUrl,locationText?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationText)}`:'');

 useEffect(()=>{
   if(!b)return;
   QRCode.toDataURL(`ALMAHER|BOOKING=${b.booking_number}`,{width:280,margin:1,errorCorrectionLevel:'M'}).then(setQr).catch(()=>{});
   if(locationUrl)QRCode.toDataURL(locationUrl,{width:220,margin:1,errorCorrectionLevel:'M'}).then(setLocationQr).catch(()=>{});
   api.module('tickets').then(setOps).catch(e=>setError(e.message));api.mega('ticket_terms',{},'GET').then(x=>setTerms(Array.isArray(x?.terms)?x.terms:[])).catch(()=>{});
 },[b?.id,locationUrl]);

 const seatByPassenger=useMemo(()=>{
   const map=new Map();for(const x of ops?.seat_assignments||[]){if(!['assigned','hold'].includes(lower(x.status||'assigned')))continue;if(str(x.booking_id)===str(b?.id)||passengers.some(p=>str(p.id)===str(x.passenger_id))){const k=str(x.passenger_id||'booking');const arr=map.get(k)||[];arr.push(x);map.set(k,arr)}}return map
 },[ops,b?.id,passengers]);
 const roomByPassenger=useMemo(()=>{
   const roomMap=new Map((ops?.hotel_rooms||[]).map(x=>[str(x.id),x]));const tripHotelMap=new Map((ops?.trip_hotels||[]).map(x=>[str(x.id),x]));const hotelMap=new Map((ops?.hotels||[]).map(x=>[str(x.id),x]));const out=new Map();
   for(const a of ops?.room_assignments||[]){if(lower(a.status||'assigned')==='released')continue;const room=roomMap.get(str(a.hotel_room_id));if(!room)continue;const th=tripHotelMap.get(str(room.trip_hotel_id));const hotel=hotelMap.get(str(th?.hotel_id));out.set(str(a.passenger_id),{assignment:a,room,tripHotel:th,hotel})}return out
 },[ops]);

 if(!b)return <Card>الحجز غير موجود في البيانات الحالية.</Card>;
 const paid=Number(b.paid_amount||0),total=Number(b.total_price||0),remaining=Math.max(0,total-paid);
 const doPrint=mode=>{document.body.dataset.printMode=mode;const cleanup=()=>{delete document.body.dataset.printMode;window.removeEventListener('afterprint',cleanup)};window.addEventListener('afterprint',cleanup);window.print();setTimeout(cleanup,1500)};
 const wa=()=>{const route=trip?`${trip.from_city||trip.origin||'—'} ← ${trip.to_city||trip.destination||'—'}`:'';const msg=[`شركة الماهر الماسي`,`تذكرة الحجز: ${b.booking_number}`,`العميل: ${b.customer_name||''}`,route?`الرحلة: ${route}`:'',trip?.departure_date?`التاريخ: ${weekdayAr(trip.departure_date)} ${trip.departure_date} ${trip.departure_time||''}`:'',`المدفوع: ${money(paid)}`,remaining?`المتبقي: ${money(remaining)}`:'الحجز مسدد بالكامل'].filter(Boolean).join('\n');window.open(`https://wa.me/${phoneWa(b.customer_phone)}?text=${encodeURIComponent(msg)}`,'_blank')};
 const phone=first(branchContact?.phone,branchContact?.whatsapp,branch?.whatsapp,branch?.phone);
 const dense=passengers.length>12?'ultra-dense':passengers.length>6?'dense':'';const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};const privateType=snap.privateRoomType||(Array.isArray(b.private_room_types)?b.private_room_types[0]:'');const privateTypeLabel={single:'مفردة',double:'مزدوجة',triple:'ثلاثية',quad:'رباعية',quint:'خماسية'}[privateType]||privateType;const ticketCancelled=['cancelled','refunded'].includes(lower(b.status))||lower(trip?.status)==='cancelled';
 const showOutbound=lower(b.journey_mode)!=='returnonly';
 const showReturn=['roundtrip','separate','returnonly'].includes(lower(b.journey_mode));
 const returnInfo=returnTrip||trip;
 const returnDate=returnTrip?.departure_date||trip?.return_date||trip?.departure_date;
 const returnTime=returnTrip?.departure_time||trip?.return_time||'';
 return <>
  <PageHeader title="التذكرة" subtitle={`الحجز ${b.booking_number}`} actions={<>
   <Button onClick={()=>go('/bookings/'+b.booking_number)}><ArrowRight size={16}/> رجوع</Button>
   <Button onClick={()=>doPrint('a4')}><Printer size={16}/> A4</Button><Button onClick={()=>doPrint('80')}><Printer size={16}/> 80mm</Button><Button onClick={()=>doPrint('58')}><Printer size={16}/> 58mm</Button>
   <Button variant="primary" onClick={wa}><MessageCircle size={16}/> واتساب</Button>
  </>}/>
  <ErrorBox error={error}/>
  {!ops&&!error&&<Loading text="استكمال بيانات المقعد والسكن..."/>}
  <article className={`ticket-page ${dense} ${ticketCancelled?'ticket-cancelled':''}`}>
   <header className="ticket-head">
    <div className="ticket-brand-lockup"><img className="ticket-logo" src={branchLogo(branch)} alt={`شعار ${branch?.name||'الماهر الماسي'}`}/><div><h1>{branch?.name||'الماهر الماسي'}</h1><span>نُيسر دربك... لنطمئن قلبك</span></div></div>
    <div className="ticket-number"><span>رقم الحجز</span><b>{b.booking_number}</b><Badge tone={b.status==='cancelled'?'red':'green'}>{b.status||'confirmed'}</Badge></div>
   </header>
   <section className="ticket-hero-grid">
    <div><span>العميل</span><strong>{b.customer_name}</strong><small>{b.customer_phone}</small></div>
    <div><span>نوع الرحلة</span><strong>{journeyLabel(b.journey_mode)}</strong><small>{branch?.name||''}</small></div>
    <div><span>السكن</span><strong>{b.accommodation_label||b.accommodation_type||'بدون سكن'}</strong><small>{b.accommodation_type==='private'?[privateTypeLabel&&`غرفة ${privateTypeLabel}`,`${Number(b.private_rooms||snap.privateRooms||1)} غرفة`,snap.housingDays&&`${snap.housingDays} يوم`].filter(Boolean).join(' · '):''}</small></div>
    <div><span>حالة السداد</span><strong>{remaining>0?`متبقي ${money(remaining)}`:'مسدد بالكامل'}</strong><small>{b.payment_method||''}</small></div>
   </section>

   <section className="ticket-journeys">
    {showOutbound&&<JourneyBlock title="الذهاب" trip={trip} date={trip?.departure_date} time={trip?.departure_time} boardingPoint={tripBranch?.boarding_point||b.snapshot?.boardingPoint} boardingTime={tripBranch?.boarding_time||b.snapshot?.boardingTime}/>} 
    {showReturn&&<JourneyBlock title="العودة" trip={returnInfo} date={returnDate} time={returnTime} reverse={!returnTrip&&lower(b.journey_mode)==='roundtrip'}/>} 
   </section>

   <section className="ticket-passenger-section"><div className="ticket-section-title"><h3>المسافرون</h3><span>{passengers.length} مسافر</span></div>
    <div className="ticket-passengers">{passengers.map((p,i)=>{const seats=seatByPassenger.get(str(p.id))||[];const room=roomByPassenger.get(str(p.id));return <div className="ticket-passenger" key={p.id||i}>
     <div className="ticket-pax-main"><b>{i+1}. {p.full_name}</b><span>{p.identity_number} · {p.nationality||''}</span></div>
     <div className="ticket-pax-tags">{seats.length?seats.map((s,j)=><span key={s.id||j}><Armchair size={12}/> {s.seat_no||s.seat_number||'—'}{s.segment_type?` · ${s.segment_type}`:''}</span>):<span><Armchair size={12}/> المقعد غير محدد</span>}{room&&<span><Hotel size={12}/> {room.hotel?.name||'الفندق'} · غرفة {room.room?.room_no||'—'}</span>}</div>
    </div>})}</div>
   </section>

   <section className="ticket-bottom">
    <div className="ticket-finance"><div><span>الإجمالي</span><b>{money(total)}</b></div><div><span>المدفوع</span><b>{money(paid)}</b></div><div><span>المتبقي</span><b>{money(remaining)}</b></div></div>
    <div className="ticket-qr-group">{qr&&<div><img src={qr} alt="QR الحجز"/><span>QR الحجز</span></div>}{locationQr&&<div><img src={locationQr} alt="QR الموقع"/><span>موقع الصعود</span></div>}</div>
   </section>
   <section className="ticket-terms"><h3>الشروط والأحكام</h3><ol>{(terms.length?terms:['الحضور قبل موعد الانطلاق بوقت كافٍ.','الاحتفاظ بالتذكرة والهوية/الإقامة أثناء الرحلة.','التذكرة الملغاة أو المستبدلة غير صالحة للاستخدام.']).map((x,i)=><li key={i}>{typeof x==='string'?x:x?.text}</li>)}</ol></section><footer className="ticket-contact"><div>{locationText&&<span><MapPin size={13}/> {locationText}</span>}{phone&&<span><Phone size={13}/> {phone}</span>}</div><small>تخضع الرحلة للشروط والأحكام المسجلة بالنظام وقت إصدار التذكرة.</small></footer>
  </article>
 </>;
}

function JourneyBlock({title,trip,date,time,boardingPoint,boardingTime,reverse=false}){
 if(!trip)return <div className="journey-block"><strong>{title}</strong><span>بيانات الرحلة غير متاحة</span></div>;
 const from=reverse?(trip.to_city||trip.destination):(trip.from_city||trip.origin),to=reverse?(trip.from_city||trip.origin):(trip.to_city||trip.destination);
 return <div className="journey-block"><div className="journey-title"><BusFront size={17}/><strong>{title}</strong><span>{trip.trip_code||''}</span></div><div className="journey-route"><b>{from||'—'}</b><span>←</span><b>{to||'—'}</b></div><div className="journey-meta"><span>{weekdayAr(date)} · {date||'—'} {time||''}</span>{boardingPoint&&<span>{boardingPoint}{boardingTime?` · ${boardingTime}`:''}</span>}</div></div>
}
