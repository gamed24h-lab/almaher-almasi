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
 const html='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#111;margin:0}.head{text-align:center;margin-bottom:16px}.head h1{font-size:20px;margin:0 0 6px}.head p{font-size:12px;margin:0;color:#555}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:center}th{background:#f2f4f7}.meta{display:flex;justify-content:space-between;font-size:10px;margin:8px 0 12px}.foot{font-size:9px;color:#666;margin-top:10px;text-align:center}</style></head><body><div class="head"><h1>'+esc(title)+'</h1><p>'+esc(subtitle||'')+'</p></div><div class="meta"><span>نظام الماهر الماسي — الحضور والبصمة</span><span>'+esc(new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}))+'</span></div><table><thead><tr>'+th+'</tr></thead><tbody>'+(body||empty)+'</tbody></table><div class="foot">كشف مولّد من سجلات أجهزة البصمة المرتبطة بالنظام.</div><script>window.onload=function(){window.print()}</script></body></html>';
 win.document.open();win.document.write(html);win.document.close();
}
function buildDaily(logs,employeeMap){
 const groups=new Map();
 for(const log of logs||[]){const day=dayKey(log.occurred_at),key=String(log.attendance_employee_id||log.staff_user_id||('pin:'+log.device_id+':'+log.device_pin))+'|'+day,arr=groups.get(key)||[];arr.push(log);groups.set(key,arr)}
 const rows=[];
 for(const arr of groups.values()){arr.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));const first=arr[0],last=arr[arr.length-1],employee=employeeMap.get(String(first.attendance_employee_id))||null,firstM=minutesFromClock(timeOnly(first.device_time_raw||first.occurred_at)),shiftM=minutesFromClock(employee?.shift_start),grace=Number(employee?.grace_minutes||0),late=shiftM!=null&&firstM!=null?Math.max(0,firstM-(shiftM+grace)):0,work=arr.length>1?Math.max(0,(new Date(last.occurred_at)-new Date(first.occurred_at))/60000):0;rows.push({id:String(first.id)+'-'+day,day,name:employee?.name||first.employee_name||('PIN '+first.device_pin),employee_code:employee?.employee_code||'—',first_in:timeOnly(first.device_time_raw||first.occurred_at),last_out:arr.length>1?timeOnly(last.device_time_raw||last.occurred_at):'—',punches:arr.length,work_minutes:work,late_minutes:late})}
 return rows.sort((a,b)=>String(a.day).localeCompare(String(b.day))||String(a.name).localeCompare(String(b.name),'ar'));
}
function buildMonthly(daily){
 const map=new Map();
 for(const r of daily){const key=r.employee_code==='—'?r.name:r.employee_code,x=map.get(key)||{id:key,employee_code:r.employee_code,name:r.name,present_days:0,late_days:0,total_minutes:0,punches:0};x.present_days+=1;if(r.late_minutes>0)x.late_days+=1;x.total_minutes+=r.work_minutes;x.punches+=r.punches;map.set(key,x)}
 return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ar'));
}

export default function AttendanceReports({state,onError,onNotice}){
 const employees=state.employees||[],devices=state.devices||[],branches=state.branches||[];
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const [filters,setFilters]=useState({from_date:todayKey(),to_date:todayKey(),attendance_employee_id:'',device_id:'',report_type:'daily'}),[logs,setLogs]=useState([]),[busy,setBusy]=useState(false),[truncated,setTruncated]=useState(false);
 const daily=useMemo(()=>buildDaily(logs,employeeMap),[logs,employeeMap]),monthly=useMemo(()=>buildMonthly(daily),[daily]);

 async function loadReport(){setBusy(true);onError?.('');try{const out=await api.attendanceWrite({action:'report',...filters});setLogs(out.logs||[]);setTruncated(!!out.truncated);onNotice?.('تم تجهيز الكشف: '+String((out.logs||[]).length)+' حركة بصمة.')}catch(err){onError?.(err.message)}finally{setBusy(false)}}
 function printCurrent(){
  const subtitle='من '+filters.from_date+' إلى '+filters.to_date+' · '+(branchMap.get(String(state.scope?.branch_id))||'كل الفروع');
  if(filters.report_type==='raw')return printTable('سجل البصمات الخام',subtitle,[{label:'الموظف',value:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{label:'PIN',value:r=>r.device_pin},{label:'الجهاز',value:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{label:'التاريخ والوقت',value:r=>fmtDate(r.occurred_at)},{label:'الحالة',value:r=>r.status_code??'—'},{label:'التحقق',value:r=>r.verify_code??'—'}],logs);
  if(filters.report_type==='monthly')return printTable('كشف الحضور المجمع',subtitle,[{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'أيام الحضور',key:'present_days'},{label:'أيام التأخير',key:'late_days'},{label:'إجمالي الساعات',value:r=>humanMinutes(r.total_minutes)},{label:'عدد البصمات',key:'punches'}],monthly);
  return printTable('كشف الحضور اليومي',subtitle,[{label:'التاريخ',key:'day'},{label:'الكود',key:'employee_code'},{label:'الموظف',key:'name'},{label:'أول دخول',key:'first_in'},{label:'آخر خروج',key:'last_out'},{label:'ساعات العمل',value:r=>humanMinutes(r.work_minutes)},{label:'التأخير',value:r=>r.late_minutes?humanMinutes(r.late_minutes):'—'},{label:'البصمات',key:'punches'}],daily);
 }

 const rawCols=[{key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||r.employee_name||('PIN '+r.device_pin)},{key:'pin',label:'PIN',render:r=>r.device_pin},{key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||r.serial_number},{key:'time',label:'الوقت',render:r=>fmtDate(r.occurred_at)},{key:'status',label:'الحالة',render:r=>r.status_code??'—'},{key:'verify',label:'التحقق',render:r=>r.verify_code??'—'}];
 const dailyCols=[{key:'day',label:'التاريخ'},{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'first_in',label:'أول دخول'},{key:'last_out',label:'آخر خروج'},{key:'work',label:'ساعات العمل',render:r=>humanMinutes(r.work_minutes)},{key:'late',label:'التأخير',render:r=>r.late_minutes?<Badge tone="orange">{humanMinutes(r.late_minutes)}</Badge>:'—'},{key:'punches',label:'البصمات'}];
 const monthlyCols=[{key:'employee_code',label:'الكود'},{key:'name',label:'الموظف'},{key:'present_days',label:'أيام الحضور'},{key:'late_days',label:'أيام التأخير'},{key:'hours',label:'إجمالي الساعات',render:r=>humanMinutes(r.total_minutes)},{key:'punches',label:'البصمات'}];

 return <Card><div className="card-title"><div><h3><FileText size={19}/> الكشوفات والطباعة</h3><small>كشف يومي، كشف مجمع لفترة أو شهر، وسجل البصمات الخام.</small></div><div className="finance-actions"><Button onClick={loadReport} disabled={busy}>{busy?'جاري التجهيز...':'عرض الكشف'}</Button><Button variant="primary" onClick={printCurrent} disabled={!logs.length}><Printer size={16}/> طباعة / PDF</Button></div></div>
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
