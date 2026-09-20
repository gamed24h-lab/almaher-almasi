import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Activity,Clock3,Database,DownloadCloud,Fingerprint,History,Plus,RefreshCw,ShieldCheck,Trash2,UploadCloud,UserPlus,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function ageState(d){
 const v=d.last_command_poll_at||d.last_seen_at;if(!v)return {tone:'red',label:'لم يتصل'};
 const ms=Date.now()-new Date(v).getTime();
 if(ms<3*60*1000)return {tone:'green',label:'متصل الآن'};
 if(ms<30*60*1000)return {tone:'orange',label:'اتصال حديث'};
 return {tone:'red',label:'غير متصل'};
}
function cmdLabel(v){return v==='success'?'تم':v==='failed'?'فشل':v==='sent'?'أرسل للجهاز':v==='queued'?'بانتظار الجهاز':v||'—'}
function cmdName(v,meta){const s=meta?.history_strategy;return v==='sync_info'?'معلومات الجهاز':v==='diagnostic_info'?'تشخيص الجهاز':v==='sync_users'?'الموظفون':v==='sync_attlog'?'سجل الحضور':v==='history_attlog'?(s==='range_iso'?'الحركات القديمة — توافق 1':s==='plain'?'الحركات القديمة — توافق 2':'الحركات القديمة'):v==='history_attlog_replay'?'الحركات القديمة — إعادة إرسال':v==='push_user'?'رفع موظف':v==='verify_user'?'تأكيد الموظف':v||'مزامنة'}
function cmdReason(c){
 if(c?.status!=='failed')return '';
 const code=Number(c?.result_code),s=c?.metadata?.history_strategy;
 if(c?.command_type==='history_attlog'&&code===-3){
  if(s==='plain')return 'الجهاز لا يدعم DATA QUERY لسجل الحضور (Code -3). النظام ينتقل تلقائيًا لطريقة إعادة الإرسال عبر Push.';
  if(s==='range_iso')return 'الجهاز رفض صيغة الوقت البديلة أيضًا (Code -3). النظام يجرب طلب السجل بدون فترة زمنية.';
  return 'الجهاز رفض صيغة الفترة الأولى (Code -3). النظام يجرب تلقائيًا صيغة وقت متوافقة أخرى.';
 }
 if(c?.command_type==='history_attlog_replay'&&c?.status==='failed')return 'فشل أمر CHECK الخاص بإعادة إرسال سجل الحضور. رمز الجهاز: '+String(c?.result_code??'—');
 return c?.result_code==null?'تعذر تنفيذ الأمر ولم يرسل الجهاز رمز نتيجة.':'رمز نتيجة الجهاز: '+String(c.result_code);
}
function historyProfile(d){
 const p=d?.metadata?.history_profile||{};
 if(p.preferred_mode==='push_replay')return {tone:'blue',label:'Push Replay',detail:'السجل التاريخي يُعاد إرساله عبر ADMS Push',last:p.last_success_at||p.last_probe_at};
 if(p.preferred_mode==='data_query')return {tone:'green',label:'DATA QUERY',detail:p.preferred_strategy==='range_iso'?'صيغة وقت ISO':p.preferred_strategy==='plain'?'بدون فترة زمنية':'صيغة الفترة القياسية',last:p.last_success_at};
 return {tone:'orange',label:'تلقائي',detail:'لم يتم تثبيت طريقة التوافق بعد',last:null};
}
const blankUser={device_id:'',device_pin:'',name:'',privilege:0,card_number:'',group_no:'1',timezone_raw:'0000000100000000',verify_mode:0};
const blankShift={id:'',device_id:'',name:'',start_time:'08:00',end_time:'17:00',grace_minutes:10,sequence_no:1,active:true,notes:''};

