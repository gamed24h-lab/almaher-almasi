import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,CheckCircle2,Clock3,Fingerprint,Link2,LogIn,LogOut,MapPin,RefreshCw,ShieldCheck,ShieldAlert,Smartphone,UserRoundCheck} from 'lucide-react';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import ModuleShell from '../../components/ModuleShell.jsx';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Table,Textarea} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
const statusTone=s=>s==='approved'||s==='auto_resolved'?'green':s==='rejected'?'red':s==='pending'?'orange':'gray';
const statusLabel=s=>({pending:'قيد المراجعة',auto_resolved:'تم تلقائيًا',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي'}[s]||s||'—');
const reqType=t=>({account_binding:'ربط الحساب بملف الحضور',claim_unlinked_pin:'تصحيح ربط PIN',wrong_link:'تصحيح ربط خاطئ',not_mine:'هذه البصمة ليست لي',other:'تأكيد الربط'}[t]||t||'—');
function mobileDeviceKey(){
 try{
  const k='almaher-attendance-mobile-device-key';let v=localStorage.getItem(k);
  if(!v){v=(globalThis.crypto?.randomUUID?.()||('mob-'+Date.now()+'-'+Math.random().toString(36).slice(2)));localStorage.setItem(k,v)}
  return v;
 }catch{return 'mob-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
}
function currentPosition(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('خدمة الموقع غير متاحة على هذا الجهاز.'));return}
  navigator.geolocation.getCurrentPosition(p=>resolve(p.coords),e=>reject(new Error(e.code===1?'اسمح للموقع بالوصول إلى موقعك لتسجيل الحضور.':'تعذر تحديد موقعك الحالي. حاول مرة أخرى في مكان مفتوح.')),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
 });
}

