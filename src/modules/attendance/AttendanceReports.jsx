import React,{useMemo,useState} from 'react';
import {AlertTriangle,FileText,Lock,Printer,Unlock} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea,SavedViews} from '../../components/UI.jsx';

const DEFAULT_POLICY={
 early_leave_grace_minutes:10,
 shortage_grace_minutes:15,
 partial_absence_threshold_minutes:60,
 late_penalty_minutes:0,
 early_leave_penalty_minutes:0,
 missing_punch_penalty_minutes:0,
 partial_absence_penalty_minutes:0,
 absence_penalty_minutes:0
};
const text=v=>String(v??'').trim();
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function dayKey(v){try{const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return ''}}
function todayKey(){return dayKey(new Date())}
function monthBounds(day){const v=String(day||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const start=v.slice(0,7)+'-01',[y,m]=start.split('-').map(Number),end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);return {start,end}}
function isFullMonth(from,to){const b=monthBounds(from);return !!b&&b.start===from&&b.end===to}
function dayOfWeek(day){try{return new Date(day+'T12:00:00+03:00').getUTCDay()}catch{return 0}}
function dateRange(from,to){const out=[],a=new Date(from+'T12:00:00+03:00'),b=new Date(to+'T12:00:00+03:00');for(let d=new Date(a);d<=b;d.setUTCDate(d.getUTCDate()+1))out.push(d.toISOString().slice(0,10));return out}
function minutesFromClock(v){const m=String(v||'').match(/(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null}
function timeOnly(v){const s=text(v);const m=s.match(/(?:T|\s)(\d{2}:\d{2}):?\d{0,2}/);return m?.[1]||'—'}
function humanMinutes(v){const n=Math.max(0,Math.round(Number(v)||0)),h=Math.floor(n/60),m=n%60;return h?(String(h)+' س '+(m?String(m)+' د':'' )).trim():String(m)+' د'}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function printTable(title,subtitle,columns,rows){
 const win=window.open('about:blank','_blank');if(!win)throw new Error('اسمح بالنوافذ المنبثقة لطباعة الكشف.');
 const th=columns.map(c=>'<th>'+esc(c.label)+'</th>').join('');
 const body=rows.map(r=>'<tr>'+columns.map(c=>'<td>'+esc(typeof c.value==='function'?c.value(r):r[c.key])+'</td>').join('')+'</tr>').join('');
 const empty='<tr><td colspan="'+columns.length+'">لا توجد بيانات</td></tr>';
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#111;margin:0}.head{text-align:center;margin-bottom:14px}.head h1{font-size:19px;margin:0 0 5px}.head p{font-size:11px;margin:0;color:#555}table{width:100%;border-collapse:collapse;font-size:8.5px}th,td{border:1px solid #bbb;padding:4px;text-align:center;vertical-align:middle}th{background:#f2f4f7}.meta{display:flex;justify-content:space-between;font-size:9px;margin:7px 0 10px}.foot{font-size:8px;color:#666;margin-top:8px;text-align:center}</style></head><body><div class="head"><h1>'+esc(title)+'</h1><p>'+esc(subtitle||'')+'</p></div><div class="meta"><span>نظام الماهر الماسي — الحضور والبصمة</span><span>'+esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))+'</span></div><table><thead><tr>'+th+'</tr></thead><tbody>'+(body||empty)+'</tbody></table><div class="foot">الجزاءات المعروضة إدارية مقترحة بالدقائق حسب سياسة الفرع، ولا تُخصم ماليًا تلقائيًا.</div><script>window.onload=function(){window.print()}</script></body></html>';
 win.document.open();win.document.write(html);win.document.close();
}
function logClock(log){return timeOnly(log.occurred_at||log.device_time_raw)}
function adjustedMinute(m,start,end){if(m==null)return null;if(end<start&&m<start)return m+1440;return m}
function periodDuration(start,end){if(start==null||end==null)return 0;return end>=start?end-start:(end+1440)-start}
function intervalOverlap(a1,a2,b1,b2){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1))}
function distanceToPeriod(m,start,end){const x=adjustedMinute(m,start,end),finish=end<start?end+1440:end,center=(start+finish)/2;return Math.abs(x-center)}
function ruleOnDay(rule,day){return rule.start_date<=day&&rule.end_date>=day}
function ruleMinutes(rule){const s=minutesFromClock(rule.start_time),e=minutesFromClock(rule.end_time);return periodDuration(s,e)}
function statusTone(v){return v==='حضور'?'green':v==='حضور جزئي'?'orange':v==='غياب'?'red':v==='إجازة'||v==='راحة'?'blue':v==='حضور خارج الجدول'?'orange':'blue'}
function reviewLabel(v){return v==='approved'?'معتمدة':v==='waived'?'معفاة':v==='adjusted'?'معدلة':v==='pending'?'بانتظار المراجعة':'—'}
function reviewTone(v){return v==='approved'?'green':v==='waived'?'blue':v==='adjusted'?'orange':v==='pending'?'red':'blue'}
function policyFor(employee,policyMap){return {...DEFAULT_POLICY,...(policyMap.get(String(employee?.branch_id))||{})}}

