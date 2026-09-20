import React,{useMemo,useState} from 'react';
import {History,RefreshCw,Search} from 'lucide-react';
import {useAuth} from '../core/AuthContext.jsx';
import {api} from '../lib/api.js';
import {has} from '../lib/permissions.js';
import {auditActionLabel,auditEntityLabel,normalizeAuditChanges} from '../lib/audit-format.js';
import {Badge,Button,Card,Input,Loading,Modal,Table} from './UI.jsx';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const elevated=u=>!!u&&(u.role==='developer'||u.role==='مدير عام'||u.permissions?.all===true);
const fmt=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};

export default function RecordTimeline({
  entityId='',
  entityIds=[],
  label='سجل التغييرات',
  title='سجل التغييرات',
  subtitle='من أنشأ السجل ومن عدله ومتى وما الذي تغيّر.',
  variant='secondary',
  buttonClassName='',
  limit=250
}){
 const {user}=useAuth();
 const canAudit=elevated(user)||has(user,'auditLog')||has(user,'managePermissions');
 const ids=useMemo(()=>[...new Set([entityId,...(Array.isArray(entityIds)?entityIds:[])].map(text).filter(Boolean))],[entityId,entityIds]);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[rows,setRows]=useState([]),[q,setQ]=useState(''),[selected,setSelected]=useState(null),[summary,setSummary]=useState({});
 async function load(){
  if(!canAudit||!ids.length)return;
  setBusy(true);setError('');
  try{
   const x=await api.auditRecord(ids,{limit});
   setRows(Array.isArray(x?.rows)?x.rows:[]);setSummary(x?.summary||{});
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function show(){setOpen(true);setSelected(null);await load()}
 const filtered=useMemo(()=>{const needle=lower(q);if(!needle)return rows;return rows.filter(r=>[
   r.actor_name,r.actor_role,r.action,r.entity_type,r.entity_id,r.metadata?.reason,JSON.stringify(r.metadata||{})
 ].some(v=>lower(v).includes(needle)))},[rows,q]);
 const selectedChanges=selected?normalizeAuditChanges(selected.metadata?.changes||[]):[];
 if(!canAudit||!ids.length)return null;
 const columns=[
  {key:'time',label:'الوقت',render:r=><strong>{fmt(r.created_at)}</strong>},
  {key:'action',label:'العملية',render:r=><div><strong>{auditActionLabel(r.action)}</strong><div className="muted-small">{auditEntityLabel(r.entity_type)}</div></div>},
  {key:'actor',label:'المستخدم',render:r=><div><strong>{r.actor_name||r.actor_id||'النظام'}</strong><div className="muted-small">{r.actor_role||'—'}</div></div>},
  {key:'changes',label:'التغيير',render:r=>{const n=Array.isArray(r.metadata?.changes)?r.metadata.changes.length:0;return n?<Badge tone="orange">{n} تغيير</Badge>:<Badge>نشاط مسجل</Badge>}},
  {key:'reason',label:'السبب',render:r=>r.metadata?.reason||'—'},
  {key:'action_btn',label:'',render:r=><Button type="button" onClick={()=>setSelected(r)}>التفاصيل</Button>}
 ];
 return <>
  <Button type="button" variant={variant} className={buttonClassName} onClick={show}><History size={15}/> {label}</Button>
  <Modal open={open} onClose={()=>setOpen(false)} title={title} wide>
   <div style={{display:'grid',gap:14}}>
    <Card><div className="card-title"><div><h3>{title}</h3><small>{subtitle}</small></div><div className="finance-actions"><Badge>{summary?.total_matched??rows.length} حركة</Badge><Button type="button" onClick={load} disabled={busy}><RefreshCw size={14}/> تحديث</Button></div></div>
     <div className="filterbar" style={{marginTop:10}}><Search size={16}/><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث باسم المستخدم أو العملية أو السبب"/></div>
    </Card>
    {error&&<div className="error-box">{error}</div>}
    {busy&&!rows.length?<Loading text="جاري تحميل تاريخ السجل..."/>:<Card>{filtered.length?<Table preferenceKey={'record-timeline-'+ids.join('-').slice(0,90)} defaultPageSize={25} rows={filtered} columns={columns}/>:<div className="empty">لا توجد حركات مسجلة لهذا السجل حتى الآن.</div>}</Card>}
    {selected&&<Card><div className="card-title"><div><h3>{auditActionLabel(selected.action)}</h3><small>{fmt(selected.created_at)} · {selected.actor_name||selected.actor_id||'النظام'}</small></div><Button type="button" onClick={()=>setSelected(null)}>إغلاق التفاصيل</Button></div>
     <div className="detail-grid" style={{marginTop:10}}>
      <div><span>الكيان</span><strong>{auditEntityLabel(selected.entity_type)}</strong></div>
      <div><span>المعرّف</span><strong dir="ltr">{selected.entity_id||'—'}</strong></div>
      <div><span>المستخدم</span><strong>{selected.actor_name||selected.actor_id||'النظام'}</strong></div>
      <div><span>الدور</span><strong>{selected.actor_role||'—'}</strong></div>
      {selected.metadata?.reason&&<div><span>السبب</span><strong>{selected.metadata.reason}</strong></div>}
      {selected.metadata?.source&&<div><span>المصدر</span><strong>{selected.metadata.source}</strong></div>}
     </div>
     {selectedChanges.length>0&&<div style={{marginTop:14}}><div className="card-title"><h3>قبل / بعد</h3><Badge>{selectedChanges.length}</Badge></div><Table rows={selectedChanges} columns={[{key:'label',label:'البيان'},{key:'before',label:'قبل'},{key:'after',label:'بعد'}]}/></div>}
     {selectedChanges.length===0&&<div className="success-note" style={{marginTop:12}}>هذه الحركة مسجلة بدون Snapshot تفصيلي قبل/بعد.</div>}
    </Card>}
   </div>
  </Modal>
 </>;
}
