import React,{useMemo,useState} from 'react';
import {BellRing,CheckCheck,Eye,Link2,ServerCog,ShieldCheck} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Select,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function severityView(v){
 if(v==='critical')return {tone:'red',label:'حرج'};
 if(v==='warning')return {tone:'orange',label:'تحذير'};
 return {tone:'blue',label:'معلومة'};
}
function statusView(v,active){
 if(v==='resolved')return {tone:'green',label:active?'تمت المعالجة — الحالة ما زالت قائمة':'تم الحل'};
 if(v==='seen')return {tone:'blue',label:'تمت المشاهدة'};
 return {tone:'orange',label:'جديد'};
}
function categoryLabel(v){return v==='predictive'?'استباقي':v==='linking'?'ربط الحركات':'صحة الجهاز'}

export default function AttendanceNotifications({state,onChanged,onError,onNotice,onOpenDevices,onOpenLinks}){
 const notifications=state.notifications||[],devices=state.devices||[],branches=state.branches||[],counts=state.notificationCounts||{};
 const [status,setStatus]=useState('open'),[severity,setSeverity]=useState('all'),[deviceId,setDeviceId]=useState('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState('');
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const rows=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return notifications.filter(n=>{
   if(status==='open'&&!n.active)return false;
   if(status==='new'&&n.status!=='new')return false;
   if(status==='seen'&&n.status!=='seen')return false;
   if(status==='resolved'&&n.status!=='resolved')return false;
   if(severity!=='all'&&n.severity!==severity)return false;
   if(deviceId!=='all'&&String(n.device_id)!==String(deviceId))return false;
   if(q){
    const d=deviceMap.get(String(n.device_id));
    const hay=[n.title,n.message,n.category,d?.name,d?.serial_number,branchMap.get(String(n.branch_id))].filter(Boolean).join(' ').toLowerCase();
    if(!hay.includes(q))return false;
   }
   return true;
  });
 },[notifications,status,severity,deviceId,query,deviceMap,branchMap]);

 async function update(row,notification_action){
  setBusy(row.id+notification_action);onError?.('');
  try{
   await api.attendanceWrite({action:'update_notification',id:row.id,notification_action});
   onNotice?.(notification_action==='seen'?'تم تحديد التنبيه كمشاهَد.':'تم تسجيل التنبيه كمعالَج.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function markAllSeen(){
  setBusy('all');onError?.('');
  try{
   const out=await api.attendanceWrite({action:'mark_notifications_seen'});
   onNotice?.('تم تحديد '+String(out?.count||0)+' تنبيه جديد كمشاهَد.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 function openTarget(row){
  if(row.category==='linking'){onOpenLinks?.();return}
  onOpenDevices?.();
 }

 const cols=[
  {key:'severity',label:'الأولوية',render:r=>{const x=severityView(r.severity);return <Badge tone={x.tone}>{x.label}</Badge>}},
  {key:'alert',label:'التنبيه',render:r=><div><strong>{r.title}</strong><div className="muted-small" style={{marginTop:3,maxWidth:500}}>{r.message||'—'}</div><div className="muted-small" style={{marginTop:3}}>{categoryLabel(r.category)}</div></div>},
  {key:'device',label:'الجهاز / الفرع',render:r=>{const d=deviceMap.get(String(r.device_id));return <div><strong>{d?.name||'—'}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))||'—'}</div>{d?.serial_number&&<div className="muted-small" dir="ltr">{d.serial_number}</div>}</div>}},
  {key:'status',label:'الحالة',render:r=>{const x=statusView(r.status,r.active);return <div><Badge tone={x.tone}>{x.label}</Badge>{!r.active&&<div className="muted-small">الحالة الأصلية زالت</div>}</div>}},
  {key:'time',label:'آخر ظهور',render:r=><div><strong>{fmt(r.last_seen_at)}</strong><div className="muted-small">أول ظهور: {fmt(r.first_seen_at)}</div></div>},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>openTarget(r)}>{r.category==='linking'?<Link2 size={14}/>:<ServerCog size={14}/>} فتح</Button>{r.status==='new'&&<Button onClick={()=>update(r,'seen')} disabled={busy===r.id+'seen'}><Eye size={14}/> تمت المشاهدة</Button>}{r.status!=='resolved'&&(state.permissions?.manage_devices||state.permissions?.manage_links)&&<Button variant="primary" onClick={()=>update(r,'resolved')} disabled={busy===r.id+'resolved'}><CheckCheck size={14}/> تمت المعالجة</Button>}</div>}
 ];

 return <>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>جديد</span><strong>{counts.new||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تنبيهات نشطة</span><strong>{counts.active||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>حرجة</span><strong>{counts.critical||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تم حلها</span><strong>{counts.resolved||0}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><BellRing size={19}/> مركز تنبيهات الحضور والأجهزة</h3><small>التنبيهات تُجمع من صحة الأجهزة، المراقبة الاستباقية، والأرقام التي تحتاج ربط موظف.</small></div><div className="finance-actions">{Number(counts.new||0)>0&&<Button onClick={markAllSeen} disabled={busy==='all'}><Eye size={15}/>{busy==='all'?' جاري التحديث...':' مشاهدة الكل'}</Button>}<Badge tone={Number(counts.critical||0)>0?'red':Number(counts.active||0)>0?'orange':'green'}>{Number(counts.active||0)>0?'توجد تنبيهات نشطة':'لا توجد تنبيهات نشطة'}</Badge></div></div>
   <div className="form-grid" style={{marginBottom:14}}>
    <Field label="بحث"><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="اسم الجهاز، الفرع، الرسالة..."/></Field>
    <Field label="الحالة"><Select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">النشطة</option><option value="all">الكل</option><option value="new">جديد</option><option value="seen">تمت المشاهدة</option><option value="resolved">تم الحل / المعالجة</option></Select></Field>
    <Field label="الأولوية"><Select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">كل الأولويات</option><option value="critical">حرج</option><option value="warning">تحذير</option><option value="info">معلومة</option></Select></Field>
    <Field label="الجهاز"><Select value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="all">كل الأجهزة</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
   </div>
   {rows.length?<Table preferenceKey="attendance-notification-center" defaultPageSize={25} rows={rows} columns={cols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد تنبيهات مطابقة للفلاتر الحالية.</div>}
  </Card>
 </>;
}
