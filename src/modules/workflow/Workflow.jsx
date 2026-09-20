import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,CheckCircle2,CheckSquare2,Clock3,Fingerprint,Plus,RefreshCw,RotateCcw,ShieldCheck,UserCog,WalletCards} from 'lucide-react';
import {api} from '../../lib/api.js';
import {useAuth} from '../../core/AuthContext.jsx';
import {useAppData} from '../../core/AppDataContext.jsx';
import {has} from '../../lib/permissions.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';
import {money,statusLabel} from '../../lib/format.js';

const txt=v=>String(v??'').trim();
const lower=v=>txt(v).toLowerCase();
const dateTime=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const priorityLabel=v=>({urgent:'عاجلة',high:'عالية',normal:'عادية',low:'منخفضة'})[lower(v)]||v||'عادية';
const priorityTone=v=>lower(v)==='urgent'?'red':lower(v)==='high'?'orange':'blue';
const taskStatusLabel=v=>({open:'مفتوحة',in_progress:'قيد التنفيذ',done:'منتهية',cancelled:'ملغاة'})[lower(v)]||statusLabel(v||'open');
const approvalTypeLabel=v=>{
 const k=lower(v);
 if(k==='staff_permission_change')return 'تعديل صلاحيات موظف';
 if(k.includes('refund'))return 'طلب استرداد';
 if(k.includes('attendance'))return 'إجراء حضور';
 return txt(v)||'طلب موافقة';
};
function elevated(user){return !!(user&&(user.role==='developer'||user.role==='مدير عام'||user.permissions?.all))}
function isOpenTask(t){return ['open','in_progress'].includes(lower(t?.status))}
function isPendingApproval(a){return lower(a?.status)==='pending'}
function isOpenRefund(r){return ['pending','approved'].includes(lower(r?.status))}
function isAttentionDelete(r){return !['success','completed','done'].includes(lower(r?.status))}
function approvalTarget(a){
 const k=lower(a?.request_type);
 if(k==='staff_permission_change')return '/staff?tab=approvals';
 if(k.includes('refund'))return '/refunds';
 if(k.includes('attendance'))return '/attendance?tab=reports';
 return '/workflow?tab=approvals';
}

