import React,{useMemo,useState} from 'react';
import {FileText,Printer} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Select,Table} from '../../components/UI.jsx';

const text=v=>String(v??'').trim();
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function dayKey(v){try{const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return ''}}
function todayKey(){return dayKey(new Date())}
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
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#111;margin:0}.head{text-align:center;margin-bottom:14px}.head h1{font-size:19px;margin:0 0 5px}.head p{font-size:11px;margin:0;color:#555}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #bbb;padding:5px;text-align:center;vertical-align:middle}th{background:#f2f4f7}.meta{display:flex;justify-content:space-between;font-size:9px;margin:7px 0 10px}.foot{font-size:8px;color:#666;margin-top:8px;text-align:center}</style></head><body><div class="head"><h1>'+esc(title)+'</h1><p>'+esc(subtitle||'')+'</p></div><div class="meta"><span>نظام الماهر الماسي — الحضور والبصمة</span><span>'+esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))+'</span></div><table><thead><tr>'+th+'</tr></thead><tbody>'+(body||empty)+'</tbody></table><div class="foot">الحساب يعتمد على جدول الموظف والاستثناءات المعتمدة وسجلات أجهزة البصمة.</div><script>window.onload=function(){window.print()}</script></body></html>';
 win.document.open();win.document.write(html);win.document.close();
}
function logClock(log){return timeOnly(log.device_time_raw||log.occurred_at)}
function adjustedMinute(m,start,end){if(m==null)return null;if(end<start&&m<start)return m+1440;return m}
function periodDuration(start,end){if(start==null||end==null)return 0;return end>=start?end-start:(end+1440)-start}
function intervalOverlap(a1,a2,b1,b2){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1))}
function distanceToPeriod(m,start,end){const x=adjustedMinute(m,start,end),finish=end<start?end+1440:end,center=(start+finish)/2;return Math.abs(x-center)}
function ruleOnDay(rule,day){return rule.start_date<=day&&rule.end_date>=day}
function ruleMinutes(rule){const s=minutesFromClock(rule.start_time),e=minutesFromClock(rule.end_time);return periodDuration(s,e)}
function statusTone(v){return v==='حضور'?'green':v==='غياب'?'red':v==='إجازة'?'blue':v==='راحة'?'blue':v==='حضور خارج الجدول'?'orange':'gray'}

function expectedPeriods(employee,day,periodsMap,rules){
 const dayNo=dayOfWeek(day),dayRules=(rules||[]).filter(r=>ruleOnDay(r,day)),leave=dayRules.find(r=>r.rule_type==='leave'),off=dayRules.find(r=>r.rule_type==='off'),overrides=dayRules.filter(r=>r.rule_type==='work_override');
 if(leave)return {periods:[],dayRules,state:'leave'};
 if(off)return {periods:[],dayRules,state:'off'};
 if(overrides.length)return {periods:overrides.map((r,i)=>({id:r.id,sequence_no:i+1,label:r.label||'دوام مؤقت',start_time:r.start_time,end_time:r.end_time,grace_minutes:r.grace_minutes??employee.grace_minutes??10,weekdays:[dayNo],temporary:true})),dayRules,state:'work'};
 const weeklyOff=(employee.weekly_off_days||[]).map(Number).includes(dayNo);
 if(weeklyOff)return {periods:[],dayRules,state:'off'};
 let periods=(periodsMap.get(String(employee.id))||[]).filter(p=>{const days=Array.isArray(p.weekdays)&&p.weekdays.length?p.weekdays.map(Number):[0,1,2,3,4,5,6];return days.includes(dayNo)});
 if(!periods.length&&employee.shift_start&&employee.shift_end)periods=[{sequence_no:1,label:'الفترة الأولى',start_time:employee.shift_start,end_time:employee.shift_end,grace_minutes:employee.grace_minutes??10,weekdays:[dayNo]}];
 return {periods:[...periods].sort((a,b)=>Number(a.sequence_no)-Number(b.sequence_no)),dayRules,state:periods.length?'work':'off'};
}