export default function AttendanceSelfService({go}){
 const {user}=useAuth();
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mobileBusy,setMobileBusy]=useState(false);
 const [employeeCode,setEmployeeCode]=useState('');
 const [requestOpen,setRequestOpen]=useState(false),[requestTarget,setRequestTarget]=useState(null),[requestReason,setRequestReason]=useState('');

 async function load(){
  setLoading(true);setError('');
  try{setData(await api.attendanceSelfService())}catch(e){setError(e.message)}finally{setLoading(false)}
 }
 useEffect(()=>{load()},[]);

 const pendingRequests=useMemo(()=>((data?.requests||[]).filter(x=>x.status==='pending')),[data]);
 const requestRows=useMemo(()=>(data?.requests||[]).map(x=>({...x,id:x.id||x.requested_at})),[data]);

 async function captureMobile(eventType){
  setMobileBusy(true);setError('');setNotice('');
  try{
   const mobile=data?.mobile_attendance||{},needsLocation=mobile?.policy?.geofence_enabled!==false&&mobile?.policy?.location_exempt!==true;
   let coords=null;if(needsLocation)coords=await currentPosition();
   const out=await api.attendanceSelfServiceWrite({action:'mobile_attendance',event_type:eventType,device_key:mobileDeviceKey(),device_label:navigator.userAgent||'جوال الموظف',request_id:globalThis.crypto?.randomUUID?.()||String(Date.now()),latitude:coords?.latitude??null,longitude:coords?.longitude??null,accuracy_m:coords?.accuracy??null});
   setNotice(out?.message||'تم تحديث حركة الحضور.');await load();
  }catch(err){setError(err.message)}finally{setMobileBusy(false)}
 }
 async function bind(e){
  e.preventDefault();if(!employeeCode.trim())return;
  setBusy('bind');setError('');setNotice('');
  try{
   const out=await api.attendanceSelfServiceWrite({action:'bind_account',employee_code:employeeCode.trim()});
   setNotice(out?.message||'تم تحديث ربط الحساب.');await load();
  }catch(err){setError(err.message)}finally{setBusy('')}
 }
 async function autoCorrect(row){
  if(!confirm('سيقوم النظام بتصحيح هذا الربط فقط إذا بقيت كل شروط الأمان متحققة على السيرفر. متابعة؟'))return;
  setBusy('auto:'+row.device_id+':'+row.device_pin);setError('');setNotice('');
  try{
   const out=await api.attendanceSelfServiceWrite({action:'auto_correct',device_id:row.device_id,device_pin:row.device_pin});
   setNotice(out?.message||'تمت معالجة الحالة.');await load();
  }catch(err){setError(err.message)}finally{setBusy('')}
 }
 async function confirmCurrent(row){
  if(!confirm('تأكيد أن PIN '+row.device_pin+' والاسم الموجود على الجهاز يخصانك فعلًا؟'))return;
  setBusy('confirm:'+row.device_id+':'+row.device_pin);setError('');setNotice('');
  try{
   const out=await api.attendanceSelfServiceWrite({action:'confirm_current_link',device_id:row.device_id,device_pin:row.device_pin,reason:'أكد الموظف من صفحة بصمتي أن الربط الحالي يخصه'});
   setNotice(out?.message||'تم تأكيد الربط.');await load();
  }catch(err){setError(err.message)}finally{setBusy('')}
 }
 function openCorrection(row,type){
  setRequestTarget({...row,request_type:type});setRequestReason('');setRequestOpen(true);
 }
 async function submitCorrection(e){
  e.preventDefault();if(!requestTarget)return;
  const reason=requestReason.trim();if(!reason){setError('اكتب سبب طلب التصحيح.');return}
  setBusy('request');setError('');setNotice('');
  try{
   const out=await api.attendanceSelfServiceWrite({action:'request_correction',device_id:requestTarget.device_id,device_pin:requestTarget.device_pin,request_type:requestTarget.request_type,reason});
   setRequestOpen(false);setNotice(out?.message||'تم إرسال طلب التصحيح.');await load();
  }catch(err){setError(err.message)}finally{setBusy('')}
 }

 const requestCols=[
  {key:'type',label:'الطلب',render:r=><div><strong>{reqType(r.request_type)}</strong><div className="muted-small">{r.requested_reason||'—'}</div></div>},
  {key:'pin',label:'الجهاز / PIN',render:r=><div>{r.device_id?<span>PIN <strong dir="ltr">{r.device_pin||'—'}</strong></span>:'—'}</div>},
  {key:'status',label:'الحالة',render:r=><Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>},
  {key:'date',label:'التاريخ',render:r=><div>{fmt(r.requested_at)}{r.resolution_note&&<div className="muted-small">{r.resolution_note}</div>}</div>}
 ];

 if(loading&&!data)return <Loading text="جاري تحميل حالة البصمة..."/>;

 return <>
  <ModuleShell title="حضوري وبصمتي" subtitle="تسجيل الحضور بالجوال عند سماح سياسة الفرع، ومراجعة ربط جهاز البصمة من نفس الصفحة" icon={Fingerprint}
   actions={<><Button onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث</Button>{go&&<Button onClick={()=>go('/')}><ArrowRight size={16}/> الرئيسية</Button>}</>}
   breadcrumbs={[{label:'الرئيسية'},{label:'بصمتي'}]}/>
  <ErrorBox error={error}/>{notice&&<div className="success-note"><CheckCircle2 size={16}/>{notice}</div>}

  {data?.available===false&&<Card><div className="card-title"><h3>الخدمة الذاتية غير متاحة لهذا الحساب</h3></div><div className="muted-small">{data.message||'هذا الحساب غير مربوط بموظف تشغيل عادي.'}</div></Card>}

  {data?.available!==false&&data?.binding_required&&<>
   <Card>
    <div className="card-title"><div><h3><UserRoundCheck size={19}/> ربط حسابي بملف الحضور</h3><small>خطوة واحدة فقط لأول مرة. النظام لن يعتمد الاسم وحده كدليل.</small></div><Badge tone={pendingRequests.some(x=>x.request_type==='account_binding')?'orange':'blue'}>{pendingRequests.some(x=>x.request_type==='account_binding')?'طلبك قيد المراجعة':'أول استخدام'}</Badge></div>
    <form onSubmit={bind} style={{display:'grid',gap:12}}>
     <Field label="الكود الوظيفي في ملف الحضور"><Input value={employeeCode} onChange={e=>setEmployeeCode(e.target.value)} placeholder="مثال: ATT-0001" dir="ltr" required/></Field>
     <div className="success-note"><ShieldCheck size={16}/> الربط التلقائي لا يتم إلا إذا كان الكود في نفس الفرع، غير مربوط بحساب آخر، والاسم متقارب بما يكفي. غير ذلك يرسل النظام طلب مراجعة للموارد البشرية.</div>
     <div><Button variant="primary" type="submit" disabled={busy==='bind'}>{busy==='bind'?' جاري التحقق...':' ربط ملف الحضور'}</Button></div>
    </form>
   </Card>
   {!!requestRows.length&&<Card><div className="card-title"><h3>طلباتك السابقة</h3><Badge>{requestRows.length}</Badge></div><Table preferenceKey="attendance-self-requests-unbound" defaultPageSize={10} rows={requestRows} columns={requestCols}/></Card>}
  </>}

  {data?.available!==false&&!data?.binding_required&&data?.employee&&<>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>ملف الحضور</span><strong>{data.employee.name}</strong><small dir="ltr">{data.employee.employee_code}</small></div></div></Card>
    <Card><div className="stat-card"><div><span>أجهزة مربوطة</span><strong>{(data.links||[]).length}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>بصمات مكتشفة</span><strong>{(data.biometric_profiles||[]).length}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>تصحيح تلقائي متاح</span><strong>{(data.safe_candidates||[]).length}</strong><small>{(data.conflicts||[]).length} تحتاج مراجعة</small></div></div></Card>
   </div>

   {data.mobile_attendance&&<Card>
    <div className="card-title"><div><h3><Smartphone size={19}/> الحضور والانصراف بالجوال</h3><small>وقت الحركة يؤخذ من السيرفر. الموقع يُطلب فقط وقت التسجيل عندما تشترطه سياسة الفرع.</small></div><Badge tone={data.mobile_attendance.exempt?'blue':data.mobile_attendance.enabled?'green':'gray'}>{data.mobile_attendance.exempt?'معفى':data.mobile_attendance.enabled?(data.mobile_attendance.attendance_mode==='hybrid'?'مختلط':'جوال'):'غير مفعّل'}</Badge></div>
    {data.mobile_attendance.error?<div className="error-box">{data.mobile_attendance.error}</div>:data.mobile_attendance.exempt?<div className="success-note"><ShieldCheck size={16}/> أنت معفى من تسجيل الحضور والانصراف خلال الفترة الحالية، ولن تُحسب غائبًا بسبب عدم وجود حركة.</div>:data.mobile_attendance.enabled?<div style={{display:'grid',gap:12}}>
     <div className="finance-actions">
      {data.mobile_attendance.policy?.geofence_enabled!==false&&!data.mobile_attendance.policy?.location_exempt&&<Badge><MapPin size={14}/> نطاق {data.mobile_attendance.policy?.geofence_radius_m||100}م · دقة GPS ≤ {data.mobile_attendance.policy?.max_accuracy_m||120}م</Badge>}
      {data.mobile_attendance.policy?.location_exempt&&<Badge tone="blue"><MapPin size={14}/> معفى من شرط الموقع</Badge>}
      {data.mobile_attendance.policy?.require_trusted_device&&<Badge><ShieldCheck size={14}/> جهاز موثوق مطلوب</Badge>}
     </div>
     <div className="success-note"><Clock3 size={16}/> آخر حالة اليوم: {data.mobile_attendance.last_attendance_event?((data.mobile_attendance.last_attendance_event.event_type==='check_in'?'حضور':'انصراف')+' — '+fmt(data.mobile_attendance.last_attendance_event.occurred_at)+' · '+(data.mobile_attendance.last_attendance_event.source==='mobile'?'جوال':'جهاز بصمة')):'لا توجد حركة مسجلة اليوم'}{Number(data.mobile_attendance.today_punches||0)>0&&<span className="muted-small"> · إجمالي الحركات {data.mobile_attendance.today_punches}</span>}</div>
     <div>
      <Button variant="primary" onClick={()=>captureMobile(data.mobile_attendance.next_event_type||'check_in')} disabled={mobileBusy}>
       {(data.mobile_attendance.next_event_type||'check_in')==='check_in'?<LogIn size={16}/>:<LogOut size={16}/>}
       {mobileBusy?' جاري التحقق والتسجيل...':(data.mobile_attendance.next_event_type||'check_in')==='check_in'?' تسجيل حضور الآن':' تسجيل انصراف الآن'}
      </Button>
     </div>
     {!!(data.mobile_attendance.today_events||[]).length&&<div><strong>حركات الجوال اليوم</strong><div style={{display:'grid',gap:6,marginTop:6}}>{data.mobile_attendance.today_events.map(ev=><div key={ev.id} className="muted-small"><strong>{ev.event_type==='check_in'?'حضور':'انصراف'}</strong> · {fmt(ev.occurred_at)}{ev.distance_from_site_m!=null?' · '+Math.round(ev.distance_from_site_m)+'م من الموقع':''}</div>)}</div></div>}
    </div>:<div className="training-banner">سياسة هذا الموظف حاليًا لا تسمح بالحضور من الجوال. استخدم جهاز البصمة أو راجع سياسة الفرع.</div>}
   </Card>}

   {!!(data.safe_candidates||[]).length&&<Card>
    <div className="card-title"><div><h3><ShieldCheck size={19}/> تصحيح تلقائي آمن متاح</h3><small>هذه الحالات PIN غير مملوك لموظف آخر، في نفس فرعك، ومطابقة الاسم واضحة على السيرفر.</small></div><Badge tone="green">{data.safe_candidates.length}</Badge></div>
    <div style={{display:'grid',gap:10}}>
     {data.safe_candidates.map(row=><Card key={row.device_id+'|'+row.device_pin}>
      <div className="card-title"><div><h3>{row.device_name}</h3><small>الاسم على الجهاز: {row.device_user_name||'—'} · PIN <span dir="ltr">{row.device_pin}</span></small></div><Badge tone="green">ثقة {row.match_score}%</Badge></div>
      <div className="muted-small">{(row.match_reasons||[]).join(' + ')||'مطابقة آمنة'}{row.biometric_count?' · '+row.biometric_count+' قالب/حالة بصمة مكتشفة':''}</div>
      <div className="finance-actions" style={{marginTop:10}}><Button variant="primary" onClick={()=>autoCorrect(row)} disabled={busy==='auto:'+row.device_id+':'+row.device_pin}><ShieldCheck size={15}/>{busy==='auto:'+row.device_id+':'+row.device_pin?' جاري التصحيح...':' تصحيح تلقائي الآن'}</Button></div>
     </Card>)}
    </div>
   </Card>}

   <Card>
    <div className="card-title"><div><h3><Fingerprint size={19}/> أرقامي وبصماتي على الأجهزة</h3><small>لا يتم عرض أو تخزين قالب البصمة الخام هنا؛ المعروض حالة الربط فقط.</small></div><Badge>{(data.links||[]).length}</Badge></div>
    {(data.links||[]).length?<div style={{display:'grid',gap:10}}>
     {data.links.map(row=><Card key={row.device_id+'|'+row.device_pin}>
      <div className="card-title"><div><h3>{row.device_name}</h3><small>PIN <span dir="ltr">{row.device_pin}</span> · اسم الجهاز: {row.device_user_name||'—'}</small></div><Badge tone={row.mismatch?'orange':'green'}>{row.mismatch?'يحتاج تأكيد':'مرتبط'}</Badge></div>
      <div className="muted-small">{row.biometric_count} بصمة/قالب مكتشف · تطابق الاسم {row.match_score}%{row.last_seen_at?' · آخر ظهور '+fmt(row.last_seen_at):''}</div>
      {row.mismatch&&<div className="training-banner" style={{marginTop:10}}>الاسم الموجود على الجهاز مختلف عن اسم ملف حضورك. لو هذا PIN الخاص بك أكد الربط، ولو ليس لك أرسل طلب تصحيح.</div>}
      <div className="finance-actions" style={{marginTop:10}}>
       {row.mismatch&&<Button variant="primary" onClick={()=>confirmCurrent(row)} disabled={busy==='confirm:'+row.device_id+':'+row.device_pin}><ShieldCheck size={15}/> هذا الربط يخصني</Button>}
       <Button onClick={()=>openCorrection(row,'not_mine')}><ShieldAlert size={15}/> هذه ليست بصمتي / الربط خطأ</Button>
      </div>
     </Card>)}
    </div>:<div className="training-banner">لا يوجد PIN مربوط بملف حضورك حتى الآن. لو النظام وجد تطابقًا آمنًا سيظهر لك أعلاه كتصحيح تلقائي.</div>}
   </Card>

   {!!(data.conflicts||[]).length&&<Card>
    <div className="card-title"><div><h3><ShieldAlert size={19}/> حالات تشبه بياناتك لكنها مرتبطة بسجل آخر</h3><small>لن يغيّرها النظام تلقائيًا حفاظًا على هوية الموظفين.</small></div><Badge tone="orange">{data.conflicts.length}</Badge></div>
    <div style={{display:'grid',gap:10}}>
     {data.conflicts.map(row=><Card key={row.device_id+'|'+row.device_pin}>
      <div className="card-title"><div><h3>{row.device_name}</h3><small>PIN <span dir="ltr">{row.device_pin}</span> · الاسم على الجهاز: {row.device_user_name||'—'}</small></div><Badge tone="orange">ثقة {row.match_score}%</Badge></div>
      <div className="finance-actions"><Button onClick={()=>openCorrection(row,'wrong_link')}><Link2 size={15}/> إرسال طلب تصحيح للموارد البشرية</Button></div>
     </Card>)}
    </div>
   </Card>}

   {!!requestRows.length&&<Card><div className="card-title"><div><h3>سجل طلبات التصحيح</h3><small>يمكنك متابعة الطلبات التي احتاجت تدخل الموارد البشرية.</small></div><Badge tone={pendingRequests.length?'orange':'green'}>{pendingRequests.length} قيد المراجعة</Badge></div><Table preferenceKey="attendance-self-requests" defaultPageSize={10} rows={requestRows} columns={requestCols}/></Card>}
  </>}

  <Modal open={requestOpen} onClose={()=>busy!=='request'&&setRequestOpen(false)} title="إرسال طلب تصحيح للموارد البشرية">
   {requestTarget&&<form onSubmit={submitCorrection} style={{display:'grid',gap:12}}>
    <div className="training-banner">الجهاز: {requestTarget.device_name||'—'} · PIN <span dir="ltr">{requestTarget.device_pin}</span>. لن يتم تغيير الربط تلقائيًا في هذه الحالة.</div>
    <Field label="اشرح المشكلة باختصار"><Textarea value={requestReason} onChange={e=>setRequestReason(e.target.value)} placeholder="مثال: هذا الرقم ليس لي / اسمي على الجهاز صحيح لكن الربط في النظام على موظف آخر" required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setRequestOpen(false)} disabled={busy==='request'}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy==='request'}>{busy==='request'?' جاري الإرسال...':' إرسال الطلب'}</Button></div>
   </form>}
  </Modal>
 </>;
}
