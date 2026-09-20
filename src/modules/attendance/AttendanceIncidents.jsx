import React,{useMemo,useState} from 'react';
import {AlarmClock,CheckCircle2,Clock3,History,Settings2,ShieldAlert,Siren,UserCheck} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function durationText(sec){const n=Math.max(0,Number(sec)||0);if(n<60)return Math.round(n)+' ث';if(n<3600)return Math.round(n/60)+' د';if(n<86400)return (n/3600).toFixed(n<7200?1:0)+' س';return (n/86400).toFixed(1)+' يوم'}
function severityView(v){if(v==='critical')return {tone:'red',label:'حرج'};if(v==='warning')return {tone:'orange',label:'تحذير'};return {tone:'blue',label:'معلومة'}}
function statusView(v){if(v==='open')return {tone:'red',label:'مفتوحة'};if(v==='acknowledged')return {tone:'blue',label:'تم الاستلام'};if(v==='investigating')return {tone:'orange',label:'قيد المعالجة'};if(v==='resolved')return {tone:'green',label:'تم الحل'};return {tone:'gray',label:'مغلقة'}}
function categoryLabel(v){return v==='predictive'?'استباقي':v==='linking'?'ربط الحركات':v==='device_health'?'صحة جهاز':'أخرى'}
function dueView(incident){
 if(['resolved','closed'].includes(incident.status))return {tone:incident.resolution_breached?'red':'green',label:incident.resolution_breached?'تم الحل بعد SLA':'تم الحل داخل SLA'};
 const due=incident.resolution_due_at?new Date(incident.resolution_due_at).getTime():null;if(!due)return {tone:'gray',label:'بدون SLA'};
 const diff=due-Date.now();if(diff<0)return {tone:'red',label:'متجاوز '+durationText(Math.abs(diff)/1000)};
 if(diff<60*60*1000)return {tone:'orange',label:'متبقي '+durationText(diff/1000)};
 return {tone:'blue',label:'متبقي '+durationText(diff/1000)};
}
const blankPolicy={id:'',branch_id:'',category:'*',severity:'warning',active:true,response_minutes:60,resolution_minutes:480};

