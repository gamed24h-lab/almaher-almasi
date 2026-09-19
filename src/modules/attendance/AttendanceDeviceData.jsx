import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Database,DownloadCloud,Fingerprint,History,RefreshCw,UploadCloud,UserPlus,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function ageState(d){
 const v=d.last_command_poll_at||d.last_seen_at;if(!v)return {tone:'red',label:'لم يتصل'};
 const ms=Date.now()-new Date(v).getTime();
 if(ms<3*60*1000)return {tone:'green',label:'متصل الآن'};
 if(ms<30*60*1000)return {tone:'orange',label:'اتصال حديث'};
 return {tone:'red',label:'غير متصل'};
}
function cmdLabel(v){return v==='success'?'تم':v==='failed'?'فشل':v==='sent'?'أرسل للجهاز':v==='queued'?'بانتظار الجهاز':v||'—'}
function cmdName(v){return v==='sync_info'?'معلومات الجهاز':v==='sync_users'?'الموظفون':v==='sync_attlog'?'سجل الحضور':v==='history_attlog'?'الحركات القديمة':v==='push_user'?'رفع موظف':v==='verify_user'?'تأكيد الموظف':v||'مزامنة'}
const blankUser={device_id:'',device_pin:'',name:'',privilege:0,card_number:'',group_no:'1',timezone_raw:'0000000100000000',verify_mode:0};

