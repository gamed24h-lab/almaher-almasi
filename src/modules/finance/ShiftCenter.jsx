import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,CheckCircle2,Printer,RefreshCw,WalletCards,AlertTriangle} from 'lucide-react';
import {useAuth} from '../../core/AuthContext.jsx';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,PageHeader,Select,Table,Textarea} from '../../components/UI.jsx';
import {money,dateTime,statusLabel} from '../../lib/format.js';
import {printElement} from '../../lib/print.js';

const s=v=>String(v??'');
const n=v=>Number(v||0);
export default function ShiftCenter({go}){
 const {user}=useAuth();const {data:appData}=useAppData();
 const [cloud,setCloud]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[closing,setClosing]=useState(null),[actual,setActual]=useState(''),[notes,setNotes]=useState('');
 async function load(){setBusy(true);setError('');try{setCloud(await api.module('finance_full'))}catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{load()},[]);
 const regs=cloud?.cash_registers||[],shifts=cloud?.cash_shifts||[];
 const regMap=useMemo(()=>new Map(regs.map(r=>[s(r.id),r])),[regs]);
 const branchMap=useMemo(()=>new Map((appData.branches||[]).map(b=>[s(b.id),b.name||b.branch_name||b.id])),[appData.branches]);
 const open=shifts.filter(x=>String(x.status||'open')==='open');
 const closed=shifts.filter(x=>String(x.status)==='closed');
 function expected(row){return n(row.expected_closing??row.opening_balance)}
 async function closeShift(row){const act=Number(actual);if(!Number.isFinite(act)){setError('أدخل الرصيد الفعلي عند الإغلاق.');return}setBusy(true);setError('');try{const exp=expected(row),variance=act-exp;const handover=`[تسليم واستلام وردية] الموظف=${user?.name||user?.username||user?.id||''} الرصيد المتوقع=${exp} الرصيد الفعلي=${act} الفرق=${variance}${notes?` ملاحظات=${notes}`:''}`;await api.moduleWrite({action:'update',table:'cash_shifts',id:row.id,row:{actual_closing:act,variance,status:'closed',closed_at:new Date().toISOString(),closing_notes:handover}});setClosing(null);setActual('');setNotes('');await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 function printShift(row){setTimeout(()=>{const el=document.querySelector(`[data-shift-print="${row.id}"]`);if(el)printElement(el,{title:`تسليم واستلام وردية ${row.id}`,pageSize:'A4',orientation:'portrait'})},0)}
 const cols=[{key:'register',label:'الخزنة',render:r=>regMap.get(s(r.register_id))?.name||'—'},{key:'branch',label:'الفرع',render:r=>branchMap.get(s(regMap.get(s(r.register_id))?.branch_id))||'—'},{key:'opened_at',label:'الفتح',render:r=>dateTime(r.opened_at)},{key:'opening_balance',label:'افتتاحي',render:r=>money(r.opening_balance)},{key:'actual_closing',label:'إغلاق فعلي',render:r=>r.actual_closing==null?'—':money(r.actual_closing)},{key:'variance',label:'الفرق',render:r=>r.variance==null?'—':<Badge tone={Math.abs(n(r.variance))<.01?'green':'orange'}>{money(r.variance)}</Badge>},{key:'status',label:'الحالة',render:r=><Badge tone={r.status==='closed'?'blue':'green'}>{statusLabel(r.status||'open')}</Badge>},{key:'action',label:'',render:r=><div className="row-actions">{r.status==='open'?<Button onClick={()=>{setClosing(r);setActual(String(expected(r)));setNotes('')}}>تسليم / إغلاق</Button>:<Button onClick={()=>printShift(r)}><Printer size={14}/> سند الوردية</Button>}</div>}];
 return <><PageHeader title="تسليم واستلام الورديات" subtitle="إقفال الخزنة مع الرصيد المتوقع والفعلي والفروقات وسند مستقل" actions={<><Button onClick={()=>go?.('/finance')}><ArrowRight size={16}/> المالية</Button><Button onClick={load}><RefreshCw size={16}/> تحديث</Button></>}/><ErrorBox error={error}/>{busy&&!cloud?<Loading/>:<><div className="stats-grid"><Mini label="الورديات المفتوحة" value={open.length}/><Mini label="الورديات المغلقة" value={closed.length}/><Mini label="فروقات غير صفرية" value={closed.filter(x=>Math.abs(n(x.variance))>.01).length}/><Mini label="إجمالي فروقات" value={money(closed.reduce((a,x)=>a+n(x.variance),0))}/></div><Card><Table rows={shifts} columns={cols}/></Card></>}
 {closing&&<Card><div className="card-title"><h3>تسليم الوردية</h3><Badge>{regMap.get(s(closing.register_id))?.name||'الخزنة'}</Badge></div><div className="form-grid"><Field label="الرصيد الافتتاحي"><Input value={money(closing.opening_balance)} readOnly/></Field><Field label="الرصيد المتوقع"><Input value={money(expected(closing))} readOnly/></Field><Field label="الرصيد الفعلي"><Input type="number" step="0.01" value={actual} onChange={e=>setActual(e.target.value)}/></Field><Field label="الفرق"><Input value={money(n(actual)-expected(closing))} readOnly/></Field><Field label="ملاحظات التسليم"><Textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="أي ملاحظات أو عهدة تم تسليمها..."/></Field></div><div className="page-actions"><Button onClick={()=>setClosing(null)}>إلغاء</Button><Button variant="primary" disabled={busy} onClick={()=>closeShift(closing)}><CheckCircle2 size={16}/> اعتماد التسليم والإغلاق</Button></div></Card>}
 {closed.map(r=><div key={r.id} data-shift-print={r.id} className="print-only"><h2>سند تسليم واستلام وردية</h2><p>الخزنة: {regMap.get(s(r.register_id))?.name||'—'}</p><p>الفرع: {branchMap.get(s(regMap.get(s(r.register_id))?.branch_id))||'—'}</p><p>الفتح: {dateTime(r.opened_at)}</p><p>الإغلاق: {dateTime(r.closed_at)}</p><p>الرصيد الافتتاحي: {money(r.opening_balance)}</p><p>الرصيد المتوقع: {money(expected(r))}</p><p>الرصيد الفعلي: {money(r.actual_closing)}</p><p>الفرق: {money(r.variance)}</p><p>{r.closing_notes||''}</p></div>)}
 </>;
}
function Mini({label,value}){return <Card className="stat-card"><WalletCards/><div><span>{label}</span><strong>{value}</strong></div></Card>}
