import React,{useEffect,useState} from 'react';
import {CheckCircle2,RefreshCw,ShieldAlert,XCircle} from 'lucide-react';
import {Badge,Button,Card,ErrorBox} from '../../components/UI.jsx';

async function req(path,{method='GET'}={}){
  const r=await fetch(path,{method,credentials:'include',headers:{Accept:'application/json'},cache:'no-store'});
  const text=await r.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={message:text}}
  if(!r.ok){const e=new Error(body?.error||body?.message||`HTTP ${r.status}`);e.status=r.status;throw e}return body;
}
async function safeReq(path,options){try{return {ok:true,data:await req(path,options)}}catch(error){return {ok:false,error:error?.message||'تعذر تنفيذ الفحص'}}}

export default function FinalGateStatus(){
  const [gate,setGate]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){
    setBusy(true);setError('');
    try{
      const [readinessR,inventoryR,planR,rollbackR]=await Promise.all([
        safeReq('/api/production/readiness'),
        safeReq('/api/production/prelaunch-inventory'),
        safeReq('/api/production/prelaunch-reset-plan'),
        safeReq('/api/production/rollback-test',{method:'POST'})
      ]);
      const readiness=readinessR.data||{},inventory=inventoryR.data||{},plan=planR.data||{},rollback=rollbackR.data||{};
      const checks=[
        {key:'readiness',label:'الجاهزية الأساسية',ok:readinessR.ok&&readiness.ready===true,details:readinessR.ok?((readiness.blockers||[]).length?`موانع: ${(readiness.blockers||[]).join('، ')}`:'الفحوصات الأساسية سليمة'):readinessR.error},
        {key:'inventory',label:'الجرد الشامل',ok:inventoryR.ok&&inventory.ok===true,details:inventoryR.ok?`${inventory.totals?.total??0} سجل تشغيلي`:inventoryR.error},
        {key:'reset_plan',label:'خطة التصفير الحالية',ok:planR.ok&&plan.ok===true&&!!plan.plan_hash,details:planR.ok?(plan.plan_hash?`SHA-256 ${String(plan.plan_hash).slice(0,12)}…`:'لا توجد بصمة صالحة'):planR.error},
        {key:'snapshot',label:'Snapshot قبل التشغيل',ok:planR.ok&&!!plan.latest_snapshot,details:planR.ok?(plan.latest_snapshot?.completed_at||'غير موجودة'):planR.error},
        {key:'restore_drill',label:'Restore Drill على آخر Snapshot',ok:planR.ok&&plan.latest_snapshot?.restore_tested===true,details:planR.ok?(plan.latest_snapshot?.restore_tested_at||'لم ينجح بعد'):planR.error},
        {key:'rollback',label:'سلامة ملف Rollback',ok:rollbackR.ok&&rollback.verified===true,details:rollbackR.ok?(rollback.verified?'checksum والتغطية الأساسية سليمان':'فحص Rollback غير مكتمل'):rollbackR.error}
      ];
      const ready=checks.every(x=>x.ok);
      setGate({checks,ready_for_final_review:ready,plan_hash:plan.plan_hash||null,warnings:['هذه البوابة تجمع نتائج فحوصات مستقلة للقراءة فقط.','التفعيل والحذف يظلان مقفولين حتى بعد نجاح جميع الشروط.']});
      const failedRequests=[readinessR,inventoryR,planR,rollbackR].filter(x=>!x.ok);if(failedRequests.length)setError(`تعذر إكمال ${failedRequests.length} من فحوصات البوابة. راجع النتائج أدناه.`);
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  useEffect(()=>{load()},[]);
  const checks=gate?.checks||[];
  const ready=gate?.ready_for_final_review===true;
  return <Card><div className="card-title"><div><h3><ShieldAlert size={18}/> بوابة المراجعة النهائية قبل التشغيل</h3><small>قراءة فقط — لا يوجد من هنا أي حذف أو تحويل إلى Production.</small></div><Badge tone={ready?'green':'orange'}>{ready?'جاهز للمراجعة النهائية':'محظور حتى اكتمال الشروط'}</Badge></div><ErrorBox error={error}/><div className="developer-actions"><Button onClick={load} disabled={busy}><RefreshCw size={16}/> {busy?'جاري الفحص...':'تحديث البوابة النهائية'}</Button></div>{gate&&<><div className="permissions-box" style={{marginTop:12}}>{checks.map(x=><div key={x.key} className="permission-check" style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>{x.ok?<CheckCircle2 size={18} color="green"/>:<XCircle size={18} color="crimson"/>}<div><b>{x.label}</b><div className="muted-small">{x.details||'—'}</div></div></div>)}</div><div className="muted-small" style={{marginTop:10}}>التفعيل الفعلي: <b>مقفول</b> · الحذف الفعلي: <b>مقفول</b>{gate.plan_hash&&<> · بصمة الخطة: <b>{String(gate.plan_hash).slice(0,12)}…</b></>}</div>{(gate.warnings||[]).map((x,i)=><div className="muted-small" key={i} style={{marginTop:5}}>• {x}</div>)}</>}</Card>;
}
