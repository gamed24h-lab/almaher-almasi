import React,{useEffect,useMemo,useState} from 'react';
import {BellRing,CalendarClock,Fingerprint,Package,RefreshCw,Plus,Link2,Wifi,WifiOff,Settings2,ShieldCheck,LayoutDashboard,Users,ServerCog,BarChart3,SlidersHorizontal,Activity,Siren} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Modal,Select,Table} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';
import {DATE_PRESET_OPTIONS,dateRangeForPreset,isWithinDateRange} from '../../lib/dateRangeFilters.js';
import RuleFilterBuilder from '../../components/RuleFilterBuilder.jsx';
import {matchesRuleSet} from '../../lib/ruleFilters.js';
import AttendanceEmployees from './AttendanceEmployees.jsx';
import AttendanceReports from './AttendanceReports.jsx';
import AttendanceDeviceData from './AttendanceDeviceData.jsx';
import AttendancePolicies from './AttendancePolicies.jsx';
import AttendanceNotifications from './AttendanceNotifications.jsx';
import AttendanceIncidents from './AttendanceIncidents.jsx';
import AttendancePreventiveMaintenance from './AttendancePreventiveMaintenance.jsx';
import AttendanceDeviceLifecycle from './AttendanceDeviceLifecycle.jsx';
import AttendanceBiometricReconciliation from './AttendanceBiometricReconciliation.jsx';

const blankDevice={id:'',name:'',serial_number:'',model:'',branch_id:'',connection_mode:'adms',status:'active',data_environment:'training',reason:''};
const blankLink={id:'',device_id:'',device_pin:'',attendance_employee_id:'',staff_user_id:'',display_name:''};
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function dayKey(v){try{const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return ''}}
function online(d){const v=d?.last_command_poll_at||d?.last_seen_at;if(!v)return false;return Date.now()-new Date(v).getTime()<30*60*1000}