function expectedPeriods(employee,day,periodsMap,rules,scheduleVersionsMap){
 const dayNo=dayOfWeek(day),dayRules=(rules||[]).filter(r=>ruleOnDay(r,day)),leave=dayRules.find(r=>r.rule_type==='leave'),off=dayRules.find(r=>r.rule_type==='off'),overrides=dayRules.filter(r=>r.rule_type==='work_override');
 if(leave)return {periods:[],dayRules,state:'leave',scheduleVersion:null};
 if(off)return {periods:[],dayRules,state:'off',scheduleVersion:null};
 if(overrides.length)return {periods:overrides.map((r,i)=>({id:r.id,sequence_no:i+1,label:r.label||'دوام مؤقت',start_time:r.start_time,end_time:r.end_time,grace_minutes:r.grace_minutes??employee.grace_minutes??10,weekdays:[dayNo],temporary:true})),dayRules,state:'work',scheduleVersion:null};
 const versions=scheduleVersionsMap?.get(String(employee.id))||[],version=versions.find(v=>String(v.effective_from)<=day&&(!v.effective_to||String(v.effective_to)>=day))||null;
 const weeklyOffDays=version&&Array.isArray(version.weekly_off_days)?version.weekly_off_days:(employee.weekly_off_days||[]);
 const weeklyOff=weeklyOffDays.map(Number).includes(dayNo);
 if(weeklyOff)return {periods:[],dayRules,state:'off',scheduleVersion:version};
 const sourcePeriods=version&&Array.isArray(version.shift_periods)?version.shift_periods:(periodsMap.get(String(employee.id))||[]);
 let periods=(sourcePeriods||[]).filter(p=>{const days=Array.isArray(p.weekdays)&&p.weekdays.length?p.weekdays.map(Number):[0,1,2,3,4,5,6];return days.includes(dayNo)});
 if(!version&&!periods.length&&employee.shift_start&&employee.shift_end)periods=[{sequence_no:1,label:'الفترة الأولى',start_time:employee.shift_start,end_time:employee.shift_end,grace_minutes:employee.grace_minutes??10,weekdays:[dayNo]}];
 return {periods:[...periods].sort((a,b)=>Number(a.sequence_no)-Number(b.sequence_no)),dayRules,state:periods.length?'work':'off',scheduleVersion:version};
}
function permissionOverlap(permissions,start,finish,from,to){
 let total=0;
 for(const pr of permissions){
  const psRaw=minutesFromClock(pr.start_time),peRaw=minutesFromClock(pr.end_time);if(psRaw==null||peRaw==null)continue;
  let ps=psRaw,pe=peRaw<psRaw?peRaw+1440:peRaw;
  if(finish>1440&&ps<start){ps+=1440;pe+=1440}
  total+=intervalOverlap(from,to,ps,pe);
 }
 return total;
}

