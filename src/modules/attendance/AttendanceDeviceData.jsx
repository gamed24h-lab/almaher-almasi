import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Activity,Clock3,Database,DownloadCloud,Fingerprint,History,MoreHorizontal,Plus,RefreshCw,ShieldCheck,Trash2,UploadCloud,UserPlus,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import RecordTimeline from '../../components/RecordTimeline.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function durationText(sec){const n=Math.max(0,Number(sec)||0);if(n<60)return Math.round(n)+' ثانية';if(n<3600)return Math.round(n/60)+' دقيقة';if(n<86400)return (n/3600).toFixed(n<7200?1:0)+' ساعة';return (n/86400).toFixed(1)+' يوم'}
function ageState(d){
 const v=d.last_command_poll_at||d.last_seen_at;if(!v)return {tone:'red',label:'لم يتصل'};
 const ms=Date.now()-new Date(v).getTime();
 if(ms<3*60*1000)return {tone:'green',label:'متصل الآن'};
 if(ms<30*60*1000)return {tone:'orange',label:'اتصال حديث'};
 return {tone:'red',label:'غير متصل'};
}
function cmdLabel(v){return v==='success'?'تم':v==='failed'?'فشل':v==='sent'?'أرسل للجهاز':v==='queued'?'بانتظار الجهاز':v||'—'}
function clockSyncLabel(v){return v==='queued'?'بانتظار الجهاز':v==='accepted'?'استلم الجهاز التحديث':v==='accepted_unverified'?'استلم التحديث — لم يُتحقق بعد':v==='verified'?'تمت المزامنة والتحقق':v==='failed'?'فشلت المزامنة':v||'لم تُنفذ بعد'}
function cmdName(v,meta){const s=meta?.history_strategy;return v==='clock_probe'?'فحص ساعة الجهاز':v==='clock_sync'?'مزامنة ساعة الجهاز':v==='sync_info'?'معلومات الجهاز':v==='diagnostic_info'?'تشخيص الجهاز':v==='sync_users'?'الموظفون':v==='sync_attlog'?'سجل الحضور':v==='history_attlog'?(s==='range_iso'?'الحركات القديمة — توافق 1':s==='plain'?'الحركات القديمة — توافق 2':'الحركات القديمة'):v==='history_attlog_replay'?'الحركات القديمة — إعادة إرسال':v==='biometric_import_fingerprint'?'استيراد بصمات الأصابع':v==='biometric_import_face'?'استيراد بصمة الوجه':v==='biometric_enroll'?'تسجيل بصمة':v==='biometric_delete'?'حذف بصمة محددة':v==='push_user'?'رفع موظف':v==='verify_user'?'تأكيد الموظف':v||'مزامنة'}
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

