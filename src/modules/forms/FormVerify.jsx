import React,{useEffect,useState} from 'react';
import {CheckCircle2,FileCheck2,XCircle} from 'lucide-react';
import {Badge,Button,Card,Loading} from '../../components/UI.jsx';

const label={draft:'مسودة',pending:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي'};
const tone=s=>s==='approved'?'green':s==='pending'?'orange':s==='draft'?'blue':'red';

export default function FormVerify({token,go}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{(async()=>{try{const r=await fetch('/api/forms/verify?token='+encodeURIComponent(token),{cache:'no-store'});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر التحقق من المستند.');setData(b.document)}catch(e){setError(e.message)}})()},[token]);
 if(!data&&!error)return <Loading text="التحقق من المستند..."/>;
 return <div style={{maxWidth:720,margin:'40px auto',padding:16}}><Card>
  <div className="card-title"><div><h2>التحقق من مستند الماهر الماسي</h2><small>التحقق الإلكتروني من رقم وحالة المستند</small></div>{data?.status==='approved'?<CheckCircle2 size={28}/>:<FileCheck2 size={28}/>}</div>
  {error?<div className="error-box"><XCircle size={18}/> {error}</div>:<div className="detail-grid">
   <div><span>رقم المستند</span><strong>{data.document_no}</strong></div>
   <div><span>نوع المستند</span><strong>{data.template_name}</strong></div>
   <div><span>الحالة</span><Badge tone={tone(data.status)}>{label[data.status]||data.status}</Badge></div>
   <div><span>الفرع</span><strong>{data.branch_name||'—'}</strong></div>
   <div><span>تاريخ الإصدار</span><strong>{data.created_at?new Date(data.created_at).toLocaleString('ar-SA'):'—'}</strong></div>
   <div><span>تاريخ الاعتماد</span><strong>{data.approved_at?new Date(data.approved_at).toLocaleString('ar-SA'):'—'}</strong></div>
  </div>}
  {go&&<div className="finance-actions" style={{marginTop:18}}><Button onClick={()=>go('/')}>الرئيسية</Button></div>}
 </Card></div>;
}