function buildDaily(logs,employees,periodsMap,scheduleVersionsMap,rules,policyMap,fromDate,toDate,filterEmployeeId,filterDeviceId,links){
 const grouped=new Map();
 for(const log of logs||[]){
  const day=dayKey(log.occurred_at),emp=log.attendance_employee_id?String(log.attendance_employee_id):'',key=(emp||('orphan:'+String(log.employee_name||log.device_pin||'unknown')+':'+String(log.device_id||'')))+'|'+day,arr=grouped.get(key)||[];
  arr.push(log);grouped.set(key,arr);
 }
 const linkedEmployeeIds=filterDeviceId?new Set((links||[]).filter(l=>String(l.device_id)===String(filterDeviceId)&&l.active&&l.attendance_employee_id).map(l=>String(l.attendance_employee_id))):null;
 const selected=(employees||[]).filter(e=>(!filterEmployeeId||String(e.id)===String(filterEmployeeId))&&(!linkedEmployeeIds||linkedEmployeeIds.has(String(e.id))));
 const days=dateRange(fromDate,toDate),rows=[],used=new Set();

 for(const employee of selected){
  const employeeRules=(rules||[]).filter(r=>String(r.attendance_employee_id)===String(employee.id)),policy=policyFor(employee,policyMap);
  for(const day of days){
   const key=String(employee.id)+'|'+day,arr=(grouped.get(key)||[]).sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));used.add(key);
   const schedule=expectedPeriods(employee,day,periodsMap,employeeRules,scheduleVersionsMap),periods=schedule.periods,dayRules=schedule.dayRules;
   const leave=dayRules.find(r=>r.rule_type==='leave'),off=dayRules.find(r=>r.rule_type==='off'),permissions=dayRules.filter(r=>r.rule_type==='permission'),overtimes=dayRules.filter(r=>r.rule_type==='overtime');
   const buckets=periods.map(p=>({period:p,logs:[]}));
   for(const log of arr){
    if(!buckets.length)break;
    const m=minutesFromClock(logClock(log));let best=0,bestScore=Infinity;
    periods.forEach((p,i)=>{const start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time);if(start==null||end==null)return;const score=distanceToPeriod(m,start,end);if(score<bestScore){bestScore=score;best=i}});
    buckets[best].logs.push(log);
   }

   let totalWork=0,totalLate=0,totalEarly=0,scheduledMinutes=0,permissionScheduledMinutes=0,lateViolations=0,earlyViolations=0,missingPunches=0,missedPeriods=0;
   const firstIn=arr.length?logClock(arr[0]):'—',lastOut=arr.length>1?logClock(arr[arr.length-1]):'—',summaries=[];
   for(const b of buckets){
    const p=b.period,start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time),finish=end<start?end+1440:end,grace=Number(p.grace_minutes||0),ls=b.logs.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
    const duration=periodDuration(start,end);scheduledMinutes+=duration;
    permissionScheduledMinutes+=Math.min(duration,permissionOverlap(permissions,start,finish,start,finish));
    if(!ls.length){missedPeriods+=1;summaries.push((p.label||('الفترة '+p.sequence_no))+': غياب عن الفترة');continue}
    const a=ls[0],z=ls[ls.length-1],aClock=logClock(a),zClock=ls.length>1?logClock(z):'—',aM=adjustedMinute(minutesFromClock(aClock),start,end);
    let late=start!=null&&aM!=null?Math.max(0,aM-(start+grace)):0;
    if(late>0)late=Math.max(0,late-permissionOverlap(permissions,start,finish,start+grace,aM));
    if(late>0){lateViolations+=1;totalLate+=late}

    if(ls.length===1){
      missingPunches+=1;
      summaries.push((p.label||('الفترة '+p.sequence_no))+': '+aClock+' — بصمة خروج مفقودة');
      continue;
    }

    const zM=adjustedMinute(minutesFromClock(zClock),start,end);
    let early=end!=null&&zM!=null?Math.max(0,finish-zM-Number(policy.early_leave_grace_minutes||0)):0;
    if(early>0)early=Math.max(0,early-permissionOverlap(permissions,start,finish,zM,finish));
    if(early>0){earlyViolations+=1;totalEarly+=early}
    totalWork+=Math.max(0,(new Date(z.occurred_at)-new Date(a.occurred_at))/60000);
    summaries.push((p.label||('الفترة '+p.sequence_no))+': '+aClock+' — '+zClock);
   }

   if(!periods.length&&arr.length>1)totalWork=Math.max(0,(new Date(arr[arr.length-1].occurred_at)-new Date(arr[0].occurred_at))/60000);
   const approvedPermissionMinutes=Math.min(scheduledMinutes,permissionScheduledMinutes);
   const adjustedScheduledMinutes=Math.max(0,scheduledMinutes-approvedPermissionMinutes);
   const shortageRaw=Math.max(0,adjustedScheduledMinutes-totalWork);
   const shortageMinutes=Math.max(0,shortageRaw-Number(policy.shortage_grace_minutes||0));

   let overtimeMinutes=0;
   if(arr.length>1){
    const presenceStart=minutesFromClock(logClock(arr[0])),presenceEndRaw=minutesFromClock(logClock(arr[arr.length-1]));
    if(presenceStart!=null&&presenceEndRaw!=null){
     const presenceEnd=presenceEndRaw<presenceStart?presenceEndRaw+1440:presenceEndRaw;
     for(const ot of overtimes){
      const os=minutesFromClock(ot.start_time),oeRaw=minutesFromClock(ot.end_time);if(os==null||oeRaw==null)continue;
      const oe=oeRaw<os?oeRaw+1440:oeRaw,oStart=os<presenceStart&&presenceEnd>1440?os+1440:os,oEnd=oe<presenceStart&&presenceEnd>1440?oe+1440:oe;
      overtimeMinutes+=intervalOverlap(presenceStart,presenceEnd,oStart,oEnd);
     }
    }
   }
   const permissionMinutes=permissions.reduce((n,r)=>n+ruleMinutes(r),0);

   let status='راحة';
   if(leave)status='إجازة';
   else if(off&&!arr.length)status='راحة';
   else if(periods.length&&!arr.length)status='غياب';
   else if(arr.length&&periods.length&&(missedPeriods>0||missingPunches>0||shortageMinutes>=Number(policy.partial_absence_threshold_minutes||60)))status='حضور جزئي';
   else if(arr.length&&periods.length)status='حضور';
   else if(arr.length)status='حضور خارج الجدول';

   let penaltyMinutes=0;
   if(status==='غياب')penaltyMinutes+=Number(policy.absence_penalty_minutes||0);
   else{
    if(status==='حضور جزئي')penaltyMinutes+=Number(policy.partial_absence_penalty_minutes||0);
    penaltyMinutes+=lateViolations*Number(policy.late_penalty_minutes||0);
    penaltyMinutes+=earlyViolations*Number(policy.early_leave_penalty_minutes||0);
    penaltyMinutes+=missingPunches*Number(policy.missing_punch_penalty_minutes||0);
   }

   const violations=[];
   if(status==='غياب')violations.push('غياب كامل');
   if(status==='حضور جزئي')violations.push('حضور جزئي');
   if(lateViolations)violations.push('تأخير ×'+lateViolations);
   if(earlyViolations)violations.push('انصراف مبكر ×'+earlyViolations);
   if(missingPunches)violations.push('بصمة ناقصة ×'+missingPunches);
   if(shortageMinutes>0)violations.push('نقص '+humanMinutes(shortageMinutes));

   rows.push({
    id:String(employee.id)+'-'+day,day,employee_id:employee.id,employee_code:employee.employee_code||'—',name:employee.name,branch_id:employee.branch_id,
    schedule_version_id:schedule.scheduleVersion?.id||null,schedule_effective_from:schedule.scheduleVersion?.effective_from||null,schedule_effective_to:schedule.scheduleVersion?.effective_to||null,
    status,first_in:firstIn,last_out:lastOut,periods_summary:leave?(leave.label||'إجازة'):off?(off.label||'راحة'):(summaries.join(' | ')||'لا يوجد دوام'),
    punches:arr.length,work_minutes:totalWork,scheduled_minutes:scheduledMinutes,adjusted_scheduled_minutes:adjustedScheduledMinutes,
    late_minutes:totalLate,early_leave_minutes:totalEarly,shortage_minutes:shortageMinutes,overtime_minutes:overtimeMinutes,permission_minutes:permissionMinutes,
    late_violations:lateViolations,early_leave_violations:earlyViolations,missing_punches:missingPunches,missed_periods:missedPeriods,
    penalty_minutes:penaltyMinutes,violations_summary:violations.join(' · ')||'—',expected:periods.length>0
   });
  }
 }

 for(const [key,arrRaw] of grouped.entries()){
  if(used.has(key))continue;
  const arr=[...arrRaw].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at)),first=arr[0],day=dayKey(first.occurred_at),name=first.employee_name||('PIN '+first.device_pin);
  const work=arr.length>1?Math.max(0,(new Date(arr[arr.length-1].occurred_at)-new Date(arr[0].occurred_at))/60000):0;
  rows.push({id:'orphan-'+key,day,employee_id:null,employee_code:'—',name,branch_id:first.branch_id,status:'حضور خارج الجدول',first_in:logClock(first),last_out:arr.length>1?logClock(arr[arr.length-1]):'—',periods_summary:'سجل غير مربوط بموظف حالي',punches:arr.length,work_minutes:work,scheduled_minutes:0,adjusted_scheduled_minutes:0,late_minutes:0,early_leave_minutes:0,shortage_minutes:0,overtime_minutes:0,permission_minutes:0,late_violations:0,early_leave_violations:0,missing_punches:0,missed_periods:0,penalty_minutes:0,violations_summary:'سجل خارج الجدول',expected:false});
 }
 return rows.sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.name).localeCompare(String(b.name),'ar'));
}
function buildMonthly(daily){
 const map=new Map();
 for(const r of daily){
  const key=r.employee_id||('orphan:'+r.name),x=map.get(key)||{id:key,employee_code:r.employee_code,name:r.name,working_days:0,present_days:0,partial_days:0,absent_days:0,leave_days:0,off_days:0,late_days:0,early_days:0,missing_punch_days:0,total_minutes:0,scheduled_minutes:0,shortage_minutes:0,early_leave_minutes:0,overtime_minutes:0,permission_minutes:0,penalty_minutes:0,approved_penalty_minutes:0,pending_review_count:0,reviewed_violation_days:0,punches:0};
  if(r.expected)x.working_days+=1;
  if(r.punches>0)x.present_days+=1;
  if(r.status==='حضور جزئي')x.partial_days+=1;
  if(r.status==='غياب')x.absent_days+=1;
  if(r.status==='إجازة')x.leave_days+=1;
  if(r.status==='راحة')x.off_days+=1;
  if(r.late_minutes>0)x.late_days+=1;
  if(r.early_leave_minutes>0)x.early_days+=1;
  if(r.missing_punches>0)x.missing_punch_days+=1;
  x.total_minutes+=r.work_minutes;x.scheduled_minutes+=r.adjusted_scheduled_minutes;x.shortage_minutes+=r.shortage_minutes;x.early_leave_minutes+=r.early_leave_minutes;x.overtime_minutes+=r.overtime_minutes;x.permission_minutes+=r.permission_minutes;x.penalty_minutes+=r.penalty_minutes;x.approved_penalty_minutes+=Number(r.approved_penalty_minutes||0);if(r.review_status==='pending')x.pending_review_count+=1;else if(['approved','waived','adjusted'].includes(r.review_status))x.reviewed_violation_days+=1;x.punches+=r.punches;
  map.set(key,x);
 }
 return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
}

