import React,{useEffect,useMemo,useState} from 'react';
import {Scale,ShieldAlert} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Select,Textarea} from '../../components/UI.jsx';

const defaults={
 attendance_mode:'biometric',
 mobile_geofence_enabled:true,
 mobile_geofence_radius_m:100,
 mobile_location_lat:'',
 mobile_location_lng:'',
 mobile_require_trusted_device:true,
 mobile_require_selfie:false,
 mobile_require_dynamic_qr:false,
 policy_effective_from:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
 early_leave_grace_minutes:10,
 shortage_grace_minutes:15,
 partial_absence_threshold_minutes:60,
 late_penalty_minutes:0,
 early_leave_penalty_minutes:0,
 missing_punch_penalty_minutes:0,
 partial_absence_penalty_minutes:0,
 absence_penalty_minutes:0,
 notes:'',
 reason:''
};

export default function AttendancePolicies({state,onChanged,onError,onNotice}){
 const branches=state.branches||[],policies=state.policies||[];
 const initialBranch=state.scope?.branch_id||branches[0]?.id||'';
 const [branchId,setBranchId]=useState(initialBranch),[form,setForm]=useState({...defaults}),[busy,setBusy]=useState(false);
 const policyMap=useMemo(()=>new Map(policies.map(p=>[String(p.branch_id),p])),[policies]);

 useEffect(()=>{
  if(!branchId&&branches[0]?.id){setBranchId(branches[0].id);return}
  const p=policyMap.get(String(branchId));
  setForm({...defaults,...(p||{}),branch_id:branchId,data_environment:state.scope?.environment||'training',reason:''});
 },[branchId,policyMap,branches,state.scope?.environment]);

 async function save(e){
  e.preventDefault();setBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_attendance_policy',...form,branch_id:branchId,data_environment:state.scope?.environment||'training'});
   onNotice?.('تم حفظ سياسة الحضور والمخالفات لهذا الفرع.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }

 return <Card><div className="card-title"><div><h3><ShieldAlert size={19}/> سياسة الحضور والمخالفات</h3><small>تحدد متى يُعتبر الانصراف مبكرًا أو الحضور جزئيًا، وتضيف جزاءات إدارية مقترحة بالدقائق للمراجعة. لا يتم خصم راتب تلقائيًا.</small></div><Badge tone="blue"><Scale size={14}/> سياسة الفرع</Badge></div>
 <form onSubmit={save} className="form-grid">
  <Field label="الفرع"><Select value={branchId} onChange={e=>setBranchId(e.target.value)} disabled={!state.scope?.all_branches}><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
  <Field label="طريقة تسجيل الحضور"><Select value={form.attendance_mode||'biometric'} onChange={e=>setForm(x=>({...x,attendance_mode:e.target.value}))}><option value="biometric">جهاز البصمة فقط</option><option value="mobile">الجوال فقط</option><option value="hybrid">البصمة أو الجوال</option></Select></Field>
  <Field label="سريان السياسة من تاريخ" hint="تظل النسخ الأقدم محفوظة للتقارير التاريخية"><Input type="date" value={form.policy_effective_from||defaults.policy_effective_from} onChange={e=>setForm(x=>({...x,policy_effective_from:e.target.value}))} required/></Field>
  {(form.attendance_mode==='mobile'||form.attendance_mode==='hybrid')&&<>
   <div className="field" style={{gridColumn:'1/-1'}}><span>تحقق الحضور بالجوال</span><div className="finance-actions">
    <label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={form.mobile_geofence_enabled!==false} onChange={e=>setForm(x=>({...x,mobile_geofence_enabled:e.target.checked}))}/> اشتراط نطاق الموقع</label>
    <label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={form.mobile_require_trusted_device!==false} onChange={e=>setForm(x=>({...x,mobile_require_trusted_device:e.target.checked}))}/> جهاز جوال موثوق</label>
    <label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={form.mobile_require_selfie===true} onChange={e=>setForm(x=>({...x,mobile_require_selfie:e.target.checked}))}/> صورة لحظية</label>
    <label style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={form.mobile_require_dynamic_qr===true} onChange={e=>setForm(x=>({...x,mobile_require_dynamic_qr:e.target.checked}))}/> QR ديناميكي</label>
   </div></div>
   {form.mobile_geofence_enabled!==false&&<>
    <Field label="خط العرض لموقع الفرع"><Input type="number" step="0.000001" min="-90" max="90" dir="ltr" value={form.mobile_location_lat??''} onChange={e=>setForm(x=>({...x,mobile_location_lat:e.target.value}))} placeholder="21.422510"/></Field>
    <Field label="خط الطول لموقع الفرع"><Input type="number" step="0.000001" min="-180" max="180" dir="ltr" value={form.mobile_location_lng??''} onChange={e=>setForm(x=>({...x,mobile_location_lng:e.target.value}))} placeholder="39.826168"/></Field>
    <Field label="نصف قطر الحضور بالمتر"><Input type="number" min="20" max="5000" value={form.mobile_geofence_radius_m??100} onChange={e=>setForm(x=>({...x,mobile_geofence_radius_m:Number(e.target.value||100)}))}/></Field>
   </>}
   <div className="success-note" style={{gridColumn:'1/-1'}}><ShieldAlert size={16}/> تفعيل الجوال لا يلغي قواعد الدوام أو الاستئذان. مصدر الحركة يتغير فقط، بينما وقت السيرفر وجدول الموظف يظلان المرجع للحساب.</div>
  </>}
  <Field label="سماح الانصراف المبكر (دقيقة)"><Input type="number" min="0" max="240" value={form.early_leave_grace_minutes??10} onChange={e=>setForm(x=>({...x,early_leave_grace_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="سماح نقص ساعات العمل (دقيقة)"><Input type="number" min="0" max="480" value={form.shortage_grace_minutes??15} onChange={e=>setForm(x=>({...x,shortage_grace_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="حد الحضور الجزئي (دقيقة نقص)"><Input type="number" min="1" max="720" value={form.partial_absence_threshold_minutes??60} onChange={e=>setForm(x=>({...x,partial_absence_threshold_minutes:Number(e.target.value||1)}))}/></Field>

  <Field label="جزاء التأخير لكل واقعة — دقائق"><Input type="number" min="0" max="1440" value={form.late_penalty_minutes??0} onChange={e=>setForm(x=>({...x,late_penalty_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="جزاء الانصراف المبكر لكل واقعة — دقائق"><Input type="number" min="0" max="1440" value={form.early_leave_penalty_minutes??0} onChange={e=>setForm(x=>({...x,early_leave_penalty_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="جزاء البصمة الناقصة لكل واقعة — دقائق"><Input type="number" min="0" max="1440" value={form.missing_punch_penalty_minutes??0} onChange={e=>setForm(x=>({...x,missing_punch_penalty_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="جزاء الحضور الجزئي لليوم — دقائق"><Input type="number" min="0" max="1440" value={form.partial_absence_penalty_minutes??0} onChange={e=>setForm(x=>({...x,partial_absence_penalty_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="جزاء الغياب الكامل لليوم — دقائق"><Input type="number" min="0" max="1440" value={form.absence_penalty_minutes??0} onChange={e=>setForm(x=>({...x,absence_penalty_minutes:Number(e.target.value||0)}))}/></Field>

  <Field label="ملاحظات السياسة"><Textarea value={form.notes||''} onChange={e=>setForm(x=>({...x,notes:e.target.value}))} placeholder="مثال: الجزاءات هنا للمراجعة الإدارية فقط قبل اعتمادها"/></Field>
  <Field label="سبب التعديل"><Input value={form.reason||''} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><ShieldAlert size={16}/> ترتيب التصنيف: إجازة/راحة ← غياب كامل ← حضور جزئي ← حضور. الاستئذان المعتمد يقلل النقص والانصراف المبكر، ولا يتم خصم مالي تلقائيًا من أي موظف.</div>
  <div className="modal-actions" style={{gridColumn:'1/-1'}}><Button variant="primary" type="submit" disabled={busy||!branchId}>{busy?'جاري الحفظ...':'حفظ السياسة'}</Button></div>
 </form></Card>;
}
