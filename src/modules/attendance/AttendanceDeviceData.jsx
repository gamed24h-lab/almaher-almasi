import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Database,DownloadCloud,Fingerprint,RefreshCw,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function ageState(d){
 const v=d.last_command_poll_at||d.last_seen_at;if(!v)return {tone:'red',label:'لم يتصل'};
 const ms=Date.now()-new Date(v).getTime();
 if(ms<3*60*1000)return {tone:'green',label:'متصل الآن'};
 if(ms<30*60*1000)return {tone:'orange',label:'اتصال حديث'};
 return {tone:'red',label:'غير متصل'};
}
function cmdLabel(v){return v==='success'?'تم':v==='failed'?'فشل':v==='sent'?'أرسل للجهاز':v==='queued'?'بانتظار الجهاز':v||'—'}
function cmdName(v){return v==='sync_info'?'معلومات الجهاز':v==='sync_users'?'الموظفون':v==='sync_attlog'?'سجل الحضور':v||'مزامنة'}

export default function AttendanceDeviceData({state,onChanged,onError,onNotice}){
 const [busy,setBusy]=useState(''),[watching,setWatching]=useState('');
 const timerRef=useRef(null),attemptRef=useRef(0);
 const devices=state.devices||[],deviceUsers=state.deviceUsers||[],commands=state.commands||[];
 const usersByDevice=useMemo(()=>{const m=new Map();for(const u of deviceUsers){const k=String(u.device_id),a=m.get(k)||[];a.push(u);m.set(k,a)}return m},[deviceUsers]);
 const commandsByDevice=useMemo(()=>{const m=new Map();for(const c of commands){const k=String(c.device_id),a=m.get(k)||[];a.push(c);m.set(k,a)}return m},[commands]);

 useEffect(()=>{
  if(!watching)return;
  const rows=(commandsByDevice.get(String(watching))||[]).slice(0,3);
  if(rows.length>=3&&rows.every(c=>c.status==='success'||c.status==='failed')){setWatching('');return}
  clearTimeout(timerRef.current);
  timerRef.current=setTimeout(async()=>{
   attemptRef.current+=1;
   await onChanged?.();
   if(attemptRef.current>=15)setWatching('');
  },2000);
  return()=>clearTimeout(timerRef.current);
 },[watching,commands,onChanged,commandsByDevice]);

 async function sync(d){
  setBusy(d.id);onError?.('');attemptRef.current=0;
  try{
   const out=await api.attendanceWrite({action:'sync_device_data',device_id:d.id});
   setWatching(d.id);
   onNotice?.(out?.message||'بدأ سحب بيانات الجهاز. ستتحدث الحالة تلقائيًا حتى اكتمال الموظفين وسجل الحضور.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }

 const cols=[
  {key:'device',label:'الجهاز',render:d=><div><strong>{d.name}</strong><div className="muted-small">{d.model||'—'} · {d.serial_number}</div></div>},
  {key:'status',label:'الاتصال',render:d=>{const x=ageState(d);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">{fmt(d.last_command_poll_at||d.last_seen_at)}</div></div>}},
  {key:'reported',label:'الموجود بالجهاز',render:d=><div><strong>{d.reported_user_count??'—'} موظف</strong><div className="muted-small">{d.reported_fp_count??'—'} قالب بصمة · {d.reported_face_count??'—'} وجه</div><div className="muted-small">{d.reported_transaction_count??'—'} حركة معلنة</div></div>},
  {key:'synced',label:'المسحوب للنظام',render:d=><div><strong>{(usersByDevice.get(String(d.id))||[]).length} موظف</strong><div className="muted-small">الأسماء وPIN محفوظة · القوالب البيومترية لا تُنسخ</div></div>},
  {key:'command',label:'حالة آخر سحب',render:d=>{const rows=(commandsByDevice.get(String(d.id))||[]).slice(0,3);return rows.length?<div style={{display:'grid',gap:4}}>{rows.map(c=><div key={c.id} style={{display:'flex',gap:6,alignItems:'center',justifyContent:'space-between'}}><span className="muted-small">{cmdName(c.command_type)}</span><Badge tone={c.status==='success'?'green':c.status==='failed'?'red':'orange'}>{cmdLabel(c.status)}</Badge></div>)}</div>:'—'}},
  {key:'action',label:'',render:d=>{const active=busy===d.id||watching===d.id;return state.permissions?.manage_devices?<Button variant="primary" onClick={()=>sync(d)} disabled={active}><DownloadCloud size={15}/>{active?' جاري السحب...':' سحب بيانات الجهاز'}</Button>:'—'}}
 ];
 const userCols=[
  {key:'pin',label:'PIN',render:u=><strong dir="ltr">{u.device_pin}</strong>},
  {key:'name',label:'الاسم',render:u=>u.name||'بدون اسم'},
  {key:'device',label:'الجهاز',render:u=>devices.find(d=>String(d.id)===String(u.device_id))?.name||u.serial_number},
  {key:'privilege',label:'الصلاحية',render:u=>u.privilege??'—'},
  {key:'card',label:'الكارت',render:u=>u.card_number||'—'},
  {key:'last',label:'آخر مزامنة',render:u=>fmt(u.last_seen_at)}
 ];
 return <><Card><div className="card-title"><div><h3><Database size={19}/> بيانات الأجهزة والمزامنة</h3><small>يسحب أسماء/PIN الموظفين وسجل الحضور الكامل. بعد الضغط ستظهر مراحل السحب وتُحدّث تلقائيًا.</small></div><Badge tone="blue"><RefreshCw size={13}/> ADMS Sync</Badge></div>
 {watching&&<div className="success-note" style={{marginBottom:12}}><RefreshCw size={16}/> جاري متابعة السحب تلقائيًا من الجهاز… لا تحتاج تضغط تحديث.</div>}
 <Table rows={devices} columns={cols}/></Card>
 {deviceUsers.length>0&&<Card><div className="card-title"><div><h3><Users size={19}/> الموظفون المسحوبون من الأجهزة</h3><small>بيانات تعريف الموظف من جهاز البصمة، ويمكن بعدها ربط كل PIN بموظف الحضور داخل النظام.</small></div><Badge>{deviceUsers.length}</Badge></div><Table rows={deviceUsers} columns={userCols}/><div className="success-note"><Fingerprint size={16}/> عدد قوالب البصمة يظهر كإحصائية فقط؛ قالب البصمة نفسه يظل داخل جهاز ZKTeco.</div></Card>}</>;
}
