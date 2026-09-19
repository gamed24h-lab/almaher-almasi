import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Clock3,Plus,RefreshCw,Trash2,UploadCloud,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

const defaultPeriod=()=>({label:'فترة مخصصة',start_time:'08:00',end_time:'17:00',grace_minutes:10,device_shift_template_id:'',source_type:'custom'});
const blank={id:'',employee_code:'',name:'',branch_id:'',phone:'',national_id:'',department:'',job_title:'',staff_user_id:'',weekly_off_days:[5],status:'active',data_environment:'training',notes:'',reason:'',shift_periods:[defaultPeriod()]};

export default function AttendanceEmployees({state,onChanged,onError,onNotice}){
 const branches=state.branches||[],employees=state.employees||[],users=state.users||[],links=state.links||[],devices=state.devices||[],shiftPeriods=state.shiftPeriods||[],deviceShiftTemplates=state.deviceShiftTemplates||[],deleteRequests=state.deleteRequests||[];
 const [open,setOpen]=useState(false),[form,setForm]=useState(blank),[busy,setBusy]=useState(false),[pushBusy,setPushBusy]=useState(''),[deleteBusy,setDeleteBusy]=useState(''),[deleteWatching,setDeleteWatching]=useState('');
 const deleteTimer=useRef(null);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const userMap=useMemo(()=>new Map(users.map(x=>[String(x.id),x])),[users]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const templateMap=useMemo(()=>new Map(deviceShiftTemplates.map(x=>[String(x.id),x])),[deviceShiftTemplates]);
 const periodsMap=useMemo(()=>{const m=new Map();for(const p of shiftPeriods){const k=String(p.attendance_employee_id),a=m.get(k)||[];a.push(p);m.set(k,a)}for(const a of m.values())a.sort((x,y)=>Number(x.sequence_no)-Number(y.sequence_no));return m},[shiftPeriods]);
 const linksMap=useMemo(()=>{const m=new Map();for(const l of links){if(!l.attendance_employee_id||!l.active)continue;const k=String(l.attendance_employee_id),a=m.get(k)||[];a.push(l);m.set(k,a)}return m},[links]);
 const deleteMap=useMemo(()=>{const m=new Map();for(const r of deleteRequests){const k=String(r.attendance_employee_id||'');if(k&&!m.has(k))m.set(k,r)}return m},[deleteRequests]);

 const availableTemplates=useMemo(()=>{
  const branchDevices=new Set(devices.filter(d=>!form.branch_id||String(d.branch_id)===String(form.branch_id)).map(d=>String(d.id)));
  const linkedDevices=new Set(form.id?(linksMap.get(String(form.id))||[]).map(l=>String(l.device_id)):[]);
  return deviceShiftTemplates
   .filter(t=>branchDevices.has(String(t.device_id)))
   .sort((a,b)=>{
    const al=linkedDevices.has(String(a.device_id))?0:1,bl=linkedDevices.has(String(b.device_id))?0:1;
    return al-bl||String(deviceMap.get(String(a.device_id))?.name||'').localeCompare(String(deviceMap.get(String(b.device_id))?.name||''),'ar')||Number(a.sequence_no)-Number(b.sequence_no);
   });
 },[deviceShiftTemplates,devices,form.branch_id,form.id,linksMap,deviceMap]);

 useEffect(()=>{
  if(!deleteWatching)return;
  const req=deleteMap.get(String(deleteWatching));
  if(req&&req.status!=='pending'){setDeleteWatching('');return}
  clearTimeout(deleteTimer.current);
  deleteTimer.current=setTimeout(()=>onChanged?.(),2000);
  return()=>clearTimeout(deleteTimer.current);
 },[deleteWatching,deleteRequests,deleteMap,onChanged]);

 function add(){setForm({...blank,branch_id:state.scope?.branch_id||branches[0]?.id||'',data_environment:state.scope?.environment||'training',shift_periods:[defaultPeriod()]});setOpen(true)}
 function edit(r){
  const periods=(periodsMap.get(String(r.id))||[]).map((p,i)=>({
   label:p.label||('الفترة '+String(i+1)),
   start_time:String(p.start_time||'').slice(0,5),
   end_time:String(p.end_time||'').slice(0,5),
   grace_minutes:Number(p.grace_minutes??10),
   device_shift_template_id:p.device_shift_template_id||'',
   source_type:p.device_shift_template_id?'device_template':'custom'
  }));
  if(!periods.length&&r.shift_start&&r.shift_end)periods.push({label:'فترة مخصصة',start_time:String(r.shift_start).slice(0,5),end_time:String(r.shift_end).slice(0,5),grace_minutes:Number(r.grace_minutes??10),device_shift_template_id:'',source_type:'custom'});
  setForm({...blank,...r,branch_id:r.branch_id||'',staff_user_id:r.staff_user_id||'',weekly_off_days:Array.isArray(r.weekly_off_days)?r.weekly_off_days:[],shift_periods:periods.length?periods:[defaultPeriod()],reason:''});setOpen(true);
 }
 function updatePeriod(i,key,value){
  setForm(x=>({...x,shift_periods:(x.shift_periods||[]).map((p,idx)=>{
   if(idx!==i)return p;
   const changed={...p,[key]:key==='grace_minutes'?Number(value||0):value};
   if(['label','start_time','end_time','grace_minutes'].includes(key)&&p.device_shift_template_id)return {...changed,device_shift_template_id:'',source_type:'custom'};
   return changed;
  })}))
 }
 function addCustomPeriod(){setForm(x=>({...x,shift_periods:[...(x.shift_periods||[]),{...defaultPeriod(),label:'فترة مخصصة '+String((x.shift_periods||[]).filter(p=>!p.device_shift_template_id).length+1),start_time:'',end_time:''}]}))}
 function addTemplatePeriod(t){
  setForm(x=>{
   const exists=(x.shift_periods||[]).some(p=>String(p.device_shift_template_id)===String(t.id));
   if(exists)return x;
   return {...x,shift_periods:[...(x.shift_periods||[]),{label:t.name,start_time:String(t.start_time).slice(0,5),end_time:String(t.end_time).slice(0,5),grace_minutes:Number(t.grace_minutes??10),device_shift_template_id:t.id,source_type:'device_template'}]};
  });
 }
 function removePeriod(i){setForm(x=>({...x,shift_periods:(x.shift_periods||[]).filter((_,idx)=>idx!==i)}))}

 async function save(e){
  e.preventDefault();setBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'save_employee',...form,auto_push:true});
   setOpen(false);
   const queued=Number(out?.devices_queued||0);
   onNotice?.(queued>0?'تم حفظ الموظف وفترات الدوام وتم تجهيز الرفع تلقائيًا إلى '+queued+' جهاز/أجهزة.':'تم حفظ الموظف وفترات الدوام. لا يوجد جهاز مربوط بالموظف للرفع التلقائي.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }
 async function push(r){
  setPushBusy(r.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'push_employee_to_devices',attendance_employee_id:r.id});
   onNotice?.('تم تجهيز إعادة رفع بيانات الموظف إلى '+String(Math.max(1,Math.floor((out?.count||2)/2)))+' جهاز/أجهزة.');await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setPushBusy('')}
 }
 async function removeEmployee(r){
  const linked=linksMap.get(String(r.id))||[],req=deleteMap.get(String(r.id)),retry=req?.status==='failed';
  const msg=linked.length
   ?'سيتم حذف «'+r.name+'» من النظام ومن '+linked.length+' جهاز/أجهزة بصمة مرتبطة به. سجل الحضور القديم سيظل محفوظًا ولن يُحذف. هل تريد المتابعة؟'
   :'سيتم حذف «'+r.name+'» من النظام. سجل الحضور القديم سيظل محفوظًا. هل تريد المتابعة؟';
  if(!confirm(msg))return;
  setDeleteBusy(r.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'delete_employee',attendance_employee_id:r.id,reason:retry?'إعادة محاولة حذف الموظف من النظام والجهاز':'حذف الموظف من النظام والجهاز'});
   if(out?.pending){
    setDeleteWatching(r.id);
    onNotice?.(out.message||'تم إرسال أمر الحذف للجهاز، وسيُحذف الموظف من النظام بعد تأكيد الجهاز.');
   }else{
    setDeleteWatching('');
    onNotice?.(out?.message||'تم حذف الموظف مع الاحتفاظ بسجلات الحضور القديمة.');
   }
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setDeleteBusy('')}
 }

 const cols=[
  {key:'code',label:'الكود',render:r=><strong dir="ltr">{r.employee_code}</strong>},
  {key:'name',label:'الموظف',render:r=><div><strong>{r.name}</strong><div className="muted-small">{r.job_title||''}{r.department?' · '+r.department:''}</div></div>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))||'—'},
  {key:'shift',label:'فترات الدوام',render:r=>{const ps=periodsMap.get(String(r.id))||[];return ps.length?<div style={{display:'grid',gap:3}}>{ps.map(p=><span key={p.id||p.sequence_no} className="muted-small"><Clock3 size={12}/> {p.label||'فترة'}: {String(p.start_time).slice(0,5)} — {String(p.end_time).slice(0,5)} {p.device_shift_template_id?<Badge tone="green">جاهزة</Badge>:<Badge>مخصصة</Badge>}</span>)}</div>:'غير محدد'}},
  {key:'device',label:'أجهزة الربط',render:r=>{const ls=linksMap.get(String(r.id))||[];return ls.length?<div style={{display:'grid',gap:2}}>{ls.map(l=><span key={l.id} className="muted-small">{deviceMap.get(String(l.device_id))?.name||'جهاز'} · PIN {l.device_pin}</span>)}</div>:'غير مربوط'}},
  {key:'system',label:'حساب النظام',render:r=>r.staff_user_id?(userMap.get(String(r.staff_user_id))?.name||'مرتبط'):'غير مطلوب'},
  {key:'status',label:'الحالة',render:r=>{const req=deleteMap.get(String(r.id));if(req?.status==='pending')return <Badge tone="orange">جارٍ الحذف من الجهاز</Badge>;if(req?.status==='failed')return <div><Badge tone="red">فشل حذف الجهاز</Badge><div className="muted-small">نجح {req.success_count||0} · فشل {req.failed_count||0}</div></div>;return r.status==='active'?<Badge tone="green">نشط</Badge>:<Badge tone="red">موقوف</Badge>}},
  {key:'edit',label:'',render:r=>{const req=deleteMap.get(String(r.id)),pending=req?.status==='pending',failed=req?.status==='failed';return <div className="finance-actions">{state.permissions?.manage_employees&&<Button onClick={()=>edit(r)} disabled={pending}>تعديل</Button>}{state.permissions?.manage_devices&&(linksMap.get(String(r.id))||[]).length>0&&<Button onClick={()=>push(r)} disabled={pushBusy===r.id||pending}><RefreshCw size={14}/>{pushBusy===r.id?' جاري الرفع...':' إعادة رفع'}</Button>}{state.permissions?.manage_employees&&<Button onClick={()=>removeEmployee(r)} disabled={deleteBusy===r.id||pending}><Trash2 size={14}/>{deleteBusy===r.id?' جاري الطلب...':pending?' جارٍ الحذف...':failed?' إعادة محاولة الحذف':' حذف'}</Button>}</div>}}
 ];

 return <><Card><div className="card-title"><div><h3><Users size={19}/> موظفو الحضور</h3><small>اختر فترات جاهزة أو أضف فترات مخصصة لكل موظف. الحفظ يرفع بيانات الموظف تلقائيًا للأجهزة المرتبطة، والحذف ينتظر تأكيد الجهاز قبل إزالة الموظف من النظام.</small></div><div className="finance-actions"><Badge>{employees.length}</Badge>{state.permissions?.manage_employees&&<Button variant="primary" onClick={add}><Plus size={15}/> موظف جديد</Button>}</div></div><Table rows={employees} columns={cols}/><div className="success-note"><Trash2 size={16}/> حذف الموظف لا يحذف سجل حضوره القديم. إذا كان مربوطًا بجهاز بصمة، يُرسل أمر حذف للجهاز أولًا ثم يُحذف من النظام بعد نجاح التأكيد.</div></Card>

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
   <span>فترات الدوام الجاهزة</span>
   {availableTemplates.length?<div style={{display:'grid',gap:8}}>
    {availableTemplates.map(t=>{const selected=(form.shift_periods||[]).some(p=>String(p.device_shift_template_id)===String(t.id));return <div key={t.id} className="success-note" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
      <div><strong>{deviceMap.get(String(t.device_id))?.name||'الجهاز'} — {t.name}</strong><div className="muted-small">{String(t.start_time).slice(0,5)} — {String(t.end_time).slice(0,5)} · سماح {t.grace_minutes} د</div></div>
      <Button type="button" disabled={selected} onClick={()=>addTemplatePeriod(t)}>{selected?'مضافة':'إضافة للموظف'}</Button>
     </div>})}
   </div>:<div className="muted-small">لا توجد فترات جاهزة في هذا الفرع. يمكنك إضافة فترة مخصصة.</div>}
  </div>

  <div className="field" style={{gridColumn:'1/-1'}}>
   <span>الفترات المطبقة على الموظف</span>
   <div style={{display:'grid',gap:10}}>
    {(form.shift_periods||[]).map((p,i)=><Card key={i}><div className="form-grid">
      <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
       <div>{p.device_shift_template_id?<Badge tone="green">فترة جاهزة: {templateMap.get(String(p.device_shift_template_id))?.name||p.label}</Badge>:<Badge>فترة مخصصة</Badge>}</div>
       <Button type="button" onClick={()=>removePeriod(i)}><Trash2 size={14}/> حذف</Button>
      </div>
      <Field label="اسم الفترة"><Input value={p.label||''} onChange={e=>updatePeriod(i,'label',e.target.value)} required/></Field>
      <Field label="بداية الدوام"><Input type="time" value={p.start_time||''} onChange={e=>updatePeriod(i,'start_time',e.target.value)} required/></Field>
      <Field label="نهاية الدوام"><Input type="time" value={p.end_time||''} onChange={e=>updatePeriod(i,'end_time',e.target.value)} required/></Field>
      <Field label="السماح بالدقائق"><Input type="number" min="0" max="240" value={p.grace_minutes??10} onChange={e=>updatePeriod(i,'grace_minutes',e.target.value)}/></Field>
      {p.device_shift_template_id&&<div className="muted-small" style={{gridColumn:'1/-1'}}>لو عدلت الوقت أو الاسم هنا، الفترة تتحول تلقائيًا إلى «مخصصة» لهذا الموظف ولن تتأثر لاحقًا بتعديل الفترة الجاهزة.</div>}
    </div></Card>)}
    <div><Button type="button" onClick={addCustomPeriod}><Plus size={14}/> إضافة فترة مخصصة</Button></div>
   </div>
  </div>

  <Field label="الحالة"><Select value={form.status||'active'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option value="active">نشط</option><option value="inactive">موقوف</option></Select></Field>
  <Field label="البيئة"><Select value={form.data_environment||'training'} onChange={e=>setForm(x=>({...x,data_environment:e.target.value}))}><option value="training">Training</option><option value="production">Production</option></Select></Field>
  <div className="field" style={{gridColumn:'1/-1'}}><span>الإجازة الأسبوعية</span><div className="finance-actions">{[['0','الأحد'],['1','الاثنين'],['2','الثلاثاء'],['3','الأربعاء'],['4','الخميس'],['5','الجمعة'],['6','السبت']].map(([v,label])=><label key={v} style={{display:'inline-flex',alignItems:'center',gap:5}}><input type="checkbox" checked={(form.weekly_off_days||[]).includes(Number(v))} onChange={e=>setForm(x=>({...x,weekly_off_days:e.target.checked?[...(x.weekly_off_days||[]),Number(v)]:(x.weekly_off_days||[]).filter(n=>n!==Number(v))}))}/>{label}</label>)}</div></div>
  <Field label="ملاحظات"><Textarea value={form.notes||''} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></Field>
  <Field label="سبب التعديل"><Input value={form.reason||''} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder="اختياري"/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><UploadCloud size={16}/> عند الحفظ، النظام يحفظ الفترات ويجهّز رفع بيانات الموظف تلقائيًا لكل جهاز مربوط به. لو لم يكن مربوطًا بجهاز سيُحفظ فقط لحين الربط.</div>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ والرفع...':'حفظ ورفع تلقائيًا'}</Button></div>
 </form></Modal></>;
}
