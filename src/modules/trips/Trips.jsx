import React,{useMemo,useState} from 'react';
import {Plus,RefreshCw,Pencil,UsersRound} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Table,Modal,Field,Input,Select,ErrorBox,Badge} from '../../components/UI.jsx';
import {money,statusLabel} from '../../lib/format.js';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';

const blankStop=(branch)=>({branchId:branch.id,branchName:branch.name||'',city:branch.name||'',outboundTime:'',returnTime:'',order:1});

export default function Trips({go}){
 const {user}=useAuth(),{data,refresh}=useAppData();
 const [open,setOpen]=useState(false),[err,setErr]=useState(''),[showPast,setShowPast]=useState(false),[editing,setEditing]=useState(null);
 const [mainBranch,setMainBranch]=useState(''),[shared,setShared]=useState([]),[stops,setStops]=useState({}),[saving,setSaving]=useState(false);
 const today=new Date().toISOString().slice(0,10);
 const rows=useMemo(()=>data.trips.filter(t=>showPast||!t.departure_date||t.departure_date>=today),[data.trips,showPast,today]);
 const relByTrip=useMemo(()=>{const m=new Map();for(const r of data.tripBranches||[]){const a=m.get(String(r.trip_id))||[];a.push(r);m.set(String(r.trip_id),a)}return m},[data.tripBranches]);

 function reset(){setEditing(null);setMainBranch(data.scope?.branch_id||'');setShared([]);setStops({});setErr('')}
 function openNew(){reset();const bid=data.scope?.branch_id||'';if(bid){const b=data.branches.find(x=>String(x.id)===String(bid));setStops({[bid]:blankStop(b||{id:bid,name:''})})}setOpen(true)}
 function openEdit(t){
   setEditing(t);setMainBranch(t.branch_id||data.scope?.branch_id||'');
   const rels=relByTrip.get(String(t.id))||[];const ids=rels.filter(r=>String(r.branch_id)!==String(t.branch_id)).map(r=>String(r.branch_id));setShared(ids);
   const map={};rels.forEach((r,i)=>{const b=data.branches.find(x=>String(x.id)===String(r.branch_id));map[String(r.branch_id)]={branchId:r.branch_id,branchName:b?.name||'',city:r.boarding_point||b?.name||'',outboundTime:r.boarding_time||'',returnTime:r.return_drop_time||'',order:Number(r.stop_order||i+1)}});setStops(map);setOpen(true)
 }
 function toggleBranch(id,checked){
   setShared(a=>checked?[...new Set([...a,String(id)])]:a.filter(x=>String(x)!==String(id)));
   if(checked)setStops(x=>{const b=data.branches.find(y=>String(y.id)===String(id));return {...x,[id]:x[id]||blankStop(b||{id,name:''})}})
 }
 function updateStop(id,key,value){setStops(x=>({...x,[id]:{...(x[id]||{}),branchId:id,[key]:value}}))}
 async function save(e){
   e.preventDefault();setErr('');setSaving(true);
   const f=Object.fromEntries(new FormData(e.currentTarget));
   const selected=[String(mainBranch),...shared.filter(x=>String(x)!==String(mainBranch))].filter(Boolean);
   const routeStops=selected.map((bid,i)=>{const b=data.branches.find(x=>String(x.id)===String(bid));const s=stops[bid]||{};return {branchId:bid,branchName:b?.name||'',city:s.city||b?.name||'',outboundTime:s.outboundTime||null,returnTime:s.returnTime||null,order:Number(s.order||i+1)}});
   const row={
     ...(editing?.id?{id:editing.id}:{}),trip_code:String(f.trip_code||'').trim(),branch_id:mainBranch,from_city:String(f.from_city||'').trim(),to_city:String(f.to_city||'').trim(),
     departure_date:f.departure_date,departure_time:f.departure_time||null,return_date:f.return_date||null,return_time:f.return_time||null,
     bus_capacity:Number(f.bus_capacity||49),booking_capacity:Number(f.bus_capacity||49),status:f.status||'active',
     price_one_way:Number(f.price_one_way||0),price_no_accommodation:Number(f.price_no_accommodation||0),price_shared:Number(f.price_shared||0),price_private_room:Number(f.price_private_room||0),
     operational_notes:f.operational_notes||editing?.operational_notes||'',_shared_branch_ids:shared.filter(x=>String(x)!==String(mainBranch)),route_stops:routeStops
   };
   try{await api.admin({action:'sync_trips',rows:[row]});setOpen(false);await refresh()}catch(e2){setErr(e2.message)}finally{setSaving(false)}
 }
 const tripColumns=[
   {key:'trip_code',label:'الرحلة'},
   {key:'route',label:'المسار',render:r=><strong>{r.from_city||r.origin||'—'} ← {r.to_city||r.destination||'—'}</strong>},
   {key:'departure_date',label:'التاريخ',render:r=><div>{r.departure_date||'—'}<div className="muted-small">{r.departure_time||''}</div></div>},
   {key:'shared',label:'الفروع',render:r=>{const count=(relByTrip.get(String(r.id))||[]).length||1;return <Badge tone={count>1?'orange':'blue'}><UsersRound size={12}/> {count}</Badge>}},
   {key:'capacity',label:'السعة',render:r=>r.booking_capacity||r.default_bus_capacity||r.bus_capacity||'—'},
   {key:'price',label:'ذهاب',render:r=>money(r.price_one_way||0)},
   {key:'status',label:'الحالة',render:r=><Badge tone={String(r.status).toLowerCase()==='cancelled'?'red':'green'}>{statusLabel(r.status)}</Badge>},
   {key:'edit',label:'',render:r=>has(user,'trips')?<Button onClick={e=>{e.stopPropagation();openEdit(r)}}><Pencil size={14}/> تعديل</Button>:null}
 ];
 return <>
  <PageHeader title="الرحلات" subtitle="الذهاب والعودة والتسعير والرحلات المشتركة بين الفروع" actions={<><label className="toggle"><input type="checkbox" checked={showPast} onChange={e=>setShowPast(e.target.checked)}/>إظهار القديمة</label><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button>{has(user,'trips')&&<Button variant="primary" onClick={openNew}><Plus size={16}/> إنشاء رحلة</Button>}</>}/>
  <ErrorBox error={err}/><Card><Table rows={rows} onRow={r=>go('/trips/'+r.id)} columns={tripColumns}/></Card>
  <Modal open={open} onClose={()=>setOpen(false)} title={editing?`تعديل الرحلة ${editing.trip_code}`:'إنشاء رحلة جديدة'} wide>
   <form className="form-grid" onSubmit={save} key={editing?.id||'new'}>
    <Field label="كود الرحلة"><Input name="trip_code" required defaultValue={editing?.trip_code||''} placeholder="MAH-260821-01"/></Field>
    <Field label="الفرع الرئيسي"><Select value={mainBranch} onChange={e=>{const bid=e.target.value;setMainBranch(bid);setShared(a=>a.filter(x=>String(x)!==String(bid)));if(bid)setStops(x=>{const b=data.branches.find(y=>String(y.id)===String(bid));return {...x,[bid]:x[bid]||blankStop(b||{id:bid,name:''})}})}} required><option value="">اختر</option>{data.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
    <Field label="من"><Input name="from_city" required defaultValue={editing?.from_city||editing?.origin||''}/></Field>
    <Field label="إلى"><Input name="to_city" required defaultValue={editing?.to_city||editing?.destination||''}/></Field>
    <Field label="تاريخ الذهاب"><Input type="date" name="departure_date" required defaultValue={editing?.departure_date||''}/></Field>
    <Field label="وقت الذهاب"><Input type="time" name="departure_time" required defaultValue={editing?.departure_time||''}/></Field>
    <Field label="تاريخ العودة"><Input type="date" name="return_date" defaultValue={editing?.return_date||''}/></Field>
    <Field label="وقت العودة"><Input type="time" name="return_time" defaultValue={editing?.return_time||''}/></Field>
    <Field label="سعة الحجز"><Input type="number" min="1" name="bus_capacity" defaultValue={editing?.booking_capacity||editing?.bus_capacity||49}/></Field>
    <Field label="الحالة"><Select name="status" defaultValue={editing?.status||'active'}><option value="active">نشطة</option><option value="scheduled">مجدولة</option><option value="completed">مكتملة</option><option value="cancelled">ملغاة</option></Select></Field>
    <Field label="سعر ذهاب فقط"><Input type="number" min="0" step="0.01" name="price_one_way" defaultValue={editing?.price_one_way||0}/></Field>
    <Field label="ذهاب وعودة بدون سكن"><Input type="number" min="0" step="0.01" name="price_no_accommodation" defaultValue={editing?.price_no_accommodation||0}/></Field>
    <Field label="ذهاب وعودة + سكن مشترك"><Input type="number" min="0" step="0.01" name="price_shared" defaultValue={editing?.price_shared||0}/></Field>
    <Field label="سعر الغرفة الخاصة / يوم"><Input type="number" min="0" step="0.01" name="price_private_room" defaultValue={editing?.price_private_room||0}/></Field>
    <Field label="ملاحظات تشغيلية"><Input name="operational_notes" defaultValue={editing?.operational_notes||''}/></Field>
    <div className="shared-branches-box">
     <div className="card-title"><div><h3>الفروع المشاركة</h3><small>تظهر الرحلة لهذه الفروع تشغيليًا، وتظل المالية معزولة.</small></div><Badge>{shared.length+1} فرع</Badge></div>
     {mainBranch&&(()=>{const b=data.branches.find(x=>String(x.id)===String(mainBranch));const st=stops[mainBranch]||blankStop(b||{id:mainBranch,name:''});return <div className="shared-stop-list"><div className="shared-stop main-stop"><strong>{b?.name||'الفرع الرئيسي'} · رئيسي</strong><Input value={st.city||''} onChange={e=>updateStop(mainBranch,'city',e.target.value)} placeholder="نقطة الصعود الرئيسية"/><Input type="time" value={st.outboundTime||''} onChange={e=>updateStop(mainBranch,'outboundTime',e.target.value)}/><Input type="time" value={st.returnTime||''} onChange={e=>updateStop(mainBranch,'returnTime',e.target.value)}/><Input type="number" min="1" value={st.order||1} onChange={e=>updateStop(mainBranch,'order',Number(e.target.value))}/></div></div>})()}
     <div className="branch-picker">{data.branches.filter(b=>String(b.id)!==String(mainBranch)).map(b=><label className="permission-check" key={b.id}><input type="checkbox" checked={shared.includes(String(b.id))} onChange={e=>toggleBranch(String(b.id),e.target.checked)}/><span>{b.name}</span></label>)}</div>
     {shared.length>0&&<div className="shared-stop-list">{shared.map((id,i)=>{const b=data.branches.find(x=>String(x.id)===String(id));const s=stops[id]||blankStop(b||{id,name:''});return <div className="shared-stop" key={id}><strong>{b?.name||id}</strong><Input value={s.city||''} onChange={e=>updateStop(id,'city',e.target.value)} placeholder="نقطة الصعود"/><Input type="time" value={s.outboundTime||''} onChange={e=>updateStop(id,'outboundTime',e.target.value)}/><Input type="time" value={s.returnTime||''} onChange={e=>updateStop(id,'returnTime',e.target.value)}/><Input type="number" min="1" value={s.order||i+2} onChange={e=>updateStop(id,'order',Number(e.target.value))}/></div>})}</div>}
    </div>
    <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري الحفظ...':'حفظ الرحلة'}</Button></div>
   </form>
  </Modal>
 </>;
}
