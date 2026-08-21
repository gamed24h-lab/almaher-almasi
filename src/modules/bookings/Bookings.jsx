import React,{useMemo,useState} from 'react';
import {Plus,Search,RefreshCw,FilterX} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {Card,PageHeader,Button,Table,Input,Badge,Select} from '../../components/UI.jsx';
import {money,statusLabel,journeyLabel} from '../../lib/format.js';

export default function Bookings({go,query=''}){
 const {data,refresh}=useAppData();
 const [q,setQ]=useState(query),[status,setStatus]=useState('active'),[tripId,setTripId]=useState(''),[branchId,setBranchId]=useState('');
 const tripMap=useMemo(()=>new Map(data.trips.map(t=>[String(t.id),t])),[data.trips]);
 const branchMap=useMemo(()=>new Map(data.branches.map(b=>[String(b.id),b])),[data.branches]);
 const rows=useMemo(()=>{
   const s=q.trim().toLowerCase();
   return data.bookings.filter(b=>{
     if(status==='active'&&String(b.status||'').toLowerCase()==='cancelled')return false;
     if(status!=='all'&&status!=='active'&&String(b.status||'').toLowerCase()!==status)return false;
     if(tripId&&String(b.trip_id)!==String(tripId)&&String(b.return_trip_id)!==String(tripId))return false;
     if(branchId&&String(b.branch_id)!==String(branchId))return false;
     if(!s)return true;
     const t=tripMap.get(String(b.trip_id));
     return [b.booking_number,b.customer_name,b.customer_phone,b.customer_identity,t?.trip_code,t?.from_city,t?.to_city].some(v=>String(v||'').toLowerCase().includes(s));
   });
 },[data.bookings,q,status,tripId,branchId,tripMap]);
 const totalRemaining=rows.reduce((sum,b)=>sum+Math.max(0,Number(b.total_price||0)-Number(b.paid_amount||0)),0);
 function clear(){setQ('');setStatus('active');setTripId('');setBranchId('')}
 return <>
  <PageHeader title="الحجوزات" subtitle="بحث سريع، فلترة، تعديل، تذكرة واسترداد من نفس سجل الحجز" actions={<><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button><Button variant="primary" onClick={()=>go('/bookings/new')}><Plus size={16}/> حجز جديد</Button></>}/>
  <Card>
   <div className="booking-filters">
    <div className="filterbar"><Search size={18}/><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="رقم الحجز، العميل، الجوال، الهوية، الرحلة..."/></div>
    <Select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">الحجوزات الفعالة</option><option value="all">كل الحالات</option><option value="confirmed">مؤكد</option><option value="pending">قيد المراجعة</option><option value="cancelled">ملغي</option></Select>
    <Select value={tripId} onChange={e=>setTripId(e.target.value)}><option value="">كل الرحلات</option>{data.trips.map(t=><option key={t.id} value={t.id}>{t.trip_code} — {t.from_city||t.origin} ← {t.to_city||t.destination}</option>)}</Select>
    <Select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">كل الفروع المتاحة</option>{data.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select>
    <Button onClick={clear}><FilterX size={16}/> مسح الفلاتر</Button>
   </div>
   <div className="table-summary"><span>النتائج: <b>{rows.length}</b></span><span>إجمالي المتبقي للنتائج: <b>{money(totalRemaining)}</b></span></div>
   <Table rows={rows} onRow={r=>go('/bookings/'+r.booking_number)} columns={[
    {key:'booking_number',label:'رقم الحجز'},
    {key:'customer_name',label:'العميل',render:r=><div><strong>{r.customer_name||'—'}</strong><div className="muted-small">{r.customer_phone||'—'}</div></div>},
    {key:'trip',label:'الرحلة',render:r=>{const t=tripMap.get(String(r.trip_id));return <div><strong>{t?.trip_code||'—'}</strong><div className="muted-small">{t?`${t.from_city||t.origin||'—'} ← ${t.to_city||t.destination||'—'}`:'—'}</div></div>}},
    {key:'journey_mode',label:'النوع',render:r=>journeyLabel(r.journey_mode)},
    {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
    {key:'total_price',label:'الإجمالي',render:r=>money(r.total_price)},
    {key:'remaining',label:'المتبقي',render:r=>{const v=Math.max(0,Number(r.total_price||0)-Number(r.paid_amount||0));return <strong className={v>0?'warning-text-inline':'success-text-inline'}>{money(v)}</strong>}},
    {key:'status',label:'الحالة',render:r=><Badge tone={r.status==='cancelled'?'red':r.status==='pending'?'orange':'green'}>{statusLabel(r.status)}</Badge>}
   ]}/>
  </Card>
 </>;
}
