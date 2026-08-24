import React,{useEffect,useMemo,useState} from 'react';
import QRCode from 'qrcode';
import {ArrowRight,Printer,MessageCircle,MapPin,BusFront,Phone,Languages} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {suggestedLanguageForNationality} from '../../core/LanguageContext.jsx';
import {useSystemBrand} from '../../core/SystemBrandContext.jsx';
import {api} from '../../lib/api.js';
import {PageHeader,Button,Card,Loading,ErrorBox,Badge} from '../../components/UI.jsx';
import {money,phoneWa,journeyLabel} from '../../lib/format.js';
import {branchLogo} from '../../lib/branding.js';
import {PRINT_LANGUAGES,printDirection,pt} from '../../lib/printI18n.js';
import {printElement} from '../../lib/print.js';

const str=v=>String(v??'');
const lower=v=>str(v).toLowerCase();
const DAY_NAMES=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayAr=d=>d?DAY_NAMES[new Date(d+'T12:00:00').getDay()]||'':'';
const first=(...vals)=>vals.find(v=>v!==undefined&&v!==null&&str(v).trim()!=='')??'';
const shortDate=v=>{const x=str(v);return x.includes('T')?x.slice(0,10):x};
const statusAr=v=>({confirmed:'مؤكد',paid:'مسدد',pending:'قيد المراجعة',cancelled:'ملغي',refunded:'مسترد'})[lower(v)]||str(v||'مؤكد');
const genderAr=v=>{const x=lower(v);if(['male','m','ذكر'].includes(x))return 'ذكر';if(['female','f','أنثى','انثى'].includes(x))return 'أنثى';return str(v||'—')};
const CODE39={
 '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
 A:'wnnnnwnnw',B:'nnwnnwnnw',C:'wnwnnwnnn',D:'nnnnwwnnw',E:'wnnnwwnnn',F:'nnwnwwnnn',G:'nnnnnwwnw',H:'wnnnnwwnn',I:'nnwnnwwnn',J:'nnnnwwwnn',
 K:'wnnnnnnww',L:'nnwnnnnww',M:'wnwnnnnwn',N:'nnnnwnnww',O:'wnnnwnnwn',P:'nnwnwnnwn',Q:'nnnnnnwww',R:'wnnnnnwwn',S:'nnwnnnwwn',T:'nnnnwnwwn',
 U:'wwnnnnnnw',V:'nwwnnnnnw',W:'wwwnnnnnn',X:'nwnnwnnnw',Y:'wwnnwnnnn',Z:'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn','/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn'
};
function BookingBarcode({value}){
 const raw=str(value).toUpperCase().replace(/[^0-9A-Z.\- $/+%]/g,'-');
 const encoded=`*${raw}*`;let x=0;const bars=[];
 encoded.split('').forEach((ch,ci)=>{const pattern=CODE39[ch]||CODE39['-'];let bar=true;pattern.split('').forEach((unit,pi)=>{const w=unit==='w'?3:1;if(bar)bars.push(<rect key={`${ci}-${pi}`} x={x} y="0" width={w} height="28"/>);x+=w;bar=!bar});x+=1});
 return <svg className="ticket-booking-barcode" viewBox={`0 0 ${x} 28`} preserveAspectRatio="none" role="img" aria-label={`باركود الحجز ${value}`}>{bars}</svg>;
}

