import React,{useMemo,useState} from 'react';
import {UserRoundSearch} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {Card,PageHeader,Table,Button} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

export default function Passengers({go}){
 const {data}=useAppData();
 const [filter,setFilter]=useState({q:'',nationality:'',branch:'',trip:'',documents:''});
 const bookings=useMemo(()=>new Map((data.bookings||[]).map(b=>[String(b.id),b])),[data.bookings]);
 const trips=useMemo(()=>new Map((data.trips||[]).map(t=>[String(t.id),t])),[data.trips]);
 const branches=useMemo(()=>new Map((data.branches||[]).map(b=>[String(b.id),b])),[data.branches]);
 const nationalityOptions=useMemo(()=>[...new Set((data.passengers||[]).map(p=>String(p.nationality||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[data.passengers]);
 const branchOptions=useMemo(()=>(data.branches||[]).map(b=>({value:String(b.id),label:b.name||b.branch_name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[data.branches]);
 const tripOptions=useMemo(()=>(data.trips||[]).map(t=>({value:String(t.id),label:t.trip_code||[t.from_city||t.origin,t.to_city||t.destination,t.departure_date].filter(Boolean).join(' — ')||t.id,searchText:[t.trip_code,t.from_city,t.origin,t.to_city,t.destination,t.departure_date]})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[data.trips]);
 const documentOptions=useMemo(()=>[...new Set((data.passengers||[]).map(p=>String(p.document_status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[data.passengers]);
 const rows=useMemo(()=>(data.passengers||[]).filter(p=>{
  const b=bookings.get(String(p.booking_id)),t=trips.get(String(b?.trip_id)),branch=branches.get(String(b?.branch_id));
  return (!filter.nationality||String(p.nationality||'')===filter.nationality)
   &&(!filter.branch||String(b?.branch_id||'')===filter.branch)
   &&(!filter.trip||String(b?.trip_id||'')===filter.trip||String(b?.return_trip_id||'')===filter.trip)
   &&(!filter.documents||String(p.document_status||'')===filter.documents)
   &&matchesListQuery(filter.q,p.full_name,p.identity_number,p.phone,p.nationality,p.document_status,b?.booking_number,b?.customer_name,b?.customer_phone,t?.trip_code,t?.from_city,t?.origin,t?.to_city,t?.destination,branch?.name,branch?.branch_name);
 }),[data.passengers,filter,bookings,trips,branches]);
 return <><PageHeader title="المسافرون" subtitle="ملف موحد لكل مسافر وربطه بالحجز والرحلة والسكن والمقعد والمالية"/><Card>
  <SmartListFilters storageKey="passengers-register-filters" search={filter.q} onSearchChange={v=>setFilter(x=>({...x,q:v}))} searchPlaceholder="ابحث بالاسم أو الهوية أو الجوال أو الجنسية أو رقم الحجز أو الرحلة..." totalCount={(data.passengers||[]).length} resultCount={rows.length} onReset={()=>setFilter({q:'',nationality:'',branch:'',trip:'',documents:''})} filters={[
   {key:'nationality',label:'الجنسية',value:filter.nationality,onChange:v=>setFilter(x=>({...x,nationality:v})),options:nationalityOptions},
   {key:'branch',label:'الفرع',value:filter.branch,onChange:v=>setFilter(x=>({...x,branch:v})),options:branchOptions},
   {key:'trip',label:'الرحلة',value:filter.trip,onChange:v=>setFilter(x=>({...x,trip:v})),options:tripOptions},
   {key:'documents',label:'المستندات',value:filter.documents,onChange:v=>setFilter(x=>({...x,documents:v})),options:documentOptions}
  ]}/>
  <Table preferenceKey="passengers-register" defaultPageSize={25} rows={rows} onRow={p=>go('/passengers/'+encodeURIComponent(p.id))} columns={[
   {key:'full_name',label:'الاسم'},
   {key:'identity_number',label:'الهوية'},
   {key:'nationality',label:'الجنسية'},
   {key:'phone',label:'الجوال'},
   {key:'booking',label:'الحجز',render:p=>bookings.get(String(p.booking_id))?.booking_number||'—'},
   {key:'document_status',label:'المستندات'},
   {key:'open',label:'',render:p=><Button onClick={e=>{e.stopPropagation();go('/passengers/'+encodeURIComponent(p.id))}}><UserRoundSearch size={15}/> Passenger 360°</Button>}
  ]}/>
 </Card></>;
}