export default function Workflow({go,initialTab=''}) {
 const {user}=useAuth();
 const {data:app}=useAppData();
 const isElevated=elevated(user);
 const canTasks=isElevated||has(user,'tasks')||has(user,'crm');
 const canGenericApprovals=isElevated||has(user,'approvals')||has(user,'approval_requests');
 const canPermissionApprovals=isElevated||has(user,'managePermissions')||has(user,'approvals');
 const canRefunds=isElevated||['refunds','refund_view','refund_request','refund_approve','refund_complete'].some(k=>has(user,k));
 const canAttendance=isElevated||['attendance_review_violations','attendance_close_month','attendance_reopen_month','attendance_manage_employees','attendance_reports'].some(k=>has(user,k));
 const canAny=canTasks||canGenericApprovals||canPermissionApprovals||canRefunds||canAttendance;

 const [moduleData,setModuleData]=useState({tasks:[],approval_requests:[]});
 const [refunds,setRefunds]=useState([]),[refundCaps,setRefundCaps]=useState({});
 const [permissionApprovals,setPermissionApprovals]=useState([]);
 const [attendance,setAttendance]=useState(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[sourceErrors,setSourceErrors]=useState([]);
 const [busy,setBusy]=useState(''),[taskOpen,setTaskOpen]=useState(false),[decision,setDecision]=useState(null),[decisionNote,setDecisionNote]=useState('');
 const [listFilters,setListFilters]=useState({overview:{q:'',kind:'',priority:''},tasks:{q:'',status:'',priority:'',assigned:'',branch:''},approvals:{q:'',kind:'',requester:''},refunds:{q:'',status:'',branch:''},hr:{q:'',status:'',branch:''}});

 const users=app.users||[],branches=app.branches||[];
 const branchMap=useMemo(()=>new Map(branches.map(b=>[String(b.id),b.name||b.id])),[branches]);
 const userMap=useMemo(()=>new Map(users.map(u=>[String(u.id),u])),[users]);

 async function load(){
  setLoading(true);setError('');setSourceErrors([]);
  const errors=[],next={moduleData:{tasks:[],approval_requests:[]},refunds:[],refundCaps:{},permissionApprovals:[],attendance:null};
  const jobs=[];
  if(canTasks||canGenericApprovals)jobs.push((async()=>{
   try{
    const resource=canTasks?'tasks':'approvals',x=await api.module(resource);
    next.moduleData={tasks:x?.tasks||[],approval_requests:x?.approval_requests||[]};
   }catch(e){errors.push('المهام/الموافقات: '+e.message)}
  })());
  if(canRefunds)jobs.push((async()=>{try{const x=await api.admin({action:'refund_list'});next.refunds=x?.rows||[];next.refundCaps={request:!!x?.can_request,approve:!!x?.can_approve,complete:!!x?.can_complete,print:!!x?.can_print}}catch(e){errors.push('الاستردادات: '+e.message)}})());
  if(canPermissionApprovals)jobs.push((async()=>{try{const x=await api.admin({action:'security_permission_approvals_list'});next.permissionApprovals=x?.rows||[]}catch(e){errors.push('موافقات الصلاحيات: '+e.message)}})());
  if(canAttendance)jobs.push((async()=>{try{next.attendance=await api.attendance()}catch(e){errors.push('الحضور: '+e.message)}})());
  await Promise.all(jobs);
  setModuleData(next.moduleData);setRefunds(next.refunds);setRefundCaps(next.refundCaps);setPermissionApprovals(next.permissionApprovals);setAttendance(next.attendance);setSourceErrors(errors);setLoading(false);
 }
 useEffect(()=>{load()},[]);

 const tasks=useMemo(()=>[...(moduleData.tasks||[])].sort((a,b)=>String(a.due_at||a.created_at||'').localeCompare(String(b.due_at||b.created_at||''))),[moduleData.tasks]);
 const openTasks=useMemo(()=>tasks.filter(isOpenTask),[tasks]);
 const overdueTasks=useMemo(()=>openTasks.filter(t=>t.due_at&&new Date(t.due_at).getTime()<Date.now()),[openTasks]);
 const genericApprovals=useMemo(()=>(moduleData.approval_requests||[]).filter(a=>isPendingApproval(a)&&lower(a.request_type)!=='staff_permission_change'&&!lower(a.request_type).includes('refund')),[moduleData.approval_requests]);
 const pendingPermission=useMemo(()=>permissionApprovals.filter(isPendingApproval),[permissionApprovals]);
 const openRefunds=useMemo(()=>refunds.filter(isOpenRefund),[refunds]);
 const pendingRefunds=useMemo(()=>openRefunds.filter(r=>lower(r.status)==='pending'),[openRefunds]);
 const approvedRefunds=useMemo(()=>openRefunds.filter(r=>lower(r.status)==='approved'),[openRefunds]);
 const deleteRequests=useMemo(()=>(attendance?.deleteRequests||[]).filter(isAttentionDelete),[attendance]);

 const queue=useMemo(()=>{
  const q=[];
  for(const t of openTasks)q.push({id:'task:'+t.id,kind:'task',title:t.title||'مهمة',sub:t.description||'',status:taskStatusLabel(t.status),when:t.due_at||t.created_at,priority:t.priority||'normal',raw:t});
  for(const a of pendingPermission)q.push({id:'perm:'+a.id,kind:'permission',title:'موافقة صلاحيات — '+(a.request_payload?.target_name||a.request_payload?.target_username||'موظف'),sub:'طلب حساس يحتاج موافقة ثانية',status:'بانتظار الموافقة',when:a.requested_at||a.created_at,priority:'urgent',raw:a});
  for(const a of genericApprovals)q.push({id:'approval:'+a.id,kind:'approval',title:approvalTypeLabel(a.request_type),sub:a.reason||'',status:'بانتظار الموافقة',when:a.requested_at||a.created_at,priority:'high',raw:a});
  for(const r of openRefunds)q.push({id:'refund:'+r.id,kind:'refund',title:'استرداد '+(r.booking_number||''),sub:(r.customer_name||'')+' · '+money(r.amount||0),status:lower(r.status)==='approved'?'معتمد — ينتظر التنفيذ':'بانتظار الاعتماد',when:r.requested_at||r.created_at,priority:lower(r.status)==='approved'?'urgent':'high',raw:r});
  for(const d of deleteRequests)q.push({id:'attendance-delete:'+d.id,kind:'attendance_delete',title:'حذف موظف حضور — '+(d.employee_name||d.employee_code||''),sub:d.result_summary||'طلب حذف يحتاج متابعة',status:d.status||'قيد المتابعة',when:d.created_at,priority:lower(d.status)==='failed'?'urgent':'high',raw:d});
  const rank={urgent:0,high:1,normal:2,low:3};
  return q.sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||String(a.when||'').localeCompare(String(b.when||'')));
 },[openTasks,pendingPermission,genericApprovals,openRefunds,deleteRequests]);

 const tabs=useMemo(()=>[
  {id:'overview',label:'المطلوب الآن',icon:CheckSquare2,badge:queue.length||null},
  ...(canTasks?[{id:'tasks',label:'المهام',icon:Clock3,badge:openTasks.length||null}]:[]),
  ...((canGenericApprovals||canPermissionApprovals)?[{id:'approvals',label:'الموافقات',icon:ShieldCheck,badge:(genericApprovals.length+pendingPermission.length)||null}]:[]),
  ...(canRefunds?[{id:'refunds',label:'الاستردادات',icon:WalletCards,badge:openRefunds.length||null}]:[]),
  ...(canAttendance?[{id:'hr',label:'إجراءات HR',icon:Fingerprint,badge:deleteRequests.length||null}]:[])
 ],[queue.length,canTasks,openTasks.length,canGenericApprovals,canPermissionApprovals,genericApprovals.length,pendingPermission.length,canRefunds,openRefunds.length,canAttendance,deleteRequests.length]);
 const [tab,setTab]=useModuleTab('almaher:module:action-center',tabs,initialTab||'overview');
 useEffect(()=>{if(initialTab&&tabs.some(x=>x.id===initialTab))setTab(initialTab)},[initialTab,tabs.length]);

 function openTask(){setTaskOpen(true);setError('');setNotice('')}
 async function createTask(e){
  e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));setBusy('new-task');setError('');
  try{
   const row={title:txt(f.title),description:txt(f.description)||null,priority:f.priority||'normal',status:'open',due_at:f.due_at||null,assigned_to:f.assigned_to||null,branch_id:f.branch_id||user?.branch_id||null,created_by:user?.name||user?.id||null};
   if(!row.title)throw new Error('عنوان المهمة مطلوب.');
   await api.moduleWrite({action:'insert',table:'tasks',row});setTaskOpen(false);setNotice('تم إنشاء المهمة وإضافتها إلى مركز الإجراءات.');await load();
  }catch(e2){setError(e2.message)}finally{setBusy('')}
 }
 async function setTaskStatus(row,status){
  const key='task-'+row.id;setBusy(key);setError('');
  try{await api.moduleWrite({action:'update',table:'tasks',id:row.id,row:{status,completed_at:status==='done'?new Date().toISOString():null}});setNotice(status==='done'?'تم إنهاء المهمة.':'تم تحديث حالة المهمة.');await load()}catch(e){setError(e.message)}finally{setBusy('')}
 }
 function askDecision(kind,row,value){setDecision({kind,row,value});setDecisionNote('')}
 async function saveDecision(e){
  e.preventDefault();if(!decision)return;setBusy('decision');setError('');
  try{
   if(decision.kind==='permission'){
    await api.admin({action:'security_permission_approval_decide',id:decision.row.id,decision:decision.value,notes:decisionNote});
   }else if(decision.kind==='refund'){
    await api.admin({action:'refund_decide',id:decision.row.id,decision:decision.value,notes:decisionNote});
   }
   setDecision(null);setDecisionNote('');setNotice('تم حفظ القرار بنجاح.');await load();
  }catch(err){setError(err.message)}finally{setBusy('')}
 }
 async function completeRefund(row){
  if(!confirm('تنفيذ الاسترداد المعتمد الآن؟ سيُحدّث السجل المالي للحجز.'))return;
  setBusy('refund-'+row.id);setError('');
  try{await api.admin({action:'refund_complete',id:row.id});setNotice('تم تنفيذ الاسترداد وتحديث الحالة المالية.');await load()}catch(e){setError(e.message)}finally{setBusy('')}
 }

 function queueActions(x){
  if(x.kind==='task')return <div className="finance-actions">{lower(x.raw.status)==='open'&&<Button onClick={()=>setTaskStatus(x.raw,'in_progress')} disabled={busy==='task-'+x.raw.id}>بدء</Button>}<Button variant="primary" onClick={()=>setTaskStatus(x.raw,'done')} disabled={busy==='task-'+x.raw.id}><CheckCircle2 size={14}/> إنهاء</Button></div>;
  if(x.kind==='permission')return <div className="finance-actions"><Button variant="primary" onClick={()=>askDecision('permission',x.raw,'approve')}>اعتماد</Button><Button onClick={()=>askDecision('permission',x.raw,'reject')}>رفض</Button></div>;
  if(x.kind==='approval')return <Button onClick={()=>go?.(approvalTarget(x.raw))}>فتح المصدر</Button>;
  if(x.kind==='refund'){
   if(lower(x.raw.status)==='pending'&&refundCaps.approve)return <div className="finance-actions"><Button variant="primary" onClick={()=>askDecision('refund',x.raw,'approved')}>اعتماد</Button><Button onClick={()=>askDecision('refund',x.raw,'rejected')}>رفض</Button></div>;
   if(lower(x.raw.status)==='approved'&&refundCaps.complete)return <Button variant="primary" onClick={()=>completeRefund(x.raw)} disabled={busy==='refund-'+x.raw.id}>تنفيذ الاسترداد</Button>;
   return <Button onClick={()=>go?.('/refunds')}>فتح الاستردادات</Button>;
  }
  if(x.kind==='attendance_delete')return <Button onClick={()=>go?.('/attendance?tab=employees')}>فتح الحضور</Button>;
  return '—';
 }

 const queueCols=[
  {key:'kind',label:'النوع',render:r=><Badge tone={r.kind==='refund'?'orange':r.kind==='permission'?'red':r.kind.startsWith('attendance')?'green':'blue'}>{r.kind==='task'?'مهمة':r.kind==='permission'?'صلاحيات':r.kind==='approval'?'موافقة':r.kind==='refund'?'استرداد':'HR'}</Badge>},
  {key:'title',label:'المطلوب',render:r=><div><strong>{r.title}</strong>{r.sub&&<div className="muted-small">{r.sub}</div>}</div>},
  {key:'status',label:'الحالة',render:r=><Badge tone={r.priority==='urgent'?'red':r.priority==='high'?'orange':'blue'}>{r.status}</Badge>},
  {key:'when',label:'التاريخ / الاستحقاق',render:r=>dateTime(r.when)},
  {key:'action',label:'',render:queueActions}
 ];
 const taskCols=[
  {key:'title',label:'المهمة',render:r=><div><strong>{r.title}</strong>{r.description&&<div className="muted-small">{r.description}</div>}</div>},
  {key:'priority',label:'الأولوية',render:r=><Badge tone={priorityTone(r.priority)}>{priorityLabel(r.priority)}</Badge>},
  {key:'status',label:'الحالة',render:r=><Badge tone={lower(r.status)==='done'?'green':lower(r.status)==='in_progress'?'orange':'blue'}>{taskStatusLabel(r.status)}</Badge>},
  {key:'assigned_to',label:'المسؤول',render:r=>users.find(u=>String(u.id)===String(r.assigned_to))?.name||r.assigned_to||'غير محدد'},
  {key:'due_at',label:'الاستحقاق',render:r=>r.due_at?dateTime(r.due_at):'—'},
  {key:'action',label:'',render:r=>isOpenTask(r)?<div className="finance-actions">{lower(r.status)==='open'&&<Button onClick={()=>setTaskStatus(r,'in_progress')} disabled={busy==='task-'+r.id}>بدء</Button>}<Button variant="primary" onClick={()=>setTaskStatus(r,'done')} disabled={busy==='task-'+r.id}>إنهاء</Button></div>:<Badge tone="green">مكتملة</Badge>}
 ];
 const approvalRows=useMemo(()=>[
  ...pendingPermission.map(r=>({...r,_kind:'permission'})),
  ...genericApprovals.map(r=>({...r,_kind:'generic'}))
 ],[pendingPermission,genericApprovals]);
 const branchOptions=useMemo(()=>branches.map(b=>({value:String(b.id),label:b.name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[branches]);
 const userOptions=useMemo(()=>users.map(u=>({value:String(u.id),label:u.name||u.username||u.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[users]);
 const requesterOptions=useMemo(()=>[...new Set(approvalRows.map(r=>String(r.requested_by||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:userMap.get(v)?.name||v})),[approvalRows,userMap]);
 const setListFilter=(scope,key,value)=>setListFilters(x=>({...x,[scope]:{...x[scope],[key]:value}}));
 const resetListFilter=scope=>setListFilters(x=>({...x,[scope]:Object.fromEntries(Object.keys(x[scope]||{}).map(k=>[k,'']))}));
 const filteredQueue=useMemo(()=>queue.filter(r=>{
  const f=listFilters.overview||{};
  return (!f.kind||String(r.kind)===String(f.kind))
   &&(!f.priority||String(r.priority||'normal')===String(f.priority))
   &&matchesListQuery(f.q,r.title,r.sub,r.status,r.kind,r.priority,r.raw?.booking_number,r.raw?.customer_name,r.raw?.employee_name,r.raw?.employee_code,r.raw?.request_payload?.target_name);
 }),[queue,listFilters.overview]);
 const filteredTasks=useMemo(()=>tasks.filter(r=>{
  const f=listFilters.tasks||{},assigned=userMap.get(String(r.assigned_to));
  return (!f.status||String(r.status||'open')===String(f.status))
   &&(!f.priority||String(r.priority||'normal')===String(f.priority))
   &&(!f.assigned||String(r.assigned_to||'')===String(f.assigned))
   &&(!f.branch||String(r.branch_id||'')===String(f.branch))
   &&matchesListQuery(f.q,r.title,r.description,r.status,r.priority,assigned?.name,assigned?.username,branchMap.get(String(r.branch_id)));
 }),[tasks,listFilters.tasks,userMap,branchMap]);
 const filteredApprovalRows=useMemo(()=>approvalRows.filter(r=>{
  const f=listFilters.approvals||{},kind=r._kind==='permission'?'permission':'generic';
  return (!f.kind||kind===f.kind)
   &&(!f.requester||String(r.requested_by||'')===String(f.requester))
   &&matchesListQuery(f.q,approvalTypeLabel(r.request_type),r.request_type,r.request_payload?.target_name,r.request_payload?.target_username,r.reason,r.reference_table,r.requested_by);
 }),[approvalRows,listFilters.approvals]);
 const filteredRefunds=useMemo(()=>openRefunds.filter(r=>{
  const f=listFilters.refunds||{};
  return (!f.status||String(r.status||'')===String(f.status))
   &&(!f.branch||String(r.branch_id||'')===String(f.branch))
   &&matchesListQuery(f.q,r.receipt_no,r.booking_number,r.customer_name,r.amount,r.status,branchMap.get(String(r.branch_id)));
 }),[openRefunds,listFilters.refunds,branchMap]);
 const filteredDeletes=useMemo(()=>deleteRequests.filter(r=>{
  const f=listFilters.hr||{};
  return (!f.status||String(r.status||'')===String(f.status))
   &&(!f.branch||String(r.branch_id||'')===String(f.branch))
   &&matchesListQuery(f.q,r.employee_name,r.employee_code,r.status,r.result_summary,branchMap.get(String(r.branch_id)));
 }),[deleteRequests,listFilters.hr,branchMap]);
 const approvalCols=[
  {key:'request_type',label:'النوع',render:r=>approvalTypeLabel(r.request_type)},
  {key:'target',label:'المستهدف',render:r=>r._kind==='permission'?(r.request_payload?.target_name||r.request_payload?.target_username||'موظف'):(r.reason||r.reference_table||'—')},
  {key:'requested_by',label:'مقدم الطلب',render:r=>r.requested_by||'—'},
  {key:'requested_at',label:'تاريخ الطلب',render:r=>dateTime(r.requested_at||r.created_at)},
  {key:'action',label:'',render:r=>r._kind==='permission'?<div className="finance-actions"><Button variant="primary" onClick={()=>askDecision('permission',r,'approve')}>اعتماد</Button><Button onClick={()=>askDecision('permission',r,'reject')}>رفض</Button></div>:<Button onClick={()=>go?.(approvalTarget(r))}>فتح المصدر</Button>}
 ];
 const refundCols=[
  {key:'receipt_no',label:'السند',render:r=><strong>{r.receipt_no||'—'}</strong>},
  {key:'booking_number',label:'الحجز'},
  {key:'customer_name',label:'العميل'},
  {key:'amount',label:'المبلغ',render:r=>money(r.amount||0)},
  {key:'status',label:'الحالة',render:r=><Badge tone={lower(r.status)==='approved'?'green':'orange'}>{lower(r.status)==='approved'?'معتمد — ينتظر التنفيذ':'بانتظار الاعتماد'}</Badge>},
  {key:'requested_at',label:'الطلب',render:r=>dateTime(r.requested_at||r.created_at)},
  {key:'action',label:'',render:r=>lower(r.status)==='pending'&&refundCaps.approve?<div className="finance-actions"><Button variant="primary" onClick={()=>askDecision('refund',r,'approved')}>اعتماد</Button><Button onClick={()=>askDecision('refund',r,'rejected')}>رفض</Button></div>:lower(r.status)==='approved'&&refundCaps.complete?<Button variant="primary" onClick={()=>completeRefund(r)} disabled={busy==='refund-'+r.id}>تنفيذ</Button>:<Button onClick={()=>go?.('/refunds')}>فتح</Button>}
 ];
 const deleteCols=[
  {key:'employee_name',label:'الموظف',render:r=><div><strong>{r.employee_name||r.employee_code||'—'}</strong><div className="muted-small">{r.employee_code||''}</div></div>},
  {key:'status',label:'الحالة',render:r=><Badge tone={lower(r.status)==='failed'?'red':'orange'}>{r.status||'قيد التنفيذ'}</Badge>},
  {key:'device_count',label:'الأجهزة'},
  {key:'result_summary',label:'النتيجة',render:r=>r.result_summary||'—'},
  {key:'created_at',label:'التاريخ',render:r=>dateTime(r.created_at)}
 ];

 const actions=<><Button onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</Button>{tab==='tasks'&&canTasks&&<Button variant="primary" onClick={openTask}><Plus size={16}/> مهمة جديدة</Button>}</>;

 return <>
  <ModuleShell title="مركز الإجراءات" subtitle="مكان واحد للمهام والموافقات والاستردادات وإجراءات الموارد البشرية حسب صلاحيات المستخدم" icon={CheckSquare2} tabs={tabs} activeTab={tab} onTabChange={setTab} actions={actions} breadcrumbs={[{label:'الإدارة والمتابعة'},{label:'مركز الإجراءات'}]}/>
  <ErrorBox error={error}/>
  {notice&&<div className="training-banner" style={{background:'#eef7ff',color:'#174a7e',borderColor:'#c9def4'}}>{notice}</div>}
  {!!sourceErrors.length&&<div className="error-box"><AlertTriangle size={16}/> تم تحميل المركز جزئيًا: {sourceErrors.join(' · ')}</div>}
  {loading&&<Loading/>}
  {!loading&&!canAny&&<Card><div className="empty">لا توجد صلاحيات إجراءات مرتبطة بهذا الحساب.</div></Card>}

  {!loading&&tab==='overview'&&<>
   <div className="stats-grid">
    <Card><div className="stat-card"><Clock3/><div><span>مهام مفتوحة</span><strong>{openTasks.length}</strong><small>{overdueTasks.length} متأخرة</small></div></div></Card>
    <Card><div className="stat-card"><ShieldCheck/><div><span>موافقات معلقة</span><strong>{genericApprovals.length+pendingPermission.length}</strong><small>{pendingPermission.length} صلاحيات حساسة</small></div></div></Card>
    <Card><div className="stat-card"><WalletCards/><div><span>استردادات مفتوحة</span><strong>{openRefunds.length}</strong><small>{approvedRefunds.length} معتمدة للتنفيذ</small></div></div></Card>
    <Card><div className="stat-card"><Fingerprint/><div><span>متابعة HR</span><strong>{deleteRequests.length}</strong><small>{canAttendance?'مخالفات وحضور وحذف':'غير متاح'}</small></div></div></Card>
   </div>
   {canAttendance&&<Card><div className="card-title"><div><h3>إجراءات الموارد البشرية</h3><small>مراجعة مخالفات الحضور وإقفال الشهر تظل داخل وحدة الحضور مع نفس الصلاحيات الحالية.</small></div></div><div className="finance-actions">{has(user,'attendance_review_violations')&&<Button variant="primary" onClick={()=>go?.('/attendance?tab=reports')}><Fingerprint size={16}/> مراجعة مخالفات الحضور</Button>}{has(user,'attendance_close_month')&&<Button onClick={()=>go?.('/attendance?tab=reports')}><CheckCircle2 size={16}/> إقفال شهر الحضور</Button>}{has(user,'attendance_manage_employees')&&<Button onClick={()=>go?.('/attendance?tab=employees')}><UserCog size={16}/> موظفو الحضور</Button>}</div></Card>}
   <Card><div className="card-title"><div><h3>كل المطلوب الآن</h3><small>مرتبة بالأولوية، ثم تاريخ الاستحقاق أو الطلب.</small></div><Badge tone={queue.length?'orange':'green'}>{queue.length}</Badge></div>{queue.length?<><SmartListFilters storageKey="action-center-queue-filters" search={listFilters.overview.q} onSearchChange={v=>setListFilter('overview','q',v)} searchPlaceholder="ابحث في المطلوب الآن..." totalCount={queue.length} resultCount={filteredQueue.length} onReset={()=>resetListFilter('overview')} filters={[
 {key:'kind',label:'النوع',value:listFilters.overview.kind,onChange:v=>setListFilter('overview','kind',v),options:[{value:'task',label:'مهمة'},{value:'permission',label:'صلاحيات'},{value:'approval',label:'موافقة'},{value:'refund',label:'استرداد'},{value:'attendance_delete',label:'HR'}]},
 {key:'priority',label:'الأولوية',value:listFilters.overview.priority,onChange:v=>setListFilter('overview','priority',v),options:[{value:'urgent',label:'عاجلة'},{value:'high',label:'عالية'},{value:'normal',label:'عادية'},{value:'low',label:'منخفضة'}]}
 ]}/><Table preferenceKey="action-center-queue" defaultPageSize={25} rows={filteredQueue} columns={queueCols} getRowKey={r=>r.id}/></>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد إجراءات معلقة في النطاق الحالي.</div>}</Card>
  </>}

  {!loading&&tab==='tasks'&&canTasks&&<Card><div className="card-title"><div><h3>المهام</h3><small>المهام التشغيلية المفتوحة والمنتهية داخل نطاق الحساب.</small></div><Badge>{tasks.length}</Badge></div><><SmartListFilters storageKey="action-center-tasks-filters" search={listFilters.tasks.q} onSearchChange={v=>setListFilter('tasks','q',v)} searchPlaceholder="ابحث بعنوان المهمة أو المسؤول أو الفرع..." totalCount={tasks.length} resultCount={filteredTasks.length} onReset={()=>resetListFilter('tasks')} filters={[
 {key:'status',label:'الحالة',value:listFilters.tasks.status,onChange:v=>setListFilter('tasks','status',v),options:[{value:'open',label:'مفتوحة'},{value:'in_progress',label:'قيد التنفيذ'},{value:'done',label:'منتهية'},{value:'cancelled',label:'ملغاة'}]},
 {key:'priority',label:'الأولوية',value:listFilters.tasks.priority,onChange:v=>setListFilter('tasks','priority',v),options:[{value:'urgent',label:'عاجلة'},{value:'high',label:'عالية'},{value:'normal',label:'عادية'},{value:'low',label:'منخفضة'}]},
 {key:'assigned',label:'المسؤول',value:listFilters.tasks.assigned,onChange:v=>setListFilter('tasks','assigned',v),options:userOptions},
 {key:'branch',label:'الفرع',value:listFilters.tasks.branch,onChange:v=>setListFilter('tasks','branch',v),options:branchOptions}
 ]}/><Table preferenceKey="action-center-tasks" defaultPageSize={25} rows={filteredTasks} columns={taskCols}/></></Card>}

  {!loading&&tab==='approvals'&&(canGenericApprovals||canPermissionApprovals)&&<Card><div className="card-title"><div><h3>الموافقات المعلقة</h3><small>تغييرات الصلاحيات الحساسة تُطبق فقط عبر مسار الموافقة المخصص، ولا يتم تجاوز منطق الخادم من هنا.</small></div><Badge tone={approvalRows.length?'orange':'green'}>{approvalRows.length}</Badge></div>{approvalRows.length?<><SmartListFilters storageKey="action-center-approvals-filters" search={listFilters.approvals.q} onSearchChange={v=>setListFilter('approvals','q',v)} searchPlaceholder="ابحث بنوع الموافقة أو المستهدف أو مقدم الطلب..." totalCount={approvalRows.length} resultCount={filteredApprovalRows.length} onReset={()=>resetListFilter('approvals')} filters={[
 {key:'kind',label:'المسار',value:listFilters.approvals.kind,onChange:v=>setListFilter('approvals','kind',v),options:[{value:'permission',label:'صلاحيات موظفين'},{value:'generic',label:'موافقات عامة'}]},
 {key:'requester',label:'مقدم الطلب',value:listFilters.approvals.requester,onChange:v=>setListFilter('approvals','requester',v),options:requesterOptions}
 ]}/><Table preferenceKey="action-center-approvals" defaultPageSize={25} rows={filteredApprovalRows} columns={approvalCols}/></>:<div className="success-note">لا توجد موافقات معلقة.</div>}</Card>}

  {!loading&&tab==='refunds'&&canRefunds&&<Card><div className="card-title"><div><h3>الاستردادات المفتوحة</h3><small>اعتماد الطلب أو تنفيذه يتم بنفس صلاحيات وسجل الاسترداد الحالي.</small></div><Badge tone={openRefunds.length?'orange':'green'}>{openRefunds.length}</Badge></div>{openRefunds.length?<><SmartListFilters storageKey="action-center-refunds-filters" search={listFilters.refunds.q} onSearchChange={v=>setListFilter('refunds','q',v)} searchPlaceholder="ابحث بالحجز أو العميل أو السند..." totalCount={openRefunds.length} resultCount={filteredRefunds.length} onReset={()=>resetListFilter('refunds')} filters={[
 {key:'status',label:'الحالة',value:listFilters.refunds.status,onChange:v=>setListFilter('refunds','status',v),options:[{value:'pending',label:'بانتظار الاعتماد'},{value:'approved',label:'معتمد — ينتظر التنفيذ'}]},
 {key:'branch',label:'الفرع',value:listFilters.refunds.branch,onChange:v=>setListFilter('refunds','branch',v),options:branchOptions}
 ]}/><Table preferenceKey="action-center-refunds" defaultPageSize={25} rows={filteredRefunds} columns={refundCols}/></>:<div className="success-note">لا توجد طلبات استرداد مفتوحة.</div>}</Card>}

  {!loading&&tab==='hr'&&canAttendance&&<>
   <Card><div className="card-title"><div><h3>إجراءات الحضور والموارد البشرية</h3><small>العمليات الحساسة تظل داخل صفحاتها الأصلية وتُفتح من هنا مباشرة.</small></div></div><div className="finance-actions">{has(user,'attendance_review_violations')&&<Button variant="primary" onClick={()=>go?.('/attendance?tab=reports')}>مراجعة المخالفات</Button>}{has(user,'attendance_close_month')&&<Button onClick={()=>go?.('/attendance?tab=reports')}>إقفال الشهر</Button>}{has(user,'attendance_manage_schedules')&&<Button onClick={()=>go?.('/attendance?tab=employees')}>الجداول والإجازات</Button>}{has(user,'attendance_manage_policies')&&<Button onClick={()=>go?.('/attendance?tab=policies')}>السياسات</Button>}</div></Card>
   {!!deleteRequests.length&&<Card><div className="card-title"><h3>طلبات حذف موظفي الحضور التي تحتاج متابعة</h3><Badge tone="orange">{deleteRequests.length}</Badge></div><SmartListFilters storageKey="action-center-hr-filters" search={listFilters.hr.q} onSearchChange={v=>setListFilter('hr','q',v)} searchPlaceholder="ابحث باسم الموظف أو الكود أو نتيجة الحذف..." totalCount={deleteRequests.length} resultCount={filteredDeletes.length} onReset={()=>resetListFilter('hr')} filters={[
 {key:'status',label:'الحالة',value:listFilters.hr.status,onChange:v=>setListFilter('hr','status',v),options:[{value:'pending',label:'قيد التنفيذ'},{value:'failed',label:'فشل'}]},
 {key:'branch',label:'الفرع',value:listFilters.hr.branch,onChange:v=>setListFilter('hr','branch',v),options:branchOptions}
 ]}/><Table preferenceKey="action-center-attendance-delete" defaultPageSize={25} rows={filteredDeletes} columns={deleteCols}/></Card>}
  </>}

  <Modal open={taskOpen} onClose={()=>setTaskOpen(false)} title="مهمة جديدة"><form onSubmit={createTask} className="form-grid">
   <Field label="عنوان المهمة"><Input name="title" required/></Field>
   <Field label="الأولوية"><Select name="priority" defaultValue="normal"><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></Select></Field>
   <Field label="المسؤول"><Select name="assigned_to" defaultValue=""><option value="">غير محدد</option>{users.map(u=><option key={u.id} value={u.id}>{u.name||u.username}</option>)}</Select></Field>
   <Field label="الاستحقاق"><Input name="due_at" type="datetime-local"/></Field>
   {isElevated&&<Field label="الفرع"><Select name="branch_id" defaultValue={user?.branch_id||''}><option value="">مهمة عامة</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
   <Field label="الوصف"><Textarea name="description"/></Field>
   <div className="modal-actions"><Button type="button" onClick={()=>setTaskOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy==='new-task'}>{busy==='new-task'?'جاري الحفظ...':'إنشاء المهمة'}</Button></div>
  </form></Modal>

  <Modal open={!!decision} onClose={()=>setDecision(null)} title={decision?.kind==='permission'?'قرار موافقة صلاحيات':'قرار طلب استرداد'}><form onSubmit={saveDecision} className="form-grid">
   <div className="success-note" style={{gridColumn:'1/-1'}}>{decision?.value==='approve'||decision?.value==='approved'?'سيتم اعتماد الطلب بعد التحقق من صلاحيتك على الخادم.':'سيتم رفض الطلب مع الاحتفاظ بسجل القرار.'}</div>
   <Field label="ملاحظة القرار"><Textarea value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder="اختياري"/></Field>
   <div className="modal-actions"><Button type="button" onClick={()=>setDecision(null)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy==='decision'}>{busy==='decision'?'جاري الحفظ...':'تأكيد القرار'}</Button></div>
  </form></Modal>
 </>;
}
