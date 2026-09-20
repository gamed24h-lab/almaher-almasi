import React,{useMemo,useState} from 'react';
import {Fingerprint,RefreshCw,ShieldCheck,Star,Trash2} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Field,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

const FINGERS=[
 ['right_thumb','إبهام اليد اليمنى'],['right_index','سبابة اليد اليمنى'],['right_middle','وسطى اليد اليمنى'],['right_ring','بنصر اليد اليمنى'],['right_little','خنصر اليد اليمنى'],
 ['left_thumb','إبهام اليد اليسرى'],['left_index','سبابة اليد اليسرى'],['left_middle','وسطى اليد اليسرى'],['left_ring','بنصر اليد اليسرى'],['left_little','خنصر اليد اليسرى']
];
const fingerLabel=code=>FINGERS.find(x=>x[0]===code)?.[1]||code||'—';
const statusLabel=s=>s==='success'?'تم التسجيل':s==='failed'?'فشل':s==='sent'?'وصل للجهاز':s==='queued'?'في الانتظار':s==='cancelled'?'ملغي':s||'—';
const statusTone=s=>s==='success'?'green':s==='failed'?'red':s==='queued'||s==='sent'?'orange':'gray';
function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}

export default function AttendanceBiometrics({state,employee,onChanged,onError,onNotice,disabled=false}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[importBusy,setImportBusy]=useState(false),[actionBusy,setActionBusy]=useState('');
 const [form,setForm]=useState({biometric_type:'finger',finger_code:'right_index',device_id:'',overwrite_existing:true,retry_count:3,reason:''});
 const devices=state.devices||[],links=state.links||[],profiles=state.biometricProfiles||[],requests=state.biometricEnrollmentRequests||[];
 const deviceMap=useMemo(()=>new Map(devices.map(d=>[String(d.id),d])),[devices]);
 const linkedDevices=useMemo(()=>{
  const seen=new Set(),out=[];
  for(const l of links){
   if(!l.active||String(l.attendance_employee_id)!==String(employee?.id))continue;
   const d=deviceMap.get(String(l.device_id));if(!d||seen.has(String(d.id)))continue;
   seen.add(String(d.id));out.push({device:d,link:l});
  }
  return out;
 },[links,employee?.id,deviceMap]);
 const current=useMemo(()=>profiles.filter(x=>String(x.attendance_employee_id)===String(employee?.id)),[profiles,employee?.id]);
 const recent=useMemo(()=>requests.filter(x=>String(x.attendance_employee_id)===String(employee?.id)).slice(0,20),[requests,employee?.id]);
 const selectedKey=form.biometric_type==='face'?'face':'finger:'+form.finger_code;
 const activeCurrent=current.filter(x=>x.status==='active');
 const activeByKey=new Map(activeCurrent.map(x=>[x.biometric_key,x]));
 const existing=activeByKey.get(selectedKey)||null;

 function show(){
  const first=linkedDevices[0]?.device?.id||'';
  setForm({biometric_type:'finger',finger_code:'right_index',device_id:first,overwrite_existing:true,retry_count:3,reason:''});
  setOpen(true);
 }
 async function submit(e){
  e.preventDefault();setBusy(true);onError?.('');
  try{
   if(!form.device_id)throw new Error('اربط الموظف بجهاز بصمة أولًا ثم اختر الجهاز.');
   const out=await api.attendanceWrite({
    action:'request_biometric_enrollment',
    attendance_employee_id:employee.id,
    device_id:form.device_id,
    biometric_type:form.biometric_type,
    finger_code:form.biometric_type==='finger'?form.finger_code:null,
    overwrite_existing:form.overwrite_existing,
    retry_count:Number(form.retry_count||3),
    reason:form.reason
   });
   onNotice?.(out?.message||'تم إرسال طلب تسجيل البصمة إلى الجهاز.');
   setForm(x=>({...x,reason:''}));
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setBusy(false)}
 }
 async function importExisting(){
  if(!form.device_id){onError?.('اختر الجهاز الذي توجد عليه بصمة الموظف.');return}
  setImportBusy(true);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'import_device_biometrics',device_id:form.device_id,attendance_employee_id:employee.id});
   onNotice?.(out?.message||'تم بدء قراءة البصمات الموجودة للموظف من الجهاز.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setImportBusy(false)}
 }
 async function setPreference(profile,preference){
  setActionBusy('pref-'+profile.id);onError?.('');
  try{
   await api.attendanceWrite({action:'set_biometric_preference',profile_id:profile.id,preference});
   onNotice?.(preference==='primary'?'تم تعيين البصمة كأساسية.':preference==='backup'?'تم تعيين البصمة كاحتياطية.':'تم إلغاء أولوية البصمة.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setActionBusy('')}
 }
 async function deleteProfile(profile){
  const reason=window.prompt('اكتب سبب حذف هذه البصمة من الجهاز:','');
  if(reason==null)return;if(!String(reason).trim()){onError?.('سبب حذف البصمة مطلوب.');return}
  if(!window.confirm('سيتم حذف '+(profile.biometric_type==='face'?'بصمة الوجه':fingerLabel(profile.finger_code))+' من جهاز '+(deviceMap.get(String(profile.source_device_id))?.name||'البصمة')+'. الموظف نفسه لن يُحذف. متابعة؟'))return;
  setActionBusy('del-'+profile.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'delete_biometric_profile',profile_id:profile.id,reason:String(reason).trim()});
   onNotice?.(out?.message||'تم إرسال طلب حذف البصمة المحددة من الجهاز.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setActionBusy('')}
 }

 const profileCols=[
  {key:'kind',label:'البصمة',render:r=><div><strong>{r.biometric_type==='face'?'بصمة الوجه':fingerLabel(r.finger_code)}</strong><div className="muted-small">{r.biometric_type==='face'?'Face':('Finger · Slot '+r.slot_no)}</div></div>},
  {key:'device',label:'آخر جهاز تسجيل',render:r=>deviceMap.get(String(r.source_device_id))?.name||'—'},
  {key:'version',label:'الإصدار',render:r=><Badge>V{r.version||1}</Badge>},
  {key:'status',label:'الحالة',render:r=><div><Badge tone={r.status==='active'?'green':r.status==='error'?'red':'orange'}>{r.status==='active'?'نشطة':r.status==='disabled'?'محذوفة من الجهاز':'مشكلة'}</Badge>{r.metadata?.preference==='primary'&&<div className="muted-small">⭐ أساسية</div>}{r.metadata?.preference==='backup'&&<div className="muted-small">احتياطية</div>}</div>},
  {key:'source',label:'المصدر',render:r=>r.metadata?.source==='device_import'?<Badge tone="blue">مستوردة من الجهاز</Badge>:<Badge tone="green">مسجلة من النظام</Badge>},
  {key:'date',label:'آخر تحديث',render:r=>fmt(r.last_enrolled_at||r.last_sync_at)},
  {key:'actions',label:'',render:r=>r.status==='active'?<div className="finance-actions"><Button onClick={()=>setPreference(r,'primary')} disabled={actionBusy==='pref-'+r.id}><Star size={14}/> أساسية</Button><Button onClick={()=>setPreference(r,'backup')} disabled={actionBusy==='pref-'+r.id}>احتياطية</Button><Button onClick={()=>deleteProfile(r)} disabled={actionBusy==='del-'+r.id}><Trash2 size={14}/> حذف من الجهاز</Button></div>:'—'}
 ];
 const requestCols=[
  {key:'kind',label:'الطلب',render:r=>r.biometric_type==='face'?'وجه':fingerLabel(r.finger_code)},
  {key:'device',label:'الجهاز',render:r=>deviceMap.get(String(r.device_id))?.name||'—'},
  {key:'status',label:'الحالة',render:r=><div><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>{r.result_code!=null&&r.status==='failed'&&<div className="muted-small">Code {r.result_code}</div>}</div>},
  {key:'time',label:'الوقت',render:r=>fmt(r.requested_at)}
 ];

 return <>
  <Button onClick={show} disabled={disabled}><Fingerprint size={15}/> البصمات</Button>
  <Modal open={open} onClose={()=>setOpen(false)} title={'الهوية البيومترية — '+(employee?.name||'الموظف')} wide>
   <div style={{display:'grid',gap:14}}>
    <div className="success-note"><ShieldCheck size={16}/> النظام يحفظ نوع البصمة وحالتها والإصبع والجهاز فقط. قالب الإصبع أو بيانات الوجه الخام لا يتم حفظها في قاعدة بيانات الماهر.</div>
    <div className="card-title"><div><h3>خريطة الأصابع</h3><small>عرض سريع للأصابع العشرة وما هو مسجل فعليًا لهذا الموظف.</small></div><Badge tone={activeCurrent.length?'green':'orange'}>{activeCurrent.length} نشطة</Badge></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:8}}>
     {FINGERS.map(([code,label])=>{const p=activeByKey.get('finger:'+code);return <div key={code} style={{border:'1px solid var(--border)',borderRadius:12,padding:10,display:'grid',gap:5}}><strong style={{fontSize:13}}>{label}</strong>{p?<><Badge tone="green">مسجل</Badge><span className="muted-small">{p.metadata?.preference==='primary'?'أساسية':p.metadata?.preference==='backup'?'احتياطية':'نشطة'}</span></>:<Badge tone="gray">غير مسجل</Badge>}</div>})}
    </div>
    <div className="card-title"><div><h3>البصمات المسجلة</h3><small>يمكن تعيين بصمة أساسية واحتياطية، أو حذف إصبع محدد من الجهاز دون حذف الموظف.</small></div><Badge>{current.length}</Badge></div>
    {current.length?<Table preferenceKey="attendance-employee-biometrics" defaultPageSize={10} rows={current} columns={profileCols}/>:<div className="muted-small">لا توجد بصمة مؤكدة لهذا الموظف حتى الآن.</div>}

    <form onSubmit={submit} className="form-grid">
     <Field label="نوع البصمة">
      <Select value={form.biometric_type} onChange={e=>setForm(x=>({...x,biometric_type:e.target.value}))}>
       <option value="finger">بصمة إصبع</option>
       <option value="face">بصمة وجه</option>
      </Select>
     </Field>
     {form.biometric_type==='finger'&&<Field label="الإصبع">
      <Select value={form.finger_code} onChange={e=>setForm(x=>({...x,finger_code:e.target.value}))}>
       {FINGERS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </Select>
     </Field>}
     <Field label="جهاز التسجيل" hint="تظهر فقط الأجهزة المربوطة بالموظف">
      <Select value={form.device_id} onChange={e=>setForm(x=>({...x,device_id:e.target.value}))} required>
       <option value="">اختر الجهاز</option>
       {linkedDevices.map(({device,link})=><option key={device.id} value={device.id}>{device.name||device.serial_number} · PIN {link.device_pin}</option>)}
      </Select>
     </Field>
     <Field label="عند وجود بصمة في نفس المكان">
      <Select value={form.overwrite_existing?'yes':'no'} onChange={e=>setForm(x=>({...x,overwrite_existing:e.target.value==='yes'}))}>
       <option value="yes">استبدال / إعادة تسجيل</option>
       <option value="no">عدم الاستبدال</option>
      </Select>
     </Field>
     <Field label="عدد محاولات الالتقاط">
      <Select value={String(form.retry_count)} onChange={e=>setForm(x=>({...x,retry_count:Number(e.target.value)}))}>
       <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
      </Select>
     </Field>
     <Field label="السبب" hint={existing?'مطلوب لأن هذه البصمة مسجلة بالفعل وسيتم تغييرها':'اختياري عند أول تسجيل'}>
      <Textarea value={form.reason} onChange={e=>setForm(x=>({...x,reason:e.target.value}))} placeholder={existing?'مثال: إعادة تسجيل بسبب ضعف القراءة':'ملاحظات التسجيل'}/>
     </Field>
     <div className="finance-actions" style={{gridColumn:'1/-1'}}>
      <Button type="submit" variant="primary" disabled={busy||importBusy||!linkedDevices.length}><Fingerprint size={15}/>{busy?' جاري إرسال الطلب...':existing?' تغيير البصمة':' تسجيل بصمة جديدة'}</Button>
      <Button type="button" onClick={importExisting} disabled={importBusy||busy||!form.device_id}><RefreshCw size={15}/>{importBusy?' جاري طلب البصمات...':' استيراد الموجود من الجهاز'}</Button>
      <Button type="button" onClick={()=>onChanged?.()} disabled={busy||importBusy}><RefreshCw size={15}/> تحديث الحالة</Button>
     </div>
     {!linkedDevices.length&&<div className="error-box" style={{gridColumn:'1/-1'}}>الموظف غير مربوط بأي جهاز بصمة. اربطه بجهاز وحدد PIN أولًا، وبعدها سيظهر الجهاز هنا.</div>}
     {form.biometric_type==='face'&&<div className="muted-small" style={{gridColumn:'1/-1'}}>تسجيل الوجه يعتمد على دعم موديل الجهاز لأمر Face Enrollment. إذا لم يدعمه الجهاز ستظهر العملية كفشل مع كود الجهاز بدون إنشاء سجل وجه مؤكد.</div>}
    </form>

    <div className="card-title"><div><h3>آخر طلبات التسجيل</h3><small>تتبع الطلب من لحظة إرساله حتى رد جهاز البصمة.</small></div><Badge>{recent.length}</Badge></div>
    {recent.length?<Table preferenceKey="attendance-biometric-requests" defaultPageSize={10} rows={recent} columns={requestCols}/>:<div className="muted-small">لا توجد طلبات تسجيل سابقة.</div>}
   </div>
  </Modal>
 </>;
}
