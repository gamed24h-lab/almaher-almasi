import React,{useMemo,useState} from 'react';
import {CalendarClock,CheckCircle2,History,Plus,ShieldAlert,SkipForward,Wrench} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function money(v){return (Number(v)||0).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س'}
function dueView(plan){
 if(plan.active===false)return {tone:'gray',label:'موقوفة'};
 const due=new Date(plan.next_due_at).getTime(),diff=due-Date.now();if(!Number.isFinite(due))return {tone:'gray',label:'موعد غير محدد'};
 if(diff<0){const days=Math.max(1,Math.ceil(Math.abs(diff)/86400000));return {tone:days>7?'red':'orange',label:'متأخرة '+days+' يوم'}}
 const days=Math.ceil(diff/86400000),lead=Math.max(0,Number(plan.lead_days)||0);if(days<=lead)return {tone:'orange',label:'بعد '+days+' يوم'};return {tone:'green',label:'بعد '+days+' يوم'};
}
function rootCauseLabel(v){return ({power:'كهرباء / طاقة',network:'شبكة / إنترنت',device_hardware:'هاردوير الجهاز',device_software:'سوفتوير الجهاز',configuration:'إعدادات',data_sync:'مزامنة البيانات',user_mapping:'ربط الموظفين',external:'سبب خارجي',unknown:'غير محدد',other:'أخرى'})[v]||v||'غير محدد'}
const blankPlan={id:'',device_id:'',title:'',active:true,frequency_days:30,lead_days:7,next_due_at:'',assigned_staff_id:'',vendor_name:'',checklist_text:'فحص الاتصال بالشبكة\nفحص الكهرباء ومصدر الطاقة\nاختبار إرسال حركة بصمة\nمراجعة الوقت والتاريخ بالجهاز',recurrence_window_days:90,recurrence_threshold:3,notes:''};
const blankRun={performed_by_staff_id:'',findings:'',action_taken:'',total_cost:'',checklist_results:{}};

export default function AttendancePreventiveMaintenance({state,onChanged,onError,onNotice,onOpenIncidents}){
 const plans=state.preventiveMaintenancePlans||[],runs=state.preventiveMaintenanceRuns||[],alerts=state.preventiveMaintenanceAlerts||[],analytics=state.preventiveMaintenanceAnalytics||{},devices=state.devices||[],users=state.users||[],branches=state.branches||[];
 const [filters,setFilters]=useState({q:'',branch:'',device:'',status:''}),[busy,setBusy]=useState('');
 const [planOpen,setPlanOpen]=useState(false),[planForm,setPlanForm]=useState(blankPlan),[planBusy,setPlanBusy]=useState(false);
 const [runOpen,setRunOpen]=useState(false),[runPlan,setRunPlan]=useState(null),[runForm,setRunForm]=useState(blankRun),[runBusy,setRunBusy]=useState(false);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]),userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const staffOptions=useMemo(()=>users.filter(x=>x.status!=='موقوف').map(x=>({value:String(x.id),label:(x.name||x.username||x.id)+(x.role?' — '+x.role:'')})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[users]);
 const branchOptions=useMemo(()=>branches.map(x=>({value:String(x.id),label:x.name||x.id})),[branches]),deviceOptions=useMemo(()=>devices.map(x=>({value:String(x.id),label:x.name||x.serial_number||x.id})),[devices]);
 const canManage=!!(state.permissions?.manage_devices||state.permissions?.manage_policies);
 const filtered=useMemo(()=>plans.filter(p=>{
  const d=deviceMap.get(String(p.device_id)),status=dueView(p);
  if(filters.branch&&String(p.branch_id)!==String(filters.branch))return false;
  if(filters.device&&String(p.device_id)!==String(filters.device))return false;
  if(filters.status==='active'&&p.active===false)return false;
  if(filters.status==='disabled'&&p.active!==false)return false;
  if(filters.status==='overdue'&&!status.label.startsWith('متأخرة'))return false;
  if(filters.status==='soon'&&(status.tone!=='orange'||status.label.startsWith('متأخرة')))return false;
  return matchesListQuery(filters.q,p.title,p.vendor_name,p.assigned_staff_name,d?.name,d?.serial_number,branchMap.get(String(p.branch_id)),...(Array.isArray(p.checklist)?p.checklist:[]));
 }),[plans,filters,deviceMap,branchMap]);
 const runByPlan=useMemo(()=>{const m=new Map();for(const r of runs){const k=String(r.plan_id),a=m.get(k)||[];a.push(r);m.set(k,a)}return m},[runs]);
 const recurrenceAlerts=alerts.filter(x=>x.metadata?.type==='root_cause_recurrence');

 function resetFilters(){setFilters({q:'',branch:'',device:'',status:''})}
 function editPlan(p){
  setPlanForm({id:p.id||'',device_id:p.device_id||'',title:p.title||'',active:p.active!==false,frequency_days:p.frequency_days??30,lead_days:p.lead_days??7,next_due_at:p.next_due_at?String(p.next_due_at).slice(0,10):'',assigned_staff_id:p.assigned_staff_id||'',vendor_name:p.vendor_name||'',checklist_text:Array.isArray(p.checklist)?p.checklist.join('\n'):'',recurrence_window_days:p.recurrence_window_days??90,recurrence_threshold:p.recurrence_threshold??3,notes:p.notes||''});setPlanOpen(true);
 }
 function addPlan(){setPlanForm({...blankPlan,device_id:devices[0]?.id||''});setPlanOpen(true)}
 async function savePlan(e){
  e.preventDefault();setPlanBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_preventive_maintenance_plan',id:planForm.id||undefined,device_id:planForm.device_id,title:planForm.title,active:planForm.active,frequency_days:planForm.frequency_days,lead_days:planForm.lead_days,next_due_at:planForm.next_due_at,assigned_staff_id:planForm.assigned_staff_id||null,vendor_name:planForm.vendor_name,checklist:planForm.checklist_text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),recurrence_window_days:planForm.recurrence_window_days,recurrence_threshold:planForm.recurrence_threshold,notes:planForm.notes});
   setPlanOpen(false);onNotice?.('تم حفظ خطة الصيانة الوقائية.');await onChanged?.();
  }catch(e2){onError?.(e2.message)}finally{setPlanBusy(false)}
 }
 function openRun(p){
  const checks={};for(const item of Array.isArray(p.checklist)?p.checklist:[])checks[item]=false;
  setRunPlan(p);setRunForm({...blankRun,performed_by_staff_id:p.assigned_staff_id||'',checklist_results:checks});setRunOpen(true);
 }
 async function completeRun(e){
  e.preventDefault();if(!runPlan)return;setRunBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'complete_preventive_maintenance',plan_id:runPlan.id,...runForm,total_cost:runForm.total_cost||0});setRunOpen(false);onNotice?.('تم تسجيل الصيانة الوقائية وتحديد الموعد القادم تلقائيًا.');await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setRunBusy(false)}
 }
 async function skipRun(p){
  const reason=String(window.prompt('سبب تخطي دورة الصيانة؟')||'').trim();if(!reason)return;setBusy('skip-'+p.id);onError?.('');
  try{await api.attendanceWrite({action:'skip_preventive_maintenance',plan_id:p.id,reason});onNotice?.('تم تسجيل تخطي الدورة وتحديد موعد جديد.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setBusy('')}
 }

 const cols=[
  {key:'plan',label:'الخطة',render:p=>{const d=deviceMap.get(String(p.device_id));return <div><strong>{p.title}</strong><div className="muted-small">{d?.name||'—'} · {d?.serial_number||'—'}</div><div className="muted-small">{branchMap.get(String(p.branch_id))||'—'}</div></div>}},
  {key:'schedule',label:'الدورية',render:p=><div><strong>كل {p.frequency_days} يوم</strong><div className="muted-small">تنبيه قبل {p.lead_days} يوم</div></div>},
  {key:'due',label:'الموعد القادم',render:p=>{const x=dueView(p);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small" style={{marginTop:3}}>{fmt(p.next_due_at)}</div><div className="muted-small">آخر تنفيذ: {fmt(p.last_completed_at)}</div></div>}},
  {key:'owner',label:'المسؤول',render:p=><div><strong>{p.assigned_staff_name||userMap.get(String(p.assigned_staff_id))?.name||'غير محدد'}</strong>{p.vendor_name&&<div className="muted-small">المورد: {p.vendor_name}</div>}</div>},
  {key:'checklist',label:'Checklist',render:p=><div><Badge>{Array.isArray(p.checklist)?p.checklist.length:0} بند</Badge><div className="muted-small">تكرار السبب: {p.recurrence_threshold||3} مرات / {p.recurrence_window_days||90} يوم</div></div>},
  {key:'history',label:'السجل',render:p=><div><strong>{(runByPlan.get(String(p.id))||[]).filter(x=>x.status==='completed').length} تنفيذ</strong><div className="muted-small">{(runByPlan.get(String(p.id))||[]).filter(x=>x.status==='skipped').length} تخطي</div></div>},
  {key:'actions',label:'',render:p=>canManage?<div className="finance-actions"><Button variant="primary" onClick={()=>openRun(p)} disabled={p.active===false}><CheckCircle2 size={14}/> تنفيذ الآن</Button><Button onClick={()=>editPlan(p)}>تعديل</Button><Button onClick={()=>skipRun(p)} disabled={p.active===false||busy==='skip-'+p.id}><SkipForward size={14}/> تخطي</Button></div>:'—'}
 ];
 const runCols=[
  {key:'date',label:'التاريخ',render:r=><div><strong>{fmt(r.completed_at||r.created_at)}</strong><div className="muted-small">مستحق: {fmt(r.due_at)}</div></div>},
  {key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||'—'},
  {key:'status',label:'الحالة',render:r=><Badge tone={r.status==='completed'?'green':r.status==='skipped'?'gray':'orange'}>{r.status==='completed'?'تم التنفيذ':r.status==='skipped'?'تم التخطي':r.status}</Badge>},
  {key:'performed',label:'بواسطة',render:r=>r.performed_by_name||'—'},
  {key:'result',label:'النتيجة',render:r=><div>{r.findings||r.skip_reason||'—'}{r.action_taken&&<div className="muted-small">الإجراء: {r.action_taken}</div>}</div>},
  {key:'cost',label:'التكلفة',render:r=>money(r.total_cost)}
 ];
 const alertCols=[
  {key:'device',label:'الجهاز',render:a=>deviceMap.get(String(a.device_id))?.name||'—'},
  {key:'type',label:'التنبيه',render:a=><div><strong>{a.title}</strong><div className="muted-small">{a.message}</div></div>},
  {key:'severity',label:'الأولوية',render:a=><Badge tone={a.severity==='critical'?'red':a.severity==='warning'?'orange':'blue'}>{a.severity==='critical'?'حرج':a.severity==='warning'?'تحذير':'معلومة'}</Badge>},
  {key:'detail',label:'التفاصيل',render:a=>a.metadata?.type==='root_cause_recurrence'?<div><strong>{rootCauseLabel(a.metadata?.root_cause_category)}</strong><div className="muted-small">{a.metadata?.count} مرات · الحد {a.metadata?.threshold}</div></div>:<div>الموعد: {fmt(a.metadata?.next_due_at)}</div>},
  {key:'action',label:'',render:a=>a.metadata?.type==='root_cause_recurrence'?<Button onClick={()=>onOpenIncidents?.()}>فتح الحوادث</Button>:'—'}
 ];

 return <>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>خطط نشطة</span><strong>{analytics.active_plans||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>مستحقة قريبًا</span><strong>{analytics.due_soon||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>متأخرة</span><strong>{analytics.overdue||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تكلفة 30 يوم</span><strong style={{fontSize:18}}>{money(analytics.total_cost_30d)}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><CalendarClock size={19}/> Preventive Maintenance Center</h3><small>خطط دورية للأجهزة مع Checklist وتنبيه قبل الاستحقاق واكتشاف تكرار نفس السبب الجذري.</small></div><div className="finance-actions">{canManage&&<Button variant="primary" onClick={addPlan}><Plus size={15}/> خطة صيانة جديدة</Button>}<Badge tone={Number(analytics.overdue||0)>0?'red':Number(analytics.due_soon||0)>0?'orange':'green'}>{Number(analytics.overdue||0)>0?'توجد صيانة متأخرة':Number(analytics.due_soon||0)>0?'صيانة قريبة':'المواعيد منتظمة'}</Badge></div></div>
   <SmartListFilters storageKey="attendance-preventive-maintenance-filters" search={filters.q} onSearchChange={v=>setFilters(x=>({...x,q:v}))} searchPlaceholder="ابحث بالخطة أو الجهاز أو المسؤول..." totalCount={plans.length} resultCount={filtered.length} onReset={resetFilters} filters={[
    {key:'branch',label:'الفرع',value:filters.branch,onChange:v=>setFilters(x=>({...x,branch:v})),options:branchOptions},
    {key:'device',label:'الجهاز',value:filters.device,onChange:v=>setFilters(x=>({...x,device:v})),options:deviceOptions},
    {key:'status',label:'الحالة',value:filters.status,onChange:v=>setFilters(x=>({...x,status:v})),options:[{value:'active',label:'نشطة'},{value:'overdue',label:'متأخرة'},{value:'soon',label:'مستحقة قريبًا'},{value:'disabled',label:'موقوفة'}]}
   ]}/>
   {filtered.length?<Table preferenceKey="attendance-preventive-maintenance-plans" defaultPageSize={25} rows={filtered} columns={cols}/>:<div className="success-note"><Wrench size={16}/> لا توجد خطط صيانة مطابقة للفلاتر الحالية.</div>}
  </Card>
  {alerts.length>0&&<Card><div className="card-title"><div><h3><ShieldAlert size={18}/> تنبيهات الصيانة الوقائية والتكرار</h3><small>تشمل المواعيد المستحقة واكتشاف تكرار نفس السبب الجذري رغم الإجراء الوقائي.</small></div><Badge tone={recurrenceAlerts.length?'orange':'blue'}>{alerts.length}</Badge></div><Table preferenceKey="attendance-preventive-alerts" defaultPageSize={25} rows={alerts} columns={alertCols}/></Card>}
  <Card><div className="card-title"><div><h3><History size={18}/> سجل تنفيذ الصيانة الوقائية</h3><small>آخر عمليات التنفيذ والتخطي والتكلفة.</small></div><div className="finance-actions"><Badge tone="green">{analytics.completed_30d||0} تنفيذ / 30 يوم</Badge>{Number(analytics.skipped_30d||0)>0&&<Badge tone="orange">{analytics.skipped_30d} تخطي</Badge>}</div></div>{runs.length?<Table preferenceKey="attendance-preventive-maintenance-runs" defaultPageSize={25} rows={runs} columns={runCols}/>:<div className="success-note">لا توجد دورات صيانة منفذة حتى الآن.</div>}</Card>

  <Modal open={planOpen} onClose={()=>setPlanOpen(false)} title={planForm.id?'تعديل خطة الصيانة الوقائية':'خطة صيانة وقائية جديدة'} wide>
   <form onSubmit={savePlan} className="form-grid">
    <Field label="الجهاز"><Select value={planForm.device_id} onChange={e=>setPlanForm(x=>({...x,device_id:e.target.value}))} required><option value="">اختر الجهاز</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name} — {d.serial_number}</option>)}</Select></Field>
    <Field label="اسم الخطة"><Input value={planForm.title} onChange={e=>setPlanForm(x=>({...x,title:e.target.value}))} placeholder="مثال: صيانة شهرية لجهاز مكة"/></Field>
    <Field label="التكرار — يوم"><Input type="number" min="1" max="365" value={planForm.frequency_days} onChange={e=>setPlanForm(x=>({...x,frequency_days:e.target.value}))}/></Field>
    <Field label="التنبيه قبل — يوم"><Input type="number" min="0" max="90" value={planForm.lead_days} onChange={e=>setPlanForm(x=>({...x,lead_days:e.target.value}))}/></Field>
    <Field label="الموعد القادم"><Input type="date" value={planForm.next_due_at} onChange={e=>setPlanForm(x=>({...x,next_due_at:e.target.value}))} required/></Field>
    <Field label="المسؤول"><Select value={planForm.assigned_staff_id} onChange={e=>setPlanForm(x=>({...x,assigned_staff_id:e.target.value}))}><option value="">غير محدد</option>{staffOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
    <Field label="مورد / شركة صيانة"><Input value={planForm.vendor_name} onChange={e=>setPlanForm(x=>({...x,vendor_name:e.target.value}))} placeholder="اختياري"/></Field>
    <Field label="الحالة"><Select value={planForm.active?'true':'false'} onChange={e=>setPlanForm(x=>({...x,active:e.target.value==='true'}))}><option value="true">نشطة</option><option value="false">موقوفة</option></Select></Field>
    <Field label="تكرار السبب — عدد المرات"><Input type="number" min="2" max="10" value={planForm.recurrence_threshold} onChange={e=>setPlanForm(x=>({...x,recurrence_threshold:e.target.value}))}/></Field>
    <Field label="نافذة التكرار — يوم"><Input type="number" min="30" max="365" value={planForm.recurrence_window_days} onChange={e=>setPlanForm(x=>({...x,recurrence_window_days:e.target.value}))}/></Field>
    <Field label="Checklist — بند في كل سطر"><Textarea rows="7" value={planForm.checklist_text} onChange={e=>setPlanForm(x=>({...x,checklist_text:e.target.value}))}/></Field>
    <Field label="ملاحظات"><Textarea rows="3" value={planForm.notes} onChange={e=>setPlanForm(x=>({...x,notes:e.target.value}))}/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setPlanOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={planBusy}>{planBusy?'جاري الحفظ...':'حفظ الخطة'}</Button></div>
   </form>
  </Modal>

  <Modal open={runOpen} onClose={()=>setRunOpen(false)} title={runPlan?'تنفيذ الصيانة — '+runPlan.title:'تنفيذ الصيانة'} wide>
   {runPlan&&<form onSubmit={completeRun} style={{display:'grid',gap:14}}>
    <Card><div className="card-title"><div><h3>Checklist</h3><small>يجب إكمال كل البنود قبل اعتماد الدورة.</small></div><Badge>{Array.isArray(runPlan.checklist)?runPlan.checklist.length:0}</Badge></div><div style={{display:'grid',gap:9}}>{(Array.isArray(runPlan.checklist)?runPlan.checklist:[]).map(item=><label key={item} className="finance-actions" style={{justifyContent:'flex-start'}}><input type="checkbox" checked={runForm.checklist_results?.[item]===true} onChange={e=>setRunForm(x=>({...x,checklist_results:{...x.checklist_results,[item]:e.target.checked}}))}/><span>{item}</span></label>)}</div></Card>
    <div className="form-grid">
     <Field label="نفذها"><Select value={runForm.performed_by_staff_id} onChange={e=>setRunForm(x=>({...x,performed_by_staff_id:e.target.value}))}><option value="">المستخدم الحالي</option>{staffOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
     <Field label="التكلفة"><Input type="number" min="0" step="0.01" value={runForm.total_cost} onChange={e=>setRunForm(x=>({...x,total_cost:e.target.value}))}/></Field>
     <Field label="الملاحظات / النتائج"><Textarea rows="3" value={runForm.findings} onChange={e=>setRunForm(x=>({...x,findings:e.target.value}))} placeholder="ما الذي ظهر أثناء الفحص؟"/></Field>
     <Field label="الإجراء المتخذ"><Textarea rows="3" value={runForm.action_taken} onChange={e=>setRunForm(x=>({...x,action_taken:e.target.value}))} placeholder="أي تنظيف، تعديل، اختبار أو استبدال تم أثناء الصيانة"/></Field>
    </div>
    <div className="modal-actions"><Button type="button" onClick={()=>setRunOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={runBusy}>{runBusy?'جاري التسجيل...':'اعتماد تنفيذ الصيانة'}</Button></div>
   </form>}
  </Modal>
 </>;
}
