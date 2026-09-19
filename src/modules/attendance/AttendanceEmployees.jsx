import React,{useMemo,useState} from 'react';
import {Clock3,Plus,Trash2,UploadCloud,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

const defaultPeriod=()=>({label:'الفترة الأولى',start_time:'08:00',end_time:'17:00',grace_minutes:10});
const blank={id:'',employee_code:'',name:'',branch_id:'',phone:'',national_id:'',department:'',job_title:'',staff_user_id:'',weekly_off_days:[5],status:'active',data_environment:'training',notes:'',reason:'',shift_periods:[defaultPeriod()]};

export default function AttendanceEmployees({state,onChanged,onError,onNotice}){
 const branches=state.branches||[],employees=state.employees||[],users=state.users||[],links=state.links||[],devices=state.devices||[],shiftPeriods=state.shiftPeriods||[];
 const [open,setOpen]=useState(false),[form,setForm]=useState(blank),[busy,setBusy]=useState(false),[pushBusy,setPushBusy]=useState('');
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no));return m},[shiftPeriods]);
 const linksMap=useMemo(()=>{const m=new Map();for(const l of links){if(!l.attendance_employee_id||!l.active)continue;const k=String(l.attendance_employee_id),a=m.get(k)||[];a.push(l);m.set(k,a)}return m},[links]);

 function add(){setForm({...blank,branch_id:state.scope?.branch_id||branches[0]?.id||'',data_environment:state.scope?.environment||'training',shift_periods:[defaultPeriod()]});setOpen(true)}
 function edit(r){
  const periods=(periodsMap.get(String(r.id))||[]).map((p,i)=>({label:p.label||('الفترة '+String(i+1)),start_time:String(p.start_time||'').slice(0,5),end_time:String(p.end_time||'').slice(0,5),grace_minutes:Number(p.grace_minutes??10)}));
  if(!periods.length&&r.shift_start&&r.shift_end)periods.push({label:'الفترة الأولى',start_time:String(r.shift_start).slice(0,5),end_time:String(r.shift_end).slice(0,5),grace_minutes:Number(r.grace_minutes??10)});
  setForm({...blank,...r,branch_id:r.branch_id||'',staff_user_id:r.staff_user_id||'',weekly_off_days:Array.isArray(r.weekly_off_days)?r.weekly_off_days:[],shift_periods:periods,reason:''});setOpen(true);
 }
 function updatePeriod(i,key,value){setForm(x=>({...x,shift_periods:(x.shift_periods||[]).map((p,idx)=>idx===i?{...p,[key]:key==='grace_minutes'?Number(value||0):value}:p)}))}
 function addPeriod(){setForm(x=>{const n=(x.shift_periods||[]).length+1;return {...x,shift_periods:[...(x.shift_periods||[]),{label:'الفترة '+String(n),start_time:'',end_time:'',grace_minutes:10}]}})}
 function removePeriod(i){setForm(x=>({...x,shift_periods:(x.shift_periods||[]).filter((_,idx)=>idx!==i).map((p,idx)=>({...p,label:p.label||('الفترة '+String(idx+1))}))}))}

 async function save(e){e.preventDefault();setBusy(true);onError?.('');try{await api.attendanceWrite({action:'save_employee',...form});setOpen(false);onNotice?.('تم حفظ الموظف وفترات الدوام.');await onChanged?.()}catch(err){onError?.(err.message)}finally{setBusy(false)}}
 async function push(r){setPushBusy(r.id);onError?.('');try{const out=await api.attendanceWrite({action:'push_employee_to_devices',attendance_employee_id:r.id});onNotice?.('تم تجهيز رفع اسم الموظف إلى '+String(Math.max(1,Math.floor((out?.count||2)/2)))+' جهاز/أجهزة. الجهاز يستلم الأمر في أول Poll.');await onChanged?.()}catch(err){onError?.(err.message)}finally{setPushBusy('')}}

 const cols=[
  {key:'code',label:'الكود',render:r=><strong dir="ltr">{r.employee_code}</strong>},
  {key:'name',label:'الموظف',render:r=><div><strong>{r.name}</strong><div className="muted-small">{r.job_title||''}{r.department?' · '+r.department:''}</div></div>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'shift',label:'فترات الدوام',render:r=>{const ps=periodsMap.get(String(r.id))||[];return ps.length?<div style={{display:'grid',gap:3}}>{ps.map(p=><span key={p.id||p.sequence_no} className="muted-small"><Clock3 size={12}/> {String(p.start_time).slice(0,5)} — {String(p.end_time).slice(0,5)} <span>سماح {p.grace_minutes} د</span></span>)}</div>:'غير محدد'}},
  {key:'device',label:'أجهزة الربط',render:r=>{const ls=linksMap.get(String(r.id))||[];return ls.length?<div style={{display:'grid',gap:2}}>{ls.map(l=><span key={l.id} className="muted-small">{deviceMap.get(String(l.device_id))?.name||'جهاز'} · PIN {l.device_pin}</span>)}</div>:'غير مربوط'}},
  {key:'system',label:'حساب النظام',render:r=>r.staff_user_id?(userMap.get(String(r.staff_user_id))?.name||'مرتبط'):'غير مطلوب'},
  {key:'status',label:'الحالة',render:r=>r.status==='active'?<Badge tone="green">نشط</Badge>:<Badge tone="red">موقوف</Badge>},
  {key:'edit',label:'',render:r=><div className="finance-actions">{state.permissions?.manage_employees&&<Button onClick={()=>edit(r)}>تعديل</Button>}{state.permissions?.manage_devices&&(linksMap.get(String(r.id))||[]).length>0&&<Button onClick={()=>push(r)} disabled={pushBusy===r.id}><UploadCloud size={14}/>{pushBusy===r.id?' جاري الرفع...':' رفع للجهاز'}</Button>}</div>}
 ];
 return <><Card><div className="card-title"><div><h3><Users size={19}/> موظفو الحضور</h3><small>لكل موظف فترة واحدة أو أكثر، وربط حساب النظام اختياري. الاسم المدعوم يمكن رفعه للأجهزة المرتبطة.</small></div><div className="finance-actions"><Badge>{employees.length}</Badge>{state.permissions?.manage_employees&&<Button variant="primary" onClick={add}><Plus size={15}/> موظف جديد</Button>}</div></div><Table rows={employees} columns={cols}/></Card>

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
   <span>فترات الدوام</span>
   <div style={{display:'grid',gap:10}}>
    {(form.shift_periods||[]).map((p,i)=><Card key={i}><div className="form-grid">
      <Field label={'اسم الفترة '+String(i+1)}><Input value={p.label||''} onChange={e=>updatePeriod(i,'label',e.target.value)} placeholder={i===0?'الفترة الأولى':'الفترة '+String(i+1)}/></Field>
      <Field label="بداية الدوام"><Input type="time" value={p.start_time||''} onChange={e=>updatePeriod(i,'start_time',e.target.value)} required/></Field>
      <Field label="نهاية الدوام"><Input type="time" value={p.end_time||''} onChange={e=>updatePeriod(i,'end_time',e.target.value)} required/></Field>
      <Field label="السماح بالدقائق"><Input type="number" min="0" max="240" value={p.grace_minutes??10} onChange={e=>updatePeriod(i,'grace_minutes',e.target.value)}/></Field>
      <div className="finance-actions" style={{alignItems:'end'}}>{(form.shift_periods||[]).length>1&&<Button type="button" onClick={()=>removePeriod(i)}><Trash2 size={14}/> حذف الفترة</Button>}</div>
    </div></Card>)}
    <div><Button type="button" onClick={addPeriod}><Plus size={14}/> إضافة فترة دوام أخرى</Button></div>
   </div>
  </div>

  <Field label="الحالة"><Select value={form.status||'active'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option value="active">نشط</option><option value="inactive">موقوف</option></Select></Field>
  <Field label="البيئة"><Select value={form.data_environment||'training'} onChange={e=>setForm(x=>({...x,data_environment:e.target.value}))}><option value="training">Training</option><option value="production">Production</option></Select></Field>
  <div className="field" style={{gridColumn:'1/-1'}}><span>الإجازة الأسبوعية</span><div className="finance-actions">{[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']].map(([v,label])=><label key={v} style={{display:'inline-flex',alignItems:'center',gap:5}}><input type="checkbox" checked={(form.weekly_off_days||[]).includes(Number(v))} onChange={e=>setForm(x=>({...x,weekly_off_days:e.target.checked?[...(x.weekly_off_days||[]),Number(v)]:(x.weekly_off_days||[]).filter(n=>n!==Number(v))}))}/>{label}</label>)}</div></div>
  <Field label="ملاحظات"><Textarea value={form.notes||''} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></Field>
  <Field label="سبب التعديل"><Input value={form.reason||''} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><UploadCloud size={16}/> حفظ الموظف لا يرفع تلقائيًا للجهاز. بعد الحفظ استخدم زر «رفع للجهاز» حتى تظل كل عملية واضحة ومسجلة.</div>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ الموظف'}</Button></div>
 </form></Modal></>;
}