export default function AttendanceDeviceData({state,onChanged,onError,onNotice,onOpenLinks}){
 const [busy,setBusy]=useState(''),[watching,setWatching]=useState(''),[importBusy,setImportBusy]=useState(''),[biometricImportBusy,setBiometricImportBusy]=useState(''),[historyBusy,setHistoryBusy]=useState(''),[diagBusy,setDiagBusy]=useState(''),[clockBusy,setClockBusy]=useState(''),[diagAllBusy,setDiagAllBusy]=useState(false),[diagOpen,setDiagOpen]=useState(false),[diagDeviceId,setDiagDeviceId]=useState(''),[historyOpen,setHistoryOpen]=useState(false),[historyDeviceId,setHistoryDeviceId]=useState(''),[userOpen,setUserOpen]=useState(false),[userForm,setUserForm]=useState(blankUser),[userBusy,setUserBusy]=useState(false);
 const [shiftOpen,setShiftOpen]=useState(false),[shiftDevice,setShiftDevice]=useState(null),[shiftForm,setShiftForm]=useState(blankShift),[shiftBusy,setShiftBusy]=useState(false);
 const [syncReportOpen,setSyncReportOpen]=useState(false),[syncReportDeviceId,setSyncReportDeviceId]=useState(''),[syncReportBatch,setSyncReportBatch]=useState('');
 const [actionsOpen,setActionsOpen]=useState(false),[actionsDeviceId,setActionsDeviceId]=useState('');
 const [matchOpen,setMatchOpen]=useState(false),[matchDeviceId,setMatchDeviceId]=useState(''),[matchRows,setMatchRows]=useState([]),[matchEmployees,setMatchEmployees]=useState([]),[matchDecisions,setMatchDecisions]=useState({}),[matchBusy,setMatchBusy]=useState(false),[matchApplyBusy,setMatchApplyBusy]=useState(false),[matchSummary,setMatchSummary]=useState(null);
 const timerRef=useRef(null),attemptRef=useRef(0),watchBatchRef=useRef('');
 const devices=state.devices||[],deviceHealth=state.deviceHealth||[],deviceHealthHistory=state.deviceHealthHistory||[],devicePredictiveAlerts=state.devicePredictiveAlerts||[],healthEvents=state.healthEvents||[],clockChecks=state.clockChecks||[],deviceUsers=state.deviceUsers||[],commands=state.commands||[],links=state.links||[],deviceShiftTemplates=state.deviceShiftTemplates||[],biometricProfiles=state.biometricProfiles||[],biometricDeviceStates=state.biometricDeviceStates||[],biometricInventory=state.biometricInventory||[],unlinkedGroups=state.unlinkedGroups||[];
 const usersByDevice=useMemo(()=>{const m=new Map();for(const u of deviceUsers){const k=String(u.device_id),a=m.get(k)||[];a.push(u);m.set(k,a)}return m},[deviceUsers]);
 const commandsByDevice=useMemo(()=>{const m=new Map();for(const c of commands){const k=String(c.device_id),a=m.get(k)||[];a.push(c);m.set(k,a)}return m},[commands]);
 const shiftsByDevice=useMemo(()=>{const m=new Map();for(const x of deviceShiftTemplates){const k=String(x.device_id),a=m.get(k)||[];a.push(x);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no));return m},[deviceShiftTemplates]);
 const healthByDevice=useMemo(()=>new Map(deviceHealth.map(x=>[String(x.device_id),x])),[deviceHealth]);
 const historyByDevice=useMemo(()=>new Map(deviceHealthHistory.map(x=>[String(x.device_id),x])),[deviceHealthHistory]);
 const predictiveByDevice=useMemo(()=>new Map(devicePredictiveAlerts.map(x=>[String(x.device_id),x])),[devicePredictiveAlerts]);
 const eventsByDevice=useMemo(()=>{const m=new Map();for(const x of healthEvents){const k=String(x.device_id),arr=m.get(k)||[];arr.push(x);m.set(k,arr)}return m},[healthEvents]);
 const clockChecksByDevice=useMemo(()=>{const m=new Map();for(const x of clockChecks){const k=String(x.device_id),arr=m.get(k)||[];arr.push(x);m.set(k,arr)}return m},[clockChecks]);
 const linkMap=useMemo(()=>new Map(links.map(l=>[String(l.device_id)+'|'+String(l.device_pin),l])),[links]);
 const biometricByDevice=useMemo(()=>{const m=new Map();const source=biometricInventory.length?biometricInventory:(biometricDeviceStates.length?biometricDeviceStates:biometricProfiles);for(const x of source){if(x.status!=='active')continue;const deviceId=x.device_id||x.source_device_id;if(!deviceId)continue;const k=String(deviceId),a=m.get(k)||[];a.push(x);m.set(k,a)}return m},[biometricInventory,biometricDeviceStates,biometricProfiles]);
 const diagDevice=devices.find(x=>String(x.id)===String(diagDeviceId))||null,diagHealth=healthByDevice.get(String(diagDeviceId))||null,diagCommand=(commandsByDevice.get(String(diagDeviceId))||[]).find(x=>x.command_type==='diagnostic_info')||null;
 const historyDevice=devices.find(x=>String(x.id)===String(historyDeviceId))||null,historySummary=historyByDevice.get(String(historyDeviceId))||null,historyRows=eventsByDevice.get(String(historyDeviceId))||[];
 const syncReportDevice=devices.find(x=>String(x.id)===String(syncReportDeviceId))||null,actionsDevice=devices.find(x=>String(x.id)===String(actionsDeviceId))||null,matchDevice=devices.find(x=>String(x.id)===String(matchDeviceId))||null;
 function smartSyncReport(device,batch=syncReportBatch){
  if(!device)return {users:0,linked:0,unlinkedUsers:0,employeesWithBiometric:0,withoutBiometric:0,fingerprints:0,faces:0,unlinkedMovements:0,success:0,failed:0,pending:0,totalCommands:0};
  const us=usersByDevice.get(String(device.id))||[],deviceLinks=links.filter(x=>x.active&&String(x.device_id)===String(device.id)&&x.attendance_employee_id),linkedPins=new Set(deviceLinks.map(x=>String(x.device_pin))),linkedEmployees=[...new Set(deviceLinks.map(x=>String(x.attendance_employee_id)))];
  const bios=biometricByDevice.get(String(device.id))||[],bioEmployees=new Set(bios.map(x=>String(x.attendance_employee_id||'')).filter(Boolean)),fingerprints=bios.filter(x=>x.biometric_type==='finger').length,faces=bios.filter(x=>x.biometric_type==='face').length;
  const batchRows=(commandsByDevice.get(String(device.id))||[]).filter(x=>batch?x?.metadata?.smart_sync_batch===batch:x?.metadata?.smart_sync===true);
  const unlinkedMovements=unlinkedGroups.filter(x=>String(x.device_id)===String(device.id)).reduce((n,x)=>n+Number(x.count||0),0);
  return {
   users:us.length,linked:linkedEmployees.length,linkedPins:linkedPins.size,unlinkedUsers:us.filter(u=>!linkMap.get(String(device.id)+'|'+String(u.device_pin))?.attendance_employee_id).length,
   employeesWithBiometric:linkedEmployees.filter(id=>bioEmployees.has(id)).length,withoutBiometric:linkedEmployees.filter(id=>!bioEmployees.has(id)).length,
   fingerprints,faces,unlinkedMovements,
   success:batchRows.filter(x=>x.status==='success').length,failed:batchRows.filter(x=>x.status==='failed').length,pending:batchRows.filter(x=>x.status==='queued'||x.status==='sent').length,totalCommands:batchRows.length
  };
 }

 useEffect(()=>{
  if(!watching)return;
  const batch=watchBatchRef.current,allRows=commandsByDevice.get(String(watching))||[];
  const rows=batch?allRows.filter(c=>c?.metadata?.smart_sync_batch===batch):allRows.slice(0,4);
  const hasPending=rows.some(c=>c.status==='queued'||c.status==='sent');
  if(rows.length&&!hasPending){
   if(batch){setSyncReportDeviceId(watching);setSyncReportBatch(batch);setSyncReportOpen(true);watchBatchRef.current=''}
   setWatching('');return
  }
  clearTimeout(timerRef.current);
  timerRef.current=setTimeout(async()=>{attemptRef.current+=1;await onChanged?.();if(attemptRef.current>=30){if(batch){setSyncReportDeviceId(watching);setSyncReportBatch(batch);setSyncReportOpen(true);watchBatchRef.current=''}setWatching('')}},2000);
  return()=>clearTimeout(timerRef.current);
 },[watching,commands,onChanged,commandsByDevice]);

 async function sync(d){
  setBusy(d.id);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{
   const out=await api.attendanceWrite({action:'sync_device_data',device_id:d.id});
   if(out?.queued===false){onNotice?.(out?.message||'يوجد Smart Sync قيد التنفيذ بالفعل.');await onChanged?.();return}
   watchBatchRef.current=out?.batch||'';setWatching(d.id);onNotice?.(out?.message||'بدأ Smart Sync. ستتحدث الحالة تلقائيًا.');await onChanged?.();
  }catch(e){watchBatchRef.current='';onError?.(e.message)}finally{setBusy('')}
 }
 async function loadMatchPreview(d,openModal=true){
  const device=typeof d==='string'?devices.find(x=>String(x.id)===String(d)):d;if(!device)return null;
  setMatchBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'preview_device_user_matches',device_id:device.id});
   const rows=(out?.rows||[]).map(x=>({...x,id:'pin-'+String(x.device_pin)}));
   const initial={};
   for(const row of rows){
    if(row.recommended_action==='link_existing'&&row.recommended_employee_id)initial[row.device_pin]={action:'link_existing',attendance_employee_id:row.recommended_employee_id};
    else if(row.recommended_action==='create_new')initial[row.device_pin]={action:'create_new',attendance_employee_id:''};
    else initial[row.device_pin]={action:'skip',attendance_employee_id:''};
   }
   setMatchDeviceId(device.id);setMatchRows(rows);setMatchEmployees(out?.employees||[]);setMatchDecisions(initial);setMatchSummary({pending:out?.pending||0,already_linked:out?.already_linked||0,total_device_users:out?.total_device_users||0});
   if(openModal)setMatchOpen(true);
   if(!rows.length)onNotice?.('كل موظفي هذا الجهاز مربوطون بالفعل.');
   return out;
  }catch(e){onError?.(e.message);return null}finally{setMatchBusy(false)}
 }
 async function importAll(d){
  setImportBusy(d.id);onError?.('');
  try{await loadMatchPreview(d,true)}finally{setImportBusy('')}
 }
 function setMatchDecision(pin,patch){setMatchDecisions(x=>({...x,[pin]:{...(x[pin]||{action:'skip',attendance_employee_id:''}),...patch}}))}
 async function applyMatches(){
  if(!matchDevice||!matchRows.length)return;
  const risky=matchRows.filter(r=>r.strong_match&&matchDecisions[r.device_pin]?.action==='create_new');
  if(risky.length&&!confirm('يوجد '+risky.length+' سجل/سجلات بها تطابق قوي مع موظف موجود، ومع ذلك اخترت إنشاء موظف جديد. هذا قد يصنع تكرارًا. هل راجعت الأسماء وتريد المتابعة؟'))return;
  const selected=matchRows.map(r=>({device_pin:r.device_pin,action:matchDecisions[r.device_pin]?.action||'skip',attendance_employee_id:matchDecisions[r.device_pin]?.attendance_employee_id||null,confirm_duplicate:risky.some(x=>x.device_pin===r.device_pin)}));
  const actionable=selected.filter(x=>x.action!=='skip');
  if(!actionable.length){onError?.('اختر ربط موظف موجود أو إنشاء موظف جديد لسجل واحد على الأقل.');return}
  if(!confirm('تنفيذ '+actionable.length+' قرار مطابقة على جهاز '+matchDevice.name+'؟ لن يتم تغيير أي PIN تم ربطه بالفعل.'))return;
  setMatchApplyBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'apply_device_user_matches',device_id:matchDevice.id,decisions:selected});
   setMatchSummary(out);
   onNotice?.(out?.message||'تم تنفيذ قرارات Smart Employee Matching.');
   await onChanged?.();
   const refreshed=await loadMatchPreview(matchDevice.id,false);
   if(!refreshed?.pending)setMatchOpen(false);
  }catch(e){onError?.(e.message)}finally{setMatchApplyBusy(false)}
 }
 async function importBiometrics(d){
  if(!confirm('سيتم قراءة جرد البصمات الموجودة فعليًا على هذا الجهاز حسب PIN، حتى لو لم يكن الـPIN مربوطًا بموظف بعد. لن يتم حفظ قالب البصمة الخام. هل تريد المتابعة؟'))return;
  setBiometricImportBusy(d.id);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{
   const out=await api.attendanceWrite({action:'import_device_biometrics',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'تم بدء استيراد البصمات الموجودة على الجهاز.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBiometricImportBusy('')}
 }
 async function importHistory(d){
  if(!confirm('استيراد وربط كل الحركات القديمة الموجودة على هذا الجهاز؟ العملية آمنة من التكرار لأن كل حركة لها مفتاح منع تكرار.'))return;
  setHistoryBusy(d.id);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{
   const out=await api.attendanceWrite({action:'import_historical_attendance',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'تم بدء استيراد الحركات القديمة وربطها بالموظفين.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setHistoryBusy('')}
 }
 async function diagnose(d){
  setDiagDeviceId(d.id);setDiagOpen(true);setDiagBusy(d.id);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{
   const out=await api.attendanceWrite({action:'diagnose_device',device_id:d.id});
   setWatching(d.id);onNotice?.(out?.message||'تم بدء تشخيص الجهاز.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setDiagBusy('')}
 }
 async function diagnoseAll(){
  setDiagAllBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'diagnose_all_devices'});
   onNotice?.(out?.message||'تم بدء التشخيص الشامل للأجهزة.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setDiagAllBusy(false)}
 }
 async function probeClock(d){
  setClockBusy(d.id);setDiagDeviceId(d.id);setDiagOpen(true);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{const out=await api.attendanceWrite({action:'probe_device_clock',device_id:d.id});setWatching(d.id);onNotice?.(out?.message||'تم بدء فحص ساعة الجهاز.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setClockBusy('')}
 }
 async function syncClock(d){
  if(!confirm('تحديث ساعة الجهاز فعليًا من وقت السيرفر السعودي الآن؟ سيُرسل النظام أمر مزامنة مباشر للجهاز ثم يتحقق من أول حركة Live جديدة.'))return;
  setClockBusy(d.id);onError?.('');attemptRef.current=0;watchBatchRef.current='';
  try{const out=await api.attendanceWrite({action:'sync_device_clock',device_id:d.id});setWatching(d.id);onNotice?.(out?.message||'تم إرسال تحديث الساعة الفعلية للجهاز من السيرفر.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setClockBusy('')}
 }
 function runHealthAction(h){
  const device=devices.find(x=>String(x.id)===String(h?.device_id));if(!device)return;
  if(h.recommended_action==='clock'){syncClock(device);return}
  if(h.recommended_action==='links'){onOpenLinks?.();return}
  if(h.recommended_action==='history'){importHistory(device);return}
  if(h.recommended_action==='diagnose')diagnose(device);
 }
 function openHealthHistory(device){setHistoryDeviceId(device.id);setHistoryOpen(true)}
 function openSmartSyncReport(device,batch=device?.metadata?.last_smart_sync?.batch||''){setSyncReportDeviceId(device.id);setSyncReportBatch(batch);setSyncReportOpen(true)}
 function openDeviceActions(device){setActionsDeviceId(device.id);setActionsOpen(true)}
 function closeDeviceActions(){setActionsOpen(false)}
 function runPredictiveAction(alert){
  const device=devices.find(x=>String(x.id)===String(alert?.device_id));if(!device)return;
  if(alert.recommended_action==='health_log'){openHealthHistory(device);return}
  diagnose(device);
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
  {key:'health',label:'صحة الجهاز',render:d=>{const h=healthByDevice.get(String(d.id));return h?<div><Badge tone={h.tone||'orange'}>{h.label||'غير معروف'} · {h.score}/100</Badge><div className="muted-small" style={{marginTop:3}}>آخر حركة: {fmt(h.last_log_at)}</div>{h.issues?.[0]&&<div className="muted-small">{h.issues[0]}</div>}</div>:<Badge tone="orange">جارٍ التقييم</Badge>}},
  {key:'clock',label:'ساعة الجهاز',render:d=>{const h=healthByDevice.get(String(d.id)),sec=Number(h?.clock_drift_seconds),known=h?.clock_confirmed===true&&Number.isFinite(sec),abs=Math.abs(sec||0),label=!known?'غير مؤكدة':abs<=120?'مضبوطة':sec>0?'متقدمة '+(abs>=3600?(abs/3600).toFixed(abs%3600<120?0:1)+' س':Math.round(abs/60)+' د'):'متأخرة '+(abs>=3600?(abs/3600).toFixed(abs%3600<120?0:1)+' س':Math.round(abs/60)+' د'),tone=!known?'gray':abs<=120?'green':abs>900?'red':'orange',sync=d?.metadata?.last_clock_sync;return <div><Badge tone={tone}>{label}</Badge><div className="muted-small" style={{marginTop:3}}>آخر فحص: {fmt(h?.clock_checked_at)}</div>{sync?.status&&<div className="muted-small">المزامنة: {clockSyncLabel(sync.status)}</div>}{sync?.verified_at&&<div className="muted-small">تحقق: {fmt(sync.verified_at)}</div>}</div>}},
  {key:'risk',label:'المراقبة الاستباقية',render:d=>{const r=predictiveByDevice.get(String(d.id));return r?<div><Badge tone={r.tone||'orange'}>{r.label} · {r.risk_score}/100</Badge><div className="muted-small" style={{marginTop:3}}>{r.signals?.[0]||'يوجد مؤشر يحتاج متابعة'}</div></div>:<Badge tone="green">مستقر</Badge>}},
  {key:'shifts',label:'فترات الدوام',render:d=>{const rows=shiftsByDevice.get(String(d.id))||[];return rows.length?<div style={{display:'grid',gap:2}}>{rows.slice(0,3).map(x=><span key={x.id} className="muted-small"><Clock3 size={12}/> {x.name}: {String(x.start_time).slice(0,5)} — {String(x.end_time).slice(0,5)}</span>)}{rows.length>3&&<span className="muted-small">+ {rows.length-3} فترات أخرى</span>}</div>:<Badge tone="orange">غير محددة</Badge>}},
  {key:'reported',label:'الموجود بالجهاز',render:d=><div><strong>{d.reported_user_count??'—'} موظف</strong><div className="muted-small">{d.reported_fp_count??'—'} قالب بصمة · {d.reported_face_count??'—'} وجه</div><div className="muted-small">{d.reported_transaction_count??'—'} حركة معلنة</div></div>},
  {key:'synced',label:'المسحوب للنظام',render:d=>{const us=usersByDevice.get(String(d.id))||[],imported=us.filter(u=>linkMap.get(String(d.id)+'|'+String(u.device_pin))?.attendance_employee_id).length,bios=biometricByDevice.get(String(d.id))||[],fps=bios.filter(x=>x.biometric_type==='finger').length,faces=bios.filter(x=>x.biometric_type==='face').length;return <div><strong>{us.length} موظف مسحوب</strong><div className="muted-small">{imported} مستورد كموظف حضور</div><div className="muted-small">مكتشف: {fps} إصبع{faces?(' · '+faces+' وجه'):''}</div></div>}},
  {key:'smart_sync',label:'Smart Sync',render:d=>{const s=d?.metadata?.last_smart_sync;if(!s)return <Badge tone="gray">لم يُشغّل</Badge>;const r=smartSyncReport(d,s.batch);return <div><Badge tone={r.pending?'orange':r.failed?'red':'green'}>{r.pending?'قيد التنفيذ':r.failed?'اكتمل بملاحظات':'آخر مزامنة مكتملة'}</Badge><div className="muted-small">{fmt(s.requested_at)}</div><div className="muted-small">{s.biometrics_included?'شملت البصمات':'بدون بصمات'}</div></div>}},
  {key:'compat',label:'توافق سجل الحضور',render:d=>{const p=historyProfile(d);return <div><Badge tone={p.tone}>{p.label}</Badge><div className="muted-small" style={{marginTop:3}}>{p.detail}</div>{p.last&&<div className="muted-small">آخر نجاح: {fmt(p.last)}</div>}</div>}},
  {key:'reliability',label:'اعتمادية 30 يوم',render:d=>{const h=historyByDevice.get(String(d.id));return h?<div><strong>{h.availability_pct}%</strong><div className="muted-small">{h.outage_count} انقطاع · {durationText(h.downtime_seconds)}</div><div className="muted-small">{h.command_failures} فشل أوامر</div></div>:'—'}},
  {key:'command',label:'حالة آخر أوامر',render:d=>{const rows=(commandsByDevice.get(String(d.id))||[]).slice(0,4);return rows.length?<div style={{display:'grid',gap:6}}>{rows.map(c=><div key={c.id} style={{display:'flex',gap:8,alignItems:'flex-start',justifyContent:'space-between'}}><div><span className="muted-small">{cmdName(c.command_type,c.metadata)}</span>{c.status==='failed'&&<div className="muted-small" style={{marginTop:2,maxWidth:260}}>{cmdReason(c)}</div>}</div><Badge tone={c.status==='success'?'green':c.status==='failed'?'red':'orange'}>{cmdLabel(c.status)}</Badge></div>)}</div>:'—'}},
  {key:'action',label:'',render:d=>{const active=busy===d.id||watching===d.id;return <div className="finance-actions">{state.permissions?.manage_devices&&<Button variant="primary" onClick={()=>sync(d)} disabled={active}><RefreshCw size={15}/>{active?' Smart Sync يعمل...':' Smart Sync شامل'}</Button>}<Button onClick={()=>openDeviceActions(d)}><MoreHorizontal size={16}/> إجراءات أخرى</Button></div>}}
 ];
 const predictiveCols=[
  {key:'device',label:'الجهاز',render:r=>{const x=devices.find(d=>String(d.id)===String(r.device_id));return <div><strong>{x?.name||r.device_id}</strong><div className="muted-small">{x?.model||'—'} · {x?.serial_number||'—'}</div></div>}},
  {key:'risk',label:'مستوى الخطر',render:r=><div><Badge tone={r.tone||'orange'}>{r.label}</Badge><div className="muted-small" style={{marginTop:3}}>Risk {r.risk_score}/100 · ثقة {r.confidence==='high'?'مرتفعة':'متوسطة'}</div></div>},
  {key:'signals',label:'المؤشرات المبكرة',render:r=><div style={{display:'grid',gap:3}}>{(r.signals||[]).slice(0,4).map((x,i)=><span key={i} className="muted-small">{x}</span>)}</div>},
  {key:'trend',label:'آخر 7 أيام',render:r=><div><strong>{r.metrics?.outages_7d??0} انقطاع</strong><div className="muted-small">{r.metrics?.failures_7d??0} فشل أوامر · {durationText(r.metrics?.downtime_7d_seconds)}</div></div>},
  {key:'action',label:'الإجراء',render:r=><Button onClick={()=>runPredictiveAction(r)}>{r.recommended_label||'تشخيص الآن'}</Button>}
 ];
 const healthEventCols=[
  {key:'type',label:'الحدث',render:x=>x.event_type==='disconnect_gap'?<Badge tone="red">انقطاع اتصال</Badge>:x.event_type==='command_failed'?<Badge tone="orange">فشل أمر</Badge>:x.event_type==='clock_drift'?<Badge tone="red">خلل ساعة</Badge>:x.event_type==='clock_recovered'?<Badge tone="green">ضبط الساعة</Badge>:<Badge>{x.event_type}</Badge>},
  {key:'time',label:'الوقت',render:x=><div><strong>{fmt(x.started_at)}</strong>{x.ended_at&&x.ended_at!==x.started_at&&<div className="muted-small">حتى {fmt(x.ended_at)}</div>}</div>},
  {key:'duration',label:'المدة',render:x=>x.event_type==='disconnect_gap'?durationText(x.duration_seconds):'—'},
  {key:'summary',label:'التفاصيل',render:x=><div>{x.summary||'—'}{x.result_code!=null&&<div className="muted-small">Code: {x.result_code}</div>}</div>}
 ];
 const healthAlerts=deviceHealth.filter(h=>Number(h.severity)>0&&h.tone!=='gray').sort((x,y)=>Number(y.severity)-Number(x.severity)||Number(x.score)-Number(y.score));
 const alertCols=[
  {key:'device',label:'الجهاز',render:h=>{const x=devices.find(d=>String(d.id)===String(h.device_id));return <div><strong>{x?.name||h.device_id}</strong><div className="muted-small">{x?.model||'—'} · {x?.serial_number||'—'}</div></div>}},
  {key:'status',label:'الحالة',render:h=><div><Badge tone={h.tone||'orange'}>{h.label}</Badge><div className="muted-small" style={{marginTop:3}}>درجة الصحة: {h.score}/100</div></div>},
  {key:'issues',label:'التنبيهات',render:h=><div style={{display:'grid',gap:3}}>{(h.issues||[]).slice(0,3).map((x,i)=><span key={i} className="muted-small">{x}</span>)}{(h.issues||[]).length>3&&<span className="muted-small">+ {(h.issues||[]).length-3} تنبيه آخر</span>}</div>},
  {key:'action',label:'الإجراء المقترح',render:h=>h.recommended_action?<Button onClick={()=>runHealthAction(h)}>{h.recommended_label||'معالجة'}</Button>:<span className="muted-small">{h.connection==='offline'?'افحص الكهرباء أو الشبكة المحلية للجهاز':'لا يوجد إجراء آمن تلقائيًا'}</span>}
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
 const syncReport=smartSyncReport(syncReportDevice,syncReportBatch);
 return <><Card><div className="card-title"><div><h3><ShieldCheck size={19}/> صحة أجهزة البصمة</h3><small>متابعة الاتصال، آخر حركة، أخطاء الأوامر، الحركات غير المربوطة وطريقة توافق السجل لكل جهاز.</small></div><div className="finance-actions"><Badge tone={healthCounts.red?'red':devicePredictiveAlerts.some(x=>x.level==='high')?'red':healthCounts.orange||devicePredictiveAlerts.length?'orange':'green'}>{healthCounts.red?'توجد أجهزة غير متصلة':devicePredictiveAlerts.some(x=>x.level==='high')?'خطر استباقي مرتفع':healthCounts.orange||devicePredictiveAlerts.length?'توجد تنبيهات':'الأجهزة بحالة جيدة'}</Badge>{state.permissions?.manage_devices&&<Button onClick={diagnoseAll} disabled={diagAllBusy}><Activity size={15}/>{diagAllBusy?' جاري فحص الكل...':' تشخيص كل الأجهزة'}</Button>}</div></div>
 <div className="stats-grid"><Card><div className="stat-card"><div><span>سليم</span><strong>{healthCounts.green}</strong></div></div></Card><Card><div className="stat-card"><div><span>يحتاج متابعة</span><strong>{healthCounts.orange}</strong></div></div></Card><Card><div className="stat-card"><div><span>غير متصل</span><strong>{healthCounts.red}</strong></div></div></Card><Card><div className="stat-card"><div><span>موقوف</span><strong>{healthCounts.gray}</strong></div></div></Card></div></Card>
 {devicePredictiveAlerts.length>0&&<Card><div className="card-title"><div><h3><Activity size={19}/> مراقبة استباقية</h3><small>مؤشرات مبكرة مبنية على تكرار الانقطاعات وفشل الأوامر وتوقف تدفق الحركات. هي تنبيه للمراجعة وليست تأكيدًا أن الجهاز تالف.</small></div><Badge tone={devicePredictiveAlerts.some(x=>x.level==='high')?'red':'orange'}>{devicePredictiveAlerts.length}</Badge></div><Table preferenceKey="attendance-device-predictive-watchdog" defaultPageSize={25} rows={devicePredictiveAlerts} columns={predictiveCols}/></Card>}
 {healthAlerts.length>0&&<Card><div className="card-title"><div><h3><Activity size={19}/> تنبيهات تحتاج تدخل</h3><small>النظام يرتب المشاكل حسب الأولوية ويقترح إجراء آمن لكل حالة بدون تعديل تلقائي صامت.</small></div><Badge tone="orange">{healthAlerts.length}</Badge></div><Table preferenceKey="attendance-device-health-alerts" defaultPageSize={25} rows={healthAlerts} columns={alertCols}/></Card>}
 <Card><div className="card-title"><div><h3><Database size={19}/> بيانات الأجهزة والمزامنة</h3><small>Smart Sync يجمع معلومات الجهاز والموظفين والحركات والبصمات المسموح بها في عملية واحدة، مع تقرير نتيجة بعد الانتهاء.</small></div><Badge tone="blue"><RefreshCw size={13}/> Smart ADMS Sync</Badge></div>
 {watching&&<div className="success-note" style={{marginBottom:12}}><RefreshCw size={16}/> جاري متابعة أوامر الجهاز تلقائيًا… لا تحتاج تضغط تحديث.</div>}
 <Table preferenceKey="attendance-device-data" defaultPageSize={25} rows={devices} columns={cols}/></Card>

 {deviceUsers.length>0&&<Card><div className="card-title"><div><h3><Users size={19}/> الموظفون المسحوبون من الأجهزة</h3><small>يمكن تعديل الاسم والصلاحية والكارت والبيانات التي يدعمها جهاز ZKTeco، ثم رفعها للجهاز.</small></div><Badge>{deviceUsers.length}</Badge></div><Table preferenceKey="attendance-device-users" defaultPageSize={25} rows={deviceUsers} columns={userCols}/><div className="success-note"><Fingerprint size={16}/> قالب البصمة نفسه يظل داخل جهاز ZKTeco ولا يتم نسخه إلى قاعدة البيانات.</div></Card>}

 <Modal open={matchOpen} onClose={()=>!matchApplyBusy&&setMatchOpen(false)} title={'Smart Employee Matching'+(matchDevice?' — '+matchDevice.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="success-note"><ShieldCheck size={16}/> النظام يقترح فقط. لا يتم ربط موظف أو إنشاء سجل جديد إلا بعد مراجعتك والضغط على «تنفيذ القرارات».</div>
   {matchSummary&&<div className="stats-grid">
    <Card><div className="stat-card"><div><span>موظفو الجهاز</span><strong>{matchSummary.total_device_users??matchRows.length}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>مربوطون بالفعل</span><strong>{matchSummary.already_linked??0}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>تحتاج قرار</span><strong>{matchRows.length}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>بصمات مرتبطة بعد التنفيذ</span><strong>{matchSummary.biometrics_attached??0}</strong></div></div></Card>
   </div>}
   {matchBusy?<div className="success-note"><RefreshCw size={16}/> جاري تحليل موظفي الجهاز ومقارنتهم بموظفي الفرع…</div>:matchRows.length?<div style={{display:'grid',gap:10}}>
    {matchRows.map(row=>{
     const decision=matchDecisions[row.device_pin]||{action:'skip',attendance_employee_id:''},top=row.suggestions?.[0]||null;
     return <Card key={row.device_pin}>
      <div className="card-title"><div><h3>{row.name}</h3><small>PIN <span dir="ltr">{row.device_pin}</span>{row.biometric_count?' · '+row.biometric_count+' بصمة مكتشفة':''}</small></div><Badge tone={row.strong_match?'green':top?'orange':'gray'}>{row.strong_match?'اقتراح قوي':top?'يحتاج مراجعة':'لا يوجد تطابق واضح'}</Badge></div>
      {top&&<div className="success-note" style={{marginBottom:10}}><Users size={16}/><div><strong>الاقتراح: {top.name}</strong><div className="muted-small">الثقة: {top.score}% · {(top.reasons||[]).join(' + ')}</div>{top.employee_code&&<div className="muted-small" dir="ltr">Employee Code: {top.employee_code}</div>}</div></div>}
      <div className="form-grid">
       <Field label="القرار"><Select value={decision.action} onChange={e=>setMatchDecision(row.device_pin,{action:e.target.value,attendance_employee_id:e.target.value==='link_existing'?(decision.attendance_employee_id||row.recommended_employee_id||top?.id||''):''})}><option value="skip">تجاهل الآن</option><option value="link_existing">ربط بموظف موجود</option><option value="create_new">إنشاء موظف جديد</option></Select></Field>
       {decision.action==='link_existing'&&<Field label="الموظف الموجود"><Select value={decision.attendance_employee_id||''} onChange={e=>setMatchDecision(row.device_pin,{attendance_employee_id:e.target.value})} required><option value="">اختر الموظف</option>{matchEmployees.map(emp=><option key={emp.id} value={emp.id}>{emp.name}{emp.employee_code?' · '+emp.employee_code:''}</option>)}</Select></Field>}
       {decision.action==='create_new'&&<Field label="الاسم الجديد"><Input readOnly value={row.name}/></Field>}
      </div>
      {decision.action==='create_new'&&row.strong_match&&<div className="training-banner">تنبيه: يوجد تطابق قوي مع موظف موجود. إنشاء سجل جديد يحتاج تأكيد إضافي عند التنفيذ لتجنب التكرار.</div>}
      {row.suggestions?.length>1&&<div className="muted-small" style={{marginTop:8}}>اقتراحات أخرى: {row.suggestions.slice(1,4).map(x=>x.name+' ('+x.score+'%)').join('، ')}</div>}
     </Card>
    })}
   </div>:<div className="success-note"><ShieldCheck size={16}/> لا توجد سجلات غير مربوطة على هذا الجهاز.</div>}
   <div className="modal-actions"><Button type="button" onClick={()=>setMatchOpen(false)} disabled={matchApplyBusy}>إغلاق</Button><Button variant="primary" type="button" onClick={applyMatches} disabled={matchApplyBusy||matchBusy||!matchRows.length}>{matchApplyBusy?' جاري تنفيذ القرارات...':' تنفيذ القرارات'}</Button></div>
  </div>
 </Modal>

 <Modal open={actionsOpen} onClose={closeDeviceActions} title={'إجراءات الجهاز'+(actionsDevice?' — '+actionsDevice.name:'')}>
  {actionsDevice&&<div style={{display:'grid',gap:10}}>
   <div className="success-note"><Database size={16}/> الإجراءات الثانوية مجمعة هنا لتقليل طول بطاقة الجهاز على الجوال. Smart Sync يظل ظاهرًا مباشرة في الجدول.</div>
   <div style={{display:'grid',gap:8}}>
    <RecordTimeline entityId={actionsDevice.id} title={'تاريخ جهاز البصمة — '+actionsDevice.name} subtitle="تعديلات الجهاز وإجراءاته الإدارية المسجلة في Audit Center." label="سجل التغييرات"/>
    <Button onClick={()=>{closeDeviceActions();openHealthHistory(actionsDevice)}}><History size={15}/> سجل الصحة</Button>
    {actionsDevice?.metadata?.last_smart_sync?.batch&&<Button onClick={()=>{closeDeviceActions();openSmartSyncReport(actionsDevice)}}><Database size={15}/> تقرير المزامنة</Button>}
    {state.permissions?.manage_devices&&<Button onClick={()=>{closeDeviceActions();diagnose(actionsDevice)}} disabled={diagBusy===actionsDevice.id}><Activity size={15}/>{diagBusy===actionsDevice.id?' جاري التشخيص...':' تشخيص الجهاز'}</Button>}
    {state.permissions?.manage_devices&&<Button onClick={()=>{closeDeviceActions();probeClock(actionsDevice)}} disabled={clockBusy===actionsDevice.id}><Clock3 size={15}/>{clockBusy===actionsDevice.id?' جاري فحص الساعة...':' فحص ساعة الجهاز'}</Button>}
    {state.permissions?.manage_devices&&<Button onClick={()=>{closeDeviceActions();syncClock(actionsDevice)}} disabled={clockBusy===actionsDevice.id}><RefreshCw size={15}/>{clockBusy===actionsDevice.id?' جاري تحديث الساعة...':' تحديث الساعة من السيرفر'}</Button>}
    {state.permissions?.manage_devices&&<Button onClick={()=>{closeDeviceActions();openShifts(actionsDevice)}}><Clock3 size={15}/> فترات الدوام</Button>}
    {(usersByDevice.get(String(actionsDevice.id))||[]).length>0&&state.permissions?.manage_employees&&state.permissions?.manage_links&&<Button onClick={()=>{closeDeviceActions();importAll(actionsDevice)}} disabled={importBusy===actionsDevice.id}><UserPlus size={15}/>{importBusy===actionsDevice.id?' جاري المطابقة...':' مطابقة واستيراد الموظفين'}</Button>}
    {state.permissions?.manage_biometrics&&<Button onClick={()=>{closeDeviceActions();importBiometrics(actionsDevice)}} disabled={biometricImportBusy===actionsDevice.id||busy===actionsDevice.id||watching===actionsDevice.id}><Fingerprint size={15}/>{biometricImportBusy===actionsDevice.id?' جاري استيراد البصمات...':' استيراد البصمات فقط'}</Button>}
    {state.permissions?.manage_devices&&state.permissions?.manage_links&&<Button onClick={()=>{closeDeviceActions();importHistory(actionsDevice)}} disabled={historyBusy===actionsDevice.id||busy===actionsDevice.id||watching===actionsDevice.id}><History size={15}/>{historyBusy===actionsDevice.id?' جاري الاستيراد...':historyProfile(actionsDevice).label==='Push Replay'?' إعادة إرسال الحركات القديمة':' استيراد الحركات القديمة'}</Button>}
   </div>
  </div>}
 </Modal>

 <Modal open={syncReportOpen} onClose={()=>setSyncReportOpen(false)} title={'تقرير Smart Sync'+(syncReportDevice?' — '+syncReportDevice.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>الموظفون على الجهاز</span><strong>{syncReport.users}</strong><small>{syncReport.linked} مربوط بالنظام</small></div></div></Card>
    <Card><div className="stat-card"><div><span>البصمات المكتشفة</span><strong>{syncReport.fingerprints}</strong><small>{syncReport.faces} وجه</small></div></div></Card>
    <Card><div className="stat-card"><div><span>موظفون بدون بصمة مكتشفة</span><strong>{syncReport.withoutBiometric}</strong><small>من الموظفين المربوطين بهذا الجهاز</small></div></div></Card>
    <Card><div className="stat-card"><div><span>غير مربوطين</span><strong>{syncReport.unlinkedUsers}</strong><small>{syncReport.unlinkedMovements} حركة حضور غير مربوطة</small></div></div></Card>
   </div>
   <Card><div className="card-title"><div><h3><RefreshCw size={18}/> نتيجة الأوامر</h3><small>Batch: {syncReportBatch||syncReportDevice?.metadata?.last_smart_sync?.batch||'—'}</small></div><Badge tone={syncReport.pending?'orange':syncReport.failed?'red':'green'}>{syncReport.pending?'ما زالت تعمل':syncReport.failed?'اكتملت مع أخطاء':'اكتملت'}</Badge></div>
    <div className="form-grid">
     <Field label="إجمالي الأوامر"><Input readOnly value={String(syncReport.totalCommands)}/></Field>
     <Field label="نجح"><Input readOnly value={String(syncReport.success)}/></Field>
     <Field label="فشل"><Input readOnly value={String(syncReport.failed)}/></Field>
     <Field label="قيد التنفيذ"><Input readOnly value={String(syncReport.pending)}/></Field>
     <Field label="قوالب الجهاز المعلنة"><Input readOnly value={String(syncReportDevice?.reported_fp_count??'—')}/></Field>
     <Field label="القوالب المكتشفة بالنظام"><Input readOnly value={String(syncReport.fingerprints)}/></Field>
    </div>
    {syncReport.failed>0&&<div className="training-banner">يوجد أمر أو أكثر فشل أثناء المزامنة. راجع «حالة آخر أوامر» أو سجل التغييرات لمعرفة كود الجهاز.</div>}
    {syncReportDevice?.metadata?.last_smart_sync?.biometrics_included===false&&<div className="training-banner">هذه المزامنة لم تشمل البصمات لأن الحساب الذي شغّلها لا يملك صلاحية إدارة البصمات.</div>}
    {syncReportDevice?.reported_fp_count!=null&&Number(syncReportDevice.reported_fp_count)!==syncReport.fingerprints&&<div className="training-banner">عدد القوالب المعلن من الجهاز ({syncReportDevice.reported_fp_count}) يختلف عن المكتشف في النظام ({syncReport.fingerprints}). غالبًا توجد بصمة لموظف غير مربوط أو يحتاج الجهاز إعادة Smart Sync.</div>}
    {!syncReport.failed&&!syncReport.pending&&syncReport.unlinkedUsers===0&&<div className="success-note"><ShieldCheck size={16}/> المزامنة مكتملة، وكل الموظفين المسحوبين من الجهاز مربوطون بالنظام.</div>}
   </Card>
  </div>
 </Modal>

 <Modal open={historyOpen} onClose={()=>setHistoryOpen(false)} title={'سجل صحة الجهاز'+(historyDevice?' — '+historyDevice.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>الاعتمادية</span><strong>{historySummary?historySummary.availability_pct+'%':'—'}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>الانقطاعات</span><strong>{historySummary?.outage_count??0}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>وقت الانقطاع</span><strong style={{fontSize:17}}>{durationText(historySummary?.downtime_seconds)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>فشل الأوامر</span><strong>{historySummary?.command_failures??0}</strong></div></div></Card>
   </div>
   {historySummary?.current_outage_seconds>0&&<div className="training-banner">الجهاز في انقطاع حالي محسوب منذ تجاوز 30 دقيقة بدون اتصال: {durationText(historySummary.current_outage_seconds)}.</div>}
   <Card><div className="card-title"><div><h3><History size={18}/> سجل آخر 90 يومًا</h3><small>فشل الأوامر السابق تم استرجاعه من السجل الحالي. احتساب انقطاعات الاتصال التفصيلية يبدأ تلقائيًا من هذا التحديث ويُسجّل عند عودة الجهاز بعد انقطاع أطول من 30 دقيقة.</small></div><Badge>{historyRows.length}</Badge></div>
    {historyRows.length?<Table preferenceKey={'attendance-device-health-history-'+String(historyDeviceId)} defaultPageSize={25} rows={historyRows} columns={healthEventCols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد أعطال مسجلة لهذا الجهاز ضمن الفترة الحالية.</div>}
   </Card>
   <Card><div className="card-title"><div><h3><Clock3 size={18}/> سجل فحوصات الساعة</h3><small>الفارق موجب يعني ساعة الجهاز متقدمة عن وقت السيرفر، والسالب يعني متأخرة.</small></div><Badge>{(clockChecksByDevice.get(String(historyDeviceId))||[]).length}</Badge></div>{(clockChecksByDevice.get(String(historyDeviceId))||[]).length?<Table preferenceKey={'attendance-device-clock-history-'+String(historyDeviceId)} defaultPageSize={25} rows={clockChecksByDevice.get(String(historyDeviceId))||[]} columns={[{key:'time',label:'وقت الفحص',render:x=>fmt(x.created_at)},{key:'raw',label:'وقت الجهاز',render:x=><span dir="ltr">{x.device_time_raw||'—'}</span>},{key:'drift',label:'الفارق',render:x=><Badge tone={Math.abs(Number(x.drift_seconds)||0)<=120?'green':Math.abs(Number(x.drift_seconds)||0)>900?'red':'orange'}>{Math.round((Number(x.drift_seconds)||0)/60*10)/10} دقيقة</Badge>},{key:'status',label:'التأكيد',render:x=><Badge tone={x.confirmed?'green':'orange'}>{x.confirmed?'مؤكد':'عينة أولية'}</Badge>} ]}/>:<div className="muted-small">لا توجد فحوصات ساعة مسجلة بعد.</div>}</Card>
  </div>
 </Modal>
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
     <Field label="درجة الصحة"><Input readOnly value={diagHealth?String(diagHealth.score)+'/100':'—'}/></Field>
     <Field label="الأوامر المعلقة"><Input readOnly value={String(diagHealth?.pending_commands??0)}/></Field>
     <Field label="معلقة أكثر من 15 دقيقة"><Input readOnly value={String(diagHealth?.stuck_commands??0)}/></Field>
     <Field label="حالة ساعة الجهاز"><Input readOnly value={diagHealth?.clock_confirmed?(Math.abs(Number(diagHealth.clock_drift_seconds)||0)<=120?'مضبوطة':Number(diagHealth.clock_drift_seconds)>0?'متقدمة':'متأخرة'):'غير مؤكدة'}/></Field>
     <Field label="فرق الساعة بالدقائق"><Input dir="ltr" readOnly value={diagHealth?.clock_confirmed?String(diagHealth.clock_drift_minutes):'—'}/></Field>
     <Field label="آخر فحص للساعة"><Input readOnly value={fmt(diagHealth?.clock_checked_at)}/></Field>
     <Field label="DateTime من الجهاز"><Input dir="ltr" readOnly value={diagDevice?.metadata?.clock_probe?.datetime||'—'}/></Field>
     <Field label="ServerTZ من الجهاز"><Input dir="ltr" readOnly value={diagDevice?.metadata?.clock_probe?.server_tz||'—'}/></Field>
     <Field label="حالة آخر مزامنة"><Input readOnly value={clockSyncLabel(diagDevice?.metadata?.last_clock_sync?.status)}/></Field>
     <Field label="طلب المزامنة"><Input readOnly value={fmt(diagDevice?.metadata?.last_clock_sync?.requested_at)}/></Field>
     <Field label="استلام الجهاز"><Input readOnly value={fmt(diagDevice?.metadata?.last_clock_sync?.accepted_at)}/></Field>
     <Field label="التحقق الفعلي"><Input readOnly value={fmt(diagDevice?.metadata?.last_clock_sync?.verified_at)}/></Field>
     <Field label="آخر فرق بعد التحديث"><Input dir="ltr" readOnly value={diagDevice?.metadata?.last_clock_sync?.verified_drift_seconds!=null?String(Math.round(Number(diagDevice.metadata.last_clock_sync.verified_drift_seconds)/60*10)/10)+' دقيقة':'—'}/></Field>
    </div>
    <div style={{display:'grid',gap:6,marginTop:12}}>{(diagHealth?.issues||[]).length?(diagHealth.issues||[]).map((x,i)=><div key={i} className="training-banner">{x}</div>):<div className="success-note"><ShieldCheck size={16}/> لا توجد مشاكل ظاهرة في بيانات الجهاز الحالية.</div>}</div>
    {diagDevice&&state.permissions?.manage_devices&&<div className="modal-actions"><Button onClick={()=>probeClock(diagDevice)} disabled={clockBusy===diagDevice.id}><Clock3 size={14}/>{clockBusy===diagDevice.id?' جاري الفحص...':' فحص الساعة'}</Button><Button variant="primary" onClick={()=>syncClock(diagDevice)} disabled={clockBusy===diagDevice.id}><RefreshCw size={14}/> تحديث الساعة من السيرفر</Button></div>}
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
