import React,{useState} from 'react';
import {Badge,Button,Card,ErrorBox,Loading,Table} from '../../components/UI.jsx';
import {RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';
import {money,dateTime} from '../../lib/format.js';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';

const LABELS={
 stale_pending_transactions:'حركات معلقة منذ أكثر من 10 دقائق',
 payments_without_receipt:'تحصيلات بدون رقم سند PAY',
 duplicate_references:'أرقام سندات مكررة',
 closed_shifts_missing_actual:'ورديات مغلقة بدون رصيد فعلي',
 shift_variances:'ورديات بها فرق في الرصيد'
};
const arr=v=>Array.isArray(v)?v:[];
const countIssues=a=>Object.values(a||{}).reduce((n,v)=>n+arr(v).length,0);

export default function FinanceReconciliation(){
 const {user}=useAuth();
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const explicit=Object.prototype.hasOwnProperty.call(user?.permissions||{},'reconcileFinance');
 const allowed=has(user,'reconcileFinance')||(!explicit&&(has(user,'finance')||has(user,'reports')));
 if(!allowed)return null;
 async function run(){
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/finance/reconcile',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
   const text=await r.text();let out={};try{out=text?JSON.parse(text):{}}catch{out={error:text}}
   if(!r.ok)throw new Error(out?.error||`HTTP ${r.status}`);
   setResult(out);
  }catch(e){setError(e.message||'تعذر إجراء المطابقة المالية.')}finally{setBusy(false)}
 }
 const summary=result?.summary||{},anomalies=result?.anomalies||{},issues=countIssues(anomalies);
 const issueRows=Object.entries(anomalies).flatMap(([kind,items])=>arr(items).map((item,i)=>({id:`${kind}-${i}`,kind,label:LABELS[kind]||kind,item})));
 const issueCols=[
  {key:'state',label:'الحالة',render:()=> <Badge tone="red">❌ يحتاج مراجعة</Badge>},
  {key:'label',label:'الفحص'},
  {key:'details',label:'التفاصيل',render:r=>{
    const x=r.item||{};
    if(r.kind==='duplicate_references')return `${x.reference||'—'} · مكرر ${x.count||0} مرة`;
    if(r.kind==='shift_variances')return `وردية ${x.id||'—'} · الفرق ${money(x.variance)}`;
    if(r.kind==='closed_shifts_missing_actual')return `وردية ${x.id||'—'} · أغلقت ${dateTime(x.closed_at)}`;
    if(r.kind==='stale_pending_transactions')return `${x.reference||x.id||'—'} · ${money(x.amount)} · ${dateTime(x.created_at)}`;
    if(r.kind==='payments_without_receipt')return `${x.reference||'بدون مرجع'} · ${money(x.amount)} · ${dateTime(x.created_at)}`;
    return x.id||x.reference||'—';
  }}
 ];
 return <Card>
  <div className="card-title">
   <div><h3>فحص المطابقة المالية</h3><small>مراجعة التحصيلات والسندات والخزن والورديات واكتشاف الفروقات بدون تعديل أي بيانات.</small></div>
   <Button onClick={run} disabled={busy}>{busy?<><RefreshCw size={16}/> جاري الفحص...</>:<><ShieldCheck size={16}/> فحص المطابقة المالية</>}</Button>
  </div>
  <ErrorBox error={error}/>
  {busy&&<Loading text="جاري مراجعة الحركات المالية..."/>}
  {result&&!busy&&<>
   <div className="finance-scope" style={{marginTop:10}}>
    {issues===0?<><ShieldCheck size={18}/><strong>✅ لا توجد فروقات أو حالات شاذة في الفحص الحالي.</strong></>:<><TriangleAlert size={18}/><strong>❌ تم العثور على {issues} حالة تحتاج مراجعة.</strong></>}
    <span className="muted-small">آخر فحص: {dateTime(result.generated_at)} · النطاق: {result?.scope?.all_branches?'كل الفروع':'الفرع الحالي'}</span>
   </div>
   <div className="table-summary" style={{marginTop:10}}>
    <span>التحصيل: <b>{money(summary.collected)}</b></span><span>الاسترداد: <b>{money(summary.refund_total)}</b></span><span>المصروفات: <b>{money(summary.expense_total)}</b></span><span>صافي الحركة: <b>{money(summary.net_movement)}</b></span><span>الورديات المفتوحة: <b>{summary.open_shifts||0}</b></span><span>حركات Pending: <b>{summary.pending_transactions||0}</b></span>
   </div>
   {issueRows.length?<div style={{marginTop:12}}><Table rows={issueRows} columns={issueCols}/></div>:<div className="empty" style={{marginTop:12}}>✅ نتائج الفحص سليمة.</div>}
  </>}
 </Card>;
}
