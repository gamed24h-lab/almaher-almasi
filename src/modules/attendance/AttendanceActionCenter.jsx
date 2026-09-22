import React,{useMemo} from 'react';
import {AlertTriangle,CalendarClock,MapPin,ShieldAlert,Smartphone,UserRoundX} from 'lucide-react';
import {Badge,Button,Card,Table} from '../../components/UI.jsx';

function today(){
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
 catch{return new Date().toISOString().slice(0,10)}
}
function addDays(key,n){const d=new Date(key+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function modeLabel(v){return v==='mobile'?'جوال':v==='hybrid'?'مختلط':'بصمة'}

export function attendanceActionItems(state){
 const branches=state?.branches||[],employees=state?.employees||[],policies=state?.policies||[],rules=state?.calendarRules||[],links=state?.links||[],periods=state?.shiftPeriods||[],mobileDevices=state?.mobileDevices||[],mobileAttempts=state?.mobileAttempts||[],correctionRequests=state?.correctionRequests||[],selfServiceRequests=state?.selfServiceBiometricRequests||[];
 const day=today(),soon=addDays(day,7),branchMap=new Map(branches.map(x=>[String(x.id),x])),policyMap=new Map(policies.map(x=>[String(x.branch_id),x]));
 const linkSet=new Set(links.filter(x=>x.active!==false&&x.attendance_employee_id).map(x=>String(x.attendance_employee_id)));
 const periodSet=new Set(periods.filter(x=>x.active!==false&&x.attendance_employee_id).map(x=>String(x.attendance_employee_id)));
 const rulesByEmployee=new Map();
 for(const r of rules){const k=String(r.attendance_employee_id||''),a=rulesByEmployee.get(k)||[];a.push(r);rulesByEmployee.set(k,a)}
 const items=[];

 for(const r of correctionRequests.filter(x=>x.status==='pending')){
  const e=employees.find(x=>String(x.id)===String(r.attendance_employee_id));
  items.push({id:'correction:'+r.id,severity:'warning',type:'correction_request',title:'طلب تصحيح حضور ينتظر المراجعة',detail:(e?.name||'موظف')+' · '+r.work_date+' · '+(r.requested_reason||'بدون سبب'),employee_id:r.attendance_employee_id,branch_id:r.branch_id,created_at:r.requested_at});
 }
 for(const r of selfServiceRequests.filter(x=>x.status==='pending')){
  const e=employees.find(x=>String(x.id)===String(r.attendance_employee_id));
  items.push({id:'self-service:'+r.id,severity:'warning',type:'self_service_request',title:'طلب خدمة ذاتية ينتظر المراجعة',detail:(e?.name||r.evidence?.employee_name||'موظف')+' · '+(r.requested_reason||'طلب ربط/تصحيح'),employee_id:r.attendance_employee_id,branch_id:r.branch_id,created_at:r.requested_at});
 }

 for(const d of mobileDevices.filter(x=>x.status==='pending')){
  const e=employees.find(x=>String(x.id)===String(d.attendance_employee_id));
  items.push({id:'mobile-device:'+d.id,severity:'warning',type:'mobile_device',title:'جهاز جوال يحتاج اعتماد',detail:(e?.name||'موظف')+' · '+(branchMap.get(String(d.branch_id))?.name||'فرع غير محدد'),employee_id:d.attendance_employee_id,branch_id:d.branch_id,created_at:d.updated_at||d.created_at});
 }
 for(const p of policies){
  if(!['mobile','hybrid'].includes(p.attendance_mode)||p.mobile_geofence_enabled===false)continue;
  const lat=Number(p.mobile_location_lat),lng=Number(p.mobile_location_lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){
   items.push({id:'branch-location:'+p.branch_id,severity:'critical',type:'branch_location',title:'موقع فرع الجوال غير مضبوط',detail:(branchMap.get(String(p.branch_id))?.name||'الفرع')+' · '+modeLabel(p.attendance_mode),branch_id:p.branch_id});
  }
 }
 for(const a of mobileAttempts){
  items.push({id:'mobile-attempt:'+a.id,severity:a.outcome==='pending_device'?'warning':'critical',type:'mobile_attempt',title:a.outcome==='pending_device'?'محاولة جوال تنتظر اعتماد الجهاز':'محاولة حضور جوال مرفوضة',detail:(a.reason_text||a.reason_code||'تحتاج مراجعة')+' · '+(employees.find(x=>String(x.id)===String(a.attendance_employee_id))?.name||'موظف'),employee_id:a.attendance_employee_id,branch_id:a.branch_id,created_at:a.attempted_at});
 }
 for(const e of employees.filter(x=>x.status==='active')){
  const er=(rulesByEmployee.get(String(e.id))||[]).filter(r=>r.status!=='cancelled'&&String(r.start_date)<=day&&String(r.end_date)>=day);
  const exempt=er.some(r=>r.rule_type==='attendance_exempt'),override=er.find(r=>r.rule_type==='attendance_mode_override')?.policy_payload?.attendance_mode;
  const base=policyMap.get(String(e.branch_id))?.attendance_mode||'biometric',mode=['biometric','mobile','hybrid'].includes(String(override))?String(override):base;
  if(!exempt&&mode==='biometric'&&!linkSet.has(String(e.id))){
   items.push({id:'biometric-link:'+e.id,severity:'warning',type:'biometric_link',title:'موظف مطلوب منه بصمة وغير مربوط بجهاز',detail:e.name+' · '+(branchMap.get(String(e.branch_id))?.name||'بدون فرع'),employee_id:e.id,branch_id:e.branch_id});
  }
  if(!exempt&&!periodSet.has(String(e.id))&&!e.shift_start&&!e.shift_end){
   items.push({id:'schedule:'+e.id,severity:'critical',type:'schedule',title:'موظف نشط بدون جدول دوام فعّال',detail:e.name+' · '+(branchMap.get(String(e.branch_id))?.name||'بدون فرع'),employee_id:e.id,branch_id:e.branch_id});
  }
 }
 for(const r of rules){
  if(r.status==='cancelled'||!['attendance_exempt','location_exempt','late_exempt','checkout_exempt','attendance_mode_override'].includes(r.rule_type))continue;
  if(String(r.end_date)>=day&&String(r.end_date)<=soon){
   const e=employees.find(x=>String(x.id)===String(r.attendance_employee_id));
   items.push({id:'exception-expiry:'+r.id,severity:'info',type:'exception_expiry',title:'استثناء حضور سينتهي قريبًا',detail:(e?.name||'موظف')+' · ينتهي '+r.end_date+(r.label?' · '+r.label:''),employee_id:r.attendance_employee_id,branch_id:r.branch_id,created_at:r.end_date});
  }
 }
 const rank={critical:0,warning:1,info:2};
 return items.sort((a,b)=>(rank[a.severity]??9)-(rank[b.severity]??9)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
}

export default function AttendanceActionCenter({state,onOpenMobile,onOpenEmployees,onOpenPolicies,onOpenLinks,onOpenApprovals}){
 const items=useMemo(()=>attendanceActionItems(state),[state]);
 const critical=items.filter(x=>x.severity==='critical').length,warning=items.filter(x=>x.severity==='warning').length,info=items.filter(x=>x.severity==='info').length;
 function actionFor(r){
  if(['correction_request','self_service_request'].includes(r.type))return onOpenApprovals;
  if(['mobile_device','mobile_attempt'].includes(r.type))return onOpenMobile;
  if(r.type==='branch_location')return onOpenPolicies;
  if(['schedule','exception_expiry'].includes(r.type))return onOpenEmployees;
  if(r.type==='biometric_link')return onOpenLinks;
  return null;
 }
 const cols=[
  {key:'severity',label:'الأولوية',render:r=><Badge tone={r.severity==='critical'?'red':r.severity==='warning'?'orange':'blue'}>{r.severity==='critical'?'عاجل':r.severity==='warning'?'متابعة':'تنبيه'}</Badge>},
  {key:'title',label:'الحالة',render:r=><div><strong>{r.title}</strong><div className="muted-small">{r.detail}</div></div>},
  {key:'action',label:'',render:r=>{const fn=actionFor(r);return fn?<Button onClick={fn}>فتح المعالجة</Button>:'—'}}
 ];
 return <div style={{display:'grid',gap:14}}>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>حالات تحتاج تدخل</span><strong>{items.length}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>عاجل</span><strong>{critical}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>متابعة</span><strong>{warning}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تنبيهات</span><strong>{info}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><ShieldAlert size={19}/> مركز متابعة الحضور</h3><small>يجمع الحالات التشغيلية التي تحتاج إجراء بدل اكتشافها عند نهاية الشهر.</small></div><Badge tone={critical?'red':warning?'orange':'green'}>{items.length}</Badge></div>
   {items.length?<Table preferenceKey="attendance-action-center" defaultPageSize={25} rows={items} columns={cols}/>:<div className="success-note"><AlertTriangle size={16}/> لا توجد حالات تشغيلية معلقة حاليًا ضمن الفحوصات المفعلة.</div>}
  </Card>
  <div className="success-note"><CalendarClock size={16}/> المركز يحترم سياسة الفرع واستثناء الموظف الحالية؛ موظف الجوال أو الموظف المعفى لا يظهر خطأً كـ«غير مربوط بالبصمة».</div>
 </div>;
}
