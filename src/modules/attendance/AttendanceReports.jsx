import React,{useMemo,useState} from 'react';
import {FileText,Printer} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Select,Table} from '../../components/UI.jsx';

const text=v=>String(v??'').trim();
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function dayKey(v){try{const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return ''}}
function todayKey(){return dayKey(new Date())}
function minutesFromClock(v){const m=String(v||'').match(/(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null}
function timeOnly(v){const s=text(v);const m=s.match(/(?:T|\s)(\d{2}:\d{2}):?\d{0,2}/);return m?.[1]||'—'}
function humanMinutes(v){const n=Math.max(0,Math.round(Number(v)||0)),h=Math.floor(n/60),m=n%60;return h?(String(h)+' س '+(m?String(m)+' د':'' )).trim():String(m)+' د'}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function printTable(title,subtitle,columns,rows){
 const win=window.open('about:blank','_blank');if(!win)throw new Error('اسمح بالنوافذ المنبثقة لطباعة الكشف.');
 const th=columns.map(c=>'<th>'+esc(c.label)+'</th>').join('');
 const body=rows.map(r=>'<tr>'+columns.map(c=>'<td>'+esc(typeof c.value==='function'?c.value(r):r[c.key])+'</td>').join('')+'</tr>').join('');
 const empty='<tr><td colspan="'+columns.length+'">لا توجد بيانات</td></tr>';
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#111;margin:0}.head{text-align:center;margin-bottom:14px}.head h1{font-size:19px;margin:0 0 5px}.head p{font-size:11px;margin:0;color:#555}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:5px;text-align:center;vertical-align:middle}th{background:#f2f4f7}.meta{display:flex;justify-content:space-between;font-size:9px;margin:7px 0 10px}.foot{font-size:8px;color:#666;margin-top:8px;text-align:center}</style></head><body><div class="head"><h1>'+esc(title)+'</h1><p>'+esc(subtitle||'')+'</p></div><div class="meta"><span>نظام الماهر الماسي — الحضور والبصمة</span><span>'+esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))+'</span></div><table><thead><tr>'+th+'</tr></thead><tbody>'+(body||empty)+'</tbody></table><div class="foot">كشف مولّد من سجلات أجهزة البصمة المرتبطة بالنظام.</div><script>window.onload=function(){window.print()}</script></body></html>';
 win.document.open();win.document.write(html);win.document.close();
}
function logClock(log){return timeOnly(log.device_time_raw||log.occurred_at)}
function adjustedMinute(m,start,end){if(m==null)return null;if(end<start&&m<start)return m+1440;return m}
function distanceToPeriod(m,start,end){
 const x=adjustedMinute(m,start,end),finish=end<start?end+1440:end,center=(start+finish)/2;
 return Math.abs(x-center);
}
function buildDaily(logs,employeeMap,periodsMap){
 const groups=new Map();
 for(const log of logs||[]){const day=dayKey(log.occurred_at),key=String(log.attendance_employee_id||log.staff_user_id||('pin:'+log.device_id+':'+log.device_pin))+'|'+day,arr=groups.get(key)||[];arr.push(log);groups.set(key,arr)}
 const rows=[];
 for(const arr of groups.values()){
  arr.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
  const first=arr[0],employee=employeeMap.get(String(first.attendance_employee_id))||null;
  let periods=employee?(periodsMap.get(String(employee.id))||[]):[];
  if(!periods.length&&employee?.shift_start&&employee?.shift_end)periods=[{sequence_no:1,label:'الفترة الأولى',start_time:employee.shift_start,end_time:employee.shift_end,grace_minutes:employee.grace_minutes??10}];
  if(!periods.length){
   const last=arr[arr.length-1],firstM=minutesFromClock(logClock(first)),shiftM=minutesFromClock(employee?.shift_start),grace=Number(employee?.grace_minutes||0),late=shiftM!=null&&firstM!=null?Math.max(0,firstM-(shiftM+grace)):0,work=arr.length>1?Math.max(0,(new Date(last.occurred_at)-new Date(first.occurred_at))/60000):0;
   rows.push({id:String(first.id)+'-'+dayKey(first.occurred_at),day:dayKey(first.occurred_at),name:employee?.name||first.employee_name||('PIN '+first.device_pin),employee_code:employee?.employee_code||'—',first_in:logClock(first),last_out:arr.length>1?logClock(last):'—',periods_summary:'غير محدد',punches:arr.length,work_minutes:work,late_minutes:late});
   continue;
  }
  periods=[...periods].sort((a,b)=>Number(a.sequence_no)-Number(b.sequence_no));
  const buckets=periods.map(p=>({period:p,logs:[]}));
  for(const log of arr){
   const m=minutesFromClock(logClock(log));
   let best=0,bestScore=Infinity;
   periods.forEach((p,i)=>{const start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time);if(start==null||end==null)return;const score=distanceToPeriod(m,start,end);if(score<bestScore){bestScore=score;best=i}});
   buckets[best].logs.push(log);
  }
  let totalWork=0,totalLate=0,firstIn='—',lastOut='—';
  const summaries=[];
  for(const b of buckets){
   const p=b.period,start=minutesFromClock(p.start_time),end=minutesFromClock(p.end_time),grace=Number(p.grace_minutes||0),ls=b.logs.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
   if(!ls.length){summaries.push((p.label||('الفترة '+p.sequence_no))+': لا توجد بصمة');continue}
   const a=ls[0],z=ls[ls.length-1],aClock=logClock(a),zClock=ls.length>1?logClock(z):'—',aM=adjustedMinute(minutesFromClock(aClock),start,end);
   if(firstIn==='—')firstIn=aClock;lastOut=zClock!=='—'?zClock:lastOut;
   totalLate+=start!=null&&aM!=null?Math.max(0,aM-(start+grace)):0;
   if(ls.length>1)totalWork+=Math.max(0,(new Date(z.occurred_at)-new Date(a.occurred_at))/60000);
   summaries.push((p.label||('الفترة '+p.sequence_no))+': '+aClock+' — '+zClock);
  }
  rows.push({id:String(first.id)+'-'+dayKey(first.occurred_at),day:dayKey(first.occurred_at),name:employee?.name||first.employee_name||('PIN '+first.device_pin),employee_code:employee?.employee_code||'—',first_in:firstIn,last_out:lastOut,periods_summary:summaries.join(' | '),punches:arr.length,work_minutes:totalWork,late_minutes:totalLate});
 }
 return rows.sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.name).localeCompare(String(b.name),'ar'));
}
function buildMonthly(daily){
 const map=new Map();
 for(const r of daily){const key=r.employee_code==='—'?r.name:r.employee_code,x=map.get(key)||{id:key,employee_code:r.employee_code,name:r.name,present_days:0,late_days:0,total_minutes:0,punches:0};x.present_days+=1;if(r.late_minutes>0)x.late_days+=1;x.total_minutes+=r.work_minutes;x.punches+=r.punches;map.set(key,x)}
 return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
}

