import React,{useEffect,useMemo,useState} from 'react';
import {Activity,AlertTriangle,CheckCircle2,GitMerge,History,RefreshCw,Search,ShieldCheck,UsersRound,Wrench} from 'lucide-react';
import {useAuth} from '../../core/AuthContext.jsx';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {has} from '../../lib/permissions.js';
import {auditActionLabel,auditEntityLabel,normalizeAuditChanges} from '../../lib/audit-format.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import AgentMergeModal from './AgentMergeModal.jsx';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const digits=v=>text(v).replace(/\D/g,'');
const compact=v=>lower(v).replace(/\s+/g,'');
const dateTime=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const activePassenger=p=>!['cancelled','canceled','deleted','refunded','removed','merged'].includes(lower(p?.status));
const elevated=u=>!!u&&(u.role==='developer'||u.role==='مدير عام'||u.permissions?.all===true);
const readOnlyAudit=a=>/(^|_)(get|list|summary|analytics|preview|status|snapshot)$/i.test(String(a||''))||['company_settings_get','security_permission_approvals_list','refund_list'].includes(String(a||''));

function strongPassengerMatch(a,b){
 const ai=compact(a?.identity_number),bi=compact(b?.identity_number);
 if(ai&&bi&&ai===bi)return {ok:true,type:'identity',label:'نفس الهوية / الإقامة'};
 const ap=digits(a?.phone),bp=digits(b?.phone),an=compact(a?.full_name),bn=compact(b?.full_name);
 if(ap&&bp&&ap===bp&&an&&bn&&an===bn)return {ok:true,type:'phone_name',label:'نفس الاسم والجوال'};
 return {ok:false};
}
function buildDuplicateGroups(passengers,bookingMap){
 const byBooking=new Map();
 for(const p of passengers.filter(activePassenger)){const k=String(p.booking_id||'');if(!k)continue;const a=byBooking.get(k)||[];a.push(p);byBooking.set(k,a)}
 const groups=[];
 for(const [bookingId,list] of byBooking){
  const used=new Set();
  for(let i=0;i<list.length;i++){
   if(used.has(list[i].id))continue;
   const group=[list[i]];
   for(let j=i+1;j<list.length;j++)if(!used.has(list[j].id)&&strongPassengerMatch(list[i],list[j]).ok)group.push(list[j]);
   if(group.length>1){
    group.forEach(x=>used.add(x.id));
    group.sort((a,b)=>Number(a.passenger_order||999)-Number(b.passenger_order||999)||String(a.created_at||'').localeCompare(String(b.created_at||'')));
    const match=strongPassengerMatch(group[0],group[1]);
    const booking=bookingMap.get(String(bookingId));
    groups.push({id:'dup-'+bookingId+'-'+group[0].id,booking_id:bookingId,booking_number:booking?.booking_number||bookingId,branch_id:booking?.branch_id||null,match:match.label,records:group,canonical:group[0]});
   }
  }
 }
 return groups;
}
function buildRepeatGroups(passengers,bookingMap){
 const m=new Map();
 for(const p of passengers.filter(activePassenger)){const id=compact(p.identity_number);if(!id)continue;const a=m.get(id)||[];a.push(p);m.set(id,a)}
 const out=[];
 for(const [identity,records] of m){
  const bookings=[...new Set(records.map(p=>String(p.booking_id||'')).filter(Boolean))];
  if(bookings.length<2)continue;
  const names=[...new Set(records.map(p=>text(p.full_name)).filter(Boolean))];
  out.push({id:'repeat-'+identity,identity,names,records,booking_numbers:bookings.map(id=>bookingMap.get(id)?.booking_number||id)});
 }
 return out.sort((a,b)=>b.booking_numbers.length-a.booking_numbers.length);
}
function auditCategory(r){
 const s=lower((r.action||'')+' '+(r.entity_type||''));
 if(/permission|security|login|auth|staff|approval/.test(s))return 'security';
 if(/finance|payment|refund|expense|cash|shift|budget/.test(s))return 'finance';
 if(/attendance|employee|schedule|policy|violation/.test(s))return 'hr';
 if(/booking|passenger|trip|seat|room|housing|fleet|scan|operation/.test(s))return 'operations';
 return 'system';
}
const categoryLabel={security:'أمان وصلاحيات',finance:'مالية',hr:'HR وحضور',operations:'تشغيل وحجوزات',system:'نظام'};
const categoryTone={security:'red',finance:'orange',hr:'green',operations:'blue',system:'blue'};

