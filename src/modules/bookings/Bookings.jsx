import React,{useMemo,useState} from 'react';
import {Plus,Search,RefreshCw,FilterX,Ticket,RotateCcw,MessageCircle,Pencil,UsersRound,Clock3} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Table,Input,Badge,Select,Modal} from '../../components/UI.jsx';
import {money,statusLabel,journeyLabel,tripDisplay,phoneWa} from '../../lib/format.js';
import {has} from '../../lib/permissions.js';

const num=v=>Number(v||0);
const lower=v=>String(v??'').trim().toLowerCase();
function financialState(b){const total=num(b.total_price),paid=num(b.paid_amount),remaining=Math.max(0,total-paid);if(total<=0)return {label:'بدون قيمة',tone:'orange'};if(remaining<=0.001)return {label:'مسدد',tone:'green'};if(paid>0)return {label:'مدفوع جزئيًا',tone:'orange'};return {label:'غير مسدد',tone:'red'}}
function eventTime(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA')}catch{return String(v)}}

export default function Bookings({go,query=''}){
 const {user}=useAuth();const {data,refresh}=useAppData();
 const [q,setQ]=useState(query),[status,setStatus]=useState('active'),[tripId,setTripId]=useState(''),[branchId,setBranchId]=useState(''),[financial,setFinancial]=useState('all'),[sort,setSort]=useState('newest');
 const [timeline,setTimeline]=useState(null),[timelineBusy,setTimelineBusy]=useState(false),[timelineError,setTimelineError]=useState('');
 const canEdit=has(user,'editBookings');const canRefund=has(user,'refunds')||has(user,'refund_request');const canPrint=has(user,'printTickets');const canActivity=has(user,'viewBookingActivity')||has(user,'viewBookings')||canEdit;
 const tripMap=useMemo(()=>new Map((data.trips||[]).map(t=>[String(t.id),t])),[data.trips]);
 const branchMap=useMemo(()=>new Map((data.branches||[]).map(b=>[String(b.id),b])),[data.branches]);
 const passengerMap=useMemo(()=>{const m=new Map();for(const p of data.passengers||[]){const k=String(p.booking_id||'');const a=m.get(k)||[];a.push(p);m.set(k,a)}return m},[data.passengers]);
 const rows=useMemo(()=>{
   const s=lower(q);
   const out=(data.bookings||[]).filter(b=>{
     const st=lower(b.status);
     if(status==='active'&&['cancelled','deleted','refunded'].includes(st))return false;
     if(status!=='all'&&status!=='active'&&st!==status)return false;
     if(tripId&&String(b.trip_id)!==String(tripId)&&String(b.return_trip_id)!==String(tripId))return false;
     if(branchId&&String(b.branch_id)!==String(branchId))return false;
     const fs=financialState(b).label;
     if(financial==='paid'&&fs!=='مسدد')return false;
     if(financial==='partial'&&fs!=='مدفوع جزئيًا')return false;
     if(financial==='unpaid'&&fs!=='غير مسدد')return false;
     if(!s)return true;
     const t=tripMap.get(String(b.trip_id));const ps=passengerMap.get(String(b.id))||[];
     return [b.booking_number,b.customer_name,b.customer_phone,b.customer_identity,b.customer_nationality,t?.trip_code,t?.from_city,t?.origin,t?.to_city,t?.destination,...ps.flatMap(p=>[p.full_name,p.identity_number,p.phone,p.nationality])].some(v=>lower(v).includes(s));
   });
   out.sort((a,b)=>{if(sort==='oldest')return String(a.created_at||a.booking_number||'').localeCompare(String(b.created_at||b.booking_number||''));if(sort==='remaining')return (num(b.total_price)-num(b.paid_amount))-(num(a.total_price)-num(a.paid_amount));return String(b.created_at||b.booking_number||'').localeCompare(String(a.created_at||a.booking_number||''))});
   return out;
 },[data.bookings,q,status,tripId,branchId,financial,sort,tripMap,passengerMap]);
 const totals=useMemo(()=>rows.reduce((x,b)=>{x.total+=num(b.total_price);x.paid+=num(b.paid_amount);x.remaining+=Math.max(0,num(b.total_price)-num(b.paid_amount));x.passengers+=(passengerMap.get(String(b.id))||[]).length;return x},{total:0,paid:0,remaining:0,passengers:0}),[rows,passengerMap]);
 function clear(){setQ('');setStatus('active');setTripId('');setBranchId('');setFinancial('all');setSort('newest')}
 function wa(b,e){e.stopPropagation();const href=`https://wa.me/${phoneWa(b.customer_phone)}?text=${encodeURIComponent(`شركة الماهر الماسي\nرقم الحجز: ${b.booking_number}\nالعميل: ${b.customer_name||''}`)}`;window.open(href,'_blank')}
 async function openTimeline(b,e){e?.stopPropagation();setTimeline({booking:b,events:[]});setTimelineBusy(true);setTimelineError('');try{const out=await api.bookingTimeline(b.booking_number);setTimeline({booking:out.booking||b,events:out.events||[],count:out.count||0})}catch(x){setTimelineError(x.message)}finally{setTimelineBusy(false)}}
 return <>
  <PageHeader title="الحجوزات" subtitle="سجل موحد للحجوزات والمسافرين والتحصيل والتذكرة والاسترداد" actions={<><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button><Button variant="primary" onClick={()=>go('/bookings/new')}><Plus size={16}/> حجز جديد</Button></>}/>
  <Card>
   <div className="booking-filters">
    <div className="filterbar"><Search size={18}/><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="رقم الحجز، العميل، الجوال، الهوية، المسافر، الرحلة..."/></div>
    <Select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">الحجوزات الفعالة</option><option value="all">كل الحالات</option><option value="confirmed">مؤكد</option><option value="pending">قيد المراجعة</option><option value="cancelled">ملغي</option></Select>
    <Select value={financial} onChange={e=>setFinancial(e.target.value)}><option value="all">كل الحالات المالية</option><option value="paid">مسدد</option><option value="partial">مدفوع جزئيًا</option><option value="unpaid">غير مسدد</option></Select>
    <Select value={tripId} onChange={e=>setTripId(e.target.value)}><option value="">كل الرحلات</option>{(data.trips||[]).map(t=><option key={t.id} value={t.id}>{tripDisplay(t)}</option>)}</Select>
    <Select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">كل الفروع المتاحة</option>{(data.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name||b.branch_name}</option>)}</Select>
    <Select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option><option value="remaining">الأعلى متبقيًا</option></Select>
    <Button onClick={clear}><FilterX size={16}/> مسح الفلاتر</Button>
   </div>
   <div className="table-summary"><span>الحجوزات: <b>{rows.length}</b></span><span><UsersRound size={14}/> المسافرون: <b>{totals.passengers}</b></span><span>الإجمالي: <b>{money(totals.total)}</b></span><span>المحصل: <b>{money(totals.paid)}</b></span><span>المتبقي: <b>{money(totals.remaining)}</b></span></div>
   <Table rows={rows} onRow={r=>go('/bookings/'+r.booking_number)} columns={[
    {key:'booking_number',label:'رقم الحجز',render:r=><strong>{r.booking_number}</strong>},
    {key:'customer_name',label:'العميل',render:r=><div><strong>{r.customer_name||'—'}</strong><div className="muted-small">{r.customer_phone||'—'} · {r.customer_nationality||'—'}</div></div>},
    {key:'passengers',label:'المسافرون',render:r=><Badge>{(passengerMap.get(String(r.id))||[]).length}</Badge>},
    {key:'trip',label:'الرحلة',render:r=>{const t=tripMap.get(String(r.trip_id));return <div><strong>{t?tripDisplay(t):'—'}</strong>{r.return_trip_id&&<div className="muted-small">عودة منفصلة: {tripDisplay(tripMap.get(String(r.return_trip_id))||{})}</div>}</div>}},
    {key:'journey_mode',label:'النوع',render:r=>journeyLabel(r.journey_mode)},
    {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||branchMap.get(String(r.branch_id))?.branch_name||'—'},
    {key:'financial',label:'المالية',render:r=>{const f=financialState(r),rem=Math.max(0,num(r.total_price)-num(r.paid_amount));return <div><Badge tone={f.tone}>{f.label}</Badge><div className="muted-small">{money(r.paid_amount)} / {money(r.total_price)}{rem>0?` · متبقي ${money(rem)}`:''}</div></div>}},
    {key:'status',label:'الحالة',render:r=><Badge tone={r.status==='cancelled'?'red':r.status==='pending'?'orange':'green'}>{statusLabel(r.status)}</Badge>},
    {key:'actions',label:'إجراءات',render:r=><div className="row-actions">{canEdit&&<Button title="تعديل" onClick={e=>{e.stopPropagation();go('/bookings/'+r.booking_number)}}><Pencil size={14}/></Button>}{canActivity&&<Button title="الخط الزمني / سجل النشاط" onClick={e=>openTimeline(r,e)}><Clock3 size={14}/></Button>}{canPrint&&<Button title="التذكرة" onClick={e=>{e.stopPropagation();go('/ticket/'+r.booking_number)}}><Ticket size={14}/></Button>}<Button title="واتساب" onClick={e=>wa(r,e)}><MessageCircle size={14}/></Button>{canRefund&&r.status!=='cancelled'&&<Button title="استرداد" onClick={e=>{e.stopPropagation();go('/refunds?booking='+r.booking_number)}}><RotateCcw size={14}/></Button>}</div>}
   ]}/>
  </Card>
  <Modal open={!!timeline} onClose={()=>{setTimeline(null);setTimelineError('')}} title={`الخط الزمني للحجز ${timeline?.booking?.booking_number||''}`} wide>
   {timelineBusy?<div className="empty">جاري تحميل سجل النشاط...</div>:timelineError?<div className="error-box">{timelineError}</div>:(timeline?.events||[]).length?<div className="booking-timeline">{timeline.events.map((ev,i)=><div className="booking-timeline-item" key={ev.id||i}><div className="booking-timeline-dot"/><div className="booking-timeline-body"><div className="card-title"><h3>{ev.title||ev.action||'نشاط على الحجز'}</h3><Badge>{eventTime(ev.created_at)}</Badge></div><div className="muted-small">{ev.actor_name?`بواسطة ${ev.actor_name}${ev.actor_role?` — ${ev.actor_role}`:''}`:'عملية مسجلة بالنظام'}{ev.entity_type?` · ${ev.entity_type}`:''}</div>{ev.action&&ev.action!==ev.title&&<div className="muted-small" style={{marginTop:4}}>العملية: {ev.action}</div>}</div></div>)}</div>:<div className="empty">لا توجد أحداث مسجلة لهذا الحجز حتى الآن.</div>}
  </Modal>
 </>;
}
