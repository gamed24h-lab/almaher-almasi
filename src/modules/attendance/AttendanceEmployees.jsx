import React,{useMemo,useState} from 'react';
import {Users,Plus} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

const blank={id:'',employee_code:'',name:'',branch_id:'',phone:'',national_id:'',department:'',job_title:'',staff_user_id:'',shift_start:'08:00',shift_end:'17:00',grace_minutes:10,weekly_off_days:[5],status:'active',data_environment:'training',notes:'',reason:''};

export default function AttendanceEmployees({state,onChanged,onError,onNotice}){
 const branches=state.branches||[],employees=state.employees||[],users=state.users||[];
 const [open,setOpen]=useState(false),[form,setForm]=useState(blank),[busy,setBusy]=useState(false);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 function add(){setForm({...blank,branch_id:state.scope?.branch_id||branches[0]?.id||'',data_environment:state.scope?.environment||'training'});setOpen(true)}
 function edit(r){setForm({...blank,...r,branch_id:r.branch_id||'',staff_user_id:r.staff_user_id||'',weekly_off_days:Array.isArray(r.weekly_off_days)?r.weekly_off_days:[],reason:''});setOpen(true)}
 async function save(e){e.preventDefault();setBusy(true);onError?.('');try{await api.attendanceWrite({action:'save_employee',...form});setOpen(false);onNotice?.('تم حفظ موظف الحضور. اربط رقم PIN الخاص به من قسم ربط أرقام الأجهزة.');await onChanged?.()}catch(err){onError?.(err.message)}finally{setBusy(false)}}
 const cols=[
  {key:'code',label:'الكود',render:r=><strong dir="ltr">{r.employee_code}</strong>},
  {key:'name',label:'الموظف',render:r=><div><strong>{r.name}</strong><div className="muted-small">{r.job_title||''}{r.department?' · '+r.department:''}</div></div>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'shift',label:'الدوام',render:r=>r.shift_start&&r.shift_end?String(r.shift_start).slice(0,5)+' — '+String(r.shift_end).slice(0,5):'غير محدد'},
  {key:'system',label:'حساب النظام',render:r=>r.staff_user_id?(userMap.get(String(r.staff_user_id))?.name||'مرتبط'):'غير مطلوب'},
  {key:'status',label:'الحالة',render:r=>r.status==='active'?<Badge tone="green">نشط</Badge>:<Badge tone="red">موقوف</Badge>},
  {key:'edit',label:'',render:r=>state.permissions?.manage_employees?<Button onClick={()=>edit(r)}>تعديل</Button>:'—'}
 ];
 return <><Card><div className="card-title"><div><h3><Users size={19}/> موظفو الحضور</h3><small>موظف الحضور لا يحتاج حساب دخول للنظام. ربط حساب النظام اختياري.</small></div><div className="finance-actions"><Badge>{employees.length}</Badge>{state.permissions?.manage_employees&&<Button variant="primary" onClick={add}><Plus size={15}/> موظف جديد</Button>}</div></div><Table rows={employees} columns={cols}/></Card>
 <Modal open={open} onClose={()=>setOpen(false)} title={form.id?'تعديل موظف حضور':'إضافة موظف حضور'} wide><form onSubmit={save} className="form-grid">
  <Field label="اسم الموظف"><Input value={form.name||''} onChange={e=>setForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="كود الموظف" hint="اتركه فارغًا ليولده النظام تلقائيًا"><Input dir="ltr" value={form.employee_code||''} onChange={e=>setForm(x=>({...x,employee_code:e.target.value.toUpperCase()}))} placeholder="ATT-0001"/></Field>
  <Field label="الفرع"><Select value={form.branch_id||''} onChange={e=>setForm(x=>({...x,branch_id:e.target.value}))} required><option value="">اختر الفرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
  <Field label="الجوال"><Input dir="ltr" value={form.phone||''} onChange={e=>setForm(x=>({...x,phone:e.target.value}))}/></Field>
  <Field label="رقم الهوية"><Input dir="ltr" value={form.national_id||''} onChange={e=>setForm(x=>({...x,national_id:e.target.value}))}/></Field>
  <Field label="القسم"><Input value={form.department||''} onChange={e=>setForm(x=>({...x,department:e.target.value}))}/></Field>
  <Field label="المسمى الوظيفي"><Input value={form.job_title||''} onChange={e=>setForm(x=>({...x,job_title:e.target.value}))}/></Field>
  <Field label="حساب النظام (اختياري)"><Select value={form.staff_user_id||''} onChange={e=>setForm(x=>({...x,staff_user_id:e.target.value}))}><option value="">بدون حساب دخول</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} — {branchMap.get(String(u.branch_id))||'إدارة عامة'}</option>)}</Select></Field>
  <Field label="بداية الدوام"><Input type="time" value={String(form.shift_start||'').slice(0,5)} onChange={e=>setForm(x=>({...x,shift_start:e.target.value}))}/></Field>
  <Field label="نهاية الدوام"><Input type="time" value={String(form.shift_end||'').slice(0,5)} onChange={e=>setForm(x=>({...x,shift_end:e.target.value}))}/></Field>
  <Field label="فترة السماح بالدقائق"><Input type="number" min="0" max="240" value={form.grace_minutes??10} onChange={e=>setForm(x=>({...x,grace_minutes:Number(e.target.value||0)}))}/></Field>
  <Field label="الحالة"><Select value={form.status||'active'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option value="active">نشط</option><option value="inactive">موقوف</option></Select></Field>
  <Field label="البيئة"><Select value={form.data_environment||'training'} onChange={e=>setForm(x=>({...x,data_environment:e.target.value}))}><option value="training">Training</option><option value="production">Production</option></Select></Field>
  <div className="field" style={{gridColumn:'1/-1'}}><span>الإجازة الأسبوعية</span><div className="finance-actions">{[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']].map(([v,label])=><label key={v} style={{display:'inline-flex',alignItems:'center',gap:5}}><input type="checkbox" checked={(form.weekly_off_days||[]).includes(Number(v))} onChange={e=>setForm(x=>({...x,weekly_off_days:e.target.checked?[...(x.weekly_off_days||[]),Number(v)]:(x.weekly_off_days||[]).filter(n=>n!==Number(v))}))}/>{label}</label>)}</div></div>
  <Field label="ملاحظات"><Textarea value={form.notes||''} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></Field>
  <Field label="سبب التعديل"><Input value={form.reason||''} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ الموظف'}</Button></div>
 </form></Modal></>;
}
