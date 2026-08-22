import React,{useEffect,useMemo,useState} from 'react';
import './passenger360.css';
import {ArrowRight,Ticket,MessageCircle,UserRound,MapPin,Armchair,Hotel,WalletCards,FileText,BusFront,Phone,Languages,Clock3} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Loading,PageHeader} from '../../components/UI.jsx';
import {money,phoneWa,statusLabel,journeyLabel,tripDisplay} from '../../lib/format.js';

const s=v=>String(v??'');
const low=v=>s(v).toLowerCase();
const safeDate=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{weekday:'long',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(`${String(v).slice(0,10)}T12:00:00`))}catch{return String(v)}};
const safeDateTime=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return String(v)}};
const scanLabel=v=>({outbound_boarding:'صعود الذهاب',outbound_arrival:'وصول الذهاب',housing_checkin:'دخول السكن',return_boarding:'صعود العودة',return_arrival:'وصول العودة',verify:'تحقق QR'}[s(v)]||s(v)||'مسح QR');

export default function Passenger360({id,go}){
 const {data}=useAppData();
 const passenger=data.passengers.find(p=>s(p.id)===s(id));
 const booking=passenger?data.bookings.find(b=>s(b.id)===s(passenger.booking_id)):null;
 const trip=booking?data.trips.find(t=>s(t.id)===s(booking.trip_id)):null;
 const returnTrip=booking?data.trips.find(t=>s(t.id)===s(booking.return_trip_id)):null;
 const branch=booking?data.branches.find(b=>s(b.id)===s(booking.branch_id)):null;
 const [ops,setOps]=useState(null),[timeline,setTimeline]=useState([]),[error,setError]=useState(''),[timelineError,setTimelineError]=useState('');
 useEffect(()=>{
  let live=true;setError('');setTimelineError('');
  api.module('tickets').then(x=>{if(live)setOps(x)}).catch(e=>{if(live)setError(e.message)});
  if(booking?.booking_number)api.mega('timeline',{booking_number:booking.booking_number}).then(x=>{if(live)setTimeline(Array.isArray(x?.timeline)?x.timeline:[])}).catch(e=>{if(live)setTimelineError(e.message)});
  return()=>{live=false};
 },[id,booking?.booking_number]);
 const seats=useMemo(()=>{
   if(!passenger)return[];return (ops?.seat_assignments||[]).filter(x=>s(x.passenger_id)===s(passenger.id)&&!['released','cancelled'].includes(low(x.status)));
 },[ops,passenger]);
 const room=useMemo(()=>{
   if(!passenger)return null;
   const a=(ops?.room_assignments||[]).find(x=>s(x.passenger_id)===s(passenger.id)&&low(x.status||'assigned')!=='released');
   if(!a)return null;
   const r=(ops?.hotel_rooms||[]).find(x=>s(x.id)===s(a.hotel_room_id));
   const th=(ops?.trip_hotels||[]).find(x=>s(x.id)===s(r?.trip_hotel_id));
   const h=(ops?.hotels||[]).find(x=>s(x.id)===s(th?.hotel_id));
   return {assignment:a,room:r,tripHotel:th,hotel:h};
 },[ops,passenger]);
 if(!passenger)return <Card><h2>المسافر غير موجود</h2><Button onClick={()=>go('/passengers')}>العودة للمسافرين</Button></Card>;
 const total=Number(booking?.total_price||0),paid=Number(booking?.paid_amount||0),remaining=Math.max(0,total-paid);
 const wa=()=>{const msg=[`شركة الماهر الماسي`,`المسافر: ${passenger.full_name||''}`,booking?.booking_number?`رقم الحجز: ${booking.booking_number}`:'',trip?`الرحلة: ${tripDisplay(trip)}`:''].filter(Boolean).join('\n');window.open(`https://wa.me/${phoneWa(passenger.phone||booking?.customer_phone)}?text=${encodeURIComponent(msg)}`,'_blank')};
 const timelineRows=timeline.map((x,i)=>{
   const title=x.type==='scan'?scanLabel(s(x.title).replace(/^QR:\s*/,'')):x.type==='finance'?'حركة مالية':x.type==='rating'?x.title||'تقييم ما بعد الرحلة':x.title||'نشاط';
   const tone=x.type==='scan'?'green':x.type==='finance'?'orange':x.type==='rating'?'blue':'blue';
   return {...x,_key:`${x.at||''}-${i}`,_title:title,_tone:tone};
 });
 return <>
  <PageHeader title="Passenger 360°" subtitle="ملف موحّد للمسافر يجمع الحجز والرحلة والسكن والمقعد والمالية والمستندات" actions={<>
   <Button onClick={()=>go('/passengers')}><ArrowRight size={16}/> المسافرون</Button>
   {booking&&<Button onClick={()=>go('/bookings/'+booking.booking_number)}>فتح الحجز</Button>}
   {booking&&<Button onClick={()=>go('/ticket/'+booking.booking_number)}><Ticket size={16}/> التذكرة</Button>}
   {(passenger.phone||booking?.customer_phone)&&<Button variant="primary" onClick={wa}><MessageCircle size={16}/> واتساب</Button>}
  </>}/>
  <ErrorBox error={error}/>
  <div className="passenger-360-grid">
   <Card><div className="card-title"><h3><UserRound size={18}/> الهوية</h3><Badge tone={passenger.status==='cancelled'?'red':'green'}>{statusLabel(passenger.status||'confirmed')}</Badge></div>
    <div className="detail-grid"><div><span>الاسم</span><strong>{passenger.full_name||'—'}</strong></div><div><span>الهوية / الإقامة</span><strong>{passenger.identity_number||'—'}</strong></div><div><span>الجنسية</span><strong>{passenger.nationality||'—'}</strong></div><div><span>الجنس</span><strong>{low(passenger.gender)==='female'?'أنثى':'ذكر'}</strong></div><div><span><Phone size={13}/> الجوال</span><strong dir="ltr">{passenger.phone||booking?.customer_phone||'—'}</strong></div><div><span><Languages size={13}/> لغة التواصل</span><strong>{passenger.preferred_language||'ar'}</strong></div></div>
   </Card>
   <Card><div className="card-title"><h3><FileText size={18}/> الحجز</h3>{booking&&<Badge>{booking.booking_number}</Badge>}</div>{booking?<div className="detail-grid"><div><span>نوع الرحلة</span><strong>{journeyLabel(booking.journey_mode)}</strong></div><div><span>الفرع</span><strong>{branch?.name||'—'}</strong></div><div><span>الحالة</span><strong>{statusLabel(booking.status)}</strong></div><div><span>مصدر الحجز</span><strong>{booking.source||'الفرع'}</strong></div></div>:<p>لا يوجد حجز مرتبط.</p>}</Card>
   <Card><div className="card-title"><h3><BusFront size={18}/> الرحلة</h3></div>{trip?<><strong className="big-detail">{tripDisplay(trip)}</strong><div className="detail-grid"><div><span>التاريخ</span><strong>{safeDate(trip.departure_date)}</strong></div><div><span>الوقت</span><strong>{trip.departure_time||'—'}</strong></div><div><span>الذهاب</span><strong>{trip.from_city||trip.origin||'—'} ← {trip.to_city||trip.destination||'—'}</strong></div>{returnTrip&&<div><span>العودة</span><strong>{tripDisplay(returnTrip)}</strong></div>}</div></>:<p>لا توجد رحلة مرتبطة.</p>}</Card>
   <Card><div className="card-title"><h3><Armchair size={18}/> المقعد والصعود</h3></div>{!ops?<Loading text="تحميل بيانات التشغيل..."/>:<div className="detail-grid"><div><span>المقعد</span><strong>{seats.length?seats.map(x=>x.seat_no||x.seat_number).filter(Boolean).join(' / '):'غير محدد'}</strong></div><div><span><MapPin size={13}/> نقطة الصعود</span><strong>{booking?.snapshot?.boardingPoint||'—'}</strong></div><div><span>وقت الصعود</span><strong>{booking?.snapshot?.boardingTime||'—'}</strong></div></div>}</Card>
   <Card><div className="card-title"><h3><Hotel size={18}/> السكن</h3></div>{!ops?<Loading text="تحميل السكن..."/>:<div className="detail-grid"><div><span>نوع السكن</span><strong>{booking?.accommodation_label||booking?.accommodation_type||'بدون سكن'}</strong></div><div><span>الفندق</span><strong>{room?.hotel?.name||'غير محدد'}</strong></div><div><span>الغرفة</span><strong>{room?.room?.room_no||'غير محددة'}</strong></div><div><span>حالة التسكين</span><strong>{passenger.accommodation_status||'—'}</strong></div></div>}</Card>
   <Card><div className="card-title"><h3><WalletCards size={18}/> المالية</h3></div>{booking?<div className="finance-360"><div><span>الإجمالي</span><b>{money(total)}</b></div><div><span>المدفوع</span><b>{money(paid)}</b></div><div><span>المتبقي</span><b className={remaining>0?'warning-text-inline':'success-text-inline'}>{money(remaining)}</b></div></div>:<p>لا توجد بيانات مالية.</p>}</Card>
   <Card><div className="card-title"><h3><FileText size={18}/> المستندات والمتابعة</h3></div><div className="detail-grid"><div><span>حالة المستندات</span><strong>{passenger.document_status||'unknown'}</strong></div><div><span>ملاحظات المساعدة</span><strong>{Array.isArray(passenger.assistance_flags)&&passenger.assistance_flags.length?passenger.assistance_flags.join('، '):'لا يوجد'}</strong></div></div></Card>
   <Card className="passenger-timeline-card"><div className="card-title"><h3><Clock3 size={18}/> الخط الزمني</h3><Badge>{timelineRows.length}</Badge></div>{timelineError&&<ErrorBox error={timelineError}/>} {!timelineError&&!timelineRows.length?<p className="muted-small">لا توجد أحداث إضافية مسجلة حتى الآن.</p>:<div className="passenger-timeline">{timelineRows.map(x=><div className="timeline-row" key={x._key}><div className="timeline-dot"/><div><div className="timeline-row-head"><strong>{x._title}</strong><Badge tone={x._tone}>{x.type||'event'}</Badge></div><span>{safeDateTime(x.at)}</span>{x.type==='finance'&&x.data?.hidden&&<small>التفاصيل المالية محجوبة حسب الصلاحية</small>}{x.type==='rating'&&x.data?.comment&&<small>{x.data.comment}</small>}{x.type==='scan'&&x.data?.result&&<small>النتيجة: {x.data.result==='success'?'ناجح':x.data.result}</small>}</div></div>)}</div>}</Card>
  </div>
 </>;
}
