import React,{useMemo,useRef,useState} from 'react';
import {ArchiveRestore,DatabaseBackup,Download,FileJson,RefreshCw,ShieldAlert,Upload} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox} from '../../components/UI.jsx';

const GROUPS=[
 ['branches','الفروع'],['branchContacts','اتصالات الفروع'],['trips','الرحلات'],['tripBranches','فروع الرحلات'],['bookings','الحجوزات'],['passengers','الركاب'],['users','الموظفون']
];
const SAFE_RESTORE=new Set(['branches','trips','users']);
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const arr=v=>Array.isArray(v)?v:[];

export default function DeveloperDataCenter(){
 const {data,refresh}=useAppData();
 const [selected,setSelected]=useState(()=>Object.fromEntries(GROUPS.map(([k])=>[k,true]))),[error,setError]=useState(''),[msg,setMsg]=useState(''),[incoming,setIncoming]=useState(null),[busy,setBusy]=useState('');
 const inputRef=useRef(null);
 const counts=useMemo(()=>Object.fromEntries(GROUPS.map(([k])=>[k,arr(data?.[k]).length])),[data]);
 const picked=GROUPS.filter(([k])=>selected[k]).map(([k])=>k);
 function toggle(k){setSelected(x=>({...x,[k]:!x[k]}))}
 function downloadBackup(){
   setError('');setMsg('');
   if(!picked.length)return setError('اختر مجموعة بيانات واحدة على الأقل.');
   const payload={format:'ALMAHER_BACKUP_V1',created_at:new Date().toISOString(),environment:data?.scope?.account_mode||data?.scope?.mode||'training',groups:Object.fromEntries(picked.map(k=>[k,arr(data?.[k])]))};
   const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ALMAHER-BACKUP-${stamp()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);setMsg(`تم تجهيز نسخة احتياطية على الجهاز تشمل ${picked.length} مجموعات بيانات.`)
 }
 async function readFile(e){
   setError('');setMsg('');const file=e.target.files?.[0];if(!file)return;try{const txt=await file.text();const json=JSON.parse(txt);if(json?.format!=='ALMAHER_BACKUP_V1'||!json.groups)throw new Error('الملف ليس نسخة احتياطية معتمدة من نظام الماهر.');setIncoming(json);setMsg('تم فحص ملف النسخة الاحتياطية. راجع البيانات قبل الاستعادة.')}catch(ex){setIncoming(null);setError(ex.message)}finally{e.target.value=''}
 }
 async function restoreSafe(){
   if(!incoming?.groups)return;const keys=Object.keys(incoming.groups).filter(k=>SAFE_RESTORE.has(k));if(!keys.length)return setError('هذه النسخة لا تحتوي على مجموعات يمكن استعادتها بأمان من الواجهة الحالية.');
   if(!confirm('سيتم دمج البيانات الأساسية المحددة مع البيانات الحالية. لن يتم حذف أي بيانات تلقائيًا. هل تريد المتابعة؟'))return;
   setBusy('restore');setError('');setMsg('');try{
     if(keys.includes('branches'))for(const b of arr(incoming.groups.branches))await api.admin({action:'save_branch',row:b});
     if(keys.includes('users')&&arr(incoming.groups.users).length)await api.admin({action:'sync_users',rows:incoming.groups.users});
     if(keys.includes('trips')&&arr(incoming.groups.trips).length)await api.admin({action:'sync_trips',rows:incoming.groups.trips});
     await refresh();setMsg('تمت استعادة البيانات الأساسية المدعومة ودمجها مع النظام بنجاح.');
   }catch(ex){setError(ex.message)}finally{setBusy('')}
 }
 return <Card><div className="card-title"><div><h3><DatabaseBackup size={18}/> مركز النسخ الاحتياطي والبيانات</h3><small>تحميل نسخة على الجهاز، فحص نسخة سابقة، واستعادة آمنة للبيانات الأساسية بدون حذف تلقائي.</small></div><Badge tone="orange">للمطور فقط</Badge></div><ErrorBox error={error}/>{msg&&<div className="training-banner" style={{background:'#ecfdf3',color:'#166534',borderColor:'#bbf7d0'}}>{msg}</div>}
 <div className="permission-grid">{GROUPS.map(([k,l])=><label className="permission-check" key={k}><input type="checkbox" checked={!!selected[k]} onChange={()=>toggle(k)}/><span>{l} <b>({counts[k]||0})</b></span></label>)}</div>
 <div className="developer-actions" style={{marginTop:14}}><Button variant="primary" onClick={downloadBackup}><Download size={16}/> تنزيل نسخة على الجهاز</Button><Button onClick={()=>inputRef.current?.click()}><Upload size={16}/> اختيار نسخة للاستعادة</Button><input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={readFile}/>{incoming&&<Button onClick={restoreSafe} disabled={busy==='restore'}><ArchiveRestore size={16}/>{busy==='restore'?'جاري الاستعادة...':'استعادة البيانات الأساسية'}</Button>}<Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث العدادات</Button></div>
 {incoming&&<div className="permissions-box" style={{marginTop:14}}><div className="card-title"><div><h3><FileJson size={17}/> النسخة المحددة</h3><small>{incoming.created_at||'بدون تاريخ'} · {incoming.environment||'غير محدد'}</small></div></div><div className="permission-grid">{Object.entries(incoming.groups||{}).map(([k,v])=><div className="permission-check" key={k}><b>{GROUPS.find(x=>x[0]===k)?.[1]||k}</b><div className="muted-small">{arr(v).length} سجل {SAFE_RESTORE.has(k)?'· قابل للاستعادة الآن':'· محفوظ في النسخة فقط'}</div></div>)}</div></div>}
 <div className="error-box" style={{background:'#fff9ed',borderColor:'#f1d8a8',color:'#7a4b00',marginTop:14}}><ShieldAlert size={16}/> الحذف النهائي والاستعادة الكاملة للحجوزات والركاب والمالية لن تُنفذ من المتصفح مباشرة. ستُربط بمحرك خادم محمي مع Snapshot إلزامي + تأكيد مزدوج حتى لا يمكن مسح بيانات الشركة بالخطأ.</div></Card>
}