export default function AuditCenter({go,initialTab=''}) {
 const {user}=useAuth();
 const {data,refresh}=useAppData();
 const canAudit=elevated(user)||has(user,'auditLog')||has(user,'managePermissions');
 const canReviewDuplicates=elevated(user)||has(user,'editBookings')||has(user,'editPassenger');
 const canMerge=elevated(user)||has(user,'editBookings')||has(user,'editPassenger');
 const canReviewAttendance=elevated(user)||has(user,'attendance_view')||has(user,'attendance_manage_employees');
 const canMergeAttendance=elevated(user)||has(user,'attendance_manage_employees');
 const canReviewRegistry=canAudit;
 const [auditRows,setAuditRows]=useState([]),[auditSummary,setAuditSummary]=useState({}),[auditScope,setAuditScope]=useState(''),[auditBusy,setAuditBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[q,setQ]=useState(''),[category,setCategory]=useState('all'),[auditMode,setAuditMode]=useState('changes');
 const [selectedAudit,setSelectedAudit]=useState(null);
 const [mergeOpen,setMergeOpen]=useState(false),[mergeGroup,setMergeGroup]=useState(null),[canonicalId,setCanonicalId]=useState(''),[duplicateId,setDuplicateId]=useState(''),[preview,setPreview]=useState(null),[previewBusy,setPreviewBusy]=useState(false),[mergeBusy,setMergeBusy]=useState(false),[mergeReason,setMergeReason]=useState(''),[confirmNo,setConfirmNo]=useState('');
 const [employeeGroups,setEmployeeGroups]=useState([]),[employeeBusy,setEmployeeBusy]=useState(false);
 const [registryGroups,setRegistryGroups]=useState([]),[registrySummary,setRegistrySummary]=useState({}),[registryBusy,setRegistryBusy]=useState(false);
 const [employeeMergeOpen,setEmployeeMergeOpen]=useState(false),[employeeGroup,setEmployeeGroup]=useState(null),[employeeCanonicalId,setEmployeeCanonicalId]=useState(''),[employeeDuplicateId,setEmployeeDuplicateId]=useState(''),[employeePreview,setEmployeePreview]=useState(null),[employeePreviewBusy,setEmployeePreviewBusy]=useState(false),[employeeMergeBusy,setEmployeeMergeBusy]=useState(false),[employeeReason,setEmployeeReason]=useState(''),[employeeConfirm,setEmployeeConfirm]=useState('');
 const [agentMergeGroup,setAgentMergeGroup]=useState(null);

 const bookingMap=useMemo(()=>new Map((data.bookings||[]).map(b=>[String(b.id),b])),[data.bookings]);
 const tripMap=useMemo(()=>new Map((data.trips||[]).map(t=>[String(t.id),t])),[data.trips]);
 const branchMap=useMemo(()=>new Map((data.branches||[]).map(b=>[String(b.id),b])),[data.branches]);
 const duplicateGroups=useMemo(()=>buildDuplicateGroups(data.passengers||[],bookingMap),[data.passengers,bookingMap]);
 const repeatGroups=useMemo(()=>buildRepeatGroups(data.passengers||[],bookingMap),[data.passengers,bookingMap]);

 async function loadAudit(){
  if(!canAudit)return;
  setAuditBusy(true);setError('');
  try{
   const r=await fetch('/api/audit?limit=500',{credentials:'include',cache:'no-store'});
   const b=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(b.error||'تعذر قراءة سجل النشاط.');
   setAuditRows(b.rows||[]);setAuditSummary(b.summary||{});setAuditScope(b.scope||'');
  }catch(e){setError(e.message)}finally{setAuditBusy(false)}
 }
 useEffect(()=>{if(canAudit)loadAudit()},[]);
 async function loadEmployeeDuplicates(){
  if(!canReviewAttendance)return;
  setEmployeeBusy(true);setError('');
  try{const x=await api.admin({action:'attendance_employee_duplicates_list'});setEmployeeGroups(x.groups||[])}
  catch(e){setError(e.message)}finally{setEmployeeBusy(false)}
 }
 useEffect(()=>{if(canReviewAttendance)loadEmployeeDuplicates()},[]);
 async function loadRegistryDuplicates(){
  if(!canReviewRegistry)return;
  setRegistryBusy(true);setError('');
  try{const x=await api.admin({action:'duplicate_review_registry'});setRegistryGroups(x.groups||[]);setRegistrySummary(x.summary||{})}
  catch(e){setError(e.message)}finally{setRegistryBusy(false)}
 }
 useEffect(()=>{if(canReviewRegistry)loadRegistryDuplicates()},[]);

 const tabs=useMemo(()=>[
  ...(canAudit?[{id:'activity',label:'سجل النشاط',icon:History,badge:auditRows.length||null}]:[]),
  ...((canReviewDuplicates||canReviewAttendance||canReviewRegistry)?[{id:'duplicates',label:'مراجعة التكرارات',icon:GitMerge,badge:(duplicateGroups.length+employeeGroups.length+registryGroups.length)||null}]:[])
 ],[canAudit,canReviewDuplicates,canReviewAttendance,canReviewRegistry,auditRows.length,duplicateGroups.length,employeeGroups.length,registryGroups.length]);
 const [tab,setTab]=useModuleTab('almaher:module:audit-center',tabs,initialTab||(canAudit?'activity':'duplicates'));
 useEffect(()=>{if(initialTab&&tabs.some(t=>t.id===initialTab))setTab(initialTab)},[initialTab,tabs.length]);

 const filteredAudit=useMemo(()=>{
  const needle=lower(q);
  return auditRows.filter(r=>{
   if(auditMode==='changes'&&readOnlyAudit(r.action))return false;
   if(category!=='all'&&auditCategory(r)!==category)return false;
   if(!needle)return true;
   return [r.actor_name,r.actor_role,r.action,r.entity_type,r.entity_id,branchMap.get(String(r.branch_id))?.name,JSON.stringify(r.metadata||{})].some(v=>lower(v).includes(needle));
  });
 },[auditRows,q,category,auditMode,branchMap]);

 const auditCounts=useMemo(()=>({
  total:filteredAudit.length,
  today:filteredAudit.filter(r=>String(r.created_at||'').slice(0,10)===new Date().toISOString().slice(0,10)).length,
  security:filteredAudit.filter(r=>auditCategory(r)==='security').length,
  finance:filteredAudit.filter(r=>auditCategory(r)==='finance').length
 }),[filteredAudit]);

 function sourcePath(r){
  const et=lower(r.entity_type),id=String(r.entity_id||'');
  if(['bookings','booking'].includes(et)){const b=data.bookings.find(x=>String(x.id)===id);if(b)return '/bookings/'+encodeURIComponent(b.booking_number)}
  if(['booking_passengers','passenger'].includes(et)&&id)return '/passengers/'+encodeURIComponent(id);
  if(['trips','trip'].includes(et)&&id)return '/trips/'+encodeURIComponent(id);
  if(/staff|permission/.test(et))return '/staff';
  if(/attendance|violation|schedule/.test(et))return '/attendance';
  if(/refund/.test(et)){const no=r.metadata?.booking_number;return no?'/refunds?booking='+encodeURIComponent(no):'/refunds'}
  if(r.metadata?.booking_number)return '/bookings/'+encodeURIComponent(r.metadata.booking_number);
  return '';
 }
 const auditCols=[
  {key:'created_at',label:'الوقت',render:r=>dateTime(r.created_at)},
  {key:'actor',label:'المستخدم',render:r=><div><strong>{r.actor_name||r.actor_id||'النظام'}</strong><div className="muted-small">{r.actor_role||'—'}</div></div>},
  {key:'category',label:'التصنيف',render:r=>{const c=auditCategory(r);return <Badge tone={categoryTone[c]}>{categoryLabel[c]}</Badge>}},
  {key:'action',label:'العملية',render:r=><strong>{auditActionLabel(r.action)}</strong>},
  {key:'entity',label:'الكيان',render:r=><div>{auditEntityLabel(r.entity_type)}<div className="muted-small">{r.entity_id||'—'}</div></div>},
  {key:'branch',label:'الفرع',render:r=>r.branch_id?(branchMap.get(String(r.branch_id))?.name||r.branch_id):'عام'},
  {key:'action_btn',label:'',render:r=><div className="finance-actions"><Button onClick={()=>setSelectedAudit(r)}>التفاصيل</Button>{sourcePath(r)&&<Button variant="primary" onClick={()=>go?.(sourcePath(r))}>فتح المصدر</Button>}</div>}
 ];

 function openMerge(g){
  const canonical=g.records[0],duplicate=g.records[1];
  setMergeGroup(g);setCanonicalId(canonical.id);setDuplicateId(duplicate.id);setMergeReason('');setConfirmNo('');setPreview(null);setMergeOpen(true);
  previewPair(canonical.id,duplicate.id);
 }
 async function previewPair(cId,dId){
  if(!cId||!dId||cId===dId){setPreview(null);return}
  setPreviewBusy(true);setError('');
  try{const x=await api.admin({action:'passenger_duplicate_preview',canonical_id:cId,duplicate_id:dId});setPreview(x)}catch(e){setPreview({can_merge:false,reasons:[e.message]})}finally{setPreviewBusy(false)}
 }
 async function mergePair(e){
  e.preventDefault();if(!preview?.can_merge)return;
  setMergeBusy(true);setError('');
  try{
   const x=await api.admin({action:'passenger_duplicate_merge',canonical_id:canonicalId,duplicate_id:duplicateId,reason:mergeReason,confirm_booking_number:confirmNo});
   setNotice(`تم دمج السجل المكرر داخل الحجز ${x?.result?.booking_number||mergeGroup?.booking_number||''} مع الاحتفاظ بالتاريخ وتحويل المراجع.`);
   setMergeOpen(false);await refresh();if(canAudit)await loadAudit();
  }catch(e2){setError(e2.message)}finally{setMergeBusy(false)}
 }
 const dupCols=[
  {key:'booking',label:'الحجز',render:r=><strong>{r.booking_number}</strong>},
  {key:'match',label:'سبب الاشتباه',render:r=><Badge tone="orange">{r.match}</Badge>},
  {key:'records',label:'السجلات',render:r=><div><strong>{r.records.length}</strong><div className="muted-small">{r.records.map(x=>x.full_name||'مسافر').join(' · ')}</div></div>},
  {key:'identity',label:'الهوية / الجوال',render:r=>r.canonical.identity_number||r.canonical.phone||'—'},
  {key:'branch',label:'الفرع',render:r=>r.branch_id?(branchMap.get(String(r.branch_id))?.name||'—'):'—'},
  {key:'action',label:'',render:r=><Button variant="primary" onClick={()=>openMerge(r)}><GitMerge size={14}/> معاينة الدمج</Button>}
 ];
 const repeatCols=[
  {key:'identity',label:'الهوية',render:r=><strong>{r.identity}</strong>},
  {key:'name',label:'الاسم',render:r=>r.names.join(' / ')||'—'},
  {key:'bookings',label:'الحجوزات',render:r=><div><strong>{r.booking_numbers.length}</strong><div className="muted-small">{r.booking_numbers.slice(0,6).join(' · ')}</div></div>},
  {key:'note',label:'التصنيف',render:()=> <Badge tone="green">عميل متكرر — لا يُدمج تلقائيًا</Badge>}
 ];
 function openEmployeeMerge(g){
  const canonical=g.records[0],duplicate=g.records[1];
  setEmployeeGroup(g);setEmployeeCanonicalId(canonical.id);setEmployeeDuplicateId(duplicate.id);setEmployeeReason('');setEmployeeConfirm('');setEmployeePreview(null);setEmployeeMergeOpen(true);
  previewEmployeePair(canonical.id,duplicate.id);
 }
 async function previewEmployeePair(cId,dId){
  if(!cId||!dId||cId===dId){setEmployeePreview(null);return}
  setEmployeePreviewBusy(true);setError('');
  try{const x=await api.admin({action:'attendance_employee_duplicate_preview',canonical_id:cId,duplicate_id:dId});setEmployeePreview(x)}
  catch(e){setEmployeePreview({can_merge:false,reasons:[e.message]})}finally{setEmployeePreviewBusy(false)}
 }
 async function mergeEmployeePair(e){
  e.preventDefault();if(!employeePreview?.can_merge)return;
  setEmployeeMergeBusy(true);setError('');
  try{
   const x=await api.admin({action:'attendance_employee_duplicate_merge',canonical_id:employeeCanonicalId,duplicate_id:employeeDuplicateId,reason:employeeReason,confirm_employee_code:employeeConfirm});
   setNotice(`تم دمج سجل موظف الحضور المكرر في ${x?.result?.employee_code||employeePreview?.canonical?.employee_code||''} مع تحويل المراجع والاحتفاظ بأثر الدمج.`);
   setEmployeeMergeOpen(false);await loadEmployeeDuplicates();if(canAudit)await loadAudit();
  }catch(e2){setError(e2.message)}finally{setEmployeeMergeBusy(false)}
 }
 const employeeCols=[
  {key:'code',label:'الموظف',render:r=><div><strong>{r.canonical?.employee_code||'—'}</strong><div className="muted-small">{r.records.map(x=>x.name||x.employee_code).join(' · ')}</div></div>},
  {key:'match',label:'سبب الاشتباه',render:r=><Badge tone="orange">{r.match}</Badge>},
  {key:'count',label:'السجلات',render:r=><strong>{r.records.length}</strong>},
  {key:'identity',label:'الهوية / الجوال',render:r=>r.canonical?.national_id||r.canonical?.phone||'—'},
  {key:'branch',label:'الفرع',render:r=>r.branch_id?(branchMap.get(String(r.branch_id))?.name||'—'):'—'},
  {key:'action',label:'',render:r=><Button variant="primary" onClick={()=>openEmployeeMerge(r)}><GitMerge size={14}/> معاينة الدمج</Button>}
 ];
 const registryCols=[
  {key:'type',label:'النوع',render:r=><Badge>{r.label}</Badge>},
  {key:'match',label:'سبب الاشتباه',render:r=><Badge tone="orange">{r.match}</Badge>},
  {key:'records',label:'السجلات',render:r=><div><strong>{r.records.length}</strong><div className="muted-small">{r.records.map(x=>x.name||x.full_name||x.company_name||x.agent_code||x.username||x.id).join(' · ')}</div></div>},
  {key:'mode',label:'سياسة الدمج',render:r=>r.entity_type==='agents'?<Badge tone="green">Preview + دمج آمن</Badge>:<Badge tone="red">مراجعة فقط</Badge>},
  {key:'warning',label:'ضوابط الدمج',render:r=>r.warning||'—'},
  {key:'action',label:'',render:r=>r.entity_type==='staff_users'?<Button onClick={()=>go?.('/staff')}>فتح الموظفين</Button>:r.entity_type==='agents'?<Button variant="primary" onClick={()=>setAgentMergeGroup(r)}><GitMerge size={14}/> معاينة الدمج</Button>:r.entity_type==='customer_profiles'?<Button onClick={()=>go?.('/crm')}>فتح CRM</Button>:'—'}
 ];

 const selectedChanges=selectedAudit?normalizeAuditChanges(selectedAudit.metadata?.changes||[],{tripMap,branchMap}):[];
 const selectedMeta=selectedAudit?.metadata||{};
 const refValue=v=>typeof v==='object'&&v!==null?Number(String(v.count||0).replace('+','')):Number(v||0);
 const refTotal=obj=>Object.values(obj||{}).reduce((n,v)=>{const x=refValue(v);return n+(Number.isFinite(x)?x:0)},0);

 return <>
  <ModuleShell title="Timeline / Audit Center" subtitle="من أنشأ السجل، من عدله، متى تغيّر، قبل/بعد، ودمج آمن للتكرارات بدل الحذف" icon={Activity} tabs={tabs} activeTab={tab} onTabChange={setTab} actions={<>{tab==='activity'&&canAudit&&<Button onClick={loadAudit} disabled={auditBusy}><RefreshCw size={16}/> تحديث السجل</Button>}{tab==='duplicates'&&<Button onClick={async()=>{await refresh();await Promise.all([canReviewAttendance?loadEmployeeDuplicates():Promise.resolve(),canReviewRegistry?loadRegistryDuplicates():Promise.resolve()])}} disabled={employeeBusy||registryBusy}><RefreshCw size={16}/> تحديث التكرارات</Button>}</>} breadcrumbs={[{label:'الإدارة والمتابعة'},{label:'Audit Center'}]}/>
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}

  {tab==='activity'&&canAudit&&(auditBusy&&!auditRows.length?<Loading/>:<>
   <div className="stats-grid">
    <Card><div className="stat-card"><Activity/><div><span>الحركات المعروضة</span><strong>{auditCounts.total}</strong><small>{auditScope==='all'?'كل الفروع':'نطاق الفرع'}</small></div></div></Card>
    <Card><div className="stat-card"><History/><div><span>حركات اليوم</span><strong>{auditCounts.today}</strong><small>حسب الفلاتر الحالية</small></div></div></Card>
    <Card><div className="stat-card"><ShieldCheck/><div><span>أمان وصلاحيات</span><strong>{auditCounts.security}</strong><small>تغييرات وموافقات</small></div></div></Card>
    <Card><div className="stat-card"><Activity/><div><span>مالية</span><strong>{auditCounts.finance}</strong><small>تحصيل واسترداد ومصروفات</small></div></div></Card>
   </div>
   <Card><div className="operation-filters"><div className="filterbar"><Search size={17}/><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث باسم المستخدم أو العملية أو رقم السجل"/></div><Select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">كل الأقسام</option><option value="security">أمان وصلاحيات</option><option value="operations">تشغيل وحجوزات</option><option value="finance">مالية</option><option value="hr">HR وحضور</option><option value="system">نظام</option></Select><Select value={auditMode} onChange={e=>setAuditMode(e.target.value)}><option value="changes">التغييرات المهمة فقط</option><option value="all">كل الحركات التقنية</option></Select><Badge>{filteredAudit.length} حركة</Badge></div></Card>
   <Card><div className="card-title"><div><h3>الخط الزمني للنظام</h3><small>يجمع سجل النشاط العام مع سجل التدقيق التفصيلي. العمليات التي سجلت Snapshot تعرض قبل/بعد تلقائيًا.</small></div><div className="finance-actions"><Badge tone="green">تفصيلي {auditSummary?.sources?.detailed||0}</Badge><Badge>عام {auditSummary?.sources?.activity||0}</Badge></div></div><Table preferenceKey="audit-center" defaultPageSize={25} rows={filteredAudit} columns={auditCols}/></Card>
  </>)}

  {tab==='duplicates'&&(canReviewDuplicates||canReviewAttendance||canReviewRegistry)&&<>
   <div className="stats-grid">
    <Card><div className="stat-card"><GitMerge/><div><span>تكرارات المسافرين</span><strong>{canReviewDuplicates?duplicateGroups.length:'—'}</strong><small>داخل نفس الحجز فقط</small></div></div></Card>
    <Card><div className="stat-card"><UsersRound/><div><span>تكرارات موظفي الحضور</span><strong>{canReviewAttendance?employeeGroups.length:'—'}</strong><small>نفس الفرع والبيئة فقط</small></div></div></Card>
    <Card><div className="stat-card"><ShieldCheck/><div><span>تكرارات حساسة</span><strong>{canReviewRegistry?registryGroups.length:'—'}</strong><small>الوكلاء: دمج آمن · الموظفون والعملاء: مراجعة فقط</small></div></div></Card>
    <Card><div className="stat-card"><ShieldCheck/><div><span>قاعدة الدمج</span><strong>Merge ≠ Delete</strong><small>لا تنفيذ تلقائي إذا كانت العلاقات أو المالية حساسة</small></div></div></Card>
   </div>
   {canReviewDuplicates&&<Card><div className="card-title"><div><h3>مسافرون مكررون داخل نفس الحجز</h3><small>المطابقة القوية: نفس الهوية، أو نفس الاسم والجوال. يتوقف الدمج عند تعارض مقعد أو تسكين.</small></div><Badge tone={duplicateGroups.length?'orange':'green'}>{duplicateGroups.length}</Badge></div>{duplicateGroups.length?<Table preferenceKey="passenger-duplicate-candidates" defaultPageSize={25} rows={duplicateGroups} columns={dupCols}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد حاليًا سجلات مسافرين مكررة داخل نفس الحجز ضمن نطاقك.</div>}</Card>}
   {canReviewAttendance&&<Card><div className="card-title"><div><h3>موظفو حضور مشتبه بتكرارهم</h3><small>المطابقة: نفس حساب الموظف، أو نفس الهوية، أو نفس الاسم والجوال. قبل الدمج يتم فحص الدوام وقرارات المخالفات والروابط والحركات.</small></div><Badge tone={employeeGroups.length?'orange':'green'}>{employeeBusy?'…':employeeGroups.length}</Badge></div>{employeeBusy&&!employeeGroups.length?<Loading text="جاري فحص تكرارات الموظفين..."/>:employeeGroups.length?<Table preferenceKey="attendance-employee-duplicate-candidates" defaultPageSize={25} rows={employeeGroups} columns={employeeCols}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد حاليًا سجلات موظفين مكررة ضمن نطاقك.</div>}</Card>}
   {canReviewRegistry&&<Card><div className="card-title"><div><h3>تكرارات حساسة — مراجعة ودمج موجّه</h3><small>الوكلاء يدعمون الآن Preview مالي وتشغيلي ودمجًا آمنًا بعد فحص الرصيد والتوزيعات والتطابق القانوني. حسابات الموظفين والعملاء تظل مراجعة فقط.</small></div><div className="finance-actions"><Badge tone={registryGroups.length?'orange':'green'}>{registryBusy?'…':registryGroups.length}</Badge>{registrySummary?.agents>0&&<Badge>وكلاء {registrySummary.agents}</Badge>}{registrySummary?.staff>0&&<Badge>موظفون {registrySummary.staff}</Badge>}{registrySummary?.customers>0&&<Badge>عملاء {registrySummary.customers}</Badge>}</div></div>{registryBusy&&!registryGroups.length?<Loading text="جاري فحص التكرارات الحساسة..."/>:registryGroups.length?<Table preferenceKey="sensitive-duplicate-review" defaultPageSize={25} rows={registryGroups} columns={registryCols}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد تكرارات قوية في الكيانات الحساسة ضمن النطاق الحالي.</div>}</Card>}
   {canReviewDuplicates&&<Card><div className="card-title"><div><h3>سجل العميل المتكرر عبر حجوزات مختلفة</h3><small>هذه ليست أخطاء افتراضيًا؛ نفس الشخص قد يسافر أكثر من مرة، لذلك لا يسمح النظام بدمجها.</small></div><Badge>{repeatGroups.length}</Badge></div>{repeatGroups.length?<Table preferenceKey="repeat-passengers" defaultPageSize={25} rows={repeatGroups} columns={repeatCols}/>:<div className="empty">لا توجد هويات متكررة عبر حجوزات مختلفة.</div>}</Card>}
  </>}

  <Modal open={!!selectedAudit} onClose={()=>setSelectedAudit(null)} title="تفاصيل حركة النظام" wide>
   {selectedAudit&&<div className="form-grid">
    <Card><div className="detail-grid"><div><span>العملية</span><strong>{auditActionLabel(selectedAudit.action)}</strong></div><div><span>الوقت</span><strong>{dateTime(selectedAudit.created_at)}</strong></div><div><span>المستخدم</span><strong>{selectedAudit.actor_name||selectedAudit.actor_id||'النظام'}</strong></div><div><span>الدور</span><strong>{selectedAudit.actor_role||'—'}</strong></div><div><span>الكيان</span><strong>{auditEntityLabel(selectedAudit.entity_type)}</strong></div><div><span>المعرّف</span><strong>{selectedAudit.entity_id||'—'}</strong></div></div></Card>
    {selectedChanges.length>0&&<div style={{gridColumn:'1/-1'}}><Card><div className="card-title"><h3>قبل / بعد</h3><Badge>{selectedChanges.length}</Badge></div><Table rows={selectedChanges} columns={[{key:'label',label:'البيان'},{key:'before',label:'قبل'},{key:'after',label:'بعد'}]}/></Card></div>}
    <div style={{gridColumn:'1/-1'}}><Card><div className="card-title"><h3>تفاصيل المصدر</h3></div><div className="detail-grid"><div><span>المصدر</span><strong>{selectedMeta.source||'—'}</strong></div><div><span>المسار</span><strong dir="ltr">{selectedMeta.path||'—'}</strong></div><div><span>الجدول</span><strong>{selectedMeta.table||'—'}</strong></div><div><span>الحالة</span><strong>{selectedMeta.status||'—'}</strong></div>{selectedMeta.reason&&<div><span>السبب</span><strong>{selectedMeta.reason}</strong></div>}</div></Card></div>
    <div className="modal-actions" style={{gridColumn:'1/-1'}}><Button onClick={()=>setSelectedAudit(null)}>إغلاق</Button>{sourcePath(selectedAudit)&&<Button variant="primary" onClick={()=>{const p=sourcePath(selectedAudit);setSelectedAudit(null);go?.(p)}}><Wrench size={15}/> فتح المصدر</Button>}</div>
   </div>}
  </Modal>

  <Modal open={mergeOpen} onClose={()=>!mergeBusy&&setMergeOpen(false)} title="معاينة دمج سجل مسافر مكرر" wide>
   {mergeGroup&&<form className="form-grid" onSubmit={mergePair}>
    <div className="warning-list" style={{gridColumn:'1/-1'}}><div><AlertTriangle size={16}/> الدمج مسموح فقط داخل نفس الحجز. السجل الأساسي يبقى، والسجل المكرر يتحول إلى سجل مدموج محفوظ للتدقيق.</div></div>
    <Field label="السجل الأساسي الذي سيبقى"><Select value={canonicalId} onChange={e=>{const v=e.target.value;setCanonicalId(v);const other=duplicateId===v?mergeGroup.records.find(x=>x.id!==v)?.id:duplicateId;setDuplicateId(other||'');previewPair(v,other||'')}}>{mergeGroup.records.map(p=><option key={p.id} value={p.id}>{p.full_name||'مسافر'} · #{p.passenger_order||'—'} · {p.identity_number||p.phone||p.id}</option>)}</Select></Field>
    <Field label="السجل المكرر الذي سيُدمج"><Select value={duplicateId} onChange={e=>{setDuplicateId(e.target.value);previewPair(canonicalId,e.target.value)}}>{mergeGroup.records.filter(p=>p.id!==canonicalId).map(p=><option key={p.id} value={p.id}>{p.full_name||'مسافر'} · #{p.passenger_order||'—'} · {p.identity_number||p.phone||p.id}</option>)}</Select></Field>
    <div style={{gridColumn:'1/-1'}}>{previewBusy?<Loading text="جاري فحص الارتباطات والتعارضات..."/>:preview&&<Card><div className="card-title"><div><h3>{preview.can_merge?'جاهز للدمج':'لا يمكن الدمج حاليًا'}</h3><small>{preview.match?.label||''}</small></div><Badge tone={preview.can_merge?'green':'red'}>{preview.can_merge?'آمن':'موقوف'}</Badge></div>{preview.reasons?.length>0&&<div className="warning-list">{preview.reasons.map((x,i)=><div key={i}><AlertTriangle size={15}/>{x}</div>)}</div>}<div className="detail-grid"><div><span>مراجع السجل الأساسي</span><strong>{refTotal(preview.references?.canonical)}</strong></div><div><span>مراجع السجل المكرر</span><strong>{refTotal(preview.references?.duplicate)}</strong></div><div><span>الحجز</span><strong>{preview.booking?.booking_number||mergeGroup.booking_number}</strong></div><div><span>المطابقة</span><strong>{preview.match?.label||'—'}</strong></div></div></Card>}</div>
    <Field label="سبب الدمج"><Textarea value={mergeReason} onChange={e=>setMergeReason(e.target.value)} placeholder="مثال: تم إدخال نفس المسافر مرتين داخل الحجز" required/></Field>
    <Field label={'اكتب رقم الحجز للتأكيد: '+(preview?.booking?.booking_number||mergeGroup.booking_number)}><Input value={confirmNo} onChange={e=>setConfirmNo(e.target.value)} required/></Field>
    <div className="modal-actions" style={{gridColumn:'1/-1'}}><Button type="button" onClick={()=>setMergeOpen(false)} disabled={mergeBusy}>إلغاء</Button>{canMerge&&<Button variant="primary" type="submit" disabled={mergeBusy||previewBusy||!preview?.can_merge||mergeReason.trim().length<5||confirmNo!==String(preview?.booking?.booking_number||mergeGroup.booking_number)}><GitMerge size={15}/>{mergeBusy?'جاري الدمج...':'تنفيذ الدمج الآمن'}</Button>}</div>
   </form>}
  </Modal>

  <Modal open={employeeMergeOpen} onClose={()=>!employeeMergeBusy&&setEmployeeMergeOpen(false)} title="معاينة دمج موظف حضور مكرر" wide>
   {employeeGroup&&<form className="form-grid" onSubmit={mergeEmployeePair}>
    <div className="warning-list" style={{gridColumn:'1/-1'}}><div><AlertTriangle size={16}/> لا يوجد حذف. السجل الأساسي يبقى فعالًا، والسجل المكرر يتحول إلى Inactive مرتبط بالأساسي مع حفظ سبب الدمج وكل المراجع المنقولة.</div></div>
    <Field label="السجل الأساسي الذي سيبقى"><Select value={employeeCanonicalId} onChange={e=>{const v=e.target.value;setEmployeeCanonicalId(v);const other=employeeDuplicateId===v?employeeGroup.records.find(x=>x.id!==v)?.id:employeeDuplicateId;setEmployeeDuplicateId(other||'');setEmployeeConfirm('');previewEmployeePair(v,other||'')}}>{employeeGroup.records.map(p=><option key={p.id} value={p.id}>{p.employee_code} · {p.name} · {p.national_id||p.phone||p.id}</option>)}</Select></Field>
    <Field label="السجل المكرر الذي سيُدمج"><Select value={employeeDuplicateId} onChange={e=>{setEmployeeDuplicateId(e.target.value);previewEmployeePair(employeeCanonicalId,e.target.value)}}>{employeeGroup.records.filter(p=>p.id!==employeeCanonicalId).map(p=><option key={p.id} value={p.id}>{p.employee_code} · {p.name} · {p.national_id||p.phone||p.id}</option>)}</Select></Field>
    <div style={{gridColumn:'1/-1'}}>{employeePreviewBusy?<Loading text="جاري فحص الحركات والدوام والروابط والمخالفات..."/>:employeePreview&&<Card><div className="card-title"><div><h3>{employeePreview.can_merge?'جاهز للدمج':'لا يمكن الدمج حاليًا'}</h3><small>{employeePreview.match?.label||''}</small></div><Badge tone={employeePreview.can_merge?'green':'red'}>{employeePreview.can_merge?'آمن':'موقوف'}</Badge></div>{employeePreview.reasons?.length>0&&<div className="warning-list">{employeePreview.reasons.map((x,i)=><div key={i}><AlertTriangle size={15}/>{x}</div>)}</div>}<div className="detail-grid"><div><span>مراجع السجل الأساسي</span><strong>{refTotal(employeePreview.references?.canonical)}</strong></div><div><span>مراجع السجل المكرر</span><strong>{refTotal(employeePreview.references?.duplicate)}</strong></div><div><span>الموظف الأساسي</span><strong>{employeePreview.canonical?.employee_code||'—'}</strong></div><div><span>المطابقة</span><strong>{employeePreview.match?.label||'—'}</strong></div></div></Card>}</div>
    <Field label="سبب الدمج"><Textarea value={employeeReason} onChange={e=>setEmployeeReason(e.target.value)} placeholder="مثال: تم إنشاء سجل حضور آخر لنفس الموظف عند استيراد جهاز البصمة" required/></Field>
    <Field label={'اكتب رقم الموظف الأساسي للتأكيد: '+(employeePreview?.canonical?.employee_code||'')}><Input value={employeeConfirm} onChange={e=>setEmployeeConfirm(e.target.value)} required/></Field>
    <div className="modal-actions" style={{gridColumn:'1/-1'}}><Button type="button" onClick={()=>setEmployeeMergeOpen(false)} disabled={employeeMergeBusy}>إلغاء</Button>{canMergeAttendance&&<Button variant="primary" type="submit" disabled={employeeMergeBusy||employeePreviewBusy||!employeePreview?.can_merge||employeeReason.trim().length<5||employeeConfirm!==String(employeePreview?.canonical?.employee_code||'')}><GitMerge size={15}/>{employeeMergeBusy?'جاري الدمج...':'تنفيذ الدمج الآمن'}</Button>}</div>
   </form>}
  </Modal>

  <AgentMergeModal group={agentMergeGroup} onClose={()=>setAgentMergeGroup(null)} onMerged={async out=>{setNotice(`تم دمج الوكيل المكرر داخل ${out?.result?.agent_code||'السجل الأساسي'} مع نقل الحجوزات والتوزيعات والـQuotas وحفظ أثر الدمج.`);setAgentMergeGroup(null);await loadRegistryDuplicates();if(canAudit)await loadAudit();}}/>
 </>;
}
