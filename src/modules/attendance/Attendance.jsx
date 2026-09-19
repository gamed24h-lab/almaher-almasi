import React,{useEffect,useMemo,useState} from 'react';
import {Fingerprint,RefreshCw,Plus,Link2,Wifi,WifiOff,Settings2,ShieldCheck} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Modal,PageHeader,Select,Table} from '../../components/UI.jsx';
import AttendanceEmployees from './AttendanceEmployees.jsx';
import AttendanceReports from './AttendanceReports.jsx';
import AttendanceDeviceData from './AttendanceDeviceData.jsx';

const blankDevice={id:'',name:'',serial_number:'',model:'',branch_id:'',connection_mode:'adms',status:'active',data_environment:'training',reason:''};
const blankLink={id:'',device_id:'',device_pin:'',attendance_employee_id:'',staff_user_id:'',display_name:''};
const text=v=>String(v??'').trim();
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function dayKey(v){try{const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return ''}}
function online(d){const v=d?.last_command_poll_at||d?.last_seen_at;if(!v)return false;return Date.now()-new Date(v).getTime()<30*60*1000}

export default function Attendance(){
 const [state,setState]=useState({devices:[],deviceUsers:[],commands:[],links:[],logs:[],employees:[],shiftPeriods:[],users:[],branches:[],permissions:{},adms:{}}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [deviceOpen,setDeviceOpen]=useState(false),[deviceForm,setDeviceForm]=useState(blankDevice),[deviceBusy,setDeviceBusy]=useState(false);
 const [linkOpen,setLinkOpen]=useState(false),[linkForm,setLinkForm]=useState(blankLink),[linkBusy,setLinkBusy]=useState(false);
 async function load(){setLoading(true);setError('');try{const out=await api.attendance();setState(out||{})}catch(e){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{load()},[]);
 const branches=state.branches||[],devices=state.devices||[],links=state.links||[],logs=state.logs||[],employees=state.employees||[],users=state.users||[];
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const today=dayKey(new Date()),todayLogs=logs.filter(x=>dayKey(x.occurred_at)===today),unlinked=logs.filter(x=>!x.attendance_employee_id&&!x.staff_user_id&&!x.employee_name).length,onlineCount=devices.filter(online).length;
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
 return <><PageHeader title="الحضور والبصمة" subtitle="ربط أجهزة ZKTeco والفروع واستقبال البصمات عبر ADMS بدون حفظ قالب البصمة أو صورة الوجه" actions={<><Button onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</Button>{state.permissions?.manage_links&&<Button onClick={addLink} disabled={!devices.length}><Link2 size={16}/> ربط موظف</Button>}{state.permissions?.manage_devices&&<Button variant="primary" onClick={addDevice}><Plus size={16}/> إضافة جهاز</Button>}</>}/>
 <ErrorBox error={error}/>{notice&&<div className="training-banner" style={{background:'#eef7ff',color:'#174a7e',borderColor:'#c9def4'}}>{notice}</div>}
 <Card><div className="card-title"><div><h3><Fingerprint size={19}/> إعداد ADMS المركزي</h3><small>الإعداد المعتمد بعد نشر هذه المرحلة على Stable</small></div><Badge tone="green">ZKTeco Push</Badge></div><div className="stats-grid"><Card><div className="stat-card"><div><span>Domain</span><strong dir="ltr">{state.adms?.host||'system.almaheralmasi.sa'}</strong></div></div></Card><Card><div className="stat-card"><div><span>Port</span><strong>{state.adms?.port||443}</strong></div></div></Card><Card><div className="stat-card"><div><span>HTTPS</span><strong>{state.adms?.https===false?'OFF':'ON'}</strong></div></div></Card><Card><div className="stat-card"><div><span>Proxy</span><strong>OFF</strong></div></div></Card></div><div className="success-note"><ShieldCheck size={16}/> النظام يستقبل سجلات ATTLOG فقط. قوالب البصمة وبيانات FP/الوجه لا يتم حفظها في قاعدة بيانات الماهر.</div></Card>
 <div className="stats-grid"><Card><div className="stat-card"><div><span>الأجهزة</span><strong>{devices.length}</strong></div></div></Card><Card><div className="stat-card"><div><span>متصل الآن</span><strong>{onlineCount}</strong></div></div></Card><Card><div className="stat-card"><div><span>بصمات اليوم</span><strong>{todayLogs.length}</strong></div></div></Card><Card><div className="stat-card"><div><span>غير مرتبطة بموظف</span><strong>{unlinked}</strong></div></div></Card></div>
 {state.permissions?.reports&&<AttendanceReports state={state} onError={setError} onNotice={setNotice}/>}<AttendanceEmployees state={state} onChanged={load} onError={setError} onNotice={setNotice}/>
 <AttendanceDeviceData state={state} onChanged={load} onError={setError} onNotice={setNotice}/>
 <Card><div className="card-title"><h3>أجهزة البصمة</h3><Badge>{devices.length}</Badge></div><Table rows={devices} columns={deviceCols}/></Card>
 <Card><div className="card-title"><h3>ربط أرقام الأجهزة بالموظفين</h3><Badge>{links.length}</Badge></div><Table rows={links} columns={linkCols}/></Card>
 <Card><div className="card-title"><h3>آخر البصمات المستلمة</h3><Badge>{logs.length}</Badge></div><Table rows={logs} columns={logCols}/></Card>
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
