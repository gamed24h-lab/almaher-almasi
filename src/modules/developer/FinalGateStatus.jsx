import React,{useEffect,useState} from 'react';
import {CheckCircle2,RefreshCw,ShieldAlert,XCircle} from 'lucide-react';
import {Badge,Button,Card,ErrorBox} from '../../components/UI.jsx';

async function req(path){
  const r=await fetch(path,{credentials:'include',headers:{Accept:'application/json'},cache:'no-store'});
  const text=await r.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={message:text}}
  if(!r.ok)throw new Error(body?.error||body?.message||`HTTP ${r.status}`);return body;
}

export default function FinalGateStatus(){
  const [gate,setGate]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){setBusy(true);setError('');try{setGate(await req('/api/production/final-gate'))}catch(e){setError(e.message)}finally{setBusy(false)}}
  useEffect(()=>{load()},[]);
  const checks=gate?.checks||[];
  const ready=gate?.ready_for_final_review===true;
  return <Card><div className="card-title"><div><h3><ShieldAlert size={18}/> بوابة المراجعة النهائية قبل التشغيل</h3><small>قراءة فقط — لا يوجد من هنا أي حذف أو تحويل إلى Production.</small></div><Badge tone={ready?'green':'orange'}>{ready?'جاهز للمراجعة النهائية':'محظور حتى اكتمال الشروط'}</Badge></div><ErrorBox error={error}/><div className="developer-actions"><Button onClick={load} disabled={busy}><RefreshCw size={16}/> {busy?'جاري الفحص...':'تحديث البوابة النهائية'}</Button></div>{gate&&<><div className="permissions-box" style={{marginTop:12}}>{checks.map(x=><div key={x.key} className="permission-check" style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>{x.ok?<CheckCircle2 size={18} color="green"/>:<XCircle size={18} color="crimson"/>}<div><b>{x.label}</b><div className="muted-small">{x.details||'—'}</div></div></div>)}</div><div className="muted-small" style={{marginTop:10}}>التفعيل الفعلي: <b>مقفول</b> · الحذف الفعلي: <b>مقفول</b>{gate.plan_hash&&<> · بصمة الخطة: <b>{String(gate.plan_hash).slice(0,12)}…</b></>}</div>{(gate.warnings||[]).map((x,i)=><div className="muted-small" key={i} style={{marginTop:5}}>• {x}</div>)}</>}</Card>;
}