export default function AttendanceDeviceData({state,onChanged,onError,onNotice}){
 const [busy,setBusy]=useState(''),[watching,setWatching]=useState(''),[importBusy,setImportBusy]=useState(''),[historyBusy,setHistoryBusy]=useState(''),[diagBusy,setDiagBusy]=useState(''),[diagOpen,setDiagOpen]=useState(false),[diagDeviceId,setDiagDeviceId]=useState(''),[userOpen,setUserOpen]=useState(false),[userForm,setUserForm]=useState(blankUser),[userBusy,setUserBusy]=useState(false);
 const [shiftOpen,setShiftOpen]=useState(false),[shiftDevice,setShiftDevice]=useState(null),[shiftForm,setShiftForm]=useState(blankShift),[shiftBusy,setShiftBusy]=useState(false);
 const timerRef=useRef(null),attemptRef=useRef(0);
 const devices=state.devices||[],deviceHealth=state.deviceHealth||[],deviceUsers=state.deviceUsers||[],commands=state.commands||[],links=state.links||[],deviceShiftTemplates=state.deviceShiftTemplates||[];
 const usersByDevice=useMemo(()=>{const m=new Map();for(const u of deviceUsers){const k=String(u.device_id),a=m.get(k)||[];a.push(u);m.set(k,a)}return m},[deviceUsers]);
 const commandsByDevice=useMemo(()=>{const m=new Map();for(const c of commands){const k=String(c.device_id),a=m.get(k)||[];a.push(c);m.set(k,a)}return m},[commands]);
 const shiftsByDevice=useMemo(()=>{const m=new Map();for(const x of deviceShiftTemplates){const k=String(x.device_id),a=m.get(k)||[];a.push(x);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no));return m},[deviceShiftTemplates]);
 const healthByDevice=useMemo(()=>new Map(deviceHealth.map(x=>[String(x.device_id),x])),[deviceHealth]);
 const linkMap=useMemo(()=>new Map(links.map(l=>[String(l.device_id)+'|'+String(l.device_pin),l])),[links]);
 const diagDevice=devices.find(x=>String(x.id)===String(diagDeviceId))||null,diagHealth=healthByDevice.get(String(diagDeviceId))||null,diagCommand=(commandsByDevice.get(String(diagDeviceId))||[]).find(x=>x.command_type==='diagnostic_info')||null;

 useEffect(()=>{
  if(!watching)return;
  const rows=(commandsByDevice.get(String(watching))||[]).slice(0,4);
  const hasPending=rows.some(c=>c.status==='queued'||c.status==='sent');
  if(rows.length&&!hasPending){setWatching('');return}
  clearTimeout(timerRef.current);
  timerRef.current=setTimeout(async()=>{attemptRef.current+=1;await onChanged?.();if(attemptRef.current>=20)setWatching('')},2000);
  return()=>clearTimeout(timerRef.current);
 },[watching,commands,onChanged,commandsByDevice]);

 async function sync(d){
  setBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'sync_device_data',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'بدأ سحب بيانات الجهاز. ستتحدث الحالة تلقائيًا.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function importAll(d){
  if(!confirm('استيراد كل الموظفين المسحوبين من هذا الجهاز كموظفي حضور وربط الـ PIN تلقائيًا؟'))return;
  setImportBusy(d.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'import_device_users',device_id:d.id});
   onNotice?.(out?.message||('تم استيراد '+String(out?.imported||0)+' موظف وربطهم بالجهاز. المتخطى: '+String(out?.skipped||0)+'.'));await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setImportBusy('')}
 }
 async function importHistory(d){
  if(!confirm('استيراد وربط كل الحركات القديمة الموجودة على هذا الجهاز؟ العملية آمنة من التكرار لأن كل حركة لها مفتاح منع تكرار.'))return;
  setHistoryBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'import_historical_attendance',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'تم بدء استيراد الحركات القديمة وربطها بالموظفين.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setHistoryBusy('')}
 }
 async function diagnose(d){
  setDiagDeviceId(d.id);setDiagOpen(true);setDiagBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'diagnose_device',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'تم بدء تشخيص الجهاز.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setDiagBusy('')}
 }
 function editUser(u){setUserForm({...blankUser,...u,device_id:u.device_id,device_pin:u.device_pin,privilege:u.privilege??0,group_no:u.group_no||'1',timezone_raw:u.timezone_raw||'0000000100000000',verify_mode:u.verify_mode??0});setUserOpen(true)}
 async function saveAndPush(e){
  e.preventDefault();setUserBusy(true);onError?.('');attemptRef.current=0;
  try{
   await api.attendanceWrite({action:'push_device_user',...userForm});
   setUserOpen(false);setWatching(userForm.device_id);onNotice?.('تم تجهيز تعديل الموظف ورفعه للجهاز، ثم قراءة بياناته مرة أخرى للتأكد.');await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setUserBusy(false)}
 }

 function openShifts(d){setShiftDevice(d);setShiftForm({...blankShift,device_id:d.id,sequence_no:(shiftsByDevice.get(String(d.id))||[]).length+1});setShiftOpen(true)}
 function newShift(){setShiftForm({...blankShift,device_id:shiftDevice?.id||'',sequence_no:(shiftsByDevice.get(String(shiftDevice?.id))||[]).length+1})}
 function editShift(x){setShiftForm({...blankShift,...x,start_time:String(x.start_time||'').slice(0,5),end_time:String(x.end_time||'').slice(0,5),active:x.active!==false})}
 async function saveShift(e){
  e.preventDefault();setShiftBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_device_shift_template',...shiftForm});
   onNotice?.('تم حفظ فترة الدوام في إعدادات الجهاز وتحديث أي موظف مرتبط بهذه الفترة.');await onChanged?.();newShift();
  }catch(err){onError?.(err.message)}finally{setShiftBusy(false)}
 }
 async function deleteShift(x){
  if(!confirm('حذف هذه الفترة من إعدادات الجهاز؟ الموظفون الذين كانوا يستخدمونها سيحتفظون بنفس الأوقات كفترة مخصصة.'))return;
  setShiftBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'delete_device_shift_template',device_id:x.device_id,id:x.id});onNotice?.('تم حذف الفترة من الجهاز مع الاحتفاظ بأوقات الموظفين كفترات مخصصة.');await onChanged?.();if(shiftForm.id===x.id)newShift()}catch(err){onError?.(err.message)}finally{setShiftBusy(false)}
 }

 const cols=[
  {key:'device',label:'الجهاز',render:d=><div><strong>{d.name}</strong><div className="muted-small">{d.model||'—'} · {d.serial_number}</div></div>},
  {key:'status',label:'الاتصال',render:d=>{const x=ageState(d);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">{fmt(d.last_command_poll_at||d.last_seen_at)}</div></div>}},
  {key:'health',label:'صحة الجهاز',render:d=>{const h=healthByDevice.get(String(d.id));return h?<div><Badge tone={h.tone||'orange'}>{h.label||'غير معروف'}</Badge><div className="muted-small" style={{marginTop:3}}>آخر حركة: {fmt(h.last_log_at)}</div>{h.issues?.[0]&&<div className="muted-small">{h.issues[0]}</div>}</div>:<Badge tone="orange">جارٍ التقييم</Badge>}},
  {key:'shifts',label:'فترات الدوام',render:d=>{const rows=shiftsByDevice.get(String(d.id))||[];return rows.length?<div style={{display:'grid',gap:2}}>{rows.slice(0,3).map(x=><span key={x.id} className="muted-small"><Clock3 size={12}/> {x.name}: {String(x.start_time).slice(0,5)} — {String(x.end_time).slice(0,5)}</span>)}{rows.length>3&&<span className="muted-small">+ {rows.length-3} فترات أخرى</span>}</div>:<Badge tone="orange">غير محددة</Badge>}},
  {key:'reported',label:'الموجود بالجهاز',render:d=><div><strong>{d.reported_user_count??'—'} موظف</strong><div className="muted-small">{d.reported_fp_count??'—'} قالب بصمة · {d.reported_face_count??'—'} وجه</div><div className="muted-small">{d.reported_transaction_count??'—'} حركة معلنة</div></div>},
  {key:'synced',label:'المسحوب للنظام',render:d=>{const us=usersByDevice.get(String(d.id))||[],imported=us.filter(u=>linkMap.get(String(d.id)+'|'+String(u.device_pin))?.attendance_employee_id).length;return <div><strong>{us.length} موظف مسحوب</strong><div className="muted-small">{imported} مستورد كموظف حضور</div></div>}},
  {key:'compat',label:'توافق سجل الحضور',render:d=>{const p=historyProfile(d);return <div><Badge tone={p.tone}>{p.label}</Badge><div className="muted-small" style={{marginTop:3}}>{p.detail}</div>{p.last&&<div className="muted-small">آخر نجاح: {fmt(p.last)}</div>}</div>}},
  {key:'command',label:'حالة آخر أوامر',render:d=>{const rows=(commandsByDevice.get(String(d.id))||[]).slice(0,4);return rows.length?<div style={{display:'grid',gap:6}}>{rows.map(c=><div key={c.id} style={{display:'flex',gap:8,alignItems:'flex-start',justifyContent:'space-between'}}><div><span className="muted-small">{cmdName(c.command_type,c.metadata)}</span>{c.status==='failed'&&<div className="muted-small" style={{marginTop:2,maxWidth:260}}>{cmdReason(c)}</div>}</div><Badge tone={c.status==='success'?'green':c.status==='failed'?'red':'orange'}>{cmdLabel(c.status)}</Badge></div>)}</div>:'—'}},
  {key:'action',label:'',render:d=>{const active=busy===d.id||watching===d.id,count=(usersByDevice.get(String(d.id))||[]).length;return <div className="finance-actions">{state.permissions?.manage_devices&&<Button onClick={()=>diagnose(d)} disabled={diagBusy===d.id}><Activity size={15}/>{diagBusy===d.id?' جاري التشخيص...':' تشخيص الجهاز'}</Button>}{state.permissions?.manage_devices&&<Button onClick={()=>openShifts(d)}><Clock3 size={15}/> فترات الدوام</Button>}{state.permissions?.manage_devices&&<Button variant="primary" onClick={()=>sync(d)} disabled={active}><DownloadCloud size={15}/>{active?' جاري السحب...':' سحب بيانات الجهاز'}</Button>}{count>0&&state.permissions?.manage_employees&&state.permissions?.manage_links&&<Button onClick={()=>importAll(d)} disabled={importBusy===d.id}><UserPlus size={15}/>{importBusy===d.id?' جاري الاستيراد...':' استيراد الموظفين'}</Button>}{state.permissions?.manage_devices&&state.permissions?.manage_links&&<Button onClick={()=>importHistory(d)} disabled={historyBusy===d.id||active}><History size={15}/>{historyBusy===d.id?' جاري الاستيراد...':historyProfile(d).label==='Push Replay'?' إعادة إرسال الحركات القديمة':' استيراد الحركات القديمة'}</Button>}</div>}}
 ];
 const userCols=[
  {key:'pin',label:'PIN',render:u=><strong dir="ltr">{u.device_pin}</strong>},
  {key:'name',label:'الاسم',render:u=>u.name||'بدون اسم'},
  {key:'device',label:'الجهاز',render:u=>devices.find(d=>String(d.id)===String(u.device_id))?.name||u.serial_number},
  {key:'privilege',label:'الصلاحية',render:u=>u.privilege===14?<Badge tone="orange">مسؤول جهاز</Badge>:<Badge>مستخدم</Badge>},
  {key:'card',label:'الكارت',render:u=>u.card_number||'—'},
  {key:'imported',label:'داخل موظفي الحضور',render:u=>linkMap.get(String(u.device_id)+'|'+String(u.device_pin))?.attendance_employee_id?<Badge tone="green">مستورد ومربوط</Badge>:<Badge tone="orange">غير مستورد</Badge>},
  {key:'last',label:'آخر مزامنة',render:u=>fmt(u.last_seen_at)},
  {key:'action',label:'',render:u=>state.permissions?.manage_devices?<Button onClick={()=>editUser(u)}><UploadCloud size={14}/> تعديل ورفع</Button>:'—'}
 ];
 const shiftCols=[
  {key:'name',label:'الفترة',render:x=><strong>{x.name}</strong>},
  {key:'time',label:'الوقت',render:x=><span dir="ltr">{String(x.start_time).slice(0,5)} — {String(x.end_time).slice(0,5)}</span>},
  {key:'grace',label:'السماح',render:x=>String(x.grace_minutes)+' دقيقة'},
  {key:'actions',label:'',render:x=><div className="finance-actions"><Button onClick={()=>editShift(x)}>تعديل</Button><Button onClick={()=>deleteShift(x)} disabled={shiftBusy}><Trash2 size={14}/> حذف</Button></div>}
 ];

 const healthCounts={green:deviceHealth.filter(x=>x.tone==='green').length,orange:deviceHealth.filter(x=>x.tone==='orange').length,red:deviceHealth.filter(x=>x.tone==='red').length,gray:deviceHealth.filter(x=>x.tone==='gray').length};
 return <><Card><div className="card-title"><div><h3><ShieldCheck size={19}/> صحة أجهزة البصمة</h3><small>متابعة الاتصال، آخر حركة، أخطاء الأوامر، الحركات غير المربوطة وطريقة توافق السجل لكل جهاز.</small></div><Badge tone={healthCounts.red?'red':healthCounts.orange?'orange':'green'}>{healthCounts.red?'توجد أجهزة غير متصلة':healthCounts.orange?'توجد تنبيهات':'الأجهزة بحالة جيدة'}</Badge></div>
 <div className="stats-grid"><Card><div className="stat-card"><div><span>سليم</span><strong>{healthCounts.green}</strong></div></div></Card><Card><div className="stat-card"><div><span>يحتاج متابعة</span><strong>{healthCounts.orange}</strong></div></div></Card><Card><div className="stat-card"><div><span>غير متصل</span><strong>{healthCounts.red}</strong></div></div></Card><Card><div className="stat-card"><div><span>موقوف</span><strong>{healthCounts.gray}</strong></div></div></Card></div></Card>
 <Card><div className="card-title"><div><h3><Database size={19}/> بيانات الأجهزة والمزامنة</h3><small>إدارة فترات الدوام لكل جهاز، سحب الموظفين والحركات، وتعديل بيانات المستخدمين ورفعها.</small></div><Badge tone="blue"><RefreshCw size={13}/> ADMS Sync</Badge></div>
 {watching&&<div className="success-note" style={{marginBottom:12}}><RefreshCw size={16}/> جاري متابعة أوامر الجهاز تلقائيًا… لا تحتاج تضغط تحديث.</div>}
 <Table preferenceKey="attendance-device-data" defaultPageSize={25} rows={devices} columns={cols}/></Card>

 {deviceUsers.length>0&&<Card><div className="card-title"><div><h3><Users size={19}/> الموظفون المسحوبون من الأجهزة</h3><small>يمكن تعديل الاسم والصلاحية والكارت والبيانات التي يدعمها جهاز ZKTeco، ثم رفعها للجهاز.</small></div><Badge>{deviceUsers.length}</Badge></div><Table preferenceKey="attendance-device-users" defaultPageSize={25} rows={deviceUsers} columns={userCols}/><div className="success-note"><Fingerprint size={16}/> قالب البصمة نفسه يظل داخل جهاز ZKTeco ولا يتم نسخه إلى قاعدة البيانات.</div></Card>}

 <Modal open={diagOpen} onClose={()=>setDiagOpen(false)} title={'تشخيص الجهاز'+(diagDevice?' — '+diagDevice.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>الحالة</span><strong>{diagHealth?.label||'جارٍ التقييم'}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>آخر اتصال</span><strong style={{fontSize:15}}>{fmt(diagHealth?.last_seen_at||diagDevice?.last_command_poll_at||diagDevice?.last_seen_at)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>آخر حركة</span><strong style={{fontSize:15}}>{fmt(diagHealth?.last_log_at)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>غير مربوطة</span><strong>{diagHealth?.unlinked_count??0}</strong></div></div></Card>
   </div>
   <Card><div className="card-title"><div><h3><Activity size={18}/> نتيجة التشخيص</h3><small>الاختبار يرسل INFO فقط ولا يعدّل الموظفين أو سجل الحضور.</small></div><Badge tone={diagCommand?.status==='success'?'green':diagCommand?.status==='failed'?'red':'orange'}>{diagCommand?cmdLabel(diagCommand.status):'لم يبدأ'}</Badge></div>
    <div className="form-grid">
     <Field label="طريقة السجل التاريخي"><Input readOnly value={historyProfile(diagDevice||{}).label}/></Field>
     <Field label="Firmware"><Input dir="ltr" readOnly value={diagDevice?.firmware||'—'}/></Field>
     <Field label="Push Version"><Input dir="ltr" readOnly value={diagDevice?.push_version||'—'}/></Field>
     <Field label="Platform"><Input dir="ltr" readOnly value={diagDevice?.metadata?.last_diagnostic?.platform||diagDevice?.metadata?.platform||'—'}/></Field>
     <Field label="آخر أمر"><Input readOnly value={diagHealth?.last_command_type?cmdName(diagHealth.last_command_type,{}):'—'}/></Field>
     <Field label="حالة آخر أمر"><Input readOnly value={diagHealth?.last_command_status?cmdLabel(diagHealth.last_command_status):'—'}/></Field>
    </div>
    <div style={{display:'grid',gap:6,marginTop:12}}>{(diagHealth?.issues||[]).length?(diagHealth.issues||[]).map((x,i)=><div key={i} className="training-banner">{x}</div>):<div className="success-note"><ShieldCheck size={16}/> لا توجد مشاكل ظاهرة في بيانات الجهاز الحالية.</div>}</div>
   </Card>
  </div>
 </Modal>
 <Modal open={shiftOpen} onClose={()=>setShiftOpen(false)} title={'فترات دوام الجهاز'+(shiftDevice?' — '+shiftDevice.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="success-note"><Clock3 size={16}/> هذه فترات الدوام المرجعية الخاصة بهذا الجهاز داخل نظام الماهر. الموظف يقدر يختار منها أو يستخدم فترة مخصصة مختلفة.</div>
   <Card><div className="card-title"><h3>الفترات المسجلة</h3><Button onClick={newShift}><Plus size={14}/> فترة جديدة</Button></div><Table preferenceKey="attendance-device-shifts" defaultPageSize={25} rows={shiftsByDevice.get(String(shiftDevice?.id))||[]} columns={shiftCols}/></Card>
   <Card><form onSubmit={saveShift} className="form-grid">
    <Field label="اسم الفترة"><Input value={shiftForm.name||''} onChange={e=>setShiftForm(x=>({...x,name:e.target.value}))} placeholder="مثال: صباحي" required/></Field>
    <Field label="الترتيب"><Input type="number" min="1" value={shiftForm.sequence_no||1} onChange={e=>setShiftForm(x=>({...x,sequence_no:Number(e.target.value||1)}))}/></Field>
    <Field label="بداية الدوام"><Input type="time" value={shiftForm.start_time||''} onChange={e=>setShiftForm(x=>({...x,start_time:e.target.value}))} required/></Field>
    <Field label="نهاية الدوام"><Input type="time" value={shiftForm.end_time||''} onChange={e=>setShiftForm(x=>({...x,end_time:e.target.value}))} required/></Field>
    <Field label="فترة السماح بالدقائق"><Input type="number" min="0" max="240" value={shiftForm.grace_minutes??10} onChange={e=>setShiftForm(x=>({...x,grace_minutes:Number(e.target.value||0)}))}/></Field>
    <Field label="ملاحظات"><Textarea value={shiftForm.notes||''} onChange={e=>setShiftForm(x=>({...x,notes:e.target.value}))}/></Field>
    <div className="modal-actions"><Button type="button" onClick={newShift}>تفريغ</Button><Button variant="primary" type="submit" disabled={shiftBusy}>{shiftBusy?'جاري الحفظ...':shiftForm.id?'حفظ التعديل':'إضافة الفترة'}</Button></div>
   </form></Card>
  </div>
 </Modal>

 <Modal open={userOpen} onClose={()=>setUserOpen(false)} title="تعديل بيانات الموظف ورفعها للجهاز" wide><form onSubmit={saveAndPush} className="form-grid">
  <Field label="PIN بالجهاز"><Input dir="ltr" value={userForm.device_pin||''} readOnly/></Field>
  <Field label="الاسم على الجهاز"><Input value={userForm.name||''} onChange={e=>setUserForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="الصلاحية على الجهاز"><Select value={String(userForm.privilege??0)} onChange={e=>setUserForm(x=>({...x,privilege:Number(e.target.value)}))}><option value="0">مستخدم عادي</option><option value="14">مسؤول جهاز</option></Select></Field>
  <Field label="رقم الكارت"><Input dir="ltr" value={userForm.card_number||''} onChange={e=>setUserForm(x=>({...x,card_number:e.target.value}))}/></Field>
  <Field label="المجموعة"><Input dir="ltr" value={userForm.group_no||'1'} onChange={e=>setUserForm(x=>({...x,group_no:e.target.value}))}/></Field>
  <Field label="طريقة التحقق"><Input type="number" min="0" max="15" value={userForm.verify_mode??0} onChange={e=>setUserForm(x=>({...x,verify_mode:Number(e.target.value||0)}))}/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><UploadCloud size={16}/> النظام سيرسل تعديل USERINFO للجهاز ثم يطلب قراءة نفس الـPIN للتأكد من وصول التعديل.</div>
  <div className="modal-actions"><Button type="button" onClick={()=>setUserOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={userBusy}>{userBusy?'جاري تجهيز الرفع...':'حفظ ورفع للجهاز'}</Button></div>
 </form></Modal></>;
}