export default function TicketPage({bookingNo,go}){
 const {data}=useAppData();
 const {profile:developer,config}=useSystemBrand();
 const b=data.bookings.find(x=>str(x.booking_number)===str(bookingNo));
 const passengers=data.passengers.filter(x=>str(x.booking_id)===str(b?.id));
 const [qr,setQr]=useState('');
 const [locationQr,setLocationQr]=useState('');
 const [ops,setOps]=useState(null);
 const [terms,setTerms]=useState([]);
 const [error,setError]=useState('');
 const [printLanguage,setPrintLanguage]=useState('ar');
 const [languageTouched,setLanguageTouched]=useState(false);
 const [returnCatalog,setReturnCatalog]=useState([]);
 const trip=data.trips.find(x=>str(x.id)===str(b?.trip_id));
 const localReturnTrip=data.trips.find(x=>str(x.id)===str(b?.return_trip_id));
 const returnTrip=localReturnTrip||returnCatalog.find(x=>str(x.id)===str(b?.return_trip_id));
 const branch=data.branches.find(x=>str(x.id)===str(b?.branch_id));
 const branchContact=data.branchContacts.find(x=>str(x.branch_id)===str(b?.branch_id));
 const tripBranch=(data.tripBranches||[]).find(x=>str(x.trip_id)===str(b?.trip_id)&&str(x.branch_id)===str(b?.branch_id));
 const locationText=first(tripBranch?.boarding_point,branch?.address,branchContact?.address);
 const locationUrl=first(branch?.map_url,branch?.mapUrl,branchContact?.map_url,branchContact?.mapUrl,locationText?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationText)}`:'');
 const customerNationality=first(b?.customer_nationality,passengers[0]?.nationality,b?.snapshot?.nationality);

 useEffect(()=>{if(!b||languageTouched)return;setPrintLanguage(suggestedLanguageForNationality(customerNationality))},[b?.id,customerNationality,languageTouched]);
 useEffect(()=>{if(lower(b?.journey_mode)!=='separate'||!b?.return_trip_id||localReturnTrip)return;api.returnTripOptions().then(x=>setReturnCatalog(Array.isArray(x?.trips)?x.trips:[])).catch(()=>setReturnCatalog([]))},[b?.journey_mode,b?.return_trip_id,localReturnTrip?.id]);
 useEffect(()=>{if(!b)return;QRCode.toDataURL(`ALMAHER|BOOKING=${b.booking_number}`,{width:280,margin:1,errorCorrectionLevel:'M'}).then(setQr).catch(()=>{});if(locationUrl)QRCode.toDataURL(locationUrl,{width:220,margin:1,errorCorrectionLevel:'M'}).then(setLocationQr).catch(()=>{});api.module('tickets').then(setOps).catch(e=>setError(e.message));api.mega('ticket_terms',{},'GET').then(x=>setTerms(Array.isArray(x?.terms)?x.terms:[])).catch(()=>{})},[b?.id,locationUrl]);

 const seatByPassenger=useMemo(()=>{
  const map=new Map();
  for(const x of ops?.seat_assignments||[]){
   if(!['assigned','hold'].includes(lower(x.status||'assigned')))continue;
   if(str(x.booking_id)===str(b?.id)||passengers.some(p=>str(p.id)===str(x.passenger_id))){
    const k=str(x.passenger_id||'booking');
    const arr=map.get(k)||[];
    arr.push(x);map.set(k,arr);
   }
  }
  return map;
 },[ops,b?.id,passengers]);

 const roomByPassenger=useMemo(()=>{
  const roomMap=new Map((ops?.hotel_rooms||[]).map(x=>[str(x.id),x]));
  const tripHotelMap=new Map((ops?.trip_hotels||[]).map(x=>[str(x.id),x]));
  const hotelMap=new Map((ops?.hotels||[]).map(x=>[str(x.id),x]));
  const out=new Map();
  for(const a of ops?.room_assignments||[]){
   if(lower(a.status||'assigned')==='released')continue;
   const room=roomMap.get(str(a.hotel_room_id));if(!room)continue;
   const th=tripHotelMap.get(str(room.trip_hotel_id));
   const hotel=hotelMap.get(str(th?.hotel_id));
   out.set(str(a.passenger_id),{assignment:a,room,tripHotel:th,hotel});
  }
  return out;
 },[ops]);

 if(!b)return <Card>الحجز غير موجود في البيانات الحالية.</Card>;

 const paid=Number(b.paid_amount||0);
 const total=Number(b.total_price||0);
 const remaining=Math.max(0,total-paid);
 const L=(key,f='')=>pt(printLanguage,key,f);
 const dir=printDirection(printLanguage);
 const printOptions=mode=>({title:`تذكرة سفر — ${b.booking_number}`,pageSize:mode==='a4'?'A4':`${mode}mm`,orientation:'portrait',lang:printLanguage,dir,singlePage:mode==='a4',bodyAttributes:{'data-print-mode':mode,'data-print-language':printLanguage}});
 const ticketNode=()=>document.querySelector('.ticket-page');
 const doPrint=mode=>{setError('');const el=ticketNode();if(!el)return setError('تعذر تجهيز التذكرة للطباعة.');try{printElement(el,printOptions(mode))}catch(e){setError(e.message||'تعذر فتح الطباعة.')}};
 const wa=()=>{const route=trip?`${trip.from_city||trip.origin||'—'} ← ${trip.to_city||trip.destination||'—'}`:'';const msg=[`الماهر الماسي للسفر والسياحة`,`تذكرة سفر: ${b.booking_number}`,`العميل: ${b.customer_name||''}`,route?`الرحلة: ${route}`:'',trip?.departure_date?`التاريخ: ${weekdayAr(trip.departure_date)} ${trip.departure_date} ${trip.departure_time||''}`:'',`المدفوع: ${money(paid)}`,remaining?`المتبقي: ${money(remaining)}`:'الحجز مسدد بالكامل'].filter(Boolean).join('\n');window.open(`https://wa.me/${phoneWa(b.customer_phone)}?text=${encodeURIComponent(msg)}`,'_blank')};

 const phone=first(branchContact?.phone,branchContact?.whatsapp,branch?.whatsapp,branch?.phone);
 const dense=passengers.length>12?'ultra-dense':passengers.length>6?'dense':'';
 const snap=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};
 const privateType=snap.privateRoomType||(Array.isArray(b.private_room_types)?b.private_room_types[0]:'');
 const privateTypeLabel={single:'مفردة',double:'مزدوجة',triple:'ثلاثية',quad:'رباعية',quint:'خماسية'}[privateType]||privateType;
 const ticketCancelled=['cancelled','refunded'].includes(lower(b.status))||lower(trip?.status)==='cancelled';
 const mode=lower(b.journey_mode);
 const showOutbound=mode!=='returnonly';
 const showReturn=['roundtrip','separate','returnonly'].includes(mode);
 const returnInfo=mode==='separate'?returnTrip:trip;
 const reverseReturn=showReturn;
 const returnDate=mode==='separate'?first(returnTrip?.return_date,returnTrip?.departure_date):first(trip?.return_date,trip?.departure_date);
 const returnTime=mode==='separate'?first(returnTrip?.return_time,returnTrip?.departure_time):first(trip?.return_time,trip?.departure_time);
 const defaultTerms=[L('defaultTerm1'),L('defaultTerm2'),L('defaultTerm3')];
 const housingEntries=[...roomByPassenger.values()];
 const housing=housingEntries[0];
 const hotelName=first(housing?.hotel?.name,b?.hotel_name,snap?.hotelName,b?.accommodation_label,b?.accommodation_type==='none'?L('noHousing'):'');
 const roomLabel=first(housing?.room?.room_no,privateTypeLabel?`غرفة ${privateTypeLabel}`:'',b?.accommodation_label);
 const checkIn=shortDate(first(housing?.tripHotel?.check_in_date,housing?.tripHotel?.checkin_date,snap?.checkIn,trip?.departure_date));
 const checkOut=shortDate(first(housing?.tripHotel?.check_out_date,housing?.tripHotel?.checkout_date,snap?.checkOut,returnDate));
 const issuedDate=shortDate(first(b?.booking_date,b?.created_at,b?.createdAt,trip?.departure_date));
 const license=first(branch?.license_number,branch?.license_no,branch?.travel_license_number,branch?.travel_license_no,branchContact?.license_number,branchContact?.license_no);
 const showLegal=branch?.show_legal_on_ticket!==false;
 const paymentLabel=remaining>0?'مدفوع جزئي':'مدفوع بالكامل';
 const routeLabel=trip?`${trip.from_city||trip.origin||'—'} ← ${trip.to_city||trip.destination||'—'}`:'—';

 return <>
  <PageHeader title="تذكرة سفر" subtitle={`${L('bookingNo')} ${b.booking_number}`} actions={<>
   <Button onClick={()=>go('/bookings/'+b.booking_number)}><ArrowRight size={16}/> {L('back')}</Button>
   <label className="btn" style={{gap:7}}><Languages size={16}/><select value={printLanguage} onChange={e=>{setLanguageTouched(true);setPrintLanguage(e.target.value)}} style={{border:0,padding:0,width:'auto',background:'transparent'}}>{PRINT_LANGUAGES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
   <Button onClick={()=>doPrint('a4')}><Printer size={16}/> A4</Button>
   <Button onClick={()=>doPrint('80')}><Printer size={16}/> 80mm</Button>
   <Button onClick={()=>doPrint('58')}><Printer size={16}/> 58mm</Button>
   <Button variant="primary" onClick={wa}><MessageCircle size={16}/> إرسال التذكرة واتساب</Button>
  </>}/>
  <ErrorBox error={error}/>
  {!ops&&!error&&<Loading text="استكمال بيانات المقعد والسكن..."/>}

  <article className={`ticket-page ${dense} ${ticketCancelled?'ticket-cancelled':''}`} dir={dir} lang={printLanguage}>
   {ticketCancelled&&<div className="ticket-cancelled-banner">هذه التذكرة ملغاة</div>}

   <header className="ticket-head">
    <div className="ticket-brand-lockup">
     <img className="ticket-logo" src={branchLogo(branch)} alt={`شعار ${branch?.name||'الماهر الماسي'}`}/>
     <span className="ticket-brand-english">ALMAHER ALMASI · TRAVEL & TOURISM</span>
    </div>

    <div className="ticket-clock-tower" aria-hidden="true">
     <span className="tower-spire"/>
     <span className="tower-crown">◆</span>
     <span className="tower-clock">◷</span>
     <span className="tower-body"/>
     <span className="tower-base"/>
    </div>

    <div className="ticket-meta-card">
     <span className="ticket-meta-label">رقم الحجز</span>
     <b>{b.booking_number}</b>
     <BookingBarcode value={b.booking_number}/>
     <div className="ticket-meta-foot">
      <Badge tone={b.status==='cancelled'?'red':'green'}>{statusAr(b.status)}</Badge>
      {issuedDate&&<small>{issuedDate}</small>}
     </div>
    </div>
   </header>

   <section className="ticket-title-band">
    <div className="ticket-title-rule"/>
    <div>
     <h2>تذكرة سفر</h2>
     <span>TRAVEL TICKET</span>
    </div>
    <div className="ticket-title-rule"/>
   </section>

   <section className="ticket-customer-strip">
    <div><span>اسم العميل</span><strong>{b.customer_name||'—'}</strong></div>
    <div><span>رقم الجوال</span><strong dir="ltr">{b.customer_phone||'—'}</strong></div>
    <div><span>نوع الرحلة</span><strong>{journeyLabel(b.journey_mode)||routeLabel}</strong></div>
    <div><span>حالة الدفع</span><strong>{paymentLabel}</strong><small>{b.payment_method||''}</small></div>
   </section>

   <section className="ticket-journeys">
    {showOutbound&&<JourneyBlock title={L('outbound')} trip={trip} date={trip?.departure_date} time={trip?.departure_time} boardingPoint={tripBranch?.boarding_point||snap?.boardingPoint} boardingTime={tripBranch?.boarding_time||snap?.boardingTime} unavailable={L('tripUnavailable')}/>} 
    {showReturn&&<JourneyBlock title={L('return')} trip={returnInfo} date={returnDate} time={returnTime} reverse={reverseReturn} unavailable={L('tripUnavailable')}/>} 
   </section>

   <section className="ticket-section ticket-passenger-section">
    <div className="ticket-section-heading">
     <h3>بيانات المسافرين</h3>
     <span>{passengers.length} مسافر</span>
    </div>
    <div className="ticket-passenger-table-wrap">
     <table className="ticket-passenger-table">
      <thead><tr><th>#</th><th>الاسم</th><th>الجنس</th><th>الجنسية</th><th>رقم الهوية</th><th>المقعد</th><th>الغرفة</th></tr></thead>
      <tbody>
       {passengers.map((p,i)=>{
        const seats=seatByPassenger.get(str(p.id))||[];
        const room=roomByPassenger.get(str(p.id));
        const seatsText=seats.length?seats.map(s=>s.seat_no||s.seat_number||'—').join('، '):'—';
        return <tr key={p.id||i}>
         <td>{i+1}</td>
         <td><b>{p.full_name||'—'}</b></td>
         <td>{genderAr(first(p.gender,p.sex))}</td>
         <td>{p.nationality||'—'}</td>
         <td dir="ltr">{p.identity_number||p.passport_number||'—'}</td>
         <td>{seatsText}</td>
         <td dir="ltr">{room?.room?.room_no||'—'}</td>
        </tr>;
       })}
      </tbody>
     </table>
    </div>
   </section>

   <section className="ticket-section ticket-housing-section">
    <div className="ticket-section-heading"><h3>بيانات السكن</h3><span>{b.accommodation_type==='none'?'بدون سكن':''}</span></div>
    <div className="ticket-housing-grid">
     <div><span>الفندق</span><strong>{hotelName||L('noHousing')}</strong></div>
     <div><span>نوع الغرفة</span><strong dir="ltr">{roomLabel||'—'}</strong></div>
     <div><span>الوصول</span><strong dir="ltr">{checkIn||'—'}</strong></div>
     <div><span>المغادرة</span><strong dir="ltr">{checkOut||'—'}</strong></div>
    </div>
   </section>

   <section className="ticket-section ticket-finance-section">
    <div className="ticket-section-heading"><h3>البيانات المالية</h3><span>{paymentLabel}</span></div>
    <div className="ticket-finance-grid">
     <div><span>الإجمالي</span><b>{money(total)}</b></div>
     <div><span>المدفوع</span><b>{money(paid)}</b></div>
     <div><span>المتبقي</span><b>{money(remaining)}</b></div>
     <div><span>عدد المسافرين</span><b>{passengers.length}</b></div>
    </div>
   </section>

   <section className="ticket-bottom">
    <div className="ticket-qr-panel">
     {qr&&<div><img src={qr} alt="QR"/><span>رمز الحجز</span></div>}
     {locationQr&&<div><img src={locationQr} alt="QR location"/><span>موقع الصعود</span></div>}
    </div>
    <div className="ticket-terms">
     <h3>الشروط والأحكام</h3>
     <ol>{(terms.length?terms:defaultTerms).map((x,i)=><li key={i}>{typeof x==='string'?x:x?.[printLanguage]||x?.text||x?.ar}</li>)}</ol>
    </div>
   </section>

   <section className="ticket-branch-card">
    <div><MapPin size={14}/><span>{locationText||branch?.name||'الماهر الماسي'}</span></div>
    {phone&&<div><Phone size={14}/><span dir="ltr">{phone}</span></div>}
    <div><BusFront size={14}/><span>{routeLabel}</span></div>
   </section>

   <footer className="ticket-footer-strip">
    {showLegal&&license&&<div className="ticket-footer-license">رقم الترخيص: {license}</div>}
    <div className="ticket-blessing">
     <strong>على دروب الطاعة .. راحتكم غايتنا</strong>
     <span>خطوة إلى الطاعات، ومغفرةٌ تمحو ما فات</span>
    </div>
   </footer>
   {config.show_profile_tickets!==false&&developer?.display_name&&<small className="ticket-developer-line">{L('developer')}: {developer.display_name}{developer.phone?` · ${developer.phone}`:''}</small>}
  </article>
 </>;
}

function JourneyBlock({title,trip,date,time,boardingPoint,boardingTime,reverse=false,unavailable='بيانات الرحلة غير متاحة'}){
 if(!trip)return <div className="journey-block"><div className="journey-label"><BusFront size={18}/><strong>{title}</strong></div><span className="journey-unavailable">{unavailable}</span></div>;
 const from=reverse?(trip.to_city||trip.destination):(trip.from_city||trip.origin);
 const to=reverse?(trip.from_city||trip.origin):(trip.to_city||trip.destination);
 return <div className="journey-block">
  <div className="journey-label"><BusFront size={18}/><strong>{title}</strong><span>{trip.trip_code||''}</span></div>
  <div className="journey-route"><b>{from||'—'}</b><span>←</span><b>{to||'—'}</b></div>
  <div className="journey-details">
   <div><span>التاريخ</span><strong>{weekdayAr(date)} {date||'—'}</strong></div>
   <div><span>الوقت</span><strong>{time||'—'}</strong></div>
   {boardingPoint&&<div><span>نقطة الصعود</span><strong>{boardingPoint}{boardingTime?` · ${boardingTime}`:''}</strong></div>}
  </div>
 </div>;
}