export default function AttendanceIncidents({state,onChanged,onError,onNotice,onOpenDevices,onOpenLinks}){
 const incidents=state.incidents||[],counts=state.incidentCounts||{},analytics=state.incidentAnalytics||{},policies=state.incidentPolicies||[],events=state.incidentEvents||[],devices=state.devices||[],branches=state.branches||[],users=state.users||[];
 const [filters,setFilters]=useState({q:'',status:'active',severity:'',branch:'',device:'',owner:'',breach:''}),[busy,setBusy]=useState('');
 const [assignOpen,setAssignOpen]=useState(false),[assignIncident,setAssignIncident]=useState(null),[ownerId,setOwnerId]=useState('');
 const [detailOpen,setDetailOpen]=useState(false),[detailIncident,setDetailIncident]=useState(null);
 const [slaOpen,setSlaOpen]=useState(false),[policyForm,setPolicyForm]=useState(blankPolicy),[policyBusy,setPolicyBusy]=useState(false);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]),userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const staffOptions=useMemo(()=>users.filter(x=>x.status!=='موقوف').map(x=>({value:String(x.id),label:(x.name||x.username||x.id)+(x.role?' — '+x.role:'')})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[users]);
 const branchOptions=useMemo(()=>branches.map(x=>({value:String(x.id),label:x.name||x.id})),[branches]),deviceOptions=useMemo(()=>devices.map(x=>({value:String(x.id),label:x.name||x.serial_number||x.id})),[devices]);
 const ownerOptions=useMemo(()=>staffOptions,[staffOptions]);
 const filtered=useMemo(()=>incidents.filter(r=>{
  const f=filters,active=!['resolved','closed'].includes(r.status);
  if(f.status==='active'&&!active)return false;if(f.status&&f.status!=='active'&&r.status!==f.status)return false;
  if(f.severity&&r.severity!==f.severity)return false;if(f.branch&&String(r.branch_id)!==String(f.branch))return false;if(f.device&&String(r.device_id)!==String(f.device))return false;
  if(f.owner==='unassigned'&&r.owner_staff_id)return false;if(f.owner&&f.owner!=='unassigned'&&String(r.owner_staff_id)!==String(f.owner))return false;
  if(f.breach==='yes'&&!(r.response_breached||r.resolution_breached))return false;if(f.breach==='no'&&(r.response_breached||r.resolution_breached))return false;
  return matchesListQuery(f.q,r.incident_number,r.title,r.summary,r.owner_name,categoryLabel(r.category),deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id)));
 }),[incidents,filters,deviceMap,branchMap]);
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
 function openSource(row){if(row.category==='linking')onOpenLinks?.();else onOpenDevices?.()}

 const cols=[
  {key:'id',label:'Incident',render:r=><div><strong>#INC-{String(r.incident_number||'').padStart(5,'0')}</strong><div className="muted-small">{fmt(r.started_at)}</div></div>},
  {key:'incident',label:'الحادثة',render:r=>{const s=severityView(r.severity);return <div><div className="finance-actions"><Badge tone={s.tone}>{s.label}</Badge><strong>{r.title}</strong></div><div className="muted-small" style={{marginTop:4,maxWidth:460}}>{r.summary||'—'}</div><div className="muted-small">{categoryLabel(r.category)} · {deviceMap.get(String(r.device_id))?.name||'—'} · {branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'status',label:'الحالة',render:r=>{const s=statusView(r.status);return <div><Badge tone={s.tone}>{s.label}</Badge>{r.source_active&&<div className="muted-small">المشكلة الأصلية نشطة</div>}</div>}},
  {key:'owner',label:'المسؤول',render:r=><div><strong>{r.owner_name||<span className="muted-small">غير مسندة</span>}</strong>{r.owner_staff_id&&<div className="muted-small">{userMap.get(String(r.owner_staff_id))?.role||'—'}</div>}</div>},
  {key:'sla',label:'SLA الحل',render:r=>{const x=dueView(r);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">استجابة: {fmt(r.response_due_at)}</div><div className="muted-small">حل: {fmt(r.resolution_due_at)}</div></div>}},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>openDetail(r)}><History size={14}/> التفاصيل</Button><Button onClick={()=>openSource(r)}>فتح المصدر</Button>{!r.acknowledged_at&&!['resolved','closed'].includes(r.status)&&<Button onClick={()=>action(r,'acknowledge')} disabled={busy===r.id+'acknowledge'}><UserCheck size={14}/> استلام</Button>}{!['resolved','closed'].includes(r.status)&&<Button onClick={()=>openAssign(r)}>إسناد</Button>}{!r.source_active&&!['resolved','closed'].includes(r.status)&&<Button variant="primary" onClick={()=>action(r,'resolve',{note:'تمت المعالجة'})} disabled={busy===r.id+'resolve'}><CheckCircle2 size={14}/> حل</Button>}{r.status==='resolved'&&<Button onClick={()=>action(r,'close')} disabled={busy===r.id+'close'}>إغلاق</Button>}</div>}
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

 return <>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>حوادث مفتوحة</span><strong>{openTotal}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>متجاوزة SLA</span><strong>{counts.breached||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>حرجة نشطة</span><strong>{counts.critical||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>غير مسندة</span><strong>{counts.unassigned||0}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><Siren size={19}/> Incident & SLA Center</h3><small>كل تنبيه نشط يتحول إلى حادثة تشغيلية لها مسؤول، زمن استجابة، زمن حل، وسجل كامل حتى الإغلاق.</small></div><div className="finance-actions">{state.permissions?.manage_policies&&<Button onClick={()=>setSlaOpen(true)}><Settings2 size={15}/> سياسات SLA</Button>}<Badge tone={Number(counts.breached||0)>0?'red':openTotal>0?'orange':'green'}>{Number(counts.breached||0)>0?'يوجد تجاوز SLA':openTotal>0?'توجد حوادث مفتوحة':'لا توجد حوادث مفتوحة'}</Badge></div></div>
   <SmartListFilters storageKey="attendance-incidents-filters" search={filters.q} onSearchChange={v=>setFilter('q',v)} searchPlaceholder="ابحث برقم Incident أو الجهاز أو المسؤول..." totalCount={incidents.length} resultCount={filtered.length} onReset={resetFilters} filters={[
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
    <Card><div className="card-title"><h3><History size={18}/> Timeline</h3><Badge>{detailEvents.length}</Badge></div>{detailEvents.length?<Table preferenceKey={'attendance-incident-events-'+detailIncident.id} defaultPageSize={25} rows={detailEvents} columns={eventCols}/>:<div className="muted-small">لا توجد أحداث إضافية.</div>}</Card>
   </div>}
  </Modal>

  <Modal open={slaOpen} onClose={()=>setSlaOpen(false)} title="سياسات SLA للحوادث" wide>
   <div style={{display:'grid',gap:14}}>
    <Card><div className="card-title"><div><h3>السياسات الحالية</h3><small>القاعدة الأكثر تحديدًا للفرع ونوع التنبيه والأولوية تُطبق أولًا.</small></div><Button onClick={()=>setPolicyForm(blankPolicy)}>سياسة جديدة</Button></div><Table preferenceKey="attendance-incident-sla-policies" defaultPageSize={25} rows={policies} columns={policyCols}/></Card>
    <Card><div className="card-title"><h3>{policyForm.id?'تعديل سياسة SLA':'سياسة SLA جديدة'}</h3></div><form onSubmit={savePolicy} className="form-grid">
     <Field label="الفرع"><Select value={policyForm.branch_id||''} onChange={e=>setPolicyForm(x=>({...x,branch_id:e.target.value}))} disabled={!state.scope?.all_branches}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
     <Field label="نوع التنبيه"><Select value={policyForm.category} onChange={e=>setPolicyForm(x=>({...x,category:e.target.value}))}><option value="*">كل الأنواع</option><option value="device_health">صحة الجهاز</option><option value="predictive">استباقي</option><option value="linking">ربط الحركات</option></Select></Field>
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
