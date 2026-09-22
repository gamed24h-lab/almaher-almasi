import React,{useMemo,useState} from 'react';
import {MapPin,RefreshCw,ShieldCheck,Smartphone,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function modeLabel(v){return v==='mobile'?'جوال فقط':v==='hybrid'?'مختلط':v==='biometric'?'بصمة فقط':'بصمة فقط'}
function modeTone(v){return v==='mobile'?'green':v==='hybrid'?'orange':'blue'}

export default function AttendanceMobileControl({state,onChanged,onError,onNotice,onOpenPolicies,onOpenEmployees}){
 const branches=state.branches||[],employees=state.employees||[],policies=state.policies||[],mobileDevices=state.mobileDevices||[],mobileEvents=state.mobileEvents||[];
 const [busy,setBusy]=useState('');
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x])),[branches]);
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);
 const policyMap=useMemo(()=>new Map(policies.map(x=>[String(x.branch_id),x])),[policies]);
 const mobileBranches=useMemo(()=>branches.filter(b=>['mobile','hybrid'].includes(policyMap.get(String(b.id))?.attendance_mode)),[branches,policyMap]);
 const pendingDevices=mobileDevices.filter(x=>x.status==='pending');
 const approvedDevices=mobileDevices.filter(x=>x.status==='approved');

 async function review(row,decision){
  const key=row.id+':'+decision;setBusy(key);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'review_mobile_device',id:row.id,decision,reason:decision==='approve'?'اعتماد جهاز حضور الجوال من مركز الحضور':'إلغاء اعتماد جهاز حضور الجوال من مركز الحضور'});
   onNotice?.(out?.message||'تم تحديث حالة الجهاز.');await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setBusy('')}
 }

 const branchRows=branches.map(b=>{
  const p=policyMap.get(String(b.id))||{},mode=p.attendance_mode||'biometric';
  return {...b,policy:p,mode,location_ready:Number.isFinite(Number(p.mobile_location_lat))&&Number.isFinite(Number(p.mobile_location_lng))};
 });
 const branchCols=[
  {key:'name',label:'الفرع',render:r=><strong>{r.name}</strong>},
  {key:'mode',label:'طريقة الحضور',render:r=><Badge tone={modeTone(r.mode)}>{modeLabel(r.mode)}</Badge>},
  {key:'location',label:'موقع الجوال',render:r=>r.mode==='biometric'?'—':r.location_ready?<div><Badge tone="green"><MapPin size={13}/> مضبوط</Badge><div className="muted-small">نطاق {r.policy.mobile_geofence_radius_m||100}م · دقة ≤ {r.policy.mobile_max_accuracy_m||120}م</div></div>:<Badge tone="red">غير مضبوط</Badge>},
  {key:'trusted',label:'الجهاز الموثوق',render:r=>r.mode==='biometric'?'—':r.policy.mobile_require_trusted_device!==false?<Badge>مطلوب</Badge>:<Badge tone="orange">غير مطلوب</Badge>},
  {key:'effective',label:'ساري من',render:r=>r.policy.policy_effective_from||'—'}
 ];
 const deviceCols=[
  {key:'employee',label:'الموظف',render:r=>{const e=employeeMap.get(String(r.attendance_employee_id));return <div><strong>{e?.name||'موظف'}</strong><div className="muted-small">{e?.employee_code||''} · {branchMap.get(String(r.branch_id))?.name||'—'}</div></div>}},
  {key:'device',label:'الجوال',render:r=><div><strong>{r.device_label||'جوال الموظف'}</strong><div className="muted-small">آخر ظهور: {fmt(r.last_seen_at)}</div></div>},
  {key:'status',label:'الحالة',render:r=><Badge tone={r.status==='approved'?'green':r.status==='pending'?'orange':'red'}>{r.status==='approved'?'معتمد':r.status==='pending'?'بانتظار الاعتماد':'موقوف'}</Badge>},
  {key:'actions',label:'',render:r=><div className="finance-actions">{r.status!=='approved'&&<Button onClick={()=>review(r,'approve')} disabled={busy===r.id+':approve'}>اعتماد</Button>}{r.status!=='revoked'&&<Button onClick={()=>review(r,'revoke')} disabled={busy===r.id+':revoke'}>إلغاء الاعتماد</Button>}</div>}
 ];
 const eventCols=[
  {key:'employee',label:'الموظف',render:r=>{const e=employeeMap.get(String(r.attendance_employee_id));return <div><strong>{e?.name||'موظف'}</strong><div className="muted-small">{e?.employee_code||''}</div></div>}},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
  {key:'type',label:'الحركة',render:r=><Badge tone={r.event_type==='check_in'?'green':'blue'}>{r.event_type==='check_in'?'حضور':'انصراف'}</Badge>},
  {key:'time',label:'وقت السيرفر',render:r=>fmt(r.occurred_at)},
  {key:'distance',label:'الموقع',render:r=>r.distance_from_site_m==null?<span className="muted-small">بدون شرط موقع</span>:<div><strong>{Math.round(Number(r.distance_from_site_m)||0)}م</strong><div className="muted-small">دقة GPS {Math.round(Number(r.accuracy_m)||0)}م</div></div>}
 ];

 return <div style={{display:'grid',gap:14}}>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>فروع الجوال / المختلط</span><strong>{mobileBranches.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>أجهزة موثوقة</span><strong>{approvedDevices.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تحتاج اعتماد</span><strong>{pendingDevices.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>حركات الجوال اليوم</span><strong>{mobileEvents.length}</strong></div></div></Card>
  </div>

  <Card>
   <div className="card-title"><div><h3><Smartphone size={19}/> حالة الحضور بالجوال حسب الفروع</h3><small>السياسة الفعلية الحالية لكل فرع. الفروع بدون سياسة صريحة تظل «بصمة فقط» افتراضيًا.</small></div>{onOpenPolicies&&<Button onClick={onOpenPolicies}>فتح السياسات</Button>}</div>
   <Table preferenceKey="attendance-mobile-branches" defaultPageSize={25} rows={branchRows} columns={branchCols}/>
  </Card>

  <Card>
   <div className="card-title"><div><h3><ShieldCheck size={19}/> أجهزة الجوال الموثوقة</h3><small>أول جهاز جديد يظل بانتظار الاعتماد عندما تكون سياسة «جهاز موثوق» مفعلة.</small></div><Badge tone={pendingDevices.length?'orange':'green'}>{pendingDevices.length} معلق</Badge></div>
   {mobileDevices.length?<Table preferenceKey="attendance-mobile-devices" defaultPageSize={25} rows={mobileDevices} columns={deviceCols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد أجهزة جوال مسجلة حتى الآن.</div>}
  </Card>

  <Card>
   <div className="card-title"><div><h3><Users size={19}/> حركات الجوال اليوم</h3><small>الحركات المقبولة فقط، ووقت التسجيل هنا هو وقت السيرفر.</small></div><div className="finance-actions">{onOpenEmployees&&<Button onClick={onOpenEmployees}>الموظفون والاستثناءات</Button>}<Button onClick={()=>onChanged?.()}><RefreshCw size={14}/> تحديث</Button></div></div>
   {mobileEvents.length?<Table preferenceKey="attendance-mobile-events" defaultPageSize={25} rows={mobileEvents} columns={eventCols}/>:<div className="success-note"><Smartphone size={16}/> لا توجد حركات حضور بالجوال اليوم.</div>}
  </Card>
 </div>;
}
