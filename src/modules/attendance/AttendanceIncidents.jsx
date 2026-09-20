import React,{useMemo,useState} from 'react';
import {AlarmClock,CheckCircle2,CircleDollarSign,Clock3,History,Plus,Settings2,ShieldAlert,ShieldCheck,Siren,Trash2,UserCheck,Wrench} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function durationText(sec){const n=Math.max(0,Number(sec)||0);if(n<60)return Math.round(n)+' ث';if(n<3600)return Math.round(n/60)+' د';if(n<86400)return (n/3600).toFixed(n<7200?1:0)+' س';return (n/86400).toFixed(1)+' يوم'}
function money(v){return (Number(v)||0).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س'}
function severityView(v){if(v==='critical')return {tone:'red',label:'حرج'};if(v==='warning')return {tone:'orange',label:'تحذير'};return {tone:'blue',label:'معلومة'}}
function statusView(v){if(v==='open')return {tone:'red',label:'مفتوحة'};if(v==='acknowledged')return {tone:'blue',label:'تم الاستلام'};if(v==='investigating')return {tone:'orange',label:'قيد المعالجة'};if(v==='resolved')return {tone:'green',label:'تم الحل'};return {tone:'gray',label:'مغلقة'}}
function categoryLabel(v){return v==='predictive'?'استباقي':v==='linking'?'ربط الحركات':v==='device_health'?'صحة جهاز':v==='maintenance'?'صيانة وقائية':v==='*'?'كل الأنواع':'أخرى'}
function rootCauseLabel(v){return ({power:'كهرباء / طاقة',network:'شبكة / إنترنت',device_hardware:'هاردوير الجهاز',device_software:'سوفتوير الجهاز',configuration:'إعدادات',data_sync:'مزامنة البيانات',user_mapping:'ربط الموظفين',external:'سبب خارجي',unknown:'غير محدد',other:'أخرى'})[v]||'غير محدد'}
function maintenanceTypeLabel(v){return ({remote:'عن بُعد',onsite:'ميدانية',replacement:'استبدال',network:'شبكة',power:'كهرباء',configuration:'إعدادات',software:'برمجية',other:'أخرى'})[v]||'أخرى'}
function actionTypeLabel(v){return ({inspection:'فحص',repair:'إصلاح',configuration:'إعداد',replacement:'استبدال',network:'شبكة',power:'كهرباء',software:'برمجيات',test:'اختبار',work:'عمل'})[v]||'عمل'}
function dueView(incident){
 if(['resolved','closed'].includes(incident.status))return {tone:incident.resolution_breached?'red':'green',label:incident.resolution_breached?'تم الحل بعد SLA':'تم الحل داخل SLA'};
 const due=incident.resolution_due_at?new Date(incident.resolution_due_at).getTime():null;if(!due)return {tone:'gray',label:'بدون SLA'};
 const diff=due-Date.now();if(diff<0)return {tone:'red',label:'متجاوز '+durationText(Math.abs(diff)/1000)};
 if(diff<60*60*1000)return {tone:'orange',label:'متبقي '+durationText(diff/1000)};
 return {tone:'blue',label:'متبقي '+durationText(diff/1000)};
}
const blankPolicy={id:'',branch_id:'',category:'*',severity:'warning',active:true,response_minutes:60,resolution_minutes:480};
const blankMaintenance={root_cause_category:'unknown',root_cause_text:'',maintenance_type:'remote',action_taken:'',preventive_action:'',recurrence_risk:'medium',recurrence_prevented:false,technician_staff_id:'',vendor_name:''};
const blankAction={action_type:'inspection',description:'',part_name:'',quantity:'',unit_cost:'',labor_cost:'',other_cost:'',outcome:''};

export default function AttendanceIncidents({state,onChanged,onError,onNotice,onOpenDevices,onOpenLinks,onOpenPreventive}){
 const incidents=state.incidents||[],counts=state.incidentCounts||{},analytics=state.incidentAnalytics||{},policies=state.incidentPolicies||[],events=state.incidentEvents||[],maintenanceRows=state.incidentMaintenance||[],maintenanceActions=state.maintenanceActions||[],maintenanceAnalytics=state.maintenanceAnalytics||{},devices=state.devices||[],branches=state.branches||[],users=state.users||[];
 const [filters,setFilters]=useState({q:'',status:'active',severity:'',branch:'',device:'',owner:'',breach:''}),[busy,setBusy]=useState('');
 const [assignOpen,setAssignOpen]=useState(false),[assignIncident,setAssignIncident]=useState(null),[ownerId,setOwnerId]=useState('');
 const [detailOpen,setDetailOpen]=useState(false),[detailIncident,setDetailIncident]=useState(null);
 const [slaOpen,setSlaOpen]=useState(false),[policyForm,setPolicyForm]=useState(blankPolicy),[policyBusy,setPolicyBusy]=useState(false);
 const [maintenanceOpen,setMaintenanceOpen]=useState(false),[maintenanceIncident,setMaintenanceIncident]=useState(null),[maintenanceForm,setMaintenanceForm]=useState(blankMaintenance),[maintenanceBusy,setMaintenanceBusy]=useState(false);
 const [actionForm,setActionForm]=useState(blankAction),[actionBusy,setActionBusy]=useState(false),[verifyNote,setVerifyNote]=useState('');
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]),userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const maintenanceMap=useMemo(()=>new Map(maintenanceRows.map(x=>[String(x.incident_id),x])),[maintenanceRows]);
 const actionMap=useMemo(()=>{const m=new Map();for(const x of maintenanceActions){const k=String(x.incident_id),a=m.get(k)||[];a.push(x);m.set(k,a)}return m},[maintenanceActions]);
 const staffOptions=useMemo(()=>users.filter(x=>x.status!=='موقوف').map(x=>({value:String(x.id),label:(x.name||x.username||x.id)+(x.role?' — '+x.role:'')})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[users]);
 const branchOptions=useMemo(()=>branches.map(x=>({value:String(x.id),label:x.name||x.id})),[branches]),deviceOptions=useMemo(()=>devices.map(x=>({value:String(x.id),label:x.name||x.serial_number||x.id})),[devices]);
 const ownerOptions=useMemo(()=>staffOptions,[staffOptions]);
 const filtered=useMemo(()=>incidents.filter(r=>{
  const f=filters,active=!['resolved','closed'].includes(r.status);
  if(f.status==='active'&&!active)return false;if(f.status&&f.status!=='active'&&r.status!==f.status)return false;
  if(f.severity&&r.severity!==f.severity)return false;if(f.branch&&String(r.branch_id)!==String(f.branch))return false;if(f.device&&String(r.device_id)!==String(f.device))return false;
  if(f.owner==='unassigned'&&r.owner_staff_id)return false;if(f.owner&&f.owner!=='unassigned'&&String(r.owner_staff_id)!==String(f.owner))return false;
  if(f.breach==='yes'&&!(r.response_breached||r.resolution_breached))return false;if(f.breach==='no'&&(r.response_breached||r.resolution_breached))return false;
  const m=maintenanceMap.get(String(r.id));
  return matchesListQuery(f.q,r.incident_number,r.title,r.summary,r.owner_name,categoryLabel(r.category),deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id)),rootCauseLabel(m?.root_cause_category),m?.root_cause_text,m?.vendor_name,m?.technician_name);
 }),[incidents,filters,deviceMap,branchMap,maintenanceMap]);
 const eventMap=useMemo(()=>{const m=new Map();for(const e of events){const k=String(e.incident_id),a=m.get(k)||[];a.push(e);m.set(k,a)}return m},[events]);
 const openTotal=Number(counts.open||0)+Number(counts.acknowledged||0)+Number(counts.investigating||0);

 function setFilter(key,value){setFilters(x=>({...x,[key]:value}))}
 function resetFilters(){setFilters({q:'',status:'active',severity:'',branch:'',device:'',owner:'',breach:''})}
 async function action(row,incident_action,extra={}){
  setBusy(row.id+incident_action);onError?.('');
  try{await api.attendanceWrite({action:'update_incident',id:row.id,incident_action,...extra});onNotice?.(incident_action==='acknowledge'?'تم استلام الحادثة.':incident_action==='close'?'تم إغلاق الحادثة.':incident_action==='resolve'?'تم حل الحادثة.':'تم تحديث الحادثة.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 function openAssign(row){setAssignIncident(row);setOwnerId(row.owner_staff_id||'');setAssignOpen(true)}
 async function saveAssign(e){e.preventDefault();if(!assignIncident)return;await action(assignIncident,'assign',{owner_staff_id:ownerId});setAssignOpen(false)}
 function openDetail(row){setDetailIncident(row);setDetailOpen(true)}
 function editPolicy(p){setPolicyForm({id:p.id||'',branch_id:p.branch_id||'',category:p.category||'*',severity:p.severity||'*',active:p.active!==false,response_minutes:p.response_minutes??60,resolution_minutes:p.resolution_minutes??480})}
 async function savePolicy(e){
  e.preventDefault();setPolicyBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'save_incident_sla_policy',...policyForm});onNotice?.('تم حفظ سياسة SLA.');setPolicyForm(blankPolicy);await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setPolicyBusy(false)}
 }
 function openSource(row){if(row.category==='linking')onOpenLinks?.();else if(row.category==='maintenance')onOpenPreventive?.();else onOpenDevices?.()}
 function openMaintenance(row){
  const m=maintenanceMap.get(String(row.id));
  setMaintenanceIncident(row);setMaintenanceForm(m?{root_cause_category:m.root_cause_category||'unknown',root_cause_text:m.root_cause_text||'',maintenance_type:m.maintenance_type||'remote',action_taken:m.action_taken||'',preventive_action:m.preventive_action||'',recurrence_risk:m.recurrence_risk||'medium',recurrence_prevented:m.recurrence_prevented===true,technician_staff_id:m.technician_staff_id||'',vendor_name:m.vendor_name||''}:{...blankMaintenance});
  setActionForm({...blankAction});setVerifyNote(m?.verification_note||'');setMaintenanceOpen(true);
 }
 async function saveMaintenance(e){
  e.preventDefault();if(!maintenanceIncident)return;setMaintenanceBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'save_incident_maintenance',incident_id:maintenanceIncident.id,...maintenanceForm});onNotice?.('تم حفظ السبب الجذري وبيانات الصيانة.');await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setMaintenanceBusy(false)}
 }
 async function addMaintenanceAction(e){
  e.preventDefault();if(!maintenanceIncident)return;setActionBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'add_incident_maintenance_action',incident_id:maintenanceIncident.id,...actionForm});setActionForm({...blankAction});onNotice?.('تمت إضافة إجراء الصيانة وتحديث التكلفة.');await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setActionBusy(false)}
 }
 async function deleteMaintenanceAction(row){
  if(!confirm('حذف إجراء الصيانة هذا؟ سيتم إعادة احتساب التكلفة تلقائيًا.'))return;setBusy('ma-'+row.id);onError?.('');
  try{await api.attendanceWrite({action:'delete_incident_maintenance_action',id:row.id});onNotice?.('تم حذف إجراء الصيانة وإعادة احتساب التكلفة.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function verifyMaintenance(){
  if(!maintenanceIncident)return;setMaintenanceBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'verify_incident_maintenance',incident_id:maintenanceIncident.id,verification_note:verifyNote,recurrence_prevented:maintenanceForm.recurrence_prevented===true});onNotice?.('تم اعتماد الصيانة وتحليل السبب الجذري.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setMaintenanceBusy(false)}
 }

 const cols=[
  {key:'id',label:'Incident',render:r=><div><strong>#INC-{String(r.incident_number||'').padStart(5,'0')}</strong><div className="muted-small">{fmt(r.started_at)}</div></div>},
  {key:'incident',label:'الحادثة',render:r=>{const s=severityView(r.severity);return <div><div className="finance-actions"><Badge tone={s.tone}>{s.label}</Badge><strong>{r.title}</strong></div><div className="muted-small" style={{marginTop:4,maxWidth:460}}>{r.summary||'—'}</div><div className="muted-small">{categoryLabel(r.category)} · {deviceMap.get(String(r.device_id))?.name||'—'} · {branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'status',label:'الحالة',render:r=>{const s=statusView(r.status);return <div><Badge tone={s.tone}>{s.label}</Badge>{r.source_active&&<div className="muted-small">المشكلة الأصلية نشطة</div>}</div>}},
  {key:'owner',label:'المسؤول',render:r=><div><strong>{r.owner_name||<span className="muted-small">غير مسندة</span>}</strong>{r.owner_staff_id&&<div className="muted-small">{userMap.get(String(r.owner_staff_id))?.role||'—'}</div>}</div>},
  {key:'maintenance',label:'السبب / الصيانة',render:r=>{const m=maintenanceMap.get(String(r.id));return m?<div><Badge tone={m.verified_at?'green':'orange'}>{m.verified_at?'معتمدة':'قيد التوثيق'}</Badge><div className="muted-small" style={{marginTop:3}}>{rootCauseLabel(m.root_cause_category)} · {maintenanceTypeLabel(m.maintenance_type)}</div><div className="muted-small">{money(m.total_cost)}</div></div>:<Badge tone="gray">غير موثقة</Badge>}},
  {key:'sla',label:'SLA الحل',render:r=>{const x=dueView(r);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">استجابة: {fmt(r.response_due_at)}</div><div className="muted-small">حل: {fmt(r.resolution_due_at)}</div></div>}},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>openDetail(r)}><History size={14}/> التفاصيل</Button><Button onClick={()=>openMaintenance(r)}><Wrench size={14}/> الصيانة والسبب</Button><Button onClick={()=>openSource(r)}>فتح المصدر</Button>{!r.acknowledged_at&&!['resolved','closed'].includes(r.status)&&<Button onClick={()=>action(r,'acknowledge')} disabled={busy===r.id+'acknowledge'}><UserCheck size={14}/> استلام</Button>}{!['resolved','closed'].includes(r.status)&&<Button onClick={()=>openAssign(r)}>إسناد</Button>}{!r.source_active&&!['resolved','closed'].includes(r.status)&&<Button variant="primary" onClick={()=>action(r,'resolve',{note:'تمت المعالجة'})} disabled={busy===r.id+'resolve'}><CheckCircle2 size={14}/> حل</Button>}{r.status==='resolved'&&<Button onClick={()=>action(r,'close')} disabled={busy===r.id+'close'}>إغلاق</Button>}</div>}
 ];
 const policyCols=[
  {key:'match',label:'التطبيق',render:p=><div><strong>{categoryLabel(p.category)} · {p.severity==='*'?'كل الأولويات':severityView(p.severity).label}</strong><div className="muted-small">{p.branch_id?branchMap.get(String(p.branch_id))||'فرع محدد':'كل الفروع'}</div></div>},
  {key:'response',label:'زمن الاستجابة',render:p=>durationText(Number(p.response_minutes||0)*60)},
  {key:'resolution',label:'زمن الحل',render:p=>durationText(Number(p.resolution_minutes||0)*60)},
  {key:'state',label:'الحالة',render:p=><Badge tone={p.active===false?'gray':'green'}>{p.active===false?'موقوفة':'نشطة'}</Badge>},
  {key:'action',label:'',render:p=><Button onClick={()=>editPolicy(p)}>تعديل</Button>}
 ];
 const detailEvents=detailIncident?eventMap.get(String(detailIncident.id))||[]:[];
 const eventCols=[
  {key:'time',label:'الوقت',render:e=>fmt(e.created_at)},
  {key:'type',label:'الحدث',render:e=><Badge tone="blue">{e.event_type}</Badge>},
  {key:'actor',label:'بواسطة',render:e=>e.actor_name||e.actor_id||'النظام'},
  {key:'note',label:'التفاصيل',render:e=>e.note||'—'}
 ];
 const currentMaintenance=maintenanceIncident?maintenanceMap.get(String(maintenanceIncident.id))||null:null,currentActions=maintenanceIncident?actionMap.get(String(maintenanceIncident.id))||[]:[];
 const maintenanceActionCols=[
  {key:'type',label:'النوع',render:x=><Badge>{actionTypeLabel(x.action_type)}</Badge>},
  {key:'desc',label:'الإجراء',render:x=><div><strong>{x.description}</strong>{x.outcome&&<div className="muted-small">النتيجة: {x.outcome}</div>}</div>},
  {key:'part',label:'قطعة / تكلفة',render:x=><div>{x.part_name||'—'}{x.part_name&&<div className="muted-small">{x.quantity||0} × {money(x.unit_cost)}</div>}<div className="muted-small">عمالة {money(x.labor_cost)} · أخرى {money(x.other_cost)}</div></div>},
  {key:'who',label:'التنفيذ',render:x=><div>{x.performed_by||'—'}<div className="muted-small">{fmt(x.performed_at)}</div></div>},
  {key:'delete',label:'',render:x=><Button onClick={()=>deleteMaintenanceAction(x)} disabled={busy==='ma-'+x.id}><Trash2 size={14}/> حذف</Button>}
 ];

 return <>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>حوادث مفتوحة</span><strong>{openTotal}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>متجاوزة SLA</span><strong>{counts.breached||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>حرجة نشطة</span><strong>{counts.critical||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>غير مسندة</span><strong>{counts.unassigned||0}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><Siren size={19}/> Incident & SLA Center</h3><small>كل تنبيه نشط يتحول إلى حادثة تشغيلية لها مسؤول، SLA، سبب جذري، صيانة، تكلفة، وإجراء وقائي.</small></div><div className="finance-actions">{state.permissions?.manage_policies&&<Button onClick={()=>setSlaOpen(true)}><Settings2 size={15}/> سياسات SLA</Button>}<Badge tone={Number(counts.breached||0)>0?'red':openTotal>0?'orange':'green'}>{Number(counts.breached||0)>0?'يوجد تجاوز SLA':openTotal>0?'توجد حوادث مفتوحة':'لا توجد حوادث مفتوحة'}</Badge></div></div>
   <SmartListFilters storageKey="attendance-incidents-filters" search={filters.q} onSearchChange={v=>setFilter('q',v)} searchPlaceholder="ابحث برقم Incident أو الجهاز أو المسؤول أو السبب..." totalCount={incidents.length} resultCount={filtered.length} onReset={resetFilters} filters={[
    {key:'status',label:'الحالة',value:filters.status,onChange:v=>setFilter('status',v),options:[{value:'active',label:'المفتوحة'},{value:'open',label:'مفتوحة جديدة'},{value:'acknowledged',label:'تم الاستلام'},{value:'investigating',label:'قيد المعالجة'},{value:'resolved',label:'تم الحل'},{value:'closed',label:'مغلقة'}]},
    {key:'severity',label:'الأولوية',value:filters.severity,onChange:v=>setFilter('severity',v),options:[{value:'critical',label:'حرج'},{value:'warning',label:'تحذير'},{value:'info',label:'معلومة'}]},
    {key:'branch',label:'الفرع',value:filters.branch,onChange:v=>setFilter('branch',v),options:branchOptions},
    {key:'device',label:'الجهاز',value:filters.device,onChange:v=>setFilter('device',v),options:deviceOptions},
    {key:'owner',label:'المسؤول',value:filters.owner,onChange:v=>setFilter('owner',v),options:[{value:'unassigned',label:'غير مسندة'},...ownerOptions]},
    {key:'breach',label:'SLA',value:filters.breach,onChange:v=>setFilter('breach',v),options:[{value:'yes',label:'متجاوز'},{value:'no',label:'داخل المدة'}]}
   ]}/>
   {filtered.length?<Table preferenceKey="attendance-incidents" defaultPageSize={25} rows={filtered} columns={cols}/>:<div className="success-note"><ShieldAlert size={16}/> لا توجد حوادث مطابقة للفلاتر الحالية.</div>}
  </Card>
  <div className="stats-grid">
   <Card><div className="card-title"><h3><Clock3 size={18}/> متوسط الاستجابة</h3></div><div className="stat-card"><div><span>من الحوادث التي تم استلامها</span><strong>{analytics.avg_response_seconds==null?'—':durationText(analytics.avg_response_seconds)}</strong></div></div></Card>
   <Card><div className="card-title"><h3><AlarmClock size={18}/> متوسط الحل</h3></div><div className="stat-card"><div><span>من الحوادث التي تم حلها</span><strong>{analytics.avg_resolution_seconds==null?'—':durationText(analytics.avg_resolution_seconds)}</strong></div></div></Card>
   <Card><div className="card-title"><h3>أكثر الأجهزة حوادث — 30 يوم</h3></div><div style={{display:'grid',gap:7}}>{(analytics.top_devices||[]).length?(analytics.top_devices||[]).map(x=><div key={x.device_id} className="finance-actions" style={{justifyContent:'space-between'}}><span>{deviceMap.get(String(x.device_id))?.name||x.device_id}</span><Badge>{x.count}</Badge></div>):<span className="muted-small">لا توجد بيانات كافية.</span>}</div></Card>
   <Card><div className="card-title"><h3>أكثر الفروع حوادث — 30 يوم</h3></div><div style={{display:'grid',gap:7}}>{(analytics.top_branches||[]).length?(analytics.top_branches||[]).map(x=><div key={x.branch_id} className="finance-actions" style={{justifyContent:'space-between'}}><span>{branchMap.get(String(x.branch_id))||x.branch_id}</span><Badge>{x.count}</Badge></div>):<span className="muted-small">لا توجد بيانات كافية.</span>}</div></Card>
  </div>
  <div className="stats-grid">
   <Card><div className="card-title"><h3><CircleDollarSign size={18}/> تكلفة الأعطال — 30 يوم</h3></div><div className="stat-card"><div><span>{maintenanceAnalytics.maintenance_count_30d||0} سجل صيانة</span><strong>{money(maintenanceAnalytics.total_cost_30d)}</strong></div></div></Card>
   <Card><div className="card-title"><h3><ShieldCheck size={18}/> صيانة معتمدة</h3></div><div className="stat-card"><div><span>تمت مراجعتها</span><strong>{maintenanceAnalytics.verified_count||0}</strong></div></div></Card>
   <Card><div className="card-title"><h3>أكثر الأسباب الجذرية</h3></div><div style={{display:'grid',gap:7}}>{(maintenanceAnalytics.top_causes||[]).length?(maintenanceAnalytics.top_causes||[]).map(x=><div key={x.root_cause_category} className="finance-actions" style={{justifyContent:'space-between'}}><span>{rootCauseLabel(x.root_cause_category)}</span><Badge>{x.count}</Badge></div>):<span className="muted-small">تظهر بعد توثيق الحوادث.</span>}</div></Card>
   <Card><div className="card-title"><h3>أعلى أجهزة تكلفة — 30 يوم</h3></div><div style={{display:'grid',gap:7}}>{(maintenanceAnalytics.top_cost_devices||[]).length?(maintenanceAnalytics.top_cost_devices||[]).map(x=><div key={x.device_id} className="finance-actions" style={{justifyContent:'space-between'}}><span>{deviceMap.get(String(x.device_id))?.name||x.device_id}</span><Badge>{money(x.total_cost)}</Badge></div>):<span className="muted-small">لا توجد تكاليف مسجلة.</span>}</div></Card>
  </div>

  <Modal open={assignOpen} onClose={()=>setAssignOpen(false)} title="إسناد الحادثة لمسؤول">
   <form onSubmit={saveAssign} className="form-grid">
    <Field label="المسؤول"><Select value={ownerId} onChange={e=>setOwnerId(e.target.value)} required><option value="">اختر المسؤول</option>{staffOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setAssignOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={!ownerId}>حفظ الإسناد</Button></div>
   </form>
  </Modal>

  <Modal open={detailOpen} onClose={()=>setDetailOpen(false)} title={detailIncident?'تفاصيل #INC-'+String(detailIncident.incident_number||'').padStart(5,'0'):'تفاصيل الحادثة'} wide>
   {detailIncident&&<div style={{display:'grid',gap:14}}>
    <div className="stats-grid"><Card><div className="stat-card"><div><span>الحالة</span><strong style={{fontSize:16}}>{statusView(detailIncident.status).label}</strong></div></div></Card><Card><div className="stat-card"><div><span>المسؤول</span><strong style={{fontSize:16}}>{detailIncident.owner_name||'غير مسندة'}</strong></div></div></Card><Card><div className="stat-card"><div><span>زمن الاستجابة</span><strong style={{fontSize:16}}>{detailIncident.response_seconds==null?'—':durationText(detailIncident.response_seconds)}</strong></div></div></Card><Card><div className="stat-card"><div><span>زمن الحل</span><strong style={{fontSize:16}}>{detailIncident.resolution_seconds==null?'—':durationText(detailIncident.resolution_seconds)}</strong></div></div></Card></div>
    <Card><div className="card-title"><div><h3>{detailIncident.title}</h3><small>{detailIncident.summary||'—'}</small></div><Badge tone={detailIncident.source_active?'orange':'green'}>{detailIncident.source_active?'المشكلة الأصلية ما زالت قائمة':'المشكلة الأصلية زالت'}</Badge></div></Card>
    {maintenanceMap.get(String(detailIncident.id))&&<Card><div className="card-title"><div><h3><Wrench size={18}/> Root Cause & Maintenance</h3><small>{maintenanceMap.get(String(detailIncident.id))?.root_cause_text||rootCauseLabel(maintenanceMap.get(String(detailIncident.id))?.root_cause_category)}</small></div><Button onClick={()=>{setDetailOpen(false);openMaintenance(detailIncident)}}>فتح سجل الصيانة</Button></div></Card>}
    <Card><div className="card-title"><h3><History size={18}/> Timeline</h3><Badge>{detailEvents.length}</Badge></div>{detailEvents.length?<Table preferenceKey={'attendance-incident-events-'+detailIncident.id} defaultPageSize={25} rows={detailEvents} columns={eventCols}/>:<div className="muted-small">لا توجد أحداث إضافية.</div>}</Card>
   </div>}
  </Modal>

  <Modal open={maintenanceOpen} onClose={()=>setMaintenanceOpen(false)} title={maintenanceIncident?'الصيانة والسبب الجذري — #INC-'+String(maintenanceIncident.incident_number||'').padStart(5,'0'):'الصيانة والسبب الجذري'} wide>
   {maintenanceIncident&&<div style={{display:'grid',gap:14}}>
    <div className="stats-grid">
     <Card><div className="stat-card"><div><span>تكلفة القطع</span><strong style={{fontSize:17}}>{money(currentMaintenance?.parts_cost)}</strong></div></div></Card>
     <Card><div className="stat-card"><div><span>تكلفة العمالة</span><strong style={{fontSize:17}}>{money(currentMaintenance?.labor_cost)}</strong></div></div></Card>
     <Card><div className="stat-card"><div><span>تكاليف أخرى</span><strong style={{fontSize:17}}>{money(currentMaintenance?.other_cost)}</strong></div></div></Card>
     <Card><div className="stat-card"><div><span>إجمالي الصيانة</span><strong style={{fontSize:17}}>{money(currentMaintenance?.total_cost)}</strong></div></div></Card>
    </div>
    <Card><div className="card-title"><div><h3><Wrench size={18}/> تحليل السبب الجذري RCA</h3><small>وثّق لماذا حدث العطل، ما الذي تم فعله، وكيف نمنع تكراره.</small></div>{currentMaintenance?.verified_at?<Badge tone="green">معتمد · {fmt(currentMaintenance.verified_at)}</Badge>:<Badge tone="orange">غير معتمد</Badge>}</div>
     <form onSubmit={saveMaintenance} className="form-grid">
      <Field label="تصنيف السبب الجذري"><Select value={maintenanceForm.root_cause_category} onChange={e=>setMaintenanceForm(x=>({...x,root_cause_category:e.target.value}))}><option value="unknown">غير محدد</option><option value="power">كهرباء / طاقة</option><option value="network">شبكة / إنترنت</option><option value="device_hardware">هاردوير الجهاز</option><option value="device_software">سوفتوير الجهاز</option><option value="configuration">إعدادات</option><option value="data_sync">مزامنة البيانات</option><option value="user_mapping">ربط الموظفين</option><option value="external">سبب خارجي</option><option value="other">أخرى</option></Select></Field>
      <Field label="نوع الصيانة"><Select value={maintenanceForm.maintenance_type} onChange={e=>setMaintenanceForm(x=>({...x,maintenance_type:e.target.value}))}><option value="remote">عن بُعد</option><option value="onsite">ميدانية</option><option value="replacement">استبدال</option><option value="network">شبكة</option><option value="power">كهرباء</option><option value="configuration">إعدادات</option><option value="software">برمجية</option><option value="other">أخرى</option></Select></Field>
      <Field label="الفني / المسؤول"><Select value={maintenanceForm.technician_staff_id} onChange={e=>setMaintenanceForm(x=>({...x,technician_staff_id:e.target.value}))}><option value="">غير محدد</option>{staffOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
      <Field label="المورد الخارجي"><Input value={maintenanceForm.vendor_name} onChange={e=>setMaintenanceForm(x=>({...x,vendor_name:e.target.value}))} placeholder="اختياري"/></Field>
      <Field label="خطورة تكرار المشكلة"><Select value={maintenanceForm.recurrence_risk} onChange={e=>setMaintenanceForm(x=>({...x,recurrence_risk:e.target.value}))}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">مرتفعة</option></Select></Field>
      <Field label="منع التكرار"><Select value={maintenanceForm.recurrence_prevented?'true':'false'} onChange={e=>setMaintenanceForm(x=>({...x,recurrence_prevented:e.target.value==='true'}))}><option value="false">لم يتم التأكد بعد</option><option value="true">تم اتخاذ إجراء يمنع التكرار</option></Select></Field>
      <Field label="السبب الجذري"><Textarea rows="3" value={maintenanceForm.root_cause_text} onChange={e=>setMaintenanceForm(x=>({...x,root_cause_text:e.target.value}))} placeholder="ما السبب الحقيقي الذي أدى للمشكلة؟"/></Field>
      <Field label="الإجراء المتخذ"><Textarea rows="3" value={maintenanceForm.action_taken} onChange={e=>setMaintenanceForm(x=>({...x,action_taken:e.target.value}))} placeholder="ماذا تم لإصلاح المشكلة؟"/></Field>
      <Field label="الإجراء الوقائي"><Textarea rows="3" value={maintenanceForm.preventive_action} onChange={e=>setMaintenanceForm(x=>({...x,preventive_action:e.target.value}))} placeholder="كيف نمنع تكرارها؟"/></Field>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={maintenanceBusy}>{maintenanceBusy?'جاري الحفظ...':'حفظ تحليل السبب والصيانة'}</Button></div>
     </form>
    </Card>
    <Card><div className="card-title"><div><h3>إجراءات الصيانة والتكاليف</h3><small>كل إجراء أو قطعة أو تكلفة تسجل كسطر مستقل ويُعاد احتساب الإجمالي تلقائيًا.</small></div><Badge>{currentActions.length}</Badge></div>
     {currentActions.length?<Table preferenceKey={'attendance-maintenance-actions-'+maintenanceIncident.id} defaultPageSize={25} rows={currentActions} columns={maintenanceActionCols}/>:<div className="muted-small" style={{marginBottom:14}}>لا توجد إجراءات صيانة مسجلة بعد.</div>}
     <form onSubmit={addMaintenanceAction} className="form-grid" style={{marginTop:14}}>
      <Field label="نوع الإجراء"><Select value={actionForm.action_type} onChange={e=>setActionForm(x=>({...x,action_type:e.target.value}))}><option value="inspection">فحص</option><option value="repair">إصلاح</option><option value="configuration">إعداد</option><option value="replacement">استبدال</option><option value="network">شبكة</option><option value="power">كهرباء</option><option value="software">برمجيات</option><option value="test">اختبار</option><option value="work">عمل</option></Select></Field>
      <Field label="وصف الإجراء"><Input required value={actionForm.description} onChange={e=>setActionForm(x=>({...x,description:e.target.value}))} placeholder="مثال: استبدال محول الكهرباء"/></Field>
      <Field label="القطعة"><Input value={actionForm.part_name} onChange={e=>setActionForm(x=>({...x,part_name:e.target.value}))} placeholder="اختياري"/></Field>
      <Field label="الكمية"><Input type="number" min="0" step="0.01" value={actionForm.quantity} onChange={e=>setActionForm(x=>({...x,quantity:e.target.value}))}/></Field>
      <Field label="سعر الوحدة"><Input type="number" min="0" step="0.01" value={actionForm.unit_cost} onChange={e=>setActionForm(x=>({...x,unit_cost:e.target.value}))}/></Field>
      <Field label="تكلفة العمالة"><Input type="number" min="0" step="0.01" value={actionForm.labor_cost} onChange={e=>setActionForm(x=>({...x,labor_cost:e.target.value}))}/></Field>
      <Field label="تكاليف أخرى"><Input type="number" min="0" step="0.01" value={actionForm.other_cost} onChange={e=>setActionForm(x=>({...x,other_cost:e.target.value}))}/></Field>
      <Field label="النتيجة"><Input value={actionForm.outcome} onChange={e=>setActionForm(x=>({...x,outcome:e.target.value}))} placeholder="مثال: الجهاز عاد للعمل طبيعيًا"/></Field>
      <div className="modal-actions"><Button variant="primary" type="submit" disabled={actionBusy}><Plus size={14}/>{actionBusy?' جاري الإضافة...':' إضافة إجراء'}</Button></div>
     </form>
    </Card>
    <Card><div className="card-title"><div><h3><ShieldCheck size={18}/> اعتماد الصيانة</h3><small>الاعتماد يتطلب كتابة السبب الجذري والإجراء المتخذ أولًا.</small></div></div>
     <div className="form-grid"><Field label="ملاحظة الاعتماد"><Input value={verifyNote} onChange={e=>setVerifyNote(e.target.value)} placeholder="نتيجة المراجعة أو الاختبار النهائي"/></Field><div className="modal-actions"><Button variant="primary" type="button" onClick={verifyMaintenance} disabled={maintenanceBusy||!currentMaintenance}>{currentMaintenance?.verified_at?'إعادة اعتماد الصيانة':'اعتماد الصيانة'}</Button></div></div>
    </Card>
   </div>}
  </Modal>

  <Modal open={slaOpen} onClose={()=>setSlaOpen(false)} title="سياسات SLA للحوادث" wide>
   <div style={{display:'grid',gap:14}}>
    <Card><div className="card-title"><div><h3>السياسات الحالية</h3><small>القاعدة الأكثر تحديدًا للفرع ونوع التنبيه والأولوية تُطبق أولًا.</small></div><Button onClick={()=>setPolicyForm(blankPolicy)}>سياسة جديدة</Button></div><Table preferenceKey="attendance-incident-sla-policies" defaultPageSize={25} rows={policies} columns={policyCols}/></Card>
    <Card><div className="card-title"><h3>{policyForm.id?'تعديل سياسة SLA':'سياسة SLA جديدة'}</h3></div><form onSubmit={savePolicy} className="form-grid">
     <Field label="الفرع"><Select value={policyForm.branch_id||''} onChange={e=>setPolicyForm(x=>({...x,branch_id:e.target.value}))} disabled={!state.scope?.all_branches}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
     <Field label="نوع التنبيه"><Select value={policyForm.category} onChange={e=>setPolicyForm(x=>({...x,category:e.target.value}))}><option value="*">كل الأنواع</option><option value="device_health">صحة الجهاز</option><option value="predictive">استباقي</option><option value="linking">ربط الحركات</option><option value="maintenance">صيانة وقائية</option></Select></Field>
     <Field label="الأولوية"><Select value={policyForm.severity} onChange={e=>setPolicyForm(x=>({...x,severity:e.target.value}))}><option value="*">كل الأولويات</option><option value="critical">حرج</option><option value="warning">تحذير</option><option value="info">معلومة</option></Select></Field>
     <Field label="الحالة"><Select value={policyForm.active?'true':'false'} onChange={e=>setPolicyForm(x=>({...x,active:e.target.value==='true'}))}><option value="true">نشطة</option><option value="false">موقوفة</option></Select></Field>
     <Field label="SLA الاستجابة — دقيقة"><Input type="number" min="1" max="10080" value={policyForm.response_minutes} onChange={e=>setPolicyForm(x=>({...x,response_minutes:e.target.value}))}/></Field>
     <Field label="SLA الحل — دقيقة"><Input type="number" min="1" max="10080" value={policyForm.resolution_minutes} onChange={e=>setPolicyForm(x=>({...x,resolution_minutes:e.target.value}))}/></Field>
     <div className="modal-actions"><Button type="button" onClick={()=>setPolicyForm(blankPolicy)}>تفريغ</Button><Button variant="primary" type="submit" disabled={policyBusy}>{policyBusy?'جاري الحفظ...':'حفظ السياسة'}</Button></div>
    </form></Card>
   </div>
  </Modal>
 </>;
}
