import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CalendarClock,CalendarDays,Clock3,Plus,RefreshCw,ShieldCheck,Trash2,UploadCloud,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import RecordTimeline from '../../components/RecordTimeline.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';
import AttendanceBiometrics from './AttendanceBiometrics.jsx';

const DAYS=[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']];
const ALL_DAYS=[0,1,2,3,4,5,6];
const defaultPeriod=()=>({label:'فترة مخصصة',start_time:'08:00',end_time:'17:00',grace_minutes:10,device_shift_template_id:'',source_type:'custom',weekdays:[...ALL_DAYS]});
const blank={id:'',employee_code:'',name:'',branch_id:'',phone:'',national_id:'',department:'',job_title:'',staff_user_id:'',weekly_off_days:[5],status:'active',data_environment:'training',notes:'',reason:'',schedule_effective_from:today(),shift_periods:[defaultPeriod()]};
function today(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
const blankRule=()=>({id:'',rule_type:'leave',label:'',start_date:today(),end_date:today(),start_time:'08:00',end_time:'17:00',grace_minutes:10,policy_payload:{attendance_mode:'mobile'},notes:'',reason:''});
const ruleLabel=t=>t==='leave'?'إجازة':t==='permission'?'استئذان':t==='overtime'?'عمل إضافي':t==='work_override'?'دوام مؤقت':t==='off'?'راحة / إجازة إضافية':t==='attendance_exempt'?'معفى من الحضور والانصراف':t==='location_exempt'?'معفى من شرط الموقع':t==='late_exempt'?'معفى من التأخير':t==='checkout_exempt'?'معفى من تسجيل الانصراف':t==='attendance_mode_override'?'طريقة حضور خاصة':t||'—';
const ruleTone=t=>t==='leave'||t==='off'||t==='attendance_exempt'?'blue':t==='overtime'?'green':t==='permission'||t==='late_exempt'||t==='checkout_exempt'?'orange':t==='attendance_mode_override'||t==='location_exempt'?'green':'blue';
const versionSourceLabel=v=>({manual:'تعديل يدوي',audit_backfill:'مستعاد من سجل التدقيق',audit_before:'الجدول السابق لأول تعديل',current_baseline:'خط أساس من الجدول الحالي'}[v]||v||'غير محدد');
const fmtDateTime=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const offDaysLabel=v=>{const a=Array.isArray(v)?v.map(Number).sort():[];return a.length?a.map(n=>DAYS[n]?.[1]||String(n)).join('، '):'لا توجد راحة أسبوعية'};
const periodSummary=v=>{const a=Array.isArray(v)?[...v].sort((x,y)=>Number(x.sequence_no||0)-Number(y.sequence_no||0)):[];return a.length?a.map((p,i)=>(p.label||('الفترة '+String(i+1)))+' '+String(p.start_time||'').slice(0,5)+'–'+String(p.end_time||'').slice(0,5)).join(' | '):'لا توجد فترات دوام'};
const versionSignature=v=>JSON.stringify({periods:(Array.isArray(v?.shift_periods)?v.shift_periods:[]).map((p,i)=>({sequence_no:Number(p.sequence_no||i+1),label:String(p.label||''),start_time:String(p.start_time||'').slice(0,5),end_time:String(p.end_time||'').slice(0,5),grace_minutes:Number(p.grace_minutes||0),weekdays:(Array.isArray(p.weekdays)?p.weekdays:ALL_DAYS).map(Number).sort()})),weekly_off_days:(Array.isArray(v?.weekly_off_days)?v.weekly_off_days:[]).map(Number).sort()});

export default function AttendanceEmployees({state,onChanged,onError,onNotice}){
 const branches=state.branches||[],employees=state.employees||[],users=state.users||[],links=state.links||[],devices=state.devices||[],shiftPeriods=state.shiftPeriods||[],scheduleVersions=state.scheduleVersions||[],deviceShiftTemplates=state.deviceShiftTemplates||[],deleteRequests=state.deleteRequests||[],calendarRules=state.calendarRules||[],biometricProfiles=state.biometricProfiles||[],mobileDevices=state.mobileDevices||[],policies=state.policies||[];
 const [open,setOpen]=useState(false),[form,setForm]=useState(blank),[busy,setBusy]=useState(false),[pushBusy,setPushBusy]=useState(''),[deleteBusy,setDeleteBusy]=useState(''),[deleteWatching,setDeleteWatching]=useState(''),[mobileReviewBusy,setMobileReviewBusy]=useState('');
 const [calendarOpen,setCalendarOpen]=useState(false),[calendarEmployee,setCalendarEmployee]=useState(null),[ruleForm,setRuleForm]=useState(blankRule()),[ruleBusy,setRuleBusy]=useState(false),[scheduleHistoryEmployee,setScheduleHistoryEmployee]=useState(null);
 const [policyPreview,setPolicyPreview]=useState(null),[policyPreviewDate,setPolicyPreviewDate]=useState(today()),[policyPreviewBusy,setPolicyPreviewBusy]=useState(false);
 const deleteTimer=useRef(null);
 const [listFilter,setListFilter]=useState({q:'',branch:'',department:'',status:'',device:''});
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const templateMap=useMemo(()=>new Map(deviceShiftTemplates.map(x=>[String(x.id),x])),[deviceShiftTemplates]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no));return m},[shiftPeriods]);
 const linksMap=useMemo(()=>{const m=new Map();for(const l of links){if(!l.attendance_employee_id||!l.active)continue;const k=String(l.attendance_employee_id),a=m.get(k)||[];a.push(l);m.set(k,a)}return m},[links]);
 const deleteMap=useMemo(()=>{const m=new Map();for(const r of deleteRequests){const k=String(r.attendance_employee_id||'');if(k&&!m.has(k))m.set(k,r)}return m},[deleteRequests]);
 const rulesMap=useMemo(()=>{const m=new Map();for(const r of calendarRules){const k=String(r.attendance_employee_id),a=m.get(k)||[];a.push(r);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>String(y.start_date).localeCompare(String(x.start_date)));return m},[calendarRules]);
 const biometricMap=useMemo(()=>{const m=new Map();for(const r of biometricProfiles){if(r.status!=='active')continue;const k=String(r.attendance_employee_id),a=m.get(k)||[];a.push(r);m.set(k,a)}return m},[biometricProfiles]);
 const branchPolicyMap=useMemo(()=>new Map(policies.map(p=>[String(p.branch_id),p])),[policies]);
 const mobileDeviceMap=useMemo(()=>{const m=new Map();for(const r of mobileDevices){const k=String(r.attendance_employee_id),a=m.get(k)||[];a.push(r);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>String(y.updated_at||'').localeCompare(String(x.updated_at||'')));return m},[mobileDevices]);
 const currentAttendancePolicyMap=useMemo(()=>{
  const m=new Map(),day=today();
  for(const e of employees){
   const active=(rulesMap.get(String(e.id))||[]).filter(r=>String(r.start_date)<=day&&String(r.end_date)>=day&&r.status!=='cancelled');
   const override=active.find(r=>r.rule_type==='attendance_mode_override')?.policy_payload?.attendance_mode;
   const base=branchPolicyMap.get(String(e.branch_id))?.attendance_mode||'biometric';
   m.set(String(e.id),{
    mode:['biometric','mobile','hybrid'].includes(String(override))?String(override):base,
    exempt:active.some(r=>r.rule_type==='attendance_exempt'),
    location_exempt:active.some(r=>r.rule_type==='location_exempt'),
    late_exempt:active.some(r=>r.rule_type==='late_exempt'),
    checkout_exempt:active.some(r=>r.rule_type==='checkout_exempt'),
    override:!!override
   });
  }
  return m;
 },[employees,rulesMap,branchPolicyMap]);
 const scheduleTimeline=useMemo(()=>{
  if(!scheduleHistoryEmployee?.id)return [];
  const asc=(scheduleVersions||[]).filter(v=>String(v.attendance_employee_id)===String(scheduleHistoryEmployee.id)).sort((a,b)=>String(a.effective_from).localeCompare(String(b.effective_from)));
  return asc.map((v,i)=>{
   const previous=i?asc[i-1]:null,sameSchedule=!!previous&&versionSignature(previous)===versionSignature(v);
   const actorName=value=>{
    const raw=String(value||'').trim();if(!raw)return 'النظام';
    const user=userMap.get(raw);if(user)return user.name||raw;
    if(raw.startsWith('system:'))return 'النظام';
    if(raw.startsWith('schedule_history_'))return 'أداة تصحيح سجل الدوام';
    if(/^[0-9a-f-]{36}$/i.test(raw))return 'مستخدم محفوظ بالنظام';
    return raw;
   };
   return {...v,previous,sameSchedule,isFuture:String(v.effective_from)>today(),created_actor_label:actorName(v.created_by),updated_actor_label:actorName(v.updated_by)};
  }).reverse();
 },[scheduleVersions,scheduleHistoryEmployee,userMap]);

 const branchOptions=useMemo(()=>branches.map(b=>({value:String(b.id),label:b.name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[branches]);
 const departmentOptions=useMemo(()=>[...new Set(employees.map(e=>String(e.department||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:v})),[employees]);
 const employeeDeviceOptions=useMemo(()=>devices.map(d=>({value:String(d.id),label:d.name||d.serial_number||d.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[devices]);
 const filteredEmployees=useMemo(()=>employees.filter(r=>{
  const ls=linksMap.get(String(r.id))||[];
  return (!listFilter.branch||String(r.branch_id)===String(listFilter.branch))
   &&(!listFilter.department||String(r.department||'')===String(listFilter.department))
   &&(!listFilter.status||String(r.status||'active')===String(listFilter.status))
   &&(!listFilter.device||ls.some(l=>String(l.device_id)===String(listFilter.device)))
   &&matchesListQuery(listFilter.q,r.employee_code,r.name,r.phone,r.national_id,r.department,r.job_title,branchMap.get(String(r.branch_id)),ls.map(l=>deviceMap.get(String(l.device_id))?.name));
 }),[employees,listFilter,linksMap,branchMap,deviceMap]);

 const availableTemplates=useMemo(()=>{
  const branchDevices=new Set(devices.filter(d=>!form.branch_id||String(d.branch_id)===String(form.branch_id)).map(d=>String(d.id)));
  const linkedDevices=new Set(form.id?(linksMap.get(String(form.id))||[]).map(l=>String(l.device_id)):[]);
  return deviceShiftTemplates
   .filter(t=>branchDevices.has(String(t.device_id)))
   .sort((a,b)=>{
    const al=linkedDevices.has(String(a.device_id))?0:1,bl=linkedDevices.has(String(b.device_id))?0:1;
    return al-bl||String(deviceMap.get(String(a.device_id))?.name||'').localeCompare(String(deviceMap.get(String(b.device_id))?.name||''),'ar')||Number(a.sequence_no)-Number(b.sequence_no);
   });
 },[deviceShiftTemplates,devices,form.branch_id,form.id,linksMap,deviceMap]);

 useEffect(()=>{
  if(!deleteWatching)return;
  const req=deleteMap.get(String(deleteWatching));
  if(req&&req.status!=='pending'){setDeleteWatching('');return}
  clearTimeout(deleteTimer.current);
  deleteTimer.current=setTimeout(()=>onChanged?.(),2000);
  return()=>clearTimeout(deleteTimer.current);
 },[deleteWatching,deleteRequests,deleteMap,onChanged]);

 function add(){setForm({...blank,branch_id:state.scope?.branch_id||branches[0]?.id||'',data_environment:state.scope?.environment||'training',schedule_effective_from:today(),shift_periods:[defaultPeriod()]});setOpen(true)}
 function edit(r){
  const periods=(periodsMap.get(String(r.id))||[]).map((p,i)=>({
   label:p.label||('الفترة '+String(i+1)),
   start_time:String(p.start_time||'').slice(0,5),
   end_time:String(p.end_time||'').slice(0,5),
   grace_minutes:Number(p.grace_minutes??10),
   device_shift_template_id:p.device_shift_template_id||'',
   source_type:p.device_shift_template_id?'device_template':'custom',
   weekdays:Array.isArray(p.weekdays)&&p.weekdays.length?p.weekdays.map(Number):[...ALL_DAYS]
  }));
  if(!periods.length&&r.shift_start&&r.shift_end)periods.push({label:'فترة مخصصة',start_time:String(r.shift_start).slice(0,5),end_time:String(r.shift_end).slice(0,5),grace_minutes:Number(r.grace_minutes??10),device_shift_template_id:'',source_type:'custom',weekdays:[...ALL_DAYS]});
  setForm({...blank,...r,branch_id:r.branch_id||'',staff_user_id:r.staff_user_id||'',weekly_off_days:Array.isArray(r.weekly_off_days)?r.weekly_off_days:[],schedule_effective_from:today(),shift_periods:periods.length?periods:[defaultPeriod()],reason:''});setOpen(true);
 }
 function updatePeriod(i,key,value){
  setForm(x=>({...x,shift_periods:(x.shift_periods||[]).map((p,idx)=>{
   if(idx!==i)return p;
   const changed={...p,[key]:key==='grace_minutes'?Number(value||0):value};
   if(['label','start_time','end_time','grace_minutes','weekdays'].includes(key)&&p.device_shift_template_id)return {...changed,device_shift_template_id:'',source_type:'custom'};
   return changed;
  })}))
 }
 function togglePeriodDay(i,day,checked){
  setForm(x=>({...x,shift_periods:(x.shift_periods||[]).map((p,idx)=>{
   if(idx!==i)return p;
   const current=Array.isArray(p.weekdays)?p.weekdays.map(Number):[...ALL_DAYS];
   const days=checked?[...new Set([...current,day])].sort() : current.filter(v=>v!==day);
   return {...p,weekdays:days,device_shift_template_id:p.device_shift_template_id?'':'',source_type:'custom'};
  })}))
 }
 function addCustomPeriod(){setForm(x=>({...x,shift_periods:[...(x.shift_periods||[]),{...defaultPeriod(),label:'فترة مخصصة '+String((x.shift_periods||[]).filter(p=>!p.device_shift_template_id).length+1),start_time:'',end_time:''}]}))}
 function addTemplatePeriod(t){
  setForm(x=>{
   const exists=(x.shift_periods||[]).some(p=>String(p.device_shift_template_id)===String(t.id));
   if(exists)return x;
   return {...x,shift_periods:[...(x.shift_periods||[]),{label:t.name,start_time:String(t.start_time).slice(0,5),end_time:String(t.end_time).slice(0,5),grace_minutes:Number(t.grace_minutes??10),device_shift_template_id:t.id,source_type:'device_template',weekdays:[...ALL_DAYS]}]};
  });
 }
 function removePeriod(i){setForm(x=>({...x,shift_periods:(x.shift_periods||[]).filter((_,idx)=>idx!==i)}))}

 async function save(e){
  e.preventDefault();setBusy(true);onError?.('');
  try{
   if((form.shift_periods||[]).some(p=>!Array.isArray(p.weekdays)||!p.weekdays.length))throw new Error('حدد يومًا واحدًا على الأقل لكل فترة دوام.');
   const out=await api.attendanceWrite({action:'save_employee',...form,auto_push:true});
   setOpen(false);
   const queued=Number(out?.devices_queued||0);
   if(out?.scheduled_for_future)onNotice?.('تم حفظ جدول الدوام المستقبلي. سيظل الجدول الحالي مطبقًا حتى '+String(out.activates_on||form.schedule_effective_from)+'، ثم يتفعّل الجديد تلقائيًا.');
   else onNotice?.(queued>0?'تم حفظ الموظف وجدوله وتم تجهيز رفع بياناته تلقائيًا إلى '+queued+' جهاز/أجهزة.':'تم حفظ الموظف وجدول الدوام. لا يوجد جهاز مربوط به للرفع التلقائي.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }
 async function push(r){
  setPushBusy(r.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'push_employee_to_devices',attendance_employee_id:r.id});
   onNotice?.('تم تجهيز إعادة رفع بيانات الموظف إلى '+String(Math.max(1,Math.floor((out?.count||2)/2)))+' جهاز/أجهزة.');await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setPushBusy('')}
 }
 async function reviewMobileDevice(row,decision){
  const key=row.id+':'+decision;setMobileReviewBusy(key);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'review_mobile_device',id:row.id,decision,reason:decision==='approve'?'اعتماد جهاز حضور الجوال':'إلغاء اعتماد جهاز حضور الجوال'});
   onNotice?.(out?.message||'تم تحديث حالة جهاز الجوال.');await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setMobileReviewBusy('')}
 }
 async function removeEmployee(r){
  const linked=linksMap.get(String(r.id))||[],req=deleteMap.get(String(r.id)),retry=req?.status==='failed';
  const msg=linked.length
   ?'سيتم حذف «'+r.name+'» من النظام ومن '+linked.length+' جهاز/أجهزة بصمة مرتبطة به. سجل الحضور القديم سيظل محفوظًا ولن يُحذف. هل تريد المتابعة؟'
   :'سيتم حذف «'+r.name+'» من النظام. سجل الحضور القديم سيظل محفوظًا. هل تريد المتابعة؟';
  if(!confirm(msg))return;
  setDeleteBusy(r.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'delete_employee',attendance_employee_id:r.id,reason:retry?'إعادة محاولة حذف الموظف من النظام والجهاز':'حذف الموظف من النظام والجهاز'});
   if(out?.pending){setDeleteWatching(r.id);onNotice?.(out.message||'تم إرسال أمر الحذف للجهاز، وسيُحذف الموظف من النظام بعد تأكيد الجهاز.')}
   else{setDeleteWatching('');onNotice?.(out?.message||'تم حذف الموظف مع الاحتفاظ بسجلات الحضور القديمة.')}
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setDeleteBusy('')}
 }

 async function openPolicyPreview(r,date=today()){
  setPolicyPreviewBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'preview_attendance_policy',attendance_employee_id:r.id,work_date:date});
   setPolicyPreview(out);setPolicyPreviewDate(date);
  }catch(err){onError?.(err.message)}finally{setPolicyPreviewBusy(false)}
 }
 function openCalendar(r){setCalendarEmployee(r);setRuleForm(blankRule());setCalendarOpen(true)}
 function editRule(r){setRuleForm({...blankRule(),...r,start_time:r.start_time?String(r.start_time).slice(0,5):'08:00',end_time:r.end_time?String(r.end_time).slice(0,5):'17:00',grace_minutes:Number(r.grace_minutes??10),reason:''})}
 async function saveRule(e){
  e.preventDefault();if(!calendarEmployee)return;setRuleBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_calendar_rule',attendance_employee_id:calendarEmployee.id,...ruleForm});
   onNotice?.('تم حفظ '+ruleLabel(ruleForm.rule_type)+' للموظف '+calendarEmployee.name+'.');
   setRuleForm(blankRule());await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setRuleBusy(false)}
 }
 async function deleteRule(r){
  if(!confirm('حذف «'+ruleLabel(r.rule_type)+'» من جدول الموظف؟'))return;setRuleBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'delete_calendar_rule',id:r.id});onNotice?.('تم حذف الاستثناء من جدول الموظف.');setRuleForm(blankRule());await onChanged?.()}
  catch(err){onError?.(err.message)}finally{setRuleBusy(false)}
 }

 const cols=[
  {key:'code',label:'الكود',render:r=><strong dir="ltr">{r.employee_code}</strong>},
  {key:'name',label:'الموظف',render:r=><div><strong>{r.name}</strong><div className="muted-small">{r.job_title||''}{r.department?' · '+r.department:''}</div></div>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'shift',label:'جدول الدوام',render:r=>{const ps=periodsMap.get(String(r.id))||[];return ps.length?<div style={{display:'grid',gap:3}}>{ps.map(p=><span key={p.id||p.sequence_no} className="muted-small"><Clock3 size={12}/> {p.label||'فترة'}: {String(p.start_time).slice(0,5)} — {String(p.end_time).slice(0,5)} · {(Array.isArray(p.weekdays)?p.weekdays:ALL_DAYS).map(n=>DAYS[n]?.[1]?.slice(0,2)).filter(Boolean).join(' ')}</span>)}</div>:'غير محدد'}},
  {key:'calendar',label:'استثناءات',render:r=>{const rs=rulesMap.get(String(r.id))||[];return rs.length?<div><strong>{rs.length}</strong><div className="muted-small">{rs.slice(0,2).map(x=>ruleLabel(x.rule_type)).join(' · ')}</div></div>:'—'}},
  {key:'policy',label:'سياسة الحضور الآن',render:r=>{const p=currentAttendancePolicyMap.get(String(r.id))||{mode:'biometric'};if(p.exempt)return <Badge tone="blue">معفى حاليًا</Badge>;return <div><Badge tone={p.mode==='mobile'?'green':p.mode==='hybrid'?'orange':'blue'}>{p.mode==='mobile'?'جوال':p.mode==='hybrid'?'مختلط':'بصمة'}</Badge>{p.override&&<div className="muted-small">استثناء خاص بالموظف</div>}</div>}},
  {key:'device',label:'أجهزة الربط',render:r=>{const ls=linksMap.get(String(r.id))||[],p=currentAttendancePolicyMap.get(String(r.id))||{mode:'biometric'};return ls.length?<div style={{display:'grid',gap:2}}>{ls.map(l=><span key={l.id} className="muted-small">{deviceMap.get(String(l.device_id))?.name||'جهاز'} · PIN {l.device_pin}</span>)}</div>:p.exempt?<Badge tone="blue">غير مطلوب — معفى</Badge>:p.mode==='mobile'?<Badge tone="green">غير مطلوب — جوال</Badge>:p.mode==='hybrid'?<Badge>اختياري — مختلط</Badge>:'غير مربوط'}},
  {key:'biometric',label:'الهوية البيومترية',render:r=>{const bs=biometricMap.get(String(r.id))||[],faces=bs.filter(x=>x.biometric_type==='face').length,fingers=bs.filter(x=>x.biometric_type==='finger').length,p=currentAttendancePolicyMap.get(String(r.id))||{mode:'biometric'};return bs.length?<div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{faces>0&&<Badge tone="green">وجه {faces}</Badge>}{fingers>0&&<Badge>أصابع {fingers}</Badge>}</div>:p.exempt?<Badge tone="blue">غير مطلوب</Badge>:p.mode==='mobile'?<Badge tone="green">غير مطلوب</Badge>:p.mode==='hybrid'?<Badge>اختياري</Badge>:<Badge tone="orange">غير مسجل</Badge>}},
  {key:'mobile',label:'جوال الحضور',render:r=>{const ms=mobileDeviceMap.get(String(r.id))||[];if(!ms.length)return (branchPolicyMap.get(String(r.branch_id))?.attendance_mode==='mobile'||branchPolicyMap.get(String(r.branch_id))?.attendance_mode==='hybrid')?<span className="muted-small">لم يسجل جهازًا بعد</span>:'—';return <div style={{display:'grid',gap:6}}>{ms.slice(0,3).map(m=><div key={m.id}><Badge tone={m.status==='approved'?'green':m.status==='pending'?'orange':'red'}>{m.status==='approved'?'معتمد':m.status==='pending'?'بانتظار الاعتماد':'موقوف'}</Badge><div className="muted-small">{m.device_label||'جوال'}{m.last_seen_at?' · '+fmtDateTime(m.last_seen_at):''}</div>{state.permissions?.manage_employees&&<div className="finance-actions" style={{marginTop:3}}>{m.status!=='approved'&&<Button onClick={()=>reviewMobileDevice(m,'approve')} disabled={mobileReviewBusy===m.id+':approve'}>اعتماد</Button>}{m.status!=='revoked'&&<Button onClick={()=>reviewMobileDevice(m,'revoke')} disabled={mobileReviewBusy===m.id+':revoke'}>إلغاء</Button>}</div>}</div>)}</div>}},
  {key:'status',label:'الحالة',render:r=>{const req=deleteMap.get(String(r.id));if(req?.status==='pending')return <Badge tone="orange">جارٍ الحذف من الجهاز</Badge>;if(req?.status==='failed')return <div><Badge tone="red">فشل حذف الجهاز</Badge><div className="muted-small">نجح {req.success_count||0} · فشل {req.failed_count||0}</div></div>;return r.status==='active'?<Badge tone="green">نشط</Badge>:<Badge tone="red">موقوف</Badge>}},
  {key:'edit',label:'',render:r=>{const req=deleteMap.get(String(r.id)),pending=req?.status==='pending',failed=req?.status==='failed';return <div className="finance-actions"><RecordTimeline entityId={r.id} title={'تاريخ موظف الحضور — '+r.name} subtitle="إنشاء وتعديل الجدول والربط والدمج وأي تغيير مسجل على الموظف." label="السجل"/>{(state.permissions?.manage_schedules||state.permissions?.reports)&&<Button onClick={()=>setScheduleHistoryEmployee(r)}><CalendarClock size={14}/> سجل الدوام</Button>}<Button onClick={()=>openPolicyPreview(r)} disabled={policyPreviewBusy}><ShieldCheck size={14}/> السياسة الفعلية</Button>{state.permissions?.manage_biometrics&&<AttendanceBiometrics state={state} employee={r} onChanged={onChanged} onError={onError} onNotice={onNotice} disabled={pending}/>} {state.permissions?.manage_employees&&<Button onClick={()=>edit(r)} disabled={pending}>تعديل</Button>}{state.permissions?.manage_schedules&&<Button onClick={()=>openCalendar(r)} disabled={pending}><CalendarDays size={14}/> الجدول والاستثناءات</Button>}{state.permissions?.manage_devices&&(linksMap.get(String(r.id))||[]).length>0&&<Button onClick={()=>push(r)} disabled={pushBusy===r.id||pending}><RefreshCw size={14}/>{pushBusy===r.id?' جاري الرفع...':' إعادة رفع'}</Button>}{state.permissions?.delete_employees&&<Button onClick={()=>removeEmployee(r)} disabled={deleteBusy===r.id||pending}><Trash2 size={14}/>{deleteBusy===r.id?' جاري الطلب...':pending?' جارٍ الحذف...':failed?' إعادة محاولة الحذف':' حذف'}</Button>}</div>}}
 ];

 const calendarCols=[
  {key:'type',label:'النوع',render:r=><Badge tone={ruleTone(r.rule_type)}>{ruleLabel(r.rule_type)}</Badge>},
  {key:'range',label:'الفترة',render:r=><div><strong>{r.start_date===r.end_date?r.start_date:r.start_date+' → '+r.end_date}</strong>{r.start_time&&r.end_time&&<div className="muted-small" dir="ltr">{String(r.start_time).slice(0,5)} — {String(r.end_time).slice(0,5)}</div>}</div>},
  {key:'label',label:'الوصف',render:r=>r.label||r.notes||'—'},
  {key:'action',label:'',render:r=>state.permissions?.manage_schedules?<div className="finance-actions"><Button onClick={()=>editRule(r)}>تعديل</Button><Button onClick={()=>deleteRule(r)} disabled={ruleBusy}><Trash2 size={14}/> حذف</Button></div>:'—'}
 ];

 const needsTime=['permission','overtime','work_override'].includes(ruleForm.rule_type);
 const needsGrace=ruleForm.rule_type==='work_override';
 const needsModeOverride=ruleForm.rule_type==='attendance_mode_override';

 return <><Card><div className="card-title"><div><h3><Users size={19}/> موظفو الحضور</h3><small>جدول أسبوعي مرن لكل موظف، مع دوام مؤقت وإجازات واستئذان وعمل إضافي حسب التاريخ.</small></div><div className="finance-actions"><Badge>{employees.length}</Badge>{state.permissions?.manage_employees&&<Button variant="primary" onClick={add}><Plus size={15}/> موظف جديد</Button>}</div></div><><SmartListFilters storageKey="attendance-employees-filters" search={listFilter.q} onSearchChange={v=>setListFilter(x=>({...x,q:v}))} searchPlaceholder="ابحث بالاسم أو الكود أو الجوال أو الهوية أو القسم..." totalCount={employees.length} resultCount={filteredEmployees.length} onReset={()=>setListFilter({q:'',branch:'',department:'',status:'',device:''})} filters={[
 {key:'branch',label:'الفرع',value:listFilter.branch,onChange:v=>setListFilter(x=>({...x,branch:v})),options:branchOptions},
 {key:'department',label:'القسم',value:listFilter.department,onChange:v=>setListFilter(x=>({...x,department:v})),options:departmentOptions},
 {key:'status',label:'الحالة',value:listFilter.status,onChange:v=>setListFilter(x=>({...x,status:v})),options:[{value:'active',label:'نشط'},{value:'inactive',label:'موقوف'}]},
 {key:'device',label:'جهاز البصمة',value:listFilter.device,onChange:v=>setListFilter(x=>({...x,device:v})),options:employeeDeviceOptions}
 ]}/><Table preferenceKey="attendance-employees" defaultPageSize={25} rows={filteredEmployees} columns={cols}/></><div className="success-note"><Trash2 size={16}/> حذف الموظف لا يحذف سجل حضوره القديم. إذا كان مربوطًا بجهاز بصمة، يُحذف من الجهاز أولًا ثم من النظام بعد التأكيد.</div></Card>

 <Modal open={open} onClose={()=>setOpen(false)} title={form.id?'تعديل موظف حضور':'إضافة موظف حضور'} wide><form onSubmit={save} className="form-grid">
  <Field label="اسم الموظف"><Input value={form.name||''} onChange={e=>setForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="كود الموظف" hint="اتركه فارغًا ليولده النظام تلقائيًا"><Input dir="ltr" value={form.employee_code||''} onChange={e=>setForm(x=>({...x,employee_code:e.target.value.toUpperCase()}))} placeholder="ATT-0001"/></Field>
  <Field label="الفرع"><Select value={form.branch_id||''} onChange={e=>setForm(x=>({...x,branch_id:e.target.value}))} required><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
  <Field label="الجوال"><Input dir="ltr" value={form.phone||''} onChange={e=>setForm(x=>({...x,phone:e.target.value}))}/></Field>
  <Field label="رقم الهوية"><Input dir="ltr" value={form.national_id||''} onChange={e=>setForm(x=>({...x,national_id:e.target.value}))}/></Field>
  <Field label="القسم"><Input value={form.department||''} onChange={e=>setForm(x=>({...x,department:e.target.value}))}/></Field>
  <Field label="المسمى الوظيفي"><Input value={form.job_title||''} onChange={e=>setForm(x=>({...x,job_title:e.target.value}))}/></Field>
  <Field label="حساب النظام (اختياري)"><Select value={form.staff_user_id||''} onChange={e=>setForm(x=>({...x,staff_user_id:e.target.value}))}><option value="">بدون حساب دخول</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} — {branchMap.get(String(u.branch_id))||'إدارة عامة'}</option>)}</Select></Field>

  <div className="field" style={{gridColumn:'1/-1'}}>
   <span>قوالب الدوام الجاهزة</span>
   {availableTemplates.length?<div style={{display:'grid',gap:8}}>
    {availableTemplates.map(t=>{const selected=(form.shift_periods||[]).some(p=>String(p.device_shift_template_id)===String(t.id));return <div key={t.id} className="success-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
      <div><strong>{deviceMap.get(String(t.device_id))?.name||'الجهاز'} — {t.name}</strong><div className="muted-small">{String(t.start_time).slice(0,5)} — {String(t.end_time).slice(0,5)} · سماح {t.grace_minutes} د</div></div>
      <Button type="button" disabled={selected} onClick={()=>addTemplatePeriod(t)}>{selected?'مضافة':'إضافة للموظف'}</Button>
     </div>})}
   </div>:<div className="muted-small">لا توجد قوالب جاهزة في هذا الفرع. يمكنك إضافة فترة مخصصة.</div>}
  </div>

  <div className="field" style={{gridColumn:'1/-1'}}>
   <span>الفترات الأسبوعية المطبقة على الموظف</span>
   <div style={{display:'grid',gap:10}}>
    {(form.shift_periods||[]).map((p,i)=><Card key={i}><div className="form-grid">
      <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
       <div>{p.device_shift_template_id?<Badge tone="green">قالب جاهز: {templateMap.get(String(p.device_shift_template_id))?.name||p.label}</Badge>:<Badge>فترة مخصصة</Badge>}</div>
       <Button type="button" onClick={()=>removePeriod(i)}><Trash2 size={14}/> حذف</Button>
      </div>
      <Field label="اسم الفترة"><Input value={p.label||''} onChange={e=>updatePeriod(i,'label',e.target.value)} required/></Field>
      <Field label="بداية الدوام"><Input type="time" value={p.start_time||''} onChange={e=>updatePeriod(i,'start_time',e.target.value)} required/></Field>
      <Field label="نهاية الدوام"><Input type="time" value={p.end_time||''} onChange={e=>updatePeriod(i,'end_time',e.target.value)} required/></Field>
      <Field label="السماح بالدقائق"><Input type="number" min="0" max="240" value={p.grace_minutes??10} onChange={e=>updatePeriod(i,'grace_minutes',e.target.value)}/></Field>
      <div className="field" style={{gridColumn:'1/-1'}}><span>أيام هذه الفترة</span><div className="finance-actions">{DAYS.map(([v,label])=>{const n=Number(v),checked=(p.weekdays||ALL_DAYS).includes(n);return <label key={v} style={{display:'inline-flex',alignItems:'center',gap:5}}><input type="checkbox" checked={checked} onChange={e=>togglePeriodDay(i,n,e.target.checked)}/>{label}</label>})}</div></div>
      {p.device_shift_template_id&&<div className="muted-small" style={{gridColumn:'1/-1'}}>لو عدلت الوقت أو الأيام لهذا الموظف، تتحول الفترة تلقائيًا إلى مخصصة ولا تتأثر لاحقًا بتعديل القالب الجاهز.</div>}
    </div></Card>)}
    <div><Button type="button" onClick={addCustomPeriod}><Plus size={14}/> إضافة فترة مخصصة</Button></div>
   </div>
  </div>

  {form.id&&<div className="field" style={{gridColumn:'1/-1'}}>
   <span>سجل تغييرات الدوام</span>
   <div className="finance-actions">
    {scheduleVersions.filter(v=>String(v.attendance_employee_id)===String(form.id)).sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from))).slice(0,4).map(v=>{const future=String(v.effective_from)>today();return <Badge key={v.id} tone={future?'orange':v.effective_to?'blue':'green'}>{future?'مجدول '+v.effective_from:v.effective_from+(v.effective_to?' ← '+v.effective_to:' ← مستمر')}</Badge>})}
    {scheduleVersions.some(v=>String(v.attendance_employee_id)===String(form.id))?<Button type="button" onClick={()=>setScheduleHistoryEmployee(employees.find(e=>String(e.id)===String(form.id))||form)}><CalendarClock size={14}/> فتح سجل الدوام الكامل</Button>:<span className="muted-small">لا يوجد تاريخ سابق مسجل بعد.</span>}
   </div>
  </div>}

  {form.id&&<Field label="سريان جدول الدوام من تاريخ" hint="لو التاريخ مستقبلي، يُحفظ الجدول الآن لكن لا يتطبق قبل يوم السريان"><Input type="date" value={form.schedule_effective_from||today()} onChange={e=>setForm(x=>({...x,schedule_effective_from:e.target.value}))} required/></Field>}
  {form.id&&String(form.schedule_effective_from||'')>today()&&<div className="success-note"><CalendarClock size={16}/> جدول مستقبلي: سيظل جدول الموظف الحالي كما هو حتى {form.schedule_effective_from}، ثم يتفعّل الجدول الجديد تلقائيًا.</div>}
  <Field label="الحالة"><Select value={form.status||'active'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option value="active">نشط</option><option value="inactive">موقوف</option></Select></Field>
  <Field label="البيئة"><Select value={form.data_environment||'training'} onChange={e=>setForm(x=>({...x,data_environment:e.target.value}))}><option value="training">Training</option><option value="production">Production</option></Select></Field>
  <div className="field" style={{gridColumn:'1/-1'}}><span>الإجازة الأسبوعية</span><div className="finance-actions">{DAYS.map(([v,label])=><label key={v} style={{display:'inline-flex',alignItems:'center',gap:5}}><input type="checkbox" checked={(form.weekly_off_days||[]).includes(Number(v))} onChange={e=>setForm(x=>({...x,weekly_off_days:e.target.checked?[...(x.weekly_off_days||[]),Number(v)]:(x.weekly_off_days||[]).filter(n=>n!==Number(v))}))}/>{label}</label>)}</div></div>
  <Field label="ملاحظات"><Textarea value={form.notes||''} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></Field>
  <Field label="سبب التعديل"><Input value={form.reason||''} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><UploadCloud size={16}/> عند الحفظ، النظام يحفظ الجدول ويجهّز رفع بيانات الموظف تلقائيًا لكل جهاز مربوط به. إذا تغير الدوام، يُحفظ كنسخة جديدة من تاريخ السريان وتظل التقارير الأقدم على النسخة السابقة.</div>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ والرفع...':'حفظ ورفع تلقائيًا'}</Button></div>
 </form></Modal>

 <Modal open={!!policyPreview} onClose={()=>setPolicyPreview(null)} title={policyPreview?'السياسة الفعلية — '+policyPreview.employee?.name:'السياسة الفعلية'} wide>
  {policyPreview&&<div className="form-grid">
   <Field label="تاريخ المعاينة"><div className="finance-actions"><Input type="date" value={policyPreviewDate} onChange={e=>setPolicyPreviewDate(e.target.value)}/><Button onClick={()=>openPolicyPreview({id:policyPreview.employee.id},policyPreviewDate)} disabled={policyPreviewBusy}>{policyPreviewBusy?'جاري...':'تحديث المعاينة'}</Button></div></Field>
   <Field label="طريقة الحضور النهائية"><div><Badge tone={policyPreview.attendance_mode==='mobile'?'green':policyPreview.attendance_mode==='hybrid'?'orange':'blue'}>{policyPreview.attendance_mode==='mobile'?'جوال فقط':policyPreview.attendance_mode==='hybrid'?'بصمة أو جوال':'جهاز البصمة فقط'}</Badge><div className="muted-small">بعد تطبيق سياسة الفرع وكل الاستثناءات السارية في هذا التاريخ</div></div></Field>
   <Field label="سريان سياسة الفرع"><div>{policyPreview.policy?.policy_effective_from||'—'}{policyPreview.policy?.policy_effective_to?' → '+policyPreview.policy.policy_effective_to:' → مستمر'}</div></Field>
   <Field label="سياسة الموقع"><div>{policyPreview.policy?.mobile_geofence_enabled===false?'بدون نطاق جغرافي':policyPreview.exceptions?.location_exempt?'معفى من الموقع':('داخل '+String(policyPreview.policy?.mobile_geofence_radius_m||100)+'م · دقة GPS ≤ '+String(policyPreview.policy?.mobile_max_accuracy_m||120)+'م')}</div></Field>
   <div style={{gridColumn:'1/-1'}}>
    <strong>الاستثناءات الفعالة</strong>
    <div className="finance-actions" style={{marginTop:8}}>
     {policyPreview.exceptions?.attendance_exempt&&<Badge tone="blue">معفى من الحضور والانصراف</Badge>}
     {policyPreview.exceptions?.location_exempt&&<Badge tone="green">معفى من الموقع</Badge>}
     {policyPreview.exceptions?.late_exempt&&<Badge tone="orange">معفى من التأخير</Badge>}
     {policyPreview.exceptions?.checkout_exempt&&<Badge tone="orange">معفى من الانصراف</Badge>}
     {policyPreview.exceptions?.attendance_mode_override&&<Badge>طريقة حضور خاصة</Badge>}
     {!policyPreview.exceptions?.attendance_exempt&&!policyPreview.exceptions?.location_exempt&&!policyPreview.exceptions?.late_exempt&&!policyPreview.exceptions?.checkout_exempt&&!policyPreview.exceptions?.attendance_mode_override&&<span className="muted-small">لا توجد استثناءات سارية.</span>}
    </div>
   </div>
   {!!policyPreview.active_rules?.length&&<div style={{gridColumn:'1/-1'}}>
    <strong>القواعد السارية في اليوم</strong>
    <div style={{display:'grid',gap:6,marginTop:8}}>{policyPreview.active_rules.map(r=><div key={r.id} className="success-note"><Badge tone={ruleTone(r.rule_type)}>{ruleLabel(r.rule_type)}</Badge> <strong>{r.label||'بدون وصف'}</strong><span className="muted-small"> · {r.start_date===r.end_date?r.start_date:r.start_date+' → '+r.end_date}</span></div>)}</div>
   </div>}
   {policyPreview.policy?.mobile_require_trusted_device&&policyPreview.mobile_enabled&&<div className="success-note" style={{gridColumn:'1/-1'}}><ShieldCheck size={16}/> تسجيل الجوال لهذا الموظف يتطلب جهازًا موثوقًا ومعتمدًا.</div>}
   <div className="modal-actions"><Button type="button" onClick={()=>setPolicyPreview(null)}>إغلاق</Button></div>
  </div>}
 </Modal>

 <Modal open={!!scheduleHistoryEmployee} onClose={()=>setScheduleHistoryEmployee(null)} title={scheduleHistoryEmployee?'سجل تغييرات الدوام — '+scheduleHistoryEmployee.name:'سجل تغييرات الدوام'} wide>
  <div style={{display:'grid',gap:12}}>
   <div className="success-note"><CalendarClock size={16}/> هذا السجل يعتمد على نسخ الدوام الفعلية التي تستخدمها التقارير. يعرض تاريخ السريان والمنفذ والسبب والجدول قبل/بعد، ولا يعتمد على الجدول الحالي وحده.</div>
   {scheduleTimeline.length?scheduleTimeline.map(v=><Card key={v.id}>
    <div className="card-title">
     <div><h3>{v.effective_from}{v.effective_to?' → '+v.effective_to:' → مستمر'}</h3><small>{versionSourceLabel(v.source_type)}</small></div>
     <div className="finance-actions">{v.isFuture?<Badge tone="orange">مجدول للمستقبل</Badge>:<Badge tone={v.effective_to?'blue':'green'}>{v.effective_to?'نسخة تاريخية':'النسخة الحالية'}</Badge>}{v.sameSchedule&&<Badge tone="orange">تثبيت/تصحيح تاريخ — بدون تغيير المواعيد</Badge>}</div>
    </div>
    <div className="detail-grid" style={{marginTop:10}}>
     <div><span>أنشأها</span><strong>{v.created_actor_label}</strong><div className="muted-small">{fmtDateTime(v.created_at)}</div></div>
     <div><span>آخر تصحيح بواسطة</span><strong>{v.updated_actor_label}</strong><div className="muted-small">{fmtDateTime(v.updated_at)}</div></div>
     <div><span>سبب التغيير</span><strong>{v.reason||'—'}</strong></div>
     <div><span>الراحة الأسبوعية بعد التعديل</span><strong>{offDaysLabel(v.weekly_off_days)}</strong></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10,marginTop:12}}>
     <div className="error-box"><strong>قبل</strong><div style={{marginTop:6}}>{v.previous?periodSummary(v.previous.shift_periods):'— بداية السجل —'}</div>{v.previous&&<div className="muted-small">الراحة: {offDaysLabel(v.previous.weekly_off_days)}</div>}</div>
     <div className="success-note"><strong>بعد</strong><div style={{marginTop:6}}>{periodSummary(v.shift_periods)}</div><div className="muted-small">الراحة: {offDaysLabel(v.weekly_off_days)}</div></div>
    </div>
   </Card>):<div className="empty">لا توجد نسخ دوام تاريخية مسجلة لهذا الموظف.</div>}
   <div className="modal-actions"><Button type="button" onClick={()=>setScheduleHistoryEmployee(null)}>إغلاق</Button></div>
  </div>
 </Modal>

 <Modal open={calendarOpen} onClose={()=>setCalendarOpen(false)} title={'الجدول والاستثناءات'+(calendarEmployee?' — '+calendarEmployee.name:'')} wide>
  <div style={{display:'grid',gap:14}}>
   <div className="success-note"><CalendarDays size={16}/> استخدم «دوام مؤقت» لتغيير دوام يوم أو فترة محددة، و«إجازة/راحة» لإلغاء الالتزام، و«استئذان» للسماح بجزء من الدوام. استثناءات سياسة الحضور مثل «معفى بالكامل» أو «معفى من الموقع» تُطبق فقط داخل فترة السريان المحددة ثم يعود الموظف تلقائيًا لسياسة فرعه.</div>
   <Card><div className="card-title"><h3>الاستثناءات المسجلة</h3><Badge>{(rulesMap.get(String(calendarEmployee?.id))||[]).length}</Badge></div><Table preferenceKey="attendance-calendar-rules" defaultPageSize={25} rows={rulesMap.get(String(calendarEmployee?.id))||[]} columns={calendarCols}/></Card>
   <Card><form onSubmit={saveRule} className="form-grid">
    <Field label="النوع"><Select value={ruleForm.rule_type} onChange={e=>setRuleForm(x=>({...x,rule_type:e.target.value}))}><option value="leave">إجازة</option><option value="off">راحة / إجازة إضافية</option><option value="permission">استئذان</option><option value="overtime">عمل إضافي</option><option value="work_override">دوام مؤقت</option><option value="attendance_exempt">معفى من الحضور والانصراف بالكامل</option><option value="location_exempt">معفى من شرط الموقع</option><option value="late_exempt">معفى من التأخير</option><option value="checkout_exempt">معفى من تسجيل الانصراف</option><option value="attendance_mode_override">طريقة حضور خاصة للموظف</option></Select></Field>
    <Field label="الوصف"><Input value={ruleForm.label||''} onChange={e=>setRuleForm(x=>({...x,label:e.target.value}))} placeholder="مثال: مهمة خارجية / دوام رمضان"/></Field>
    <Field label="من تاريخ"><Input type="date" value={ruleForm.start_date||''} onChange={e=>setRuleForm(x=>({...x,start_date:e.target.value,end_date:x.end_date&&x.end_date>=e.target.value?x.end_date:e.target.value}))} required/></Field>
    <Field label="إلى تاريخ"><Input type="date" value={ruleForm.end_date||''} min={ruleForm.start_date||''} onChange={e=>setRuleForm(x=>({...x,end_date:e.target.value}))} required/></Field>
    {needsTime&&<><Field label="من الساعة"><Input type="time" value={ruleForm.start_time||''} onChange={e=>setRuleForm(x=>({...x,start_time:e.target.value}))} required/></Field><Field label="إلى الساعة"><Input type="time" value={ruleForm.end_time||''} onChange={e=>setRuleForm(x=>({...x,end_time:e.target.value}))} required/></Field></>}
    {needsGrace&&<Field label="السماح بالدقائق"><Input type="number" min="0" max="240" value={ruleForm.grace_minutes??10} onChange={e=>setRuleForm(x=>({...x,grace_minutes:Number(e.target.value||0)}))}/></Field>}
    {needsModeOverride&&<Field label="طريقة الحضور الخاصة"><Select value={ruleForm.policy_payload?.attendance_mode||'mobile'} onChange={e=>setRuleForm(x=>({...x,policy_payload:{...(x.policy_payload||{}),attendance_mode:e.target.value}}))}><option value="biometric">جهاز البصمة فقط</option><option value="mobile">الجوال فقط</option><option value="hybrid">البصمة أو الجوال</option></Select></Field>}
    {['attendance_exempt','location_exempt','late_exempt','checkout_exempt','attendance_mode_override'].includes(ruleForm.rule_type)&&<div className="success-note" style={{gridColumn:'1/-1'}}>{ruleForm.rule_type==='attendance_exempt'?'خلال هذه الفترة لن يُحسب الموظف غائبًا أو متأخرًا بسبب عدم وجود حركة، وسيظهر في التقرير كـ «معفى».':ruleForm.rule_type==='location_exempt'?'الموظف يظل مطالبًا بالتسجيل، لكن عند تفعيل الحضور بالجوال لن يطبق عليه شرط نطاق موقع الفرع خلال هذه الفترة.':ruleForm.rule_type==='late_exempt'?'الحضور يظل مطلوبًا، لكن التأخير لا يُسجل كمخالفة خلال فترة الاستثناء.':ruleForm.rule_type==='checkout_exempt'?'تسجيل الحضور يظل مطلوبًا، وعدم وجود حركة انصراف لا يُعامل كبصمة ناقصة خلال فترة الاستثناء.':'هذه الطريقة تتغلب على طريقة الحضور الأساسية للفرع خلال فترة السريان فقط.'}</div>}
    <Field label="ملاحظات"><Textarea value={ruleForm.notes||''} onChange={e=>setRuleForm(x=>({...x,notes:e.target.value}))}/></Field>
    <Field label="سبب التعديل"><Input value={ruleForm.reason||''} onChange={e=>setRuleForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setRuleForm(blankRule())}>جديد</Button><Button variant="primary" type="submit" disabled={ruleBusy}>{ruleBusy?'جاري الحفظ...':ruleForm.id?'حفظ التعديل':'إضافة'}</Button></div>
   </form></Card>
  </div>
 </Modal></>;
}