export default function AttendanceDeviceData({state,onChanged,onError,onNotice}){
 const [busy,setBusy]=useState(''),[watching,setWatching]=useState(''),[importBusy,setImportBusy]=useState(''),[historyBusy,setHistoryBusy]=useState(''),[userOpen,setUserOpen]=useState(false),[userForm,setUserForm]=useState(blankUser),[userBusy,setUserBusy]=useState(false);
 const timerRef=useRef(null),attemptRef=useRef(0);
 const devices=state.devices||[],deviceUsers=state.deviceUsers||[],commands=state.commands||[],links=state.links||[];
 const usersByDevice=useMemo(()=>{const m=new Map();for(const u of deviceUsers){const k=String(u.device_id),a=m.get(k)||[];a.push(u);m.set(k,a)}return m},[deviceUsers]);
 const commandsByDevice=useMemo(()=>{const m=new Map();for(const c of commands){const k=String(c.device_id),a=m.get(k)||[];a.push(c);m.set(k,a)}return m},[commands]);
 const linkMap=useMemo(()=>new Map(links.map(l=>[String(l.device_id)+'|'+String(l.device_pin),l])),[links]);

 useEffect(()=>{
  if(!watching)return;
  const rows=(commandsByDevice.get(String(watching))||[]).slice(0,4);
  const hasPending=rows.some(c=>c.status==='queued'||c.status==='sent');
  if(rows.length&& !hasPending){setWatching('');return}
  clearTimeout(timerRef.current);
  timerRef.current=setTimeout(async()=>{attemptRef.current+=1;await onChanged?.();if(attemptRef.current>=20)setWatching('')},2000);
  return()=>clearTimeout(timerRef.current);
 },[watching,commands,onChanged,commandsByDevice]);

 async function sync(d){
  setBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'sync_device_data',device_id:d.id});
   setWatching(d.id);
   onNotice?.(out?.message||'بدأ سحب بيانات الجهاز. ستتحدث الحالة تلقائيًا.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function importAll(d){
  if(!confirm('استيراد كل الموظفين المسحوبين من هذا الجهاز كموظفي حضور وربط الـ PIN تلقائيًا؟'))return;
  setImportBusy(d.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'import_device_users',device_id:d.id});
   onNotice?.(out?.message||('تم استيراد '+String(out?.imported||0)+' موظف وربطهم بالجهاز. المتخطى: '+String(out?.skipped||0)+'.'));
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setImportBusy('')}
 }
 async function importHistory(d){
  if(!confirm('استيراد وربط كل الحركات القديمة الموجودة على هذا الجهاز؟ العملية آمنة من التكرار لأن كل حركة لها مفتاح منع تكرار.'))return;
  setHistoryBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'import_historical_attendance',device_id:d.id});
   setWatching(d.id);
   onNotice?.(out?.message||'تم بدء استيراد الحركات القديمة وربطها بالموظفين.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setHistoryBusy('')}
 }
 function editUser(u){setUserForm({...blankUser,...u,device_id:u.device_id,device_pin:u.device_pin,privilege:u.privilege??0,group_no:u.group_no||'1',timezone_raw:u.timezone_raw||'0000000100000000',verify_mode:u.verify_mode??0});setUserOpen(true)}
 async function saveAndPush(e){
  e.preventDefault();setUserBusy(true);onError?.('');attemptRef.current=0;
  try{
   await api.attendanceWrite({action:'push_device_user',...userForm});
   setUserOpen(false);setWatching(userForm.device_id);
   onNotice?.('تم تجهيز تعديل الموظف ورفعه للجهاز، ثم قراءة بياناته مرة أخرى للتأكد.');
   await onChanged?.();
  }catch(err){onError?.(err.message)}finally{setUserBusy(false)}
 }

 const cols=[
  {key:'device',label:'الجهاز',render:d=><div><strong>{d.name}</strong><div className="muted-small">{d.model||'—'} · {d.serial_number}</div></div>},
  {key:'status',label:'الاتصال',render:d=>{const x=ageState(d);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">{fmt(d.last_command_poll_at||d.last_seen_at)}</div></div>}},
  {key:'reported',label:'الموجود بالجهاز',render:d=><div><strong>{d.reported_user_count??'—'} موظف</strong><div className="muted-small">{d.reported_fp_count??'—'} قالب بصمة · {d.reported_face_count??'—'} وجه</div><div className="muted-small">{d.reported_transaction_count??'—'} حركة معلنة</div></div>},
  {key:'synced',label:'المسحوب للنظام',render:d=>{const us=usersByDevice.get(String(d.id))||[],imported=us.filter(u=>linkMap.get(String(d.id)+'|'+String(u.device_pin))?.attendance_employee_id).length;return <div><strong>{us.length} موظف مسحوب</strong><div className="muted-small">{imported} مستورد كموظف حضور</div></div>}},
  {key:'command',label:'حالة آخر أوامر',render:d=>{const rows=(commandsByDevice.get(String(d.id))||[]).slice(0,4);return rows.length?<div style={{display:'grid',gap:4}}>{rows.map(c=><div key={c.id} style={{display:'flex',gap:6,alignItems:'center',justifyContent:'space-between'}}><span className="muted-small">{cmdName(c.command_type)}</span><Badge tone={c.status==='success'?'green':c.status==='failed'?'red':'orange'}>{cmdLabel(c.status)}</Badge></div>)}</div>:'—'}},
  {key:'action',label:'',render:d=>{const active=busy===d.id||watching===d.id;const count=(usersByDevice.get(String(d.id))||[]).length;return <div className="finance-actions">{state.permissions?.manage_devices&&<Button variant="primary" onClick={()=>sync(d)} disabled={active}><DownloadCloud size={15}/>{active?' جاري السحب...':' سحب بيانات الجهاز'}</Button>}{count>0&&state.permissions?.manage_employees&&state.permissions?.manage_links&&<Button onClick={()=>importAll(d)} disabled={importBusy===d.id}><UserPlus size={15}/>{importBusy===d.id?' جاري الاستيراد...':' استيراد الموظفين'}</Button>}{state.permissions?.manage_devices&&state.permissions?.manage_links&&<Button onClick={()=>importHistory(d)} disabled={historyBusy===d.id||active}><History size={15}/>{historyBusy===d.id?' جاري الاستيراد...':' استيراد الحركات القديمة'}</Button>}</div>}}
 ];
 const userCols=[
  {key:'pin',label:'PIN',render:u=><strong dir="ltr">{u.device_pin}</strong>},
  {key:'name',label:'الاسم',render:u=>u.name||'بدون اسم'},
  {key:'device',label:'الجهاز',render:u=>devices.find(d=>String(d.id)===String(u.device_id))?.name||u.serial_number},
  {key:'privilege',label:'الصلاحية',render:u=>u.privilege===14?<Badge tone="orange">مسؤول جهاز</Badge>:<Badge>مستخدم</Badge>},
  {key:'card',label:'الكارت',render:u=>u.card_number||'—'},
  {key:'imported',label:'داخل موظفي الحضور',render:u=>linkMap.get(String(u.device_id)+'|'+String(u.device_pin))?.attendance_employee_id?<Badge tone="green">مستورد ومربوط</Badge>:<Badge tone="orange">غير مستورد</Badge>},
  {key:'last',label:'آخر مزامنة',render:u=>fmt(u.last_seen_at)},
  {key:'action',label:'',render:u=>state.permissions?.manage_devices?<Button onClick={()=>editUser(u)}><UploadCloud size={14}/> تعديل ورفع</Button>:'—'}
 ];
 return <><Card><div className="card-title"><div><h3><Database size={19}/> بيانات الأجهزة والمزامنة</h3><small>اسحب الموظفين والسجلات، استوردهم لموظفي الحضور، وعدّل بيانات الجهاز ثم ارفعها مرة أخرى.</small></div><Badge tone="blue"><RefreshCw size={13}/> ADMS Sync</Badge></div>
 {watching&&<div className="success-note" style={{marginBottom:12}}><RefreshCw size={16}/> جاري متابعة أوامر الجهاز تلقائيًا… لا تحتاج تضغط تحديث.</div>}
 <Table rows={devices} columns={cols}/></Card>

 {deviceUsers.length>0&&<Card><div className="card-title"><div><h3><Users size={19}/> الموظفون المسحوبون من الأجهزة</h3><small>يمكن تعديل الاسم والصلاحية والكارت والبيانات التي يدعمها جهاز ZKTeco، ثم رفعها للجهاز.</small></div><Badge>{deviceUsers.length}</Badge></div><Table rows={deviceUsers} columns={userCols}/><div className="success-note"><Fingerprint size={16}/> رفع الموظف لا يرفع أو ينسخ قالب بصمة الإصبع. القالب البيومتري يظل داخل الجهاز.</div></Card>}

 <Modal open={userOpen} onClose={()=>setUserOpen(false)} title="تعديل بيانات الموظف ورفعها للجهاز" wide><form onSubmit={saveAndPush} className="form-grid">
  <Field label="PIN بالجهاز"><Input dir="ltr" value={userForm.device_pin||''} readOnly/></Field>
  <Field label="الاسم على الجهاز"><Input value={userForm.name||''} onChange={e=>setUserForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="الصلاحية على الجهاز"><Select value={String(userForm.privilege??0)} onChange={e=>setUserForm(x=>({...x,privilege:Number(e.target.value)}))}><option value="0">مستخدم عادي</option><option value="14">مسؤول جهاز</option></Select></Field>
  <Field label="رقم الكارت"><Input dir="ltr" value={userForm.card_number||''} onChange={e=>setUserForm(x=>({...x,card_number:e.target.value}))}/></Field>
  <Field label="المجموعة"><Input dir="ltr" value={userForm.group_no||'1'} onChange={e=>setUserForm(x=>({...x,group_no:e.target.value}))}/></Field>
  <Field label="طريقة التحقق"><Input type="number" min="0" max="15" value={userForm.verify_mode??0} onChange={e=>setUserForm(x=>({...x,verify_mode:Number(e.target.value||0)}))}/></Field>
  <div className="success-note" style={{gridColumn:'1/-1'}}><UploadCloud size={16}/> النظام سيرسل تعديل USERINFO للجهاز ثم يطلب قراءة نفس الـPIN للتأكد من وصول التعديل.</div>
  <div className="modal-actions"><Button type="button" onClick={()=>setUserOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={userBusy}>{userBusy?'جاري تجهيز الرفع...':'حفظ ورفع للجهاز'}</Button></div>
 </form></Modal></>;
}