export default function AttendanceReports({state,onError,onNotice}){
 const employees=state.employees||[],devices=state.devices||[],branches=state.branches||[],shiftPeriods=state.shiftPeriods||[];
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}return m},[shiftPeriods]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const [filters,setFilters]=useState({from_date:todayKey(),to_date:todayKey(),attendance_employee_id:'',device_id:'',report_type:'daily'}),[logs,setLogs]=useState([]),[busy,setBusy]=useState(false),[truncated,setTruncated]=useState(false);
 const daily=useMemo(()=>buildDaily(logs,employeeMap,periodsMap),[logs,employeeMap,periodsMap]),monthly=useMemo(()=>buildMonthly(daily),[daily]);

 async function loadReport(){setBusy(true);onError?.('');try{const out=await api.attendanceWrite({action:'report',...filters});setLogs(out.logs||[]);setTruncated(!!out.truncated);onNotice?.('تم تجهيز الكشف: '+String((out.logs||[]).length)+' حركة بصمة.')}catch(err){onError?.(err.message)}finally{setBusy(false)}}
 function printCurrent(){
  const subtitle='من '+filters.from_date+' إلى '+filters.to_date+' · '+(branchMap.get(String(state.scope?.branch_id))||'كل الفروع');
  if(filters.report_type==='raw')return printTable('سجل البصمات الخام',subtitle,[{label:'الموظف',value:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{label:'PIN',value:r=>r.device_pin},{label:'الجهاز',value:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{label:'التاريخ والوقت',value:r=>fmtDate(r.occurred_at)},{label:'الحالة',value:r=>r.status_code??'—'},{label:'التحقق',value:r=>r.verify_code??'—'}],logs);
  if(filters.report_type==='monthly')return printTable('كشف الحضور المجمع',subtitle,[{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'أيام الحضور',key:'present_days'},{label:'أيام التأخير',key:'late_days'},{label:'إجمالي الساعات',value:r=>humanMinutes(r.total_minutes)},{label:'عدد البصمات',key:'punches'}],monthly);
  return printTable('كشف الحضور اليومي',subtitle,[{label:'التاريخ',key:'day'},{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'تفصيل الفترات',key:'periods_summary'},{label:'أول دخول',key:'first_in'},{label:'آخر خروج',key:'last_out'},{label:'ساعات العمل',value:r=>humanMinutes(r.work_minutes)},{label:'إجمالي التأخير',value:r=>r.late_minutes?humanMinutes(r.late_minutes):'—'},{label:'البصمات',key:'punches'}],daily);
 }

 const rawCols=[{key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{key:'pin',label:'PIN',render:r=>r.device_pin},{key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{key:'time',label:'الوقت',render:r=>fmtDate(r.occurred_at)},{key:'status',label:'الحالة',render:r=>r.status_code??'—'},{key:'verify',label:'التحقق',render:r=>r.verify_code??'—'}];
 const dailyCols=[{key:'day',label:'التاريخ'},{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'periods_summary',label:'الفترات'},{key:'first_in',label:'أول دخول'},{key:'last_out',label:'آخر خروج'},{key:'work',label:'ساعات العمل',render:r=>humanMinutes(r.work_minutes)},{key:'late',label:'التأخير',render:r=>r.late_minutes?<Badge tone="orange">{humanMinutes(r.late_minutes)}</Badge>:'—'},{key:'punches',label:'البصمات'}];
 const monthlyCols=[{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'present_days',label:'أيام الحضور'},{key:'late_days',label:'أيام التأخير'},{key:'hours',label:'إجمالي الساعات',render:r=>humanMinutes(r.total_minutes)},{key:'punches',label:'البصمات'}];

 return <Card><div className="card-title"><div><h3><FileText size={19}/> الكشوفات والطباعة</h3><small>الكشف اليومي يحسب كل فترة دوام مستقلة ثم يجمع ساعات العمل والتأخير.</small></div><div className="finance-actions"><Button onClick={loadReport} disabled={busy}>{busy?'جاري التجهيز...':'عرض الكشف'}</Button><Button variant="primary" onClick={printCurrent} disabled={!logs.length}><Printer size={16}/> طباعة / PDF</Button></div></div>
 <div className="form-grid">
  <Field label="نوع الكشف"><Select value={filters.report_type} onChange={e=>setFilters(x=>({...x,report_type:e.target.value}))}><option value="daily">كشف حضور يومي تفصيلي</option><option value="monthly">كشف مجمع للفترة / الشهر</option><option value="raw">سجل البصمات الخام</option></Select></Field>
  <Field label="من تاريخ"><Input type="date" value={filters.from_date} onChange={e=>setFilters(x=>({...x,from_date:e.target.value}))}/></Field>
  <Field label="إلى تاريخ"><Input type="date" value={filters.to_date} onChange={e=>setFilters(x=>({...x,to_date:e.target.value}))}/></Field>
  <Field label="الموظف"><Select value={filters.attendance_employee_id} onChange={e=>setFilters(x=>({...x,attendance_employee_id:e.target.value}))}><option value="">كل الموظفين</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_code} — {x.name}</option>)}</Select></Field>
  <Field label="الجهاز"><Select value={filters.device_id} onChange={e=>setFilters(x=>({...x,device_id:e.target.value}))}><option value="">كل الأجهزة</option>{devices.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
 </div>{truncated&&<div className="error-box">الكشف وصل للحد الأقصى 10,000 حركة. قلّل الفترة للحصول على كشف كامل.</div>}
 {filters.report_type==='raw'?<Table rows={logs} columns={rawCols}/>:filters.report_type==='monthly'?<Table rows={monthly} columns={monthlyCols}/>:<Table rows={daily} columns={dailyCols}/>}
 </Card>;
}
