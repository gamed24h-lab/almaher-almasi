import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,CheckCircle2,MessageSquarePlus,RefreshCw,Star,TicketCheck,UsersRound} from 'lucide-react';
import {api} from '../../lib/api.js';
import {useAppData} from '../../core/AppDataContext.jsx';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,PageHeader,Select,Table,Textarea} from '../../components/UI.jsx';
import {dateTime,statusLabel,tripDisplay} from '../../lib/format.js';

const s=v=>String(v??'');
const low=v=>s(v).toLowerCase();
const scoreOptions=[5,4,3,2,1];
const ticketStatusTone=v=>['resolved','closed','done'].includes(low(v))?'green':['urgent','high'].includes(low(v))?'red':'blue';
export default function CRM(){
 const {data:app}=useAppData();
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[modal,setModal]=useState(null),[tab,setTab]=useState('tickets');
 async function load(){setError('');try{setData(await api.module('crm'))}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[]);
 const bookings=app.bookings||[],trips=app.trips||[],branches=app.branches||[];
 const bmap=useMemo(()=>new Map(bookings.map(b=>[s(b.id),b])),[bookings]);
 const tmap=useMemo(()=>new Map(trips.map(t=>[s(t.id),t])),[trips]);
 const tickets=data?.service_tickets||[],tasks=data?.tasks||[],leads=data?.leads||[];
 const complaints=useMemo(()=>tickets.filter(x=>low(x.category)==='complaint'),[tickets]);
 const recovery=useMemo(()=>tasks.filter(x=>low(x.entity_type)==='post_trip_rating'||/service recovery|تقييم منخفض/i.test(s(x.title))),[tasks]);
 const openTickets=tickets.filter(x=>!['resolved','closed'].includes(low(x.status))).length;
 const openRecovery=recovery.filter(x=>!['done','cancelled','closed'].includes(low(x.status))).length;
 function done(msg){setNotice(msg);setTimeout(()=>setNotice(''),4500)}
 async function createComplaint(e){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const b=bmap.get(s(f.booking_id));const branchId=b?.branch_id||f.branch_id||app.scope?.branch_id||null;setBusy(true);setError('');try{
   await api.moduleWrite({action:'insert',table:'service_tickets',row:{ticket_no:`CMP-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,booking_id:f.booking_id||null,branch_id:branchId,subject:String(f.subject||'شكوى عميل').trim(),category:'complaint',priority:f.priority||'normal',status:'open',assigned_to:f.assigned_to||null,description:String(f.description||'').trim()}});
   await load();setModal(null);done('تم تسجيل الشكوى وفتح تذكرة متابعة ✅');
 }catch(e2){setError(e2.message)}finally{setBusy(false)}}
 async function submitRating(e){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const b=bmap.get(s(f.booking_id));if(!b){setError('اختر الحجز أولًا');return}const score=Number(f.overall_score||5);setBusy(true);setError('');try{
   const out=await api.mega('submit_rating',{booking_id:b.id,trip_id:b.trip_id||null,branch_id:b.branch_id||null,customer_name:b.customer_name||b.name||null,overall_score:score,bus_score:Number(f.bus_score||score),driver_score:Number(f.driver_score||score),supervisor_score:Number(f.supervisor_score||score),hotel_score:Number(f.hotel_score||score),organization_score:Number(f.organization_score||score),booking_score:Number(f.booking_score||score),comment:String(f.comment||'').trim(),tags:[]});
   await load();setModal(null);done(out?.recovery_task?'تم حفظ التقييم وفتح متابعة Service Recovery تلقائيًا ⚠️':'تم حفظ تقييم ما بعد الرحلة ✅');
 }catch(e2){setError(e2.message)}finally{setBusy(false)}}
 async function updateTicket(row,status){setBusy(true);setError('');try{await api.moduleWrite({action:'update',table:'service_tickets',id:row.id,row:{status}});await load();done(status==='resolved'?'تم اعتماد حل التذكرة ✅':'تم تحديث حالة التذكرة')}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function updateTask(row,status){setBusy(true);setError('');try{await api.moduleWrite({action:'update',table:'tasks',id:row.id,row:{status,completed_at:status==='done'?new Date().toISOString():null}});await load();done(status==='done'?'تم إغلاق متابعة العميل ✅':'تم تحديث المتابعة')}catch(e){setError(e.message)}finally{setBusy(false)}}
 const ticketCols=[
  {key:'ticket_no',label:'رقم التذكرة'},{key:'subject',label:'الموضوع'},{key:'booking',label:'الحجز',render:r=>bmap.get(s(r.booking_id))?.booking_number||'—'},
  {key:'category',label:'النوع',render:r=><Badge tone={low(r.category)==='complaint'?'orange':'blue'}>{low(r.category)==='complaint'?'شكوى':r.category||'خدمة'}</Badge>},
  {key:'priority',label:'الأولوية',render:r=><Badge tone={['urgent','high'].includes(low(r.priority))?'red':'blue'}>{statusLabel(r.priority||'normal')}</Badge>},
  {key:'status',label:'الحالة',render:r=><Badge tone={ticketStatusTone(r.status)}>{statusLabel(r.status||'open')}</Badge>},
  {key:'created_at',label:'الإنشاء',render:r=>dateTime(r.created_at)},
  {key:'actions',label:'',render:r=><div className="row-actions">{!['resolved','closed'].includes(low(r.status))&&<><Button disabled={busy} onClick={()=>updateTicket(r,'in_progress')}>بدء متابعة</Button><Button disabled={busy} onClick={()=>updateTicket(r,'resolved')}>تم الحل</Button></>}</div>}
 ];
 const recoveryCols=[
  {key:'title',label:'المتابعة'},{key:'description',label:'التفاصيل'},{key:'priority',label:'الأولوية',render:r=><Badge tone={['urgent','high'].includes(low(r.priority))?'red':'blue'}>{statusLabel(r.priority||'normal')}</Badge>},
  {key:'status',label:'الحالة',render:r=><Badge tone={low(r.status)==='done'?'green':'orange'}>{statusLabel(r.status||'open')}</Badge>},{key:'created_at',label:'الإنشاء',render:r=>dateTime(r.created_at)},
  {key:'actions',label:'',render:r=>!['done','cancelled'].includes(low(r.status))?<div className="row-actions"><Button disabled={busy} onClick={()=>updateTask(r,'in_progress')}>جاري التواصل</Button><Button disabled={busy} onClick={()=>updateTask(r,'done')}>إغلاق المتابعة</Button></div>:null}
 ];
 const leadCols=[{key:'name',label:'العميل'},{key:'phone',label:'الجوال'},{key:'source_channel',label:'المصدر'},{key:'status',label:'الحالة',render:r=><Badge>{statusLabel(r.status)}</Badge>},{key:'next_follow_up_at',label:'المتابعة القادمة',render:r=>dateTime(r.next_follow_up_at)}];
 const tabs=[['tickets','تذاكر الخدمة',tickets.length],['complaints','الشكاوى',complaints.length],['recovery','استعادة رضا العميل',recovery.length],['leads','العملاء المحتملون',leads.length]];
 const rows=tab==='tickets'?tickets:tab==='complaints'?complaints:tab==='recovery'?recovery:leads;
 const cols=tab==='recovery'?recoveryCols:tab==='leads'?leadCols:ticketCols;
 return <>
  <PageHeader title="CRM وخدمة العملاء" subtitle="الشكاوى، التقييمات، استعادة رضا العميل والمتابعة بعد الرحلة" actions={<><Button onClick={load}><RefreshCw size={16}/> تحديث</Button><Button onClick={()=>setModal('rating')}><Star size={16}/> تقييم بعد الرحلة</Button><Button variant="primary" onClick={()=>setModal('complaint')}><MessageSquarePlus size={16}/> تسجيل شكوى</Button></>}/>
  <ErrorBox error={error}/>{notice&&<div className="training-banner" style={{background:'#ecfdf3',color:'#166534',borderColor:'#bbf7d0'}}>{notice}</div>}
  <div className="stats-grid"><Mini icon={<TicketCheck/>} label="تذاكر مفتوحة" value={openTickets}/><Mini icon={<AlertTriangle/>} label="شكاوى" value={complaints.length}/><Mini icon={<UsersRound/>} label="متابعات رضا العميل" value={openRecovery}/><Mini icon={<CheckCircle2/>} label="مغلقة/محلولة" value={tickets.length-openTickets}/></div>
  <div className="tabs">{tabs.map(([k,l,n])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}<span>{n}</span></button>)}</div>
  {!data&&!error?<Loading/>:<Card><Table rows={rows} columns={cols}/></Card>}
  <Modal open={modal==='complaint'} onClose={()=>setModal(null)} title="تسجيل شكوى عميل"><form className="form-grid" onSubmit={createComplaint}><Field label="الحجز"><Select name="booking_id"><option value="">بدون ربط بحجز</option>{bookings.map(b=><option key={b.id} value={b.id}>{b.booking_number} — {b.customer_name||b.name||''}</option>)}</Select></Field><Field label="الأولوية"><Select name="priority" defaultValue="normal"><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></Select></Field><Field label="موضوع الشكوى"><Input name="subject" required placeholder="مثال: تأخير الانطلاق"/></Field><Field label="المسؤول"><Input name="assigned_to" placeholder="اسم الموظف / الفريق"/></Field><Field label="تفاصيل الشكوى"><Textarea name="description" required/></Field><div className="modal-actions"><Button type="button" onClick={()=>setModal(null)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'فتح تذكرة شكوى'}</Button></div></form></Modal>
  <Modal open={modal==='rating'} onClose={()=>setModal(null)} title="تقييم ما بعد الرحلة" wide><form className="form-grid" onSubmit={submitRating}><Field label="الحجز"><Select name="booking_id" required><option value="">اختر الحجز</option>{bookings.map(b=>{const t=tmap.get(s(b.trip_id));return <option key={b.id} value={b.id}>{b.booking_number} — {b.customer_name||b.name||''}{t?` — ${tripDisplay(t)}`:''}</option>})}</Select></Field><Score name="overall_score" label="التقييم العام"/><Score name="bus_score" label="الباص"/><Score name="driver_score" label="السائق"/><Score name="supervisor_score" label="المشرف"/><Score name="hotel_score" label="الفندق"/><Score name="organization_score" label="التنظيم"/><Score name="booking_score" label="الحجز والخدمة"/><Field label="تعليق العميل"><Textarea name="comment" placeholder="ملاحظات العميل بعد الرحلة..."/></Field><Card><b>قاعدة Service Recovery</b><div className="muted-small">أي تقييم عام 1 أو 2 من 5 يفتح تلقائيًا مهمة متابعة عاجلة داخل CRM حتى يتم التواصل مع العميل وإغلاقها.</div></Card><div className="modal-actions"><Button type="button" onClick={()=>setModal(null)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}><Star size={16}/>{busy?'جاري الحفظ...':'حفظ التقييم'}</Button></div></form></Modal>
 </>;
}
function Score({name,label}){return <Field label={label}><Select name={name} defaultValue="5">{scoreOptions.map(x=><option key={x} value={x}>{x} / 5</option>)}</Select></Field>}
function Mini({icon,label,value}){return <Card className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></Card>}
