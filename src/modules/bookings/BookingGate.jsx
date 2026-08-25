import React from 'react';
import {ArrowRight,Ticket,RotateCcw,LockKeyhole} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {Card,PageHeader,Button,Badge} from '../../components/UI.jsx';
import {money,journeyLabel} from '../../lib/format.js';
import BookingEditor from './BookingEditor.jsx';

const s=v=>String(v??'');
const cancelled=v=>['cancelled','canceled','ملغي'].includes(s(v).trim().toLowerCase());

export default function BookingGate({bookingNo,go}){
  const {data}=useAppData();
  if(!bookingNo)return <BookingEditor go={go}/>;
  const booking=(data.bookings||[]).find(b=>s(b.booking_number)===s(bookingNo));
  if(!booking||!cancelled(booking.status))return <BookingEditor bookingNo={bookingNo} go={go}/>;

  const snap=booking.snapshot&&typeof booking.snapshot==='object'?booking.snapshot:{};
  const passengers=(data.passengers||[]).filter(p=>s(p.booking_id)===s(booking.id));
  const trip=(data.trips||[]).find(t=>s(t.id)===s(booking.trip_id));
  const returnTrip=(data.trips||[]).find(t=>s(t.id)===s(booking.return_trip_id));
  const branch=(data.branches||[]).find(b=>s(b.id)===s(booking.branch_id));
  const mode=booking.journey_mode||snap.journeyMode||'oneway';
  const tripText=trip?`${trip.from_city||trip.origin||'—'} ← ${trip.to_city||trip.destination||'—'}`:'—';
  const returnText=returnTrip?`${returnTrip.to_city||returnTrip.destination||'—'} ← ${returnTrip.from_city||returnTrip.origin||'—'}`:mode==='roundtrip'?tripText:'—';

  return <>
    <PageHeader title={`الحجز ${booking.booking_number}`} subtitle="حجز ملغي — عرض فقط" actions={<><Button onClick={()=>go('/bookings')}><ArrowRight size={16}/> رجوع</Button><Button onClick={()=>go('/ticket/'+booking.booking_number)}><Ticket size={16}/> التذكرة</Button><Button onClick={()=>go('/refunds?booking='+booking.booking_number)}><RotateCcw size={16}/> الاسترداد</Button></>}/>
    <div className="training-banner" style={{marginBottom:14,background:'#fff1f2',color:'#9f1239',borderColor:'#fecdd3',display:'flex',alignItems:'center',gap:10}}><LockKeyhole size={20}/><strong>هذا الحجز ملغي ومقفل ضد التعديل.</strong><span>يمكن عرض بياناته والتذكرة والاستردادات فقط. إعادة التفعيل — إن لزم — تتم بإجراء مستقل ومصرح به، وليس من شاشة التعديل.</span></div>
    <div className="editor-grid">
      <Card><div className="card-title"><h3>بيانات الحجز</h3><Badge tone="red">ملغي</Badge></div><div className="form-grid"><div><small>الفرع</small><strong style={{display:'block'}}>{branch?.name||'—'}</strong></div><div><small>نوع الرحلة</small><strong style={{display:'block'}}>{journeyLabel(mode)}</strong></div><div><small>الرحلة الأساسية</small><strong style={{display:'block'}}>{tripText}</strong></div>{['roundtrip','separate','returnonly'].includes(mode)&&<div><small>العودة</small><strong style={{display:'block'}}>{returnText}</strong></div>}<div><small>اسم العميل</small><strong style={{display:'block'}}>{booking.customer_name||'—'}</strong></div><div><small>الجوال</small><strong style={{display:'block'}}>{booking.customer_phone||'—'}</strong></div><div><small>الهوية / الإقامة</small><strong style={{display:'block'}}>{booking.customer_identity||'—'}</strong></div><div><small>الجنسية</small><strong style={{display:'block'}}>{booking.customer_nationality||'—'}</strong></div><div><small>السكن</small><strong style={{display:'block'}}>{booking.accommodation_label||booking.accommodation_type||'—'}</strong></div><div><small>الإجمالي</small><strong style={{display:'block'}}>{money(booking.total_price)}</strong></div><div><small>إجمالي التحصيل التاريخي</small><strong style={{display:'block'}}>{money(booking.paid_amount)}</strong></div><div><small>الحالة</small><strong style={{display:'block'}}>ملغي</strong></div></div>{booking.notes&&<div style={{marginTop:14}}><small>ملاحظات</small><div style={{marginTop:4,whiteSpace:'pre-wrap'}}>{booking.notes}</div></div>}</Card>
      <Card><div className="card-title"><h3>المسافرون</h3><Badge>{passengers.length}</Badge></div>{passengers.length?passengers.map((p,i)=><div key={p.id||i} className="passenger-box" style={{marginBottom:10}}><div className="passenger-number">{i+1}</div><div><strong>{p.full_name||'—'}</strong><div className="muted-small">هوية: {p.identity_number||'—'} · جوال: {p.phone||'—'} · جنسية: {p.nationality||'—'}</div></div></div>):<div className="muted-small">لا توجد بيانات مسافرين متاحة لهذا الحجز.</div>}</Card>
    </div>
  </>;
}
