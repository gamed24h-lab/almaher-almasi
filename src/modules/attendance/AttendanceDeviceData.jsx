import React,{useMemo,useState} from 'react';
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

export default function AttendanceDeviceData({state,onChanged,onError,onNotice}){
 const [busy,setBusy]=useState('');
 const devices=state.devices||[],deviceUsers=state.deviceUsers||[],commands=state.commands||[];
 const usersByDevice=useMemo(()=>{const m=new Map();for(const u of deviceUsers){const k=String(u.device_id),a=m.get(k)||[];a.push(u);m.set(k,a)}return m},[deviceUsers]);
 const lastCmd=useMemo(()=>{const m=new Map();for(const c of commands){const k=String(c.device_id);if(!m.has(k))m.set(k,c)}return m},[commands]);
 async function sync(d){
  setBusy(d.id);onError?.('');
  try{
   const out=await api.attendanceWrite({action:'sync_device_data',device_id:d.id});
   onNotice?.(out?.message||'تم إرسال طلب سحب الموظفين وسجل الحضور للجهاز. سيتم الاستلام تلقائيًا عند أول اتصال ADMS.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 const cols=[
  {key:'device',label:'الجهاز',render:d=><div><strong>{d.name}</strong><div className="muted-small">{d.model||'—'} · {d.serial_number}</div></div>},
  {key:'status',label:'الاتصال',render:d=>{const x=ageState(d);return <div><Badge tone={x.tone}>{x.label}</Badge><div className="muted-small">{fmt(d.last_command_poll_at||d.last_seen_at)}</div></div>}},
  {key:'reported',label:'الموجود بالجهاز',render:d=><div><strong>{d.reported_user_count??'—'} موظف</strong><div className="muted-small">{d.reported_fp_count??'—'} قالب بصمة · {d.reported_face_count??'—'} وجه</div><div className="muted-small">{d.reported_transaction_count??'—'} حركة معلنة</div></div>},
  {key:'synced',label:'المسحوب للنظام',render:d=><div><strong>{(usersByDevice.get(String(d.id))||[]).length} موظف</strong><div className="muted-small">السجلات تُحفظ منفصلة عن القوالب البيومترية</div></div>},
  {key:'command',label:'آخر طلب مزامنة',render:d=>{const c=lastCmd.get(String(d.id));return c?<div><Badge tone={c.status==='success'?'green':c.status==='failed'?'red':'orange'}>{cmdLabel(c.status)}</Badge><div className="muted-small">{c.command_type} · {fmt(c.created_at)}</div></div>:'—'}},
  {key:'action',label:'',render:d=>state.permissions?.manage_devices?<Button variant="primary" onClick={()=>sync(d)} disabled={busy===d.id}><DownloadCloud size={15}/>{busy===d.id?' جاري الطلب...':' سحب بيانات الجهاز'}</Button>:'—'}
 ];
 const userCols=[
  {key:'pin',label:'PIN',render:u=><strong dir="ltr">{u.device_pin}</strong>},
  {key:'name',label:'الاسم',render:u=>u.name||'بدون اسم'},
  {key:'device',label:'الجهاز',render:u=>devices.find(d=>String(d.id)===String(u.device_id))?.name||u.serial_number},
  {key:'privilege',label:'الصلاحية',render:u=>u.privilege??'—'},
  {key:'card',label:'الكارت',render:u=>u.card_number||'—'},
  {key:'last',label:'آخر مزامنة',render:u=>fmt(u.last_seen_at)}
 ];
 return <><Card><div className="card-title"><div><h3><Database size={19}/> بيانات الأجهزة والمزامنة</h3><small>يسحب أسماء/PIN الموظفين وسجل الحضور الكامل. لا يتم نسخ قالب بصمة الإصبع نفسه إلى قاعدة بيانات النظام.</small></div><Badge tone="blue"><RefreshCw size={13}/> ADMS Sync</Badge></div><Table rows={devices} columns={cols}/></Card>
 {deviceUsers.length>0&&<Card><div className="card-title"><div><h3><Users size={19}/> الموظفون المسحوبون من الأجهزة</h3><small>بيانات تعريف الموظف من جهاز البصمة، ويمكن بعدها ربط كل PIN بموظف الحضور داخل النظام.</small></div><Badge>{deviceUsers.length}</Badge></div><Table rows={deviceUsers} columns={userCols}/><div className="success-note"><Fingerprint size={16}/> عدد قوالب البصمة يظهر كإحصائية من الجهاز فقط؛ القوالب نفسها تظل داخل ZKTeco.</div></Card>}</>;
}