function buildDaily(logs,employees,periodsMap,rules,fromDate,toDate,filterEmployeeId,filterDeviceId,links){
 const grouped=new Map();
 for(const log of logs||[]){
  const day=dayKey(log.occurred_at),emp=log.attendance_employee_id?String(log.attendance_employee_id):'',key=(emp||('orphan:'+String(log.employee_name||log.device_pin||'unknown')+':'+String(log.device_id||'')))+'|'+day,arr=grouped.get(key)||[];
  arr.push(log);grouped.set(key,arr);
 }
 const linkedEmployeeIds=filterDeviceId?new Set((links||[]).filter(l=>String(l.device_id)===String(filterDeviceId)&&l.active&&l.attendance_employee_id).map(l=>String(l.attendance_employee_id))):null;
 const selected=(employees||[]).filter(e=>(!filterEmployeeId||String(e.id)===String(filterEmployeeId))&&(!linkedEmployeeIds||linkedEmployeeIds.has(String(e.id))));
 const days=dateRange(fromDate,toDate),rows=[],used=new Set();

 for(const employee of selected){
  const employeeRules=(rules||[]).filter(r=>String(r.attendance_employee_id)===String(employee.id));
  for(const day of days){
   const key=String(employee.id)+'|'+day,arr=(grouped.get(key)||[]).sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));used.add(key);
   const schedule=expectedPeriods(employee,day,periodsMap,employeeRules),periods=schedule.periods,dayRules=schedule.dayRules;
   const leave=dayRules.find(r=>r.rule_type==='leave'),off=dayRules.find(r=>r.rule_type==='off'),permissions=dayRules.filter(r=>r.rule_type==='permission'),overtimes=dayRules.filter(r=>r.rule_type==='overtime');
   const buckets=periods.map(p=>({period:p,logs:[]}));
   for(const log of arr){
    if(!buckets.length)break;
    const m=minutesFromClock(logClock(log));let best=0,bestScore=Infinity;
    periods.forEach((p,i)=>{const start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time);if(start==null||end==null)return;const score=distanceToPeriod(m,start,end);if(score<bestScore){bestScore=score;best=i}});
    buckets[best].logs.push(log);
   }
   let totalWork=0,totalLate=0,scheduledMinutes=0,firstIn=arr.length?logClock(arr[0]):'—',lastOut=arr.length>1?logClock(arr[arr.length-1]):'—';
   const summaries=[];
   for(const b of buckets){
    const p=b.period,start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time),finish=end<start?end+1440:end,grace=Number(p.grace_minutes||0),ls=b.logs.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
    scheduledMinutes+=periodDuration(start,end);
    if(!ls.length){summaries.push((p.label||('الفترة '+p.sequence_no))+': غياب');continue}
    const a=ls[0],z=ls[ls.length-1],aClock=logClock(a),zClock=ls.length>1?logClock(z):'—',aM=adjustedMinute(minutesFromClock(aClock),start,end);
    let late=start!=null&&aM!=null?Math.max(0,aM-(start+grace)):0;
    if(late>0){
      let allowed=0;
      for(const pr of permissions){
       const ps=minutesFromClock(pr.start_time),pe=minutesFromClock(pr.end_time);if(ps==null||pe==null)continue;
       const px=pe<ps?pe+1440:pe,psAdj=ps<start&&finish>1440?ps+1440:ps;
       allowed+=intervalOverlap(start+grace,aM,psAdj,px);
      }
      late=Math.max(0,late-allowed);
    }
    totalLate+=late;
    if(ls.length>1)totalWork+=Math.max(0,(new Date(z.occurred_at)-new Date(a.occurred_at))/60000);
    summaries.push((p.label||('الفترة '+p.sequence_no))+': '+aClock+' — '+zClock);
   }
   if(!periods.length&&arr.length>1)totalWork=Math.max(0,(new Date(arr[arr.length-1].occurred_at)-new Date(arr[0].occurred_at))/60000);
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
   if(leave)status='إجازة';else if(off&&!arr.length)status='راحة';else if(periods.length&&!arr.length)status='غياب';else if(arr.length&&periods.length)status='حضور';else if(arr.length)status='حضور خارج الجدول';
   rows.push({
    id:String(employee.id)+'-'+day,day,employee_id:employee.id,employee_code:employee.employee_code||'—',name:employee.name,
    status,first_in:firstIn,last_out:lastOut,periods_summary:leave?(leave.label||'إجازة'):off?(off.label||'راحة'):(summaries.join(' | ')||'لا يوجد دوام'),
    punches:arr.length,work_minutes:totalWork,scheduled_minutes:scheduledMinutes,late_minutes:totalLate,overtime_minutes:overtimeMinutes,permission_minutes:permissionMinutes,
    leave_label:leave?.label||'',off_label:off?.label||'',expected:periods.length>0
   });
  }
 }

 for(const [key,arrRaw] of grouped.entries()){
  if(used.has(key))continue;
  const arr=[...arrRaw].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at)),first=arr[0],day=dayKey(first.occurred_at),name=first.employee_name||('PIN '+first.device_pin);
  const work=arr.length>1?Math.max(0,(new Date(arr[arr.length-1].occurred_at)-new Date(arr[0].occurred_at))/60000):0;
  rows.push({id:'orphan-'+key,day,employee_id:null,employee_code:'—',name,status:'حضور خارج الجدول',first_in:logClock(first),last_out:arr.length>1?logClock(arr[arr.length-1]):'—',periods_summary:'سجل غير مربوط بموظف حالي',punches:arr.length,work_minutes:work,scheduled_minutes:0,late_minutes:0,overtime_minutes:0,permission_minutes:0,expected:false});
 }
 return rows.sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.name).localeCompare(String(b.name),'ar'));
}
function buildMonthly(daily){
 const map=new Map();
 for(const r of daily){
  const key=r.employee_id||('orphan:'+r.name),x=map.get(key)||{id:key,employee_code:r.employee_code,name:r.name,working_days:0,present_days:0,absent_days:0,leave_days:0,off_days:0,late_days:0,total_minutes:0,scheduled_minutes:0,overtime_minutes:0,permission_minutes:0,punches:0};
  if(r.expected)x.working_days+=1;
  if(r.punches>0)x.present_days+=1;
  if(r.status==='غياب')x.absent_days+=1;
  if(r.status==='إجازة')x.leave_days+=1;
  if(r.status==='راحة')x.off_days+=1;
  if(r.late_minutes>0)x.late_days+=1;
  x.total_minutes+=r.work_minutes;x.scheduled_minutes+=r.scheduled_minutes;x.overtime_minutes+=r.overtime_minutes;x.permission_minutes+=r.permission_minutes;x.punches+=r.punches;
  map.set(key,x);
 }
 return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
}