export default function AttendanceReports({state,onError,onNotice}){
 const employees=state.employees||[],devices=state.devices||[],branches=state.branches||[],shiftPeriods=state.shiftPeriods||[],links=state.links||[],policies=state.policies||[];
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}return m},[shiftPeriods]);
 const policyMap=useMemo(()=>new Map(policies.map(p=>[String(p.branch_id),p])),[policies]);
 const scheduleVersionsMap=useMemo(()=>{const m=new Map();for(const v of reportScheduleVersions||[]){const k=String(v.attendance_employee_id),a=m.get(k)||[];a.push(v);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>String(y.effective_from).localeCompare(String(x.effective_from)));return m},[reportScheduleVersions]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const [filters,setFilters]=useState({from_date:todayKey(),to_date:todayKey(),branch_id:state.scope?.branch_id||'',attendance_employee_id:'',device_id:'',report_type:'daily'}),[logs,setLogs]=useState([]),[reportRules,setReportRules]=useState([]),[reportScheduleVersions,setReportScheduleVersions]=useState([]),[violationDecisions,setViolationDecisions]=useState([]),[monthClosure,setMonthClosure]=useState(null),[busy,setBusy]=useState(false),[truncated,setTruncated]=useState(false),[loaded,setLoaded]=useState(false);
 const [reviewRow,setReviewRow]=useState(null),[reviewForm,setReviewForm]=useState({decision_status:'approved',approved_penalty_minutes:0,manager_note:'',reason:''}),[reviewBusy,setReviewBusy]=useState(false);
 const [reopenOpen,setReopenOpen]=useState(false),[reopenReason,setReopenReason]=useState(''),[closeBusy,setCloseBusy]=useState(false);
 const decisionMap=useMemo(()=>new Map((violationDecisions||[]).map(d=>[String(d.attendance_employee_id)+'|'+String(d.work_date),d])),[violationDecisions]);
 const reportEmployees=useMemo(()=>employees.filter(e=>!filters.branch_id||String(e.branch_id)===String(filters.branch_id)),[employees,filters.branch_id]);
 const reportDevices=useMemo(()=>devices.filter(d=>!filters.branch_id||String(d.branch_id)===String(filters.branch_id)),[devices,filters.branch_id]);
 const rawDaily=useMemo(()=>loaded?buildDaily(logs,reportEmployees,periodsMap,scheduleVersionsMap,reportRules,policyMap,filters.from_date,filters.to_date,filters.attendance_employee_id,filters.device_id,links):[],[loaded,logs,reportEmployees,periodsMap,scheduleVersionsMap,reportRules,policyMap,filters.from_date,filters.to_date,filters.attendance_employee_id,filters.device_id,links]);
 const liveDaily=useMemo(()=>rawDaily.map(r=>{const violation=r.status==='غياب'||r.status==='حضور جزئي'||r.late_minutes>0||r.early_leave_minutes>0||r.missing_punches>0||r.shortage_minutes>0,d=r.employee_id?decisionMap.get(String(r.employee_id)+'|'+String(r.day)):null;return {...r,review_status:d?.decision_status||(violation?'pending':'none'),approved_penalty_minutes:d?Number(d.approved_penalty_minutes||0):null,review_note:d?.manager_note||'',reviewed_by:d?.reviewed_by||'',reviewed_at:d?.reviewed_at||null,decision_id:d?.id||null}}),[rawDaily,decisionMap]);
 const frozen=monthClosure?.status==='closed'&&monthClosure?.snapshot&&isFullMonth(filters.from_date,filters.to_date);
 const daily=useMemo(()=>frozen&&Array.isArray(monthClosure?.snapshot?.daily)?monthClosure.snapshot.daily:liveDaily,[frozen,monthClosure,liveDaily]);
 const monthly=useMemo(()=>frozen&&Array.isArray(monthClosure?.snapshot?.monthly)?monthClosure.snapshot.monthly:buildMonthly(daily),[frozen,monthClosure,daily]);
 const violations=useMemo(()=>daily.filter(r=>r.status==='غياب'||r.status==='حضور جزئي'||r.late_minutes>0||r.early_leave_minutes>0||r.missing_punches>0||r.shortage_minutes>0),[daily]);
 const totals=useMemo(()=>({
  absence:daily.filter(r=>r.status==='غياب').length,
  partial:daily.filter(r=>r.status==='حضور جزئي').length,
  late:daily.filter(r=>r.late_minutes>0).length,
  early:daily.filter(r=>r.early_leave_minutes>0).length,
  missing:daily.filter(r=>r.missing_punches>0).length,
  penalty:daily.reduce((n,r)=>n+Number(r.penalty_minutes||0),0),
  approved_penalty:daily.reduce((n,r)=>n+Number(r.approved_penalty_minutes||0),0),
  pending_review:daily.filter(r=>r.review_status==='pending').length,
  reviewed:daily.filter(r=>['approved','waived','adjusted'].includes(r.review_status)).length
 }),[daily]);
 const selectedBranchId=filters.branch_id||state.scope?.branch_id||'',fullMonth=isFullMonth(filters.from_date,filters.to_date),pastMonth=fullMonth&&filters.to_date<todayKey(),canClose=!!state.permissions?.close_month&&loaded&&fullMonth&&pastMonth&&!!selectedBranchId&&!filters.attendance_employee_id&&!filters.device_id&&!frozen;

 async function loadReport(){
  setBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'report',...filters,branch_id:selectedBranchId});
   setLogs(out.logs||[]);setReportRules(out.calendar_rules||[]);setReportScheduleVersions(out.schedule_versions||[]);setViolationDecisions(out.violation_decisions||[]);setMonthClosure(out.month_closure||null);setTruncated(!!out.truncated);setLoaded(true);
   onNotice?.('تم تجهيز الكشف: '+String((out.logs||[]).length)+' حركة بصمة و'+String((out.schedule_versions||[]).length)+' نسخة دوام تاريخية و'+String((out.calendar_rules||[]).length)+' قاعدة/استثناء.');
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }
 async function closeMonth(){
  if(!canClose)return;
  if(totals.pending_review>0){onError?.('راجع كل مخالفات الشهر أولًا قبل الإقفال.');return}
  if(!confirm('إقفال شهر '+filters.from_date.slice(0,7)+' وتجميد نتائجه لهذا الفرع؟ بعد الإقفال يلزم صلاحية خاصة لإعادة فتحه.'))return;
  setCloseBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'close_attendance_month',branch_id:selectedBranchId,period_month:filters.from_date.slice(0,7)+'-01',snapshot:{daily,monthly,filters:{...filters,branch_id:selectedBranchId}},totals,reason:'إقفال شهر الحضور بعد مراجعة المخالفات'});
   setMonthClosure(out.closure||null);onNotice?.(out.message||'تم إقفال شهر الحضور وتجميد نتائجه.');
  }catch(err){onError?.(err.message)}finally{setCloseBusy(false)}
 }
 async function reopenMonth(e){
  e.preventDefault();if(!monthClosure?.period_month)return;setCloseBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'reopen_attendance_month',branch_id:selectedBranchId,period_month:monthClosure.period_month,reason:reopenReason});
   setMonthClosure(out.closure||null);setReopenOpen(false);setReopenReason('');onNotice?.(out.message||'تمت إعادة فتح الشهر.');
  }catch(err){onError?.(err.message)}finally{setCloseBusy(false)}
 }
 function openReview(r){
  const d=r.employee_id?decisionMap.get(String(r.employee_id)+'|'+String(r.day)):null;
  setReviewRow(r);setReviewForm({decision_status:d?.decision_status||'approved',approved_penalty_minutes:d?.approved_penalty_minutes??r.penalty_minutes??0,manager_note:d?.manager_note||'',reason:''});
 }
 async function saveReview(e){
  e.preventDefault();if(!reviewRow?.employee_id)return;setReviewBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'save_violation_decision',attendance_employee_id:reviewRow.employee_id,work_date:reviewRow.day,decision_status:reviewForm.decision_status,system_penalty_minutes:reviewRow.penalty_minutes||0,approved_penalty_minutes:reviewForm.approved_penalty_minutes||0,manager_note:reviewForm.manager_note||'',reason:reviewForm.reason||'',violation_snapshot:{status:reviewRow.status,violations_summary:reviewRow.violations_summary,late_minutes:reviewRow.late_minutes,early_leave_minutes:reviewRow.early_leave_minutes,shortage_minutes:reviewRow.shortage_minutes,missing_punches:reviewRow.missing_punches,system_penalty_minutes:reviewRow.penalty_minutes,first_in:reviewRow.first_in,last_out:reviewRow.last_out}});
   const saved=out?.decision;if(saved)setViolationDecisions(x=>[...x.filter(d=>!(String(d.attendance_employee_id)===String(saved.attendance_employee_id)&&String(d.work_date)===String(saved.work_date))),saved]);
   setReviewRow(null);onNotice?.('تم حفظ قرار HR على مخالفة '+reviewRow.name+' بتاريخ '+reviewRow.day+'.');
  }catch(err){onError?.(err.message)}finally{setReviewBusy(false)}
 }
 async function resetReview(){
  if(!reviewRow?.employee_id)return;if(!confirm('إعادة هذه المخالفة إلى «بانتظار المراجعة»؟'))return;setReviewBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'reset_violation_decision',attendance_employee_id:reviewRow.employee_id,work_date:reviewRow.day,reason:reviewForm.reason||'إعادة للمراجعة'});
   setViolationDecisions(x=>x.filter(d=>!(String(d.attendance_employee_id)===String(reviewRow.employee_id)&&String(d.work_date)===String(reviewRow.day))));
   setReviewRow(null);onNotice?.('تمت إعادة المخالفة للمراجعة.');
  }catch(err){onError?.(err.message)}finally{setReviewBusy(false)}
 }
 function printCurrent(){
  const subtitle='من '+filters.from_date+' إلى '+filters.to_date+' · '+(branchMap.get(String(selectedBranchId))||'كل الفروع')+(frozen?' · شهر مقفل — نسخة '+String(monthClosure?.closure_version||1):'');
  if(filters.report_type==='raw')return printTable('سجل البصمات الخام',subtitle,[{label:'الموظف',value:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{label:'PIN',value:r=>r.device_pin},{label:'الجهاز',value:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{label:'التاريخ والوقت',value:r=>fmtDate(r.occurred_at)},{label:'الحالة',value:r=>r.status_code??'—'},{label:'التحقق',value:r=>r.verify_code??'—'}],logs);
  if(filters.report_type==='monthly')return printTable('التقرير الشهري النهائي للحضور',subtitle,[{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'أيام العمل',key:'working_days'},{label:'حضور',key:'present_days'},{label:'جزئي',key:'partial_days'},{label:'غياب',key:'absent_days'},{label:'تأخير',key:'late_days'},{label:'مبكر',key:'early_days'},{label:'بصمة ناقصة',key:'missing_punch_days'},{label:'ساعات فعلية',value:r=>humanMinutes(r.total_minutes)},{label:'نقص',value:r=>humanMinutes(r.shortage_minutes)},{label:'إضافي',value:r=>humanMinutes(r.overtime_minutes)},{label:'جزاء مقترح',value:r=>humanMinutes(r.penalty_minutes)},{label:'جزاء معتمد',value:r=>humanMinutes(r.approved_penalty_minutes)},{label:'معلق للمراجعة',key:'pending_review_count'}],monthly);
  if(filters.report_type==='violations')return printTable('كشف مخالفات الحضور',subtitle,[{label:'التاريخ',key:'day'},{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'الحالة',key:'status'},{label:'المخالفات',key:'violations_summary'},{label:'تأخير',value:r=>humanMinutes(r.late_minutes)},{label:'انصراف مبكر',value:r=>humanMinutes(r.early_leave_minutes)},{label:'نقص ساعات',value:r=>humanMinutes(r.shortage_minutes)},{label:'بصمات ناقصة',key:'missing_punches'},{label:'جزاء مقترح',value:r=>humanMinutes(r.penalty_minutes)},{label:'قرار HR',value:r=>reviewLabel(r.review_status)},{label:'جزاء معتمد',value:r=>r.approved_penalty_minutes==null?'—':humanMinutes(r.approved_penalty_minutes)},{label:'ملاحظة',value:r=>r.review_note||'—'}],violations);
  return printTable('كشف الحضور اليومي',subtitle,[{label:'التاريخ',key:'day'},{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'الحالة',key:'status'},{label:'تفصيل الفترات',key:'periods_summary'},{label:'أول دخول',key:'first_in'},{label:'آخر خروج',key:'last_out'},{label:'عمل فعلي',value:r=>humanMinutes(r.work_minutes)},{label:'تأخير',value:r=>humanMinutes(r.late_minutes)},{label:'انصراف مبكر',value:r=>humanMinutes(r.early_leave_minutes)},{label:'نقص',value:r=>humanMinutes(r.shortage_minutes)},{label:'إضافي',value:r=>humanMinutes(r.overtime_minutes)},{label:'جزاء مقترح',value:r=>humanMinutes(r.penalty_minutes)}],daily);
 }

 const rawCols=[{key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{key:'pin',label:'PIN',render:r=>r.device_pin},{key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{key:'time',label:'الوقت',render:r=>fmtDate(r.occurred_at)},{key:'status',label:'الحالة',render:r=>r.status_code??'—'},{key:'verify',label:'التحقق',render:r=>r.verify_code??'—'}];
 const dailyCols=[{key:'day',label:'التاريخ'},{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'status',label:'الحالة',render:r=><Badge tone={statusTone(r.status)}>{r.status}</Badge>},{key:'periods_summary',label:'الفترات / الاستثناء'},{key:'first_in',label:'أول دخول'},{key:'last_out',label:'آخر خروج'},{key:'work',label:'عمل فعلي',render:r=>humanMinutes(r.work_minutes)},{key:'late',label:'التأخير',render:r=>r.late_minutes?<Badge tone="orange">{humanMinutes(r.late_minutes)}</Badge>:'—'},{key:'early',label:'انصراف مبكر',render:r=>r.early_leave_minutes?<Badge tone="orange">{humanMinutes(r.early_leave_minutes)}</Badge>:'—'},{key:'shortage',label:'نقص ساعات',render:r=>r.shortage_minutes?<Badge tone="red">{humanMinutes(r.shortage_minutes)}</Badge>:'—'},{key:'missing',label:'بصمة ناقصة',render:r=>r.missing_punches?<Badge tone="red">{r.missing_punches}</Badge>:'—'},{key:'penalty',label:'جزاء مقترح',render:r=>r.penalty_minutes?<Badge tone="red">{humanMinutes(r.penalty_minutes)}</Badge>:'—'}];
 const monthlyCols=[{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'working_days',label:'أيام العمل'},{key:'present_days',label:'حضور'},{key:'partial_days',label:'حضور جزئي',render:r=>r.partial_days?<Badge tone="orange">{r.partial_days}</Badge>:0},{key:'absent_days',label:'غياب',render:r=>r.absent_days?<Badge tone="red">{r.absent_days}</Badge>:0},{key:'leave_days',label:'إجازات'},{key:'late_days',label:'تأخير',render:r=>r.late_days?<Badge tone="orange">{r.late_days}</Badge>:0},{key:'early_days',label:'انصراف مبكر',render:r=>r.early_days?<Badge tone="orange">{r.early_days}</Badge>:0},{key:'missing_punch_days',label:'بصمة ناقصة',render:r=>r.missing_punch_days?<Badge tone="red">{r.missing_punch_days}</Badge>:0},{key:'hours',label:'ساعات فعلية',render:r=>humanMinutes(r.total_minutes)},{key:'shortage',label:'إجمالي النقص',render:r=>humanMinutes(r.shortage_minutes)},{key:'ot',label:'إضافي',render:r=>humanMinutes(r.overtime_minutes)},{key:'permission',label:'استئذان',render:r=>humanMinutes(r.permission_minutes)},{key:'penalty',label:'جزاء مقترح',render:r=>r.penalty_minutes?<Badge tone="red">{humanMinutes(r.penalty_minutes)}</Badge>:'—'},{key:'approved',label:'جزاء معتمد',render:r=>r.approved_penalty_minutes?<Badge tone="green">{humanMinutes(r.approved_penalty_minutes)}</Badge>:'—'},{key:'pending',label:'معلق للمراجعة',render:r=>r.pending_review_count?<Badge tone="orange">{r.pending_review_count}</Badge>:0}];
 const violationCols=[{key:'day',label:'التاريخ'},{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'status',label:'الحالة',render:r=><Badge tone={statusTone(r.status)}>{r.status}</Badge>},{key:'violations_summary',label:'المخالفات'},{key:'late',label:'تأخير',render:r=>r.late_minutes?humanMinutes(r.late_minutes):'—'},{key:'early',label:'انصراف مبكر',render:r=>r.early_leave_minutes?humanMinutes(r.early_leave_minutes):'—'},{key:'shortage',label:'نقص ساعات',render:r=>r.shortage_minutes?humanMinutes(r.shortage_minutes):'—'},{key:'missing',label:'بصمة ناقصة',render:r=>r.missing_punches||'—'},{key:'penalty',label:'جزاء مقترح',render:r=>r.penalty_minutes?<Badge tone="red">{humanMinutes(r.penalty_minutes)}</Badge>:'—'},{key:'review',label:'قرار HR',render:r=><div><Badge tone={reviewTone(r.review_status)}>{reviewLabel(r.review_status)}</Badge>{r.reviewed_by&&<div className="muted-small">{r.reviewed_by}</div>}</div>},{key:'approved',label:'جزاء معتمد',render:r=>r.approved_penalty_minutes==null?'—':<Badge tone={r.approved_penalty_minutes?'green':'blue'}>{humanMinutes(r.approved_penalty_minutes)}</Badge>},{key:'note',label:'ملاحظة',render:r=>r.review_note||'—'},{key:'action',label:'',render:r=>state.permissions?.review_violations&&r.employee_id&&!frozen?<Button onClick={()=>openReview(r)}>مراجعة</Button>:frozen?<Badge tone="blue">مقفل</Badge>:'—'}];

 function applySavedView(v={}){setFilters(x=>({...x,...v}));setLoaded(false);setMonthClosure(null)}
 const rows=filters.report_type==='raw'?logs:filters.report_type==='monthly'?monthly:filters.report_type==='violations'?violations:daily;
 return <><Card><div className="card-title"><div><h3><FileText size={19}/> الكشوفات والطباعة</h3><small>الحساب يجمع الجدول الأسبوعي والاستثناءات وسياسة الفرع، والشهر المقفل يعرض النسخة المجمدة المعتمدة.</small></div><div className="finance-actions"><Button onClick={loadReport} disabled={busy}>{busy?'جاري التجهيز...':'عرض الكشف'}</Button>{canClose&&<Button onClick={closeMonth} disabled={closeBusy||totals.pending_review>0}><Lock size={15}/>{closeBusy?' جاري الإقفال...':' إقفال الشهر'}</Button>}{frozen&&state.permissions?.reopen_month&&<Button onClick={()=>setReopenOpen(true)} disabled={closeBusy}><Unlock size={15}/> إعادة فتح الشهر</Button>}<Button variant="primary" onClick={printCurrent} disabled={!loaded||!rows.length}><Printer size={16}/> طباعة / PDF</Button></div></div>
 <div className="form-grid">
  <Field label="الفرع"><Select value={filters.branch_id||''} onChange={e=>{setFilters(x=>({...x,branch_id:e.target.value,attendance_employee_id:'',device_id:''}));setLoaded(false);setMonthClosure(null)}} disabled={!state.scope?.all_branches}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
  <Field label="نوع الكشف"><Select value={filters.report_type} onChange={e=>setFilters(x=>({...x,report_type:e.target.value}))}><option value="daily">كشف حضور يومي تفصيلي</option><option value="monthly">التقرير الشهري النهائي</option><option value="violations">كشف المخالفات</option><option value="raw">سجل البصمات الخام</option></Select></Field>
  <Field label="من تاريخ"><Input type="date" value={filters.from_date} onChange={e=>{setFilters(x=>({...x,from_date:e.target.value,to_date:x.to_date&&x.to_date>=e.target.value?x.to_date:e.target.value}));setLoaded(false);setMonthClosure(null)}}/></Field>
  <Field label="إلى تاريخ"><Input type="date" min={filters.from_date} value={filters.to_date} onChange={e=>{setFilters(x=>({...x,to_date:e.target.value}));setLoaded(false);setMonthClosure(null)}}/></Field>
  <Field label="الموظف"><Select value={filters.attendance_employee_id} onChange={e=>{setFilters(x=>({...x,attendance_employee_id:e.target.value}));setLoaded(false);setMonthClosure(null)}}><option value="">كل الموظفين</option>{reportEmployees.map(x=><option key={x.id} value={x.id}>{x.employee_code} — {x.name}</option>)}</Select></Field>
  <Field label="الجهاز"><Select value={filters.device_id} onChange={e=>{setFilters(x=>({...x,device_id:e.target.value}));setLoaded(false);setMonthClosure(null)}}><option value="">كل الأجهزة</option>{reportDevices.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
  <div style={{gridColumn:'1/-1'}}><SavedViews storageKey="attendance-reports" current={filters} onApply={applySavedView}/></div>
 </div>
 {loaded&&filters.report_type!=='raw'&&<div className="stats-grid" style={{marginTop:12}}>
  <Card><div className="stat-card"><div><span>غياب كامل</span><strong>{totals.absence}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>حضور جزئي</span><strong>{totals.partial}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>أيام تأخير</span><strong>{totals.late}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>انصراف مبكر</span><strong>{totals.early}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>بصمة ناقصة</span><strong>{totals.missing}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>جزاء مقترح</span><strong>{humanMinutes(totals.penalty)}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>بانتظار HR</span><strong>{totals.pending_review}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>تمت المراجعة</span><strong>{totals.reviewed}</strong></div></div></Card>
  <Card><div className="stat-card"><div><span>جزاء معتمد</span><strong>{humanMinutes(totals.approved_penalty)}</strong></div></div></Card>
 </div>}
 {frozen&&<div className="success-note"><Lock size={16}/> هذا الشهر مقفل — نسخة {monthClosure?.closure_version||1}. النتائج المعروضة مجمدة كما كانت وقت الإقفال بواسطة {monthClosure?.closed_by||'المستخدم المخول'} في {fmtDate(monthClosure?.closed_at)}.</div>}
 {loaded&&fullMonth&&!selectedBranchId&&<div className="error-box">لإقفال شهر الحضور لازم تختار فرعًا محددًا.</div>}
 {loaded&&canClose&&totals.pending_review>0&&<div className="error-box">يوجد {totals.pending_review} مخالفة بانتظار مراجعة HR، لذلك الإقفال متوقف حتى مراجعتها.</div>}
 {loaded&&filters.report_type==='violations'&&<div className="success-note"><AlertTriangle size={16}/> كل مخالفة تبدأ «بانتظار المراجعة». موظف HR صاحب صلاحية الاعتماد يقدر يعتمد الجزاء المقترح، يعفي الموظف، أو يعدّل الجزاء مع ملاحظة. لا يوجد خصم مالي تلقائيًا.</div>}
 {truncated&&<div className="error-box">الكشف وصل للحد الأقصى 10,000 حركة. قلّل الفترة للحصول على كشف كامل.</div>}
 {filters.report_type==='raw'?<Table preferenceKey="attendance-report-raw" defaultPageSize={25} rows={logs} columns={rawCols}/>:filters.report_type==='monthly'?<Table preferenceKey="attendance-report-monthly" defaultPageSize={25} rows={monthly} columns={monthlyCols}/>:filters.report_type==='violations'?<Table preferenceKey="attendance-report-violations" defaultPageSize={25} rows={violations} columns={violationCols}/>:<Table preferenceKey="attendance-report-daily" defaultPageSize={25} rows={daily} columns={dailyCols}/>}
 </Card>
 <Modal open={!!reviewRow} onClose={()=>setReviewRow(null)} title={reviewRow?'مراجعة مخالفة — '+reviewRow.name+' — '+reviewRow.day:'مراجعة مخالفة'}>
  {reviewRow&&<form onSubmit={saveReview} className="form-grid">
   <div className="success-note" style={{gridColumn:'1/-1'}}><AlertTriangle size={16}/> {reviewRow.violations_summary} · الجزاء المقترح: {humanMinutes(reviewRow.penalty_minutes)}</div>
   <Field label="قرار الموارد البشرية"><Select value={reviewForm.decision_status} onChange={e=>setReviewForm(x=>({...x,decision_status:e.target.value,approved_penalty_minutes:e.target.value==='waived'?0:e.target.value==='approved'?reviewRow.penalty_minutes:x.approved_penalty_minutes}))}><option value="approved">اعتماد الجزاء المقترح</option><option value="waived">إعفاء من الجزاء</option><option value="adjusted">تعديل الجزاء</option></Select></Field>
   {reviewForm.decision_status==='adjusted'&&<Field label="الجزاء المعتمد بالدقائق"><Input type="number" min="0" max="10080" value={reviewForm.approved_penalty_minutes??0} onChange={e=>setReviewForm(x=>({...x,approved_penalty_minutes:Number(e.target.value||0)}))}/></Field>}
   <Field label="ملاحظة المدير / HR"><Textarea value={reviewForm.manager_note||''} onChange={e=>setReviewForm(x=>({...x,manager_note:e.target.value}))} placeholder="مثال: تم الإعفاء لوجود تكليف خارجي"/></Field>
   <Field label="سبب القرار"><Input value={reviewForm.reason||''} onChange={e=>setReviewForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري — يظهر في سجل التدقيق"/></Field>
   <div className="modal-actions">{reviewRow.review_status!=='pending'&&<Button type="button" onClick={resetReview} disabled={reviewBusy}>إعادة للمراجعة</Button>}<Button type="button" onClick={()=>setReviewRow(null)} disabled={reviewBusy}>إلغاء</Button><Button variant="primary" type="submit" disabled={reviewBusy}>{reviewBusy?'جاري الحفظ...':'حفظ القرار'}</Button></div>
  </form>}
 </Modal>
 <Modal open={reopenOpen} onClose={()=>setReopenOpen(false)} title="إعادة فتح شهر الحضور">
  <form onSubmit={reopenMonth} className="form-grid">
   <div className="error-box" style={{gridColumn:'1/-1'}}><Unlock size={16}/> إعادة الفتح ستسمح بتعديل المخالفات والاستثناءات ثم يلزم إقفال الشهر مرة أخرى لإصدار نسخة جديدة.</div>
   <Field label="سبب إعادة الفتح"><Textarea value={reopenReason} onChange={e=>setReopenReason(e.target.value)} placeholder="مثال: اكتشاف بصمة ناقصة تم تصحيحها" required/></Field>
   <div className="modal-actions"><Button type="button" onClick={()=>setReopenOpen(false)} disabled={closeBusy}>إلغاء</Button><Button variant="primary" type="submit" disabled={closeBusy||reopenReason.trim().length<5}>{closeBusy?'جاري الفتح...':'تأكيد إعادة الفتح'}</Button></div>
  </form>
 </Modal></>;
}
