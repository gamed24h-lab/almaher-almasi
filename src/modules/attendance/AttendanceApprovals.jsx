import React,{useMemo,useState} from 'react';
import {CheckCircle2,Clock3,Fingerprint,ShieldCheck,Smartphone,Users,XCircle} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function correctionLabel(v){return ({missing_check_in:'إضافة حضور مفقود',missing_check_out:'إضافة انصراف مفقود',wrong_time:'تصحيح وقت حركة',remove_event:'إلغاء حركة خاطئة'}[v]||v||'—')}
function bioRequestLabel(v){return ({account_binding:'ربط الحساب بملف الحضور',claim_unlinked_pin:'تصحيح ربط PIN',wrong_link:'تصحيح ربط خاطئ',not_mine:'هذه البصمة ليست لي',other:'تأكيد الربط'}[v]||v||'—')}

export default function AttendanceApprovals({state,onChanged,onError,onNotice,onOpenEmployees,onOpenBiometrics}){
 const corrections=state.correctionRequests||[],mobileDevices=state.mobileDevices||[],biometricRequests=state.selfServiceBiometricRequests||[],employees=state.employees||[],branches=state.branches||[];
 const [busy,setBusy]=useState('');
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const pendingCorrections=corrections.filter(x=>x.status==='pending'),pendingMobiles=mobileDevices.filter(x=>x.status==='pending'),pendingBio=biometricRequests.filter(x=>x.status==='pending');

 async function reviewCorrection(row,decision){
  const key='corr:'+row.id+':'+decision;setBusy(key);onError?.('');
  try{
   const reason=decision==='approve'?'اعتماد طلب تصحيح حركة الحضور':'رفض طلب تصحيح حركة الحضور';
   const out=await api.attendanceWrite({action:'review_attendance_correction',id:row.id,decision,reason});
   onNotice?.(out?.message||'تمت مراجعة الطلب.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function reviewMobile(row,decision){
  const key='mob:'+row.id+':'+decision;setBusy(key);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'review_mobile_device',id:row.id,decision,reason:decision==='approve'?'اعتماد جهاز حضور الجوال':'إلغاء اعتماد جهاز حضور الجوال'});
   onNotice?.(out?.message||'تم تحديث حالة الجهاز.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function reviewBio(row,decision){
  const key='bio:'+row.id+':'+decision;setBusy(key);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'review_self_service_request',id:row.id,decision,reason:decision==='approve_binding'?'اعتماد ربط حساب الموظف':'رفض طلب الخدمة الذاتية'});
   onNotice?.(out?.message||'تمت مراجعة الطلب.');await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }

 const correctionCols=[
  {key:'employee',label:'الموظف',render:r=>{const e=employeeMap.get(String(r.attendance_employee_id));return <div><strong>{e?.name||'موظف'}</strong><div className="muted-small">{e?.employee_code||''} · {branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'type',label:'الطلب',render:r=><div><strong>{correctionLabel(r.request_type)}</strong><div className="muted-small">{r.work_date} · {r.requested_reason}</div></div>},
  {key:'time',label:'الوقت المقترح',render:r=>r.proposed_at?fmt(r.proposed_at):'—'},
  {key:'requested',label:'أرسل',render:r=>fmt(r.requested_at)},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button variant="primary" onClick={()=>reviewCorrection(r,'approve')} disabled={busy==='corr:'+r.id+':approve'}><CheckCircle2 size={14}/> اعتماد</Button><Button onClick={()=>reviewCorrection(r,'reject')} disabled={busy==='corr:'+r.id+':reject'}><XCircle size={14}/> رفض</Button></div>}
 ];
 const mobileCols=[
  {key:'employee',label:'الموظف',render:r=>{const e=employeeMap.get(String(r.attendance_employee_id));return <div><strong>{e?.name||'موظف'}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'device',label:'الجوال',render:r=><div><strong>{r.device_label||'جوال الموظف'}</strong><div className="muted-small">أول ظهور {fmt(r.first_seen_at)} · آخر ظهور {fmt(r.last_seen_at)}</div></div>},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button variant="primary" onClick={()=>reviewMobile(r,'approve')} disabled={busy==='mob:'+r.id+':approve'}><ShieldCheck size={14}/> اعتماد الجهاز</Button><Button onClick={()=>reviewMobile(r,'revoke')} disabled={busy==='mob:'+r.id+':revoke'}><XCircle size={14}/> رفض / إيقاف</Button></div>}
 ];
 const bioCols=[
  {key:'employee',label:'الموظف',render:r=>{const e=employeeMap.get(String(r.attendance_employee_id));return <div><strong>{e?.name||r.evidence?.employee_name||'موظف'}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'type',label:'الطلب',render:r=><div><strong>{bioRequestLabel(r.request_type)}</strong><div className="muted-small">{r.requested_reason||'—'}</div></div>},
  {key:'device',label:'الجهاز / PIN',render:r=>r.device_id?<div>PIN <strong dir="ltr">{r.device_pin||'—'}</strong></div>:'—'},
  {key:'actions',label:'',render:r=><div className="finance-actions">{r.request_type==='account_binding'&&<Button variant="primary" onClick={()=>reviewBio(r,'approve_binding')} disabled={busy==='bio:'+r.id+':approve_binding'}><CheckCircle2 size={14}/> اعتماد الربط</Button>}<Button onClick={()=>reviewBio(r,'reject')} disabled={busy==='bio:'+r.id+':reject'}><XCircle size={14}/> رفض</Button>{r.request_type!=='account_binding'&&onOpenBiometrics&&<Button onClick={onOpenBiometrics}><Fingerprint size={14}/> فتح المطابقة</Button>}</div>}
 ];

 return <div style={{display:'grid',gap:14}}>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>إجمالي الموافقات المعلقة</span><strong>{pendingCorrections.length+pendingMobiles.length+pendingBio.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تصحيح حضور</span><strong>{pendingCorrections.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>أجهزة جوال</span><strong>{pendingMobiles.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>خدمة ذاتية / بصمة</span><strong>{pendingBio.length}</strong></div></div></Card>
  </div>

  <Card>
   <div className="card-title"><div><h3><Clock3 size={19}/> طلبات تصحيح الحضور</h3><small>الاعتماد لا يعدّل الحركة الأصلية؛ ينشئ طبقة تصحيح مستقلة ومحفوظة بالتدقيق.</small></div><Badge tone={pendingCorrections.length?'orange':'green'}>{pendingCorrections.length}</Badge></div>
   {pendingCorrections.length?<Table preferenceKey="attendance-approval-corrections" defaultPageSize={25} rows={pendingCorrections} columns={correctionCols}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد طلبات تصحيح حضور معلقة.</div>}
  </Card>

  <Card>
   <div className="card-title"><div><h3><Smartphone size={19}/> أجهزة حضور الجوال</h3><small>الجهاز الجديد لا يسجل حركة فعلية قبل الاعتماد عندما تكون سياسة الجهاز الموثوق مفعلة.</small></div><Badge tone={pendingMobiles.length?'orange':'green'}>{pendingMobiles.length}</Badge></div>
   {pendingMobiles.length?<Table preferenceKey="attendance-approval-mobile" defaultPageSize={25} rows={pendingMobiles} columns={mobileCols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد أجهزة جوال تنتظر الاعتماد.</div>}
  </Card>

  <Card>
   <div className="card-title"><div><h3><Users size={19}/> طلبات الخدمة الذاتية والبصمة</h3><small>ربط الحساب يمكن اعتماده هنا. حالات تضارب الهوية تذهب للمطابقة بدل التعديل التلقائي.</small></div><div className="finance-actions"><Badge tone={pendingBio.length?'orange':'green'}>{pendingBio.length}</Badge>{onOpenEmployees&&<Button onClick={onOpenEmployees}>الموظفون</Button>}</div></div>
   {pendingBio.length?<Table preferenceKey="attendance-approval-biometric" defaultPageSize={25} rows={pendingBio} columns={bioCols}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد طلبات خدمة ذاتية معلقة.</div>}
  </Card>
 </div>;
}