export default function AttendanceReports({state,onError,onNotice}){
 const employees=state.employees||[],devices=state.devices||[],branches=state.branches||[],shiftPeriods=state.shiftPeriods||[],links=state.links||[];
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}return m},[shiftPeriods]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const [filters,setFilters]=useState({from_date:todayKey(),to_date:todayKey(),attendance_employee_id:'',device_id:'',report_type:'daily'}),[logs,setLogs]=useState([]),[reportRules,setReportRules]=useState([]),[busy,setBusy]=useState(false),[truncated,setTruncated]=useState(false),[loaded,setLoaded]=useState(false);
 const daily=useMemo(()=>loaded?buildDaily(logs,employees,periodsMap,reportRules,filters.from_date,filters.to_date,filters.attendance_employee_id,filters.device_id,links):[],[loaded,logs,employees,periodsMap,reportRules,filters.from_date,filters.to_date,filters.attendance_employee_id,filters.device_id,links]);
 const monthly=useMemo(()=>buildMonthly(daily),[daily]);

 async function loadReport(){
  setBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'report',...filters});
   setLogs(out.logs||[]);setReportRules(out.calendar_rules||[]);setTruncated(!!out.truncated);setLoaded(true);
   onNotice?.('تم تجهيز الكشف: '+String((out.logs||[]).length)+' حركة بصمة و'+String((out.calendar_rules||[]).length)+' قاعدة/استثناء في الفترة.');
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }
 function printCurrent(){
  const subtitle='من '+filters.from_date+' إلى '+filters.to_date+' · '+(branchMap.get(String(state.scope?.branch_id))||'كل الفروع');
  if(filters.report_type==='raw')return printTable('سجل البصمات الخام',subtitle,[{label:'الموظف',value:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{label:'PIN',value:r=>r.device_pin},{label:'الجهاز',value:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{label:'التاريخ والوقت',value:r=>fmtDate(r.occurred_at)},{label:'الحالة',value:r=>r.status_code??'—'},{label:'التحقق',value:r=>r.verify_code??'—'}],logs);
  if(filters.report_type==='monthly')return printTable('التقرير الشهري النهائي للحضور',subtitle,[{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'أيام العمل',key:'working_days'},{label:'حضور',key:'present_days'},{label:'غياب',key:'absent_days'},{label:'إجازات',key:'leave_days'},{label:'تأخير',key:'late_days'},{label:'ساعات فعلية',value:r=>humanMinutes(r.total_minutes)},{label:'ساعات مجدولة',value:r=>humanMinutes(r.scheduled_minutes)},{label:'إضافي',value:r=>humanMinutes(r.overtime_minutes)},{label:'استئذان',value:r=>humanMinutes(r.permission_minutes)}],monthly);
  return printTable('كشف الحضور اليومي',subtitle,[{label:'التاريخ',key:'day'},{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'الحالة',key:'status'},{label:'تفصيل الفترات',key:'periods_summary'},{label:'أول دخول',key:'first_in'},{label:'آخر خروج',key:'last_out'},{label:'العمل الفعلي',value:r=>humanMinutes(r.work_minutes)},{label:'التأخير',value:r=>r.late_minutes?humanMinutes(r.late_minutes):'—'},{label:'إضافي',value:r=>r.overtime_minutes?humanMinutes(r.overtime_minutes):'—'},{label:'استئذان',value:r=>r.permission_minutes?humanMinutes(r.permission_minutes):'—'}],daily);
 }

 const rawCols=[{key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{key:'pin',label:'PIN',render:r=>r.device_pin},{key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{key:'time',label:'الوقت',render:r=>fmtDate(r.occurred_at)},{key:'status',label:'الحالة',render:r=>r.status_code??'—'},{key:'verify',label:'التحقق',render:r=>r.verify_code??'—'}];
 const dailyCols=[{key:'day',label:'التاريخ'},{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'status',label:'الحالة',render:r=><Badge tone={statusTone(r.status)}>{r.status}</Badge>},{key:'periods_summary',label:'الفترات / الاستثناء'},{key:'first_in',label:'أول دخول'},{key:'last_out',label:'آخر خروج'},{key:'work',label:'العمل الفعلي',render:r=>humanMinutes(r.work_minutes)},{key:'late',label:'التأخير',render:r=>r.late_minutes?<Badge tone="orange">{humanMinutes(r.late_minutes)}</Badge>:'—'},{key:'ot',label:'الإضافي',render:r=>r.overtime_minutes?<Badge tone="green">{humanMinutes(r.overtime_minutes)}</Badge>:'—'},{key:'permission',label:'الاستئذان',render:r=>r.permission_minutes?humanMinutes(r.permission_minutes):'—'},{key:'punches',label:'البصمات'}];
 const monthlyCols=[{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'working_days',label:'أيام العمل'},{key:'present_days',label:'حضور'},{key:'absent_days',label:'غياب',render:r=>r.absent_days?<Badge tone="red">{r.absent_days}</Badge>:0},{key:'leave_days',label:'إجازات'},{key:'late_days',label:'أيام التأخير',render:r=>r.late_days?<Badge tone="orange">{r.late_days}</Badge>:0},{key:'hours',label:'ساعات فعلية',render:r=>humanMinutes(r.total_minutes)},{key:'scheduled',label:'ساعات مجدولة',render:r=>humanMinutes(r.scheduled_minutes)},{key:'ot',label:'إضافي',render:r=>humanMinutes(r.overtime_minutes)},{key:'permission',label:'استئذان',render:r=>humanMinutes(r.permission_minutes)}];

 const rows=filters.report_type==='raw'?logs:filters.report_type==='monthly'?monthly:daily;
 return <Card><div className="card-title"><div><h3><FileText size={19}/> الكشوفات والطباعة</h3><small>الحساب يعتمد على أيام كل فترة، الإجازات الأسبوعية، الدوام المؤقت، الإجازات، الاستئذان والعمل الإضافي.</small></div><div className="finance-actions"><Button onClick={loadReport} disabled={busy}>{busy?'جاري التجهيز...':'عرض الكشف'}</Button><Button variant="primary" onClick={printCurrent} disabled={!loaded||!rows.length}><Printer size={16}/> طباعة / PDF</Button></div></div>
 <div className="form-grid">
  <Field label="نوع الكشف"><Select value={filters.report_type} onChange={e=>setFilters(x=>({...x,report_type:e.target.value}))}><option value="daily">كشف حضور يومي تفصيلي</option><option value="monthly">التقرير الشهري النهائي</option><option value="raw">سجل البصمات الخام</option></Select></Field>
  <Field label="من تاريخ"><Input type="date" value={filters.from_date} onChange={e=>setFilters(x=>({...x,from_date:e.target.value,to_date:x.to_date&&x.to_date>=e.target.value?x.to_date:e.target.value}))}/></Field>
  <Field label="إلى تاريخ"><Input type="date" min={filters.from_date} value={filters.to_date} onChange={e=>setFilters(x=>({...x,to_date:e.target.value}))}/></Field>
  <Field label="الموظف"><Select value={filters.attendance_employee_id} onChange={e=>setFilters(x=>({...x,attendance_employee_id:e.target.value}))}><option value="">كل الموظفين</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_code} — {x.name}</option>)}</Select></Field>
  <Field label="الجهاز"><Select value={filters.device_id} onChange={e=>setFilters(x=>({...x,device_id:e.target.value}))}><option value="">كل الأجهزة</option>{devices.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
 </div>
 {truncated&&<div className="error-box">الكشف وصل للحد الأقصى 10,000 حركة. قلّل الفترة للحصول على كشف كامل.</div>}
 {filters.report_type==='raw'?<Table rows={logs} columns={rawCols}/>:filters.report_type==='monthly'?<Table rows={monthly} columns={monthlyCols}/>:<Table rows={daily} columns={dailyCols}/>}
 </Card>;
}