export default function Attendance({initialTab=''}){
 const [state,setState]=useState({devices:[],deviceUsers:[],commands:[],deviceShiftTemplates:[],deviceHealth:[],deviceHealthHistory:[],devicePredictiveAlerts:[],healthEvents:[],clockChecks:[],notifications:[],notificationCounts:{},escalationRules:[],escalationEvents:[],deliverySettings:{},deliveries:[],deliveryCounts:{},incidents:[],incidentCounts:{},incidentAnalytics:{},incidentPolicies:[],incidentEvents:[],incidentMaintenance:[],maintenanceActions:[],maintenanceAnalytics:{},preventiveMaintenancePlans:[],preventiveMaintenanceRuns:[],preventiveMaintenanceAlerts:[],preventiveMaintenanceAnalytics:{},deviceAssets:[],deviceAssetEvents:[],deviceLifecycle:[],deviceLifecycleAlerts:[],deviceLifecycleAnalytics:{},watchdog:null,deleteRequests:[],calendarRules:[],policies:[],links:[],logs:[],unlinkedGroups:[],unlinkedTotal:0,employees:[],shiftPeriods:[],biometricProfiles:[],biometricDeviceStates:[],biometricInventory:[],biometricEnrollmentRequests:[],users:[],branches:[],permissions:{},adms:{}}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [deviceOpen,setDeviceOpen]=useState(false),[deviceForm,setDeviceForm]=useState(blankDevice),[deviceBusy,setDeviceBusy]=useState(false);
 const [linkOpen,setLinkOpen]=useState(false),[linkForm,setLinkForm]=useState(blankLink),[linkBusy,setLinkBusy]=useState(false);
 const [listFilters,setListFilters]=useState({devices:{q:'',branch:'',connectivity:'',status:''},links:{q:'',branch:'',device:''},logs:{q:'',branch:'',device:'',employee:'',environment:'',verify:'',statusCode:'',datePreset:'',fromDate:'',toDate:''},unlinked:{q:'',branch:'',device:''}});
 const [logRules,setLogRules]=useState([]),[logRuleMode,setLogRuleMode]=useState('all');
 async function load(){setLoading(true);setError('');try{const out=await api.attendance();setState(out||{})}catch(e){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{load()},[]);

 const branches=state.branches||[],devices=state.devices||[],links=state.links||[],logs=state.logs||[],unlinkedGroups=state.unlinkedGroups||[],employees=state.employees||[],users=state.users||[],deviceUsers=state.deviceUsers||[];
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const deviceUserMap=useMemo(()=>new Map(deviceUsers.map(x=>[String(x.device_id)+'|'+String(x.device_pin),x])),[deviceUsers]);
 const today=dayKey(new Date()),todayLogs=logs.filter(x=>dayKey(x.occurred_at)===today),unlinked=Number(state.unlinkedTotal??unlinkedGroups.reduce((n,x)=>n+Number(x.count||0),0)),onlineCount=devices.filter(online).length;

 const employeeOptions=useMemo(()=>employees.map(e=>({value:String(e.id),label:(e.employee_code?e.employee_code+' — ':'')+(e.name||e.id)})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[employees]);
 const branchOptions=useMemo(()=>branches.map(b=>({value:String(b.id),label:b.name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[branches]);
 const deviceOptions=useMemo(()=>devices.map(d=>({value:String(d.id),label:d.name||d.serial_number||d.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[devices]);
 const verifyOptions=useMemo(()=>[...new Set(logs.map(r=>String(r.verify_code??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[logs]);
 const statusCodeOptions=useMemo(()=>[...new Set(logs.map(r=>String(r.status_code??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[logs]);
 const logRuleFields=useMemo(()=>[
  {key:'employee',label:'الموظف',options:employeeOptions,get:r=>String(r.attendance_employee_id||'')},
  {key:'branch',label:'الفرع',options:branchOptions,get:r=>String(r.branch_id||'')},
  {key:'device',label:'الجهاز',options:deviceOptions,get:r=>String(r.device_id||'')},
  {key:'environment',label:'البيئة',options:[{value:'training',label:'Training'},{value:'production',label:'Production'}],get:r=>String(r.data_environment||'')},
  {key:'verify',label:'رمز التحقق',get:r=>r.verify_code},
  {key:'statusCode',label:'رمز الحالة',get:r=>r.status_code},
  {key:'pin',label:'PIN الجهاز',get:r=>r.device_pin},
  {key:'occurredAt',label:'تاريخ البصمة',type:'date',get:r=>r.occurred_at}
 ],[employeeOptions,branchOptions,deviceOptions]);
 const setListFilter=(scope,key,value)=>setListFilters(x=>({...x,[scope]:{...x[scope],[key]:value}}));
 const resetListFilter=scope=>setListFilters(x=>({...x,[scope]:Object.fromEntries(Object.keys(x[scope]||{}).map(k=>[k,'']))}));
 const applyLogDatePreset=v=>setListFilters(x=>{const current=x.logs||{};if(!v)return {...x,logs:{...current,datePreset:'',fromDate:'',toDate:''}};if(v==='custom')return {...x,logs:{...current,datePreset:v}};const r=dateRangeForPreset(v);return {...x,logs:{...current,datePreset:v,fromDate:r.from,toDate:r.to}}});
 const filteredDevices=useMemo(()=>devices.filter(d=>{
  const f=listFilters.devices||{};
  return (!f.branch||String(d.branch_id)===String(f.branch))
   &&(!f.connectivity||(f.connectivity==='online'?online(d):!online(d)))
   &&(!f.status||String(d.status||'active')===String(f.status))
   &&matchesListQuery(f.q,d.name,d.serial_number,d.model,d.connection_mode,branchMap.get(String(d.branch_id)));
 }),[devices,listFilters.devices,branchMap]);
 const filteredLinks=useMemo(()=>links.filter(r=>{
  const f=listFilters.links||{},emp=employeeMap.get(String(r.attendance_employee_id)),usr=userMap.get(String(r.staff_user_id));
  return (!f.branch||String(r.branch_id)===String(f.branch))
   &&(!f.device||String(r.device_id)===String(f.device))
   &&matchesListQuery(f.q,r.device_pin,r.display_name,emp?.employee_code,emp?.name,usr?.name,deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id)));
 }),[links,listFilters.links,employeeMap,userMap,deviceMap,branchMap]);
 const filteredLogs=useMemo(()=>logs.filter(r=>{
  const f=listFilters.logs||{},emp=employeeMap.get(String(r.attendance_employee_id)),usr=userMap.get(String(r.staff_user_id));
  return (!f.branch||String(r.branch_id)===String(f.branch))
   &&(!f.device||String(r.device_id)===String(f.device))
   &&(!f.employee||String(r.attendance_employee_id)===String(f.employee))
   &&(!f.environment||String(r.data_environment||'')===String(f.environment))
   &&(!f.verify||String(r.verify_code??'')===String(f.verify))
   &&(!f.statusCode||String(r.status_code??'')===String(f.statusCode))
   &&isWithinDateRange(r.occurred_at,f.fromDate,f.toDate)
   &&matchesRuleSet(r,logRules,logRuleFields,logRuleMode)
   &&matchesListQuery(f.q,r.device_pin,r.employee_name,r.serial_number,emp?.employee_code,emp?.name,usr?.name,deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id)));
 }),[logs,listFilters.logs,employeeMap,userMap,deviceMap,branchMap,logRules,logRuleFields,logRuleMode]);
 const filteredUnlinked=useMemo(()=>unlinkedGroups.filter(r=>{
  const f=listFilters.unlinked||{},du=deviceUserMap.get(String(r.device_id)+'|'+String(r.device_pin));
  return (!f.branch||String(r.branch_id)===String(f.branch))
   &&(!f.device||String(r.device_id)===String(f.device))
   &&matchesListQuery(f.q,r.device_pin,du?.name,deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id)));
 }),[unlinkedGroups,listFilters.unlinked,deviceUserMap,deviceMap,branchMap]);

 const tabs=useMemo(()=>[
  {id:'overview',label:'نظرة عامة',icon:LayoutDashboard},
  {id:'employees',label:'الموظفون والجداول',icon:Users,badge:employees.length},
  {id:'devices',label:'الأجهزة والمزامنة',icon:ServerCog,badge:devices.length},
  ...(state.permissions?.manage_biometrics?[{id:'biometric-reconcile',label:'مطابقة البصمات',icon:Fingerprint}]:[]),
  {id:'alerts',label:'التنبيهات',icon:BellRing,badge:Number(state.notificationCounts?.new||0)||null},
  {id:'incidents',label:'الحوادث و SLA',icon:Siren,badge:Number(state.incidentCounts?.open||0)+Number(state.incidentCounts?.acknowledged||0)+Number(state.incidentCounts?.investigating||0)||null},
  {id:'preventive',label:'الصيانة الوقائية',icon:CalendarClock,badge:Number(state.preventiveMaintenanceAnalytics?.overdue||0)+Number(state.preventiveMaintenanceAnalytics?.due_soon||0)||null},
  {id:'lifecycle',label:'الأصول ودورة الحياة',icon:Package,badge:Number(state.deviceLifecycleAnalytics?.replace_soon||0)+Number(state.deviceLifecycleAnalytics?.replacement_review||0)||null},
  {id:'links',label:'الربط والحركات',icon:Activity,badge:unlinked||null},
  ...(state.permissions?.reports?[{id:'reports',label:'التقارير والمخالفات',icon:BarChart3}]:[]),
  ...(state.permissions?.manage_policies?[{id:'policies',label:'السياسات',icon:SlidersHorizontal}]:[])
 ],[employees.length,devices.length,unlinked,state.permissions?.manage_biometrics,state.notificationCounts?.new,state.incidentCounts?.open,state.incidentCounts?.acknowledged,state.incidentCounts?.investigating,state.preventiveMaintenanceAnalytics?.overdue,state.preventiveMaintenanceAnalytics?.due_soon,state.deviceLifecycleAnalytics?.replace_soon,state.deviceLifecycleAnalytics?.replacement_review,state.permissions?.reports,state.permissions?.manage_policies]);
 const [activeTab,setActiveTab]=useModuleTab('almaher:module:attendance',tabs,initialTab||'overview');
 useEffect(()=>{if(initialTab&&tabs.some(t=>t.id===initialTab))setActiveTab(initialTab)},[initialTab,tabs.length]);

 function addDevice(){setDeviceForm({...blankDevice});setDeviceOpen(true)}
 function editDevice(row){setDeviceForm({...blankDevice,...row,branch_id:row.branch_id||'',reason:''});setDeviceOpen(true)}
 async function saveDevice(e){e.preventDefault();setDeviceBusy(true);setError('');try{await api.attendanceWrite({action:'save_device',...deviceForm});setDeviceOpen(false);setNotice('تم حفظ إعداد جهاز البصمة.');await load()}catch(e2){setError(e2.message)}finally{setDeviceBusy(false)}}
 function addLink(seed={}){setLinkForm({...blankLink,device_id:seed.device_id||devices[0]?.id||'',device_pin:seed.device_pin||'',attendance_employee_id:seed.attendance_employee_id||''});setLinkOpen(true)}
 function editLink(row){setLinkForm({...blankLink,...row,attendance_employee_id:row.attendance_employee_id||'',staff_user_id:row.staff_user_id||'',display_name:row.display_name||''});setLinkOpen(true)}
 async function saveLink(e){e.preventDefault();setLinkBusy(true);setError('');try{await api.attendanceWrite({action:'save_link',...linkForm});setLinkOpen(false);setNotice('تم ربط رقم جهاز البصمة بالموظف.');await load()}catch(e2){setError(e2.message)}finally{setLinkBusy(false)}}
 async function deleteLink(row){if(!confirm('حذف ربط هذا الرقم بالموظف؟ سجلات البصمة نفسها لن تُحذف.'))return;setError('');try{await api.attendanceWrite({action:'delete_link',id:row.id});setNotice('تم حذف الربط مع الاحتفاظ بسجل البصمات.');await load()}catch(e){setError(e.message)}}

 const deviceCols=[
  {key:'name',label:'الجهاز',render:r=><div><strong>{r.name}</strong><div className="muted-small">{r.model||'—'} · {r.connection_mode?.toUpperCase()}</div></div>},
  {key:'serial',label:'Serial Number',render:r=><span dir="ltr">{r.serial_number}</span>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||<Badge tone="orange">غير مربوط</Badge>},
  {key:'env',label:'البيئة',render:r=>r.data_environment==='production'?<Badge tone="green">Production</Badge>:<Badge tone="orange">Training</Badge>},
  {key:'connection',label:'الاتصال',render:r=>online(r)?<Badge tone="green"><Wifi size={13}/> متصل / حديث</Badge>:<Badge tone="red"><WifiOff size={13}/> غير متصل</Badge>},
  {key:'seen',label:'آخر اتصال',render:r=>fmtDate(r.last_command_poll_at||r.last_seen_at)},
  {key:'edit',label:'',render:r=>state.permissions?.manage_devices?<Button onClick={()=>editDevice(r)}><Settings2 size={15}/> إعداد</Button>:'—'}
 ];
 const linkCols=[
  {key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.device_id},
  {key:'pin',label:'رقم الموظف بالجهاز',render:r=><strong dir="ltr">{r.device_pin}</strong>},
  {key:'staff',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||userMap.get(String(r.staff_user_id))?.name||r.display_name||<Badge tone="orange">غير مرتبط</Badge>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'actions',label:'',render:r=>state.permissions?.manage_links?<div className="finance-actions"><Button onClick={()=>editLink(r)}>تعديل</Button><Button onClick={()=>deleteLink(r)}>حذف الربط</Button></div>:'—'}
 ];
 const logCols=[
  {key:'employee',label:'الموظف',render:r=><div><strong>{employeeMap.get(String(r.attendance_employee_id))?.name||userMap.get(String(r.staff_user_id))?.name||r.employee_name||('PIN '+r.device_pin)}</strong>{!r.attendance_employee_id&&!r.staff_user_id&&!r.employee_name&&<div className="muted-small">يحتاج ربط موظف</div>}</div>},
  {key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'time',label:'وقت البصمة',render:r=>fmtDate(r.occurred_at)},
  {key:'verify',label:'رمز التحقق',render:r=>r.verify_code??'—'},
  {key:'status',label:'رمز الحالة',render:r=>r.status_code??'—'},
  {key:'env',label:'البيئة',render:r=>r.data_environment==='production'?<Badge tone="green">فعلي</Badge>:<Badge tone="orange">تدريب</Badge>},
  {key:'link',label:'',render:r=>state.permissions?.manage_links&&!r.attendance_employee_id?<Button onClick={()=>addLink({device_id:r.device_id,device_pin:r.device_pin})}><Link2 size={14}/> ربط</Button>:'—'}
 ];
 const unlinkedCols=[
  {key:'pin',label:'PIN غير مربوط',render:r=>{const du=deviceUserMap.get(String(r.device_id)+'|'+String(r.device_pin));return <div><strong dir="ltr">{r.device_pin}</strong><div className="muted-small">{du?.name?('اسم الجهاز: '+du.name):'لا يوجد اسم مسحوب من الجهاز'}</div></div>}},
  {key:'device',label:'الجهاز',render:r=><div><strong>{deviceMap.get(String(r.device_id))?.name||r.serial_number}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))||'—'}</div></div>},
  {key:'count',label:'عدد الحركات',render:r=><Badge tone="orange">{r.count}</Badge>},
  {key:'range',label:'الفترة',render:r=><div><div>{fmtDate(r.oldest_at)}</div><div className="muted-small">حتى {fmtDate(r.newest_at)}</div></div>},
  {key:'action',label:'',render:r=>state.permissions?.manage_links?<Button variant="primary" onClick={()=>addLink({device_id:r.device_id,device_pin:r.device_pin})}><Link2 size={14}/> ربط كل الحركات</Button>:'—'}
 ];

 const actions=<><Button onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</Button>{activeTab==='links'&&state.permissions?.manage_links&&<Button variant="primary" onClick={()=>addLink()} disabled={!devices.length}><Link2 size={16}/> ربط موظف</Button>}{activeTab==='devices'&&state.permissions?.manage_devices&&<Button variant="primary" onClick={addDevice}><Plus size={16}/> إضافة جهاز</Button>}</>;

 return <>
  <ModuleShell title="الحضور والبصمة" subtitle="إدارة الموظفين والجداول والأجهزة والمخالفات والتقارير من أقسام مستقلة بدون صفحة طويلة" icon={Fingerprint} tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={actions} breadcrumbs={[{label:'الموارد البشرية'},{label:'الحضور والبصمة'}]}/>
  <ErrorBox error={error}/>{notice&&<div className="training-banner" style={{background:'#eef7ff',color:'#174a7e',borderColor:'#c9def4'}}>{notice}</div>}

  {activeTab==='overview'&&<>
   <div className="stats-grid"><Card><div className="stat-card"><div><span>الأجهزة</span><strong>{devices.length}</strong></div></div></Card><Card><div className="stat-card"><div><span>متصل الآن</span><strong>{onlineCount}</strong></div></div></Card><Card><div className="stat-card"><div><span>بصمات اليوم</span><strong>{todayLogs.length}</strong></div></div></Card><Card><div className="stat-card"><div><span>غير مرتبطة بموظف</span><strong>{unlinked}</strong></div></div></Card></div>
   <Card><div className="card-title"><div><h3><Fingerprint size={19}/> إعداد ADMS المركزي</h3><small>حالة الاتصال المعتمدة لأجهزة ZKTeco</small></div><Badge tone="green">ZKTeco Push</Badge></div><div className="stats-grid"><Card><div className="stat-card"><div><span>Domain</span><strong dir="ltr">{state.adms?.host||'system.almaheralmasi.sa'}</strong></div></div></Card><Card><div className="stat-card"><div><span>Port</span><strong>{state.adms?.port||443}</strong></div></div></Card><Card><div className="stat-card"><div><span>HTTPS</span><strong>{state.adms?.https===false?'OFF':'ON'}</strong></div></div></Card><Card><div className="stat-card"><div><span>Proxy</span><strong>OFF</strong></div></div></Card></div><div className="success-note"><ShieldCheck size={16}/> النظام يستقبل الحركات، ويمكنه اكتشاف حالة بصمات الأصابع والوجه الموجودة على أجهزة ZKTeco. يتم حفظ PIN ونوع البصمة ورقم الإصبع والحالة فقط، ولا يتم حفظ قالب FP/Face الخام.</div></Card>
   <Card><div className="card-title"><div><h3>آخر الحركات</h3><small>آخر 10 بصمات مستلمة للمتابعة السريعة</small></div><Badge>{Math.min(10,logs.length)}</Badge></div><Table preferenceKey="attendance-overview-logs" defaultPageSize={10} rows={logs.slice(0,10)} columns={logCols}/></Card>
  </>}

  {activeTab==='employees'&&<AttendanceEmployees state={state} onChanged={load} onError={setError} onNotice={setNotice}/>}
  {activeTab==='devices'&&<><AttendanceDeviceData state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenLinks={()=>setActiveTab('links')}/><Card><div className="card-title"><h3>أجهزة البصمة</h3><Badge>{devices.length}</Badge></div><><SmartListFilters storageKey="attendance-devices-filters" search={listFilters.devices.q} onSearchChange={v=>setListFilter('devices','q',v)} searchPlaceholder="ابحث باسم الجهاز أو السيريال أو الموديل..." totalCount={devices.length} resultCount={filteredDevices.length} onReset={()=>resetListFilter('devices')} filters={[
 {key:'branch',label:'الفرع',value:listFilters.devices.branch,onChange:v=>setListFilter('devices','branch',v),options:branchOptions},
 {key:'connectivity',label:'الاتصال',value:listFilters.devices.connectivity,onChange:v=>setListFilter('devices','connectivity',v),options:[{value:'online',label:'متصل / حديث'},{value:'offline',label:'غير متصل'}]},
 {key:'status',label:'الحالة',value:listFilters.devices.status,onChange:v=>setListFilter('devices','status',v),options:[{value:'active',label:'نشط'},{value:'disabled',label:'موقوف'}]}
 ]}/><Table preferenceKey="attendance-devices" defaultPageSize={25} rows={filteredDevices} columns={deviceCols}/></></Card></>}
  {activeTab==='biometric-reconcile'&&state.permissions?.manage_biometrics&&<AttendanceBiometricReconciliation state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenLinks={()=>setActiveTab('links')} onOpenDevices={()=>setActiveTab('devices')}/>}
  {activeTab==='alerts'&&<AttendanceNotifications state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenDevices={()=>setActiveTab('devices')} onOpenLinks={()=>setActiveTab('links')} onOpenPreventive={()=>setActiveTab('preventive')} onOpenLifecycle={()=>setActiveTab('lifecycle')}/>}
  {activeTab==='incidents'&&<AttendanceIncidents state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenDevices={()=>setActiveTab('devices')} onOpenLinks={()=>setActiveTab('links')} onOpenPreventive={()=>setActiveTab('preventive')}/>}
  {activeTab==='preventive'&&<AttendancePreventiveMaintenance state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenIncidents={()=>setActiveTab('incidents')}/>}
  {activeTab==='lifecycle'&&<AttendanceDeviceLifecycle state={state} onChanged={load} onError={setError} onNotice={setNotice} onOpenPreventive={()=>setActiveTab('preventive')} onOpenIncidents={()=>setActiveTab('incidents')}/>}
  {activeTab==='links'&&<><Card><div className="card-title"><div><h3>حركات تحتاج ربط موظف</h3><small>كل PIN يظهر مرة واحدة. عند ربطه بموظف يتم ربط جميع حركاته القديمة تلقائيًا بدون حذف سجل البصمات.</small></div><Badge tone={unlinked?'orange':'green'}>{unlinked}</Badge></div>{state.unlinkedTruncated&&<div className="training-banner">القائمة كبيرة جدًا؛ المعروض ملخص لأول 5000 حركة غير مرتبطة.</div>}{unlinkedGroups.length?<><SmartListFilters storageKey="attendance-unlinked-filters" search={listFilters.unlinked.q} onSearchChange={v=>setListFilter('unlinked','q',v)} searchPlaceholder="ابحث بـ PIN أو اسم الجهاز..." totalCount={unlinkedGroups.length} resultCount={filteredUnlinked.length} onReset={()=>resetListFilter('unlinked')} filters={[
 {key:'branch',label:'الفرع',value:listFilters.unlinked.branch,onChange:v=>setListFilter('unlinked','branch',v),options:branchOptions},
 {key:'device',label:'الجهاز',value:listFilters.unlinked.device,onChange:v=>setListFilter('unlinked','device',v),options:deviceOptions}
 ]}/><Table preferenceKey="attendance-unlinked-groups" defaultPageSize={25} rows={filteredUnlinked} columns={unlinkedCols}/></>:<div className="success-note"><ShieldCheck size={16}/> كل الحركات المستلمة مرتبطة بموظفين.</div>}</Card><Card><div className="card-title"><h3>ربط أرقام الأجهزة بالموظفين</h3><Badge>{links.length}</Badge></div><><SmartListFilters storageKey="attendance-links-filters" search={listFilters.links.q} onSearchChange={v=>setListFilter('links','q',v)} searchPlaceholder="ابحث بالموظف أو PIN أو الجهاز..." totalCount={links.length} resultCount={filteredLinks.length} onReset={()=>resetListFilter('links')} filters={[
 {key:'branch',label:'الفرع',value:listFilters.links.branch,onChange:v=>setListFilter('links','branch',v),options:branchOptions},
 {key:'device',label:'الجهاز',value:listFilters.links.device,onChange:v=>setListFilter('links','device',v),options:deviceOptions}
 ]}/><Table preferenceKey="attendance-links" defaultPageSize={25} rows={filteredLinks} columns={linkCols}/></></Card><Card><div className="card-title"><h3>الحركات المستلمة</h3><Badge>{logs.length}</Badge></div><><SmartListFilters storageKey="attendance-logs-filters" search={listFilters.logs.q} onSearchChange={v=>setListFilter('logs','q',v)} searchPlaceholder="ابحث بالموظف أو PIN أو السيريال..." totalCount={logs.length} resultCount={filteredLogs.length} onReset={()=>resetListFilter('logs')} filters={[
 {key:'employee',label:'الموظف',value:listFilters.logs.employee,onChange:v=>setListFilter('logs','employee',v),options:employeeOptions},
 {key:'branch',label:'الفرع',value:listFilters.logs.branch,onChange:v=>setListFilter('logs','branch',v),options:branchOptions},
 {key:'device',label:'الجهاز',value:listFilters.logs.device,onChange:v=>setListFilter('logs','device',v),options:deviceOptions},
 {key:'environment',label:'البيئة',value:listFilters.logs.environment,onChange:v=>setListFilter('logs','environment',v),options:[{value:'training',label:'Training'},{value:'production',label:'Production'}]},
 {key:'verify',label:'رمز التحقق',value:listFilters.logs.verify,onChange:v=>setListFilter('logs','verify',v),options:verifyOptions},
 {key:'statusCode',label:'رمز الحالة',value:listFilters.logs.statusCode,onChange:v=>setListFilter('logs','statusCode',v),options:statusCodeOptions},
 {key:'datePreset',label:'الفترة',value:listFilters.logs.datePreset,onChange:applyLogDatePreset,options:DATE_PRESET_OPTIONS},
 {key:'fromDate',label:'من تاريخ',value:listFilters.logs.fromDate,onChange:v=>setListFilters(x=>({...x,logs:{...x.logs,fromDate:v,datePreset:v||x.logs?.toDate?'custom':''}})),render:()=> <Input type="date" value={listFilters.logs.fromDate} onChange={e=>setListFilters(x=>({...x,logs:{...x.logs,fromDate:e.target.value,datePreset:e.target.value||x.logs?.toDate?'custom':''}}))} advanced={{getValue:()=>({rules:logRules,mode:logRuleMode}),onApply:v=>{setLogRules(Array.isArray(v?.rules)?v.rules:[]);setLogRuleMode(v?.mode==='any'?'any':'all')},render:()=> <RuleFilterBuilder fields={logRuleFields} rules={logRules} mode={logRuleMode} onRulesChange={setLogRules} onModeChange={setLogRuleMode}/>}}/>},
 {key:'toDate',label:'إلى تاريخ',value:listFilters.logs.toDate,onChange:v=>setListFilters(x=>({...x,logs:{...x.logs,toDate:v,datePreset:x.logs?.fromDate||v?'custom':''}})),render:()=> <Input type="date" value={listFilters.logs.toDate} onChange={e=>setListFilters(x=>({...x,logs:{...x.logs,toDate:e.target.value,datePreset:x.logs?.fromDate||e.target.value?'custom':''}}))}/>}
 ]}/><Table preferenceKey="attendance-logs" defaultPageSize={25} rows={filteredLogs} columns={logCols}/></></Card></>}
  {activeTab==='reports'&&state.permissions?.reports&&<AttendanceReports state={state} onError={setError} onNotice={setNotice}/>}
  {activeTab==='policies'&&state.permissions?.manage_policies&&<AttendancePolicies state={state} onChanged={load} onError={setError} onNotice={setNotice}/>}

  <Modal open={deviceOpen} onClose={()=>setDeviceOpen(false)} title={deviceForm.id?'تعديل جهاز البصمة':'إضافة جهاز بصمة'} wide><form onSubmit={saveDevice} className="form-grid">
   <Field label="اسم الجهاز"><Input value={deviceForm.name||''} onChange={e=>setDeviceForm(x=>({...x,name:e.target.value}))} placeholder="مثال: بصمة فرع تبوك" required/></Field>
   <Field label="Serial Number"><Input dir="ltr" value={deviceForm.serial_number||''} onChange={e=>setDeviceForm(x=>({...x,serial_number:e.target.value.toUpperCase()}))} required/></Field>
   <Field label="الموديل"><Input value={deviceForm.model||''} onChange={e=>setDeviceForm(x=>({...x,model:e.target.value}))} placeholder="MB20-VL"/></Field>
   <Field label="الفرع"><Select value={deviceForm.branch_id||''} onChange={e=>setDeviceForm(x=>({...x,branch_id:e.target.value}))}><option value="">غير مربوط بعد</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
   <Field label="طريقة الاتصال"><Select value={deviceForm.connection_mode||'adms'} onChange={e=>setDeviceForm(x=>({...x,connection_mode:e.target.value}))}><option value="adms">ADMS / Push</option><option value="agent">Agent</option><option value="sdk">SDK</option><option value="api">API</option></Select></Field>
   <Field label="الحالة"><Select value={deviceForm.status||'active'} onChange={e=>setDeviceForm(x=>({...x,status:e.target.value}))}><option value="active">نشط</option><option value="disabled">موقوف</option></Select></Field>
   <Field label="بيئة البيانات"><Select value={deviceForm.data_environment||'training'} onChange={e=>setDeviceForm(x=>({...x,data_environment:e.target.value}))}><option value="training">Training — اختبار</option><option value="production">Production — فعلي</option></Select></Field>
   <Field label="سبب التعديل"><Input value={deviceForm.reason||''} onChange={e=>setDeviceForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
   <div className="modal-actions"><Button type="button" onClick={()=>setDeviceOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={deviceBusy}>{deviceBusy?'جاري الحفظ...':'حفظ الجهاز'}</Button></div>
  </form></Modal>
  <Modal open={linkOpen} onClose={()=>setLinkOpen(false)} title="ربط موظف بجهاز البصمة" wide><form onSubmit={saveLink} className="form-grid">
   <Field label="الجهاز"><Select value={linkForm.device_id||''} onChange={e=>setLinkForm(x=>({...x,device_id:e.target.value}))} required><option value="">اختر الجهاز</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name} — {d.serial_number}</option>)}</Select></Field>
   <Field label="رقم الموظف داخل الجهاز (PIN)"><Input dir="ltr" value={linkForm.device_pin||''} onChange={e=>setLinkForm(x=>({...x,device_pin:e.target.value}))} required/></Field>
   <Field label="موظف الحضور"><Select value={linkForm.attendance_employee_id||''} onChange={e=>{const emp=employeeMap.get(String(e.target.value));setLinkForm(x=>({...x,attendance_employee_id:e.target.value,staff_user_id:emp?.staff_user_id||'',display_name:emp?.name||''}))}}><option value="">اختر موظف الحضور</option>{employees.filter(x=>x.status==='active').map(emp=><option key={emp.id} value={emp.id}>{emp.employee_code} — {emp.name}</option>)}</Select></Field>
   <Field label="حساب النظام القديم (اختياري)"><Select value={linkForm.staff_user_id||''} disabled={!!linkForm.attendance_employee_id} onChange={e=>{const u=userMap.get(String(e.target.value));setLinkForm(x=>({...x,staff_user_id:e.target.value,display_name:u?.name||x.display_name}))}}><option value="">بدون حساب نظام</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} — {branchMap.get(String(u.branch_id))||'إدارة عامة'}</option>)}</Select></Field>
   <Field label="الاسم اليدوي"><Input value={linkForm.display_name||''} disabled={!!linkForm.attendance_employee_id} onChange={e=>setLinkForm(x=>({...x,display_name:e.target.value}))} placeholder="للسجلات القديمة فقط"/></Field>
   <div className="modal-actions"><Button type="button" onClick={()=>setLinkOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={linkBusy}>{linkBusy?'جاري الحفظ...':'حفظ الربط'}</Button></div>
  </form></Modal>
 </>;
}
