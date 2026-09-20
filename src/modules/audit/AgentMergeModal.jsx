import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,GitMerge} from 'lucide-react';
import {api} from '../../lib/api.js';
import {money} from '../../lib/format.js';
import {Badge,Button,Card,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';

const text=v=>String(v??'').trim();
const countOf=v=>typeof v==='object'&&v!==null?Number(String(v.count||0).replace('+','')):Number(v||0);
const totalRefs=obj=>Object.values(obj||{}).reduce((n,v)=>{const x=countOf(v);return n+(Number.isFinite(x)?x:0)},0);
const show=v=>{if(v===true)return 'نعم';if(v===false)return 'لا';if(v===null||v===undefined||v==='')return '—';return String(v)};
const optionLabel=r=>`${r.agent_code||'—'} · ${r.company_name||r.name||'وكيل'} · الرصيد ${money(Number(r.current_balance||0))}`;

export default function AgentMergeModal({group,onClose,onMerged}){
 const records=useMemo(()=>Array.isArray(group?.records)?group.records:[],[group]);
 const [canonicalId,setCanonicalId]=useState(''),[duplicateId,setDuplicateId]=useState('');
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[mergeBusy,setMergeBusy]=useState(false);
 const [reason,setReason]=useState(''),[confirmCode,setConfirmCode]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!group){setCanonicalId('');setDuplicateId('');setPreview(null);return}
  const sorted=[...records].sort((a,b)=>Math.abs(Number(b.current_balance||0))-Math.abs(Number(a.current_balance||0))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
  const canonical=sorted[0],duplicate=sorted.find(x=>x.id!==canonical?.id);
  setCanonicalId(canonical?.id||'');setDuplicateId(duplicate?.id||'');setReason('');setConfirmCode('');setPreview(null);setError('');
 },[group]);
 useEffect(()=>{
  if(!group||!canonicalId||!duplicateId||canonicalId===duplicateId){setPreview(null);return}
  let alive=true;setBusy(true);setError('');
  api.admin({action:'agent_duplicate_preview',canonical_id:canonicalId,duplicate_id:duplicateId})
   .then(x=>{if(alive)setPreview(x)})
   .catch(e=>{if(alive)setPreview({can_merge:false,reasons:[e.message],can_execute:false})})
   .finally(()=>{if(alive)setBusy(false)});
  return()=>{alive=false};
 },[group,canonicalId,duplicateId]);
 async function submit(e){
  e.preventDefault();if(!preview?.can_merge||!preview?.can_execute)return;
  setMergeBusy(true);setError('');
  try{
   const out=await api.admin({action:'agent_duplicate_merge',canonical_id:canonicalId,duplicate_id:duplicateId,reason,confirm_agent_code:confirmCode});
   await onMerged?.(out);
  }catch(err){setError(err.message)}finally{setMergeBusy(false)}
 }
 const canonical=preview?.canonical||records.find(x=>String(x.id)===String(canonicalId));
 const duplicate=preview?.duplicate||records.find(x=>String(x.id)===String(duplicateId));
 const policyCols=[
  {key:'label',label:'الإعداد'},
  {key:'canonical',label:'السجل الأساسي',render:r=>r.field==='current_balance'||r.field==='credit_limit'?money(Number(r.canonical||0)):show(r.canonical)},
  {key:'duplicate',label:'السجل المكرر',render:r=>r.field==='current_balance'||r.field==='credit_limit'?money(Number(r.duplicate||0)):show(r.duplicate)}
 ];
 return <Modal open={!!group} onClose={()=>!mergeBusy&&onClose?.()} title="معاينة دمج وكيل مكرر" wide>
  <form className="form-grid" onSubmit={submit}>
   <div className="warning-list" style={{gridColumn:'1/-1'}}>
    <div><AlertTriangle size={16}/> لا يوجد حذف. السجل الأساسي يبقى، والسجل المكرر يتحول إلى Inactive مرتبط بالأساسي مع حفظ سبب الدمج وكل المراجع المنقولة.</div>
    <div><AlertTriangle size={16}/> أي رصيد أو توزيع Active متعارض يوقف الدمج. النظام لا يجمع أرصدة ولا كميات تخصيص تلقائيًا.</div>
   </div>
   <Field label="السجل الأساسي الذي سيبقى"><Select value={canonicalId} onChange={e=>{const v=e.target.value;setCanonicalId(v);if(v===duplicateId)setDuplicateId(records.find(x=>String(x.id)!==String(v))?.id||'');setConfirmCode('')}}>{records.map(r=><option key={r.id} value={r.id}>{optionLabel(r)}</option>)}</Select></Field>
   <Field label="السجل المكرر الذي سيُدمج"><Select value={duplicateId} onChange={e=>setDuplicateId(e.target.value)}>{records.filter(r=>String(r.id)!==String(canonicalId)).map(r=><option key={r.id} value={r.id}>{optionLabel(r)}</option>)}</Select></Field>
   <div style={{gridColumn:'1/-1'}}>
    {busy?<Loading text="جاري فحص الرصيد والحجوزات والتوزيعات والبيانات القانونية..."/>:preview&&<Card>
     <div className="card-title"><div><h3>{preview.can_merge?'جاهز للدمج':'الدمج متوقف حاليًا'}</h3><small>{preview.match?.label||'فحص المطابقة'}</small></div><Badge tone={preview.can_merge?'green':'red'}>{preview.can_merge?'آمن':'موقوف'}</Badge></div>
     {preview.reasons?.length>0&&<div className="warning-list">{preview.reasons.map((x,i)=><div key={i}><AlertTriangle size={15}/>{x}</div>)}</div>}
     {preview.warnings?.length>0&&<div className="training-banner" style={{marginTop:10}}>{preview.warnings.join(' ')}</div>}
     <div className="detail-grid" style={{marginTop:12}}>
      <div><span>الوكيل الأساسي</span><strong>{canonical?.agent_code||'—'} · {canonical?.company_name||canonical?.name||'—'}</strong></div>
      <div><span>رصيد الأساسي</span><strong>{money(Number(canonical?.current_balance||0))}</strong></div>
      <div><span>الوكيل المكرر</span><strong>{duplicate?.agent_code||'—'} · {duplicate?.company_name||duplicate?.name||'—'}</strong></div>
      <div><span>رصيد المكرر</span><strong>{money(Number(duplicate?.current_balance||0))}</strong></div>
      <div><span>مراجع الأساسي</span><strong>{totalRefs(preview.references?.canonical)}</strong></div>
      <div><span>مراجع المكرر ستُنقل</span><strong>{totalRefs(preview.references?.duplicate)}</strong></div>
      <div><span>حجوزات المكرر</span><strong>{countOf(preview.references?.duplicate?.bookings)||0}</strong></div>
      <div><span>توزيعات المكرر</span><strong>{countOf(preview.references?.duplicate?.agent_allocations)||0}</strong></div>
      <div><span>Resource Quotas</span><strong>{countOf(preview.references?.duplicate?.resource_quotas)||0}</strong></div>
      <div><span>تعارض توزيع Active</span><strong>{preview.allocation_conflicts?.length||0}</strong></div>
     </div>
     {preview.policy_differences?.length>0&&<div style={{marginTop:14}}><div className="card-title"><div><h3>اختلافات الإعدادات</h3><small>بعد الدمج تظل قيم السجل الأساسي هي المعتمدة؛ لا يتم جمعها أو استبدالها تلقائيًا.</small></div><Badge tone="orange">{preview.policy_differences.length}</Badge></div><Table rows={preview.policy_differences} columns={policyCols}/></div>}
     {!preview.can_execute&&<div className="training-banner" style={{marginTop:12}}>يمكنك مراجعة الحالة، لكن تنفيذ دمج الوكلاء يحتاج صلاحية الحجوزات والمالية معًا أو صلاحية إدارية عليا.</div>}
    </Card>}
   </div>
   {error&&<div className="error-box" style={{gridColumn:'1/-1'}}>{error}</div>}
   <Field label="سبب الدمج"><Textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="مثال: تم إنشاء الوكيل مرتين بنفس السجل التجاري" required/></Field>
   <Field label={'اكتب كود الوكيل الأساسي للتأكيد: '+(canonical?.agent_code||'')}><Input value={confirmCode} onChange={e=>setConfirmCode(e.target.value)} required/></Field>
   <div className="modal-actions" style={{gridColumn:'1/-1'}}><Button type="button" onClick={()=>onClose?.()} disabled={mergeBusy}>إلغاء</Button><Button variant="primary" type="submit" disabled={mergeBusy||busy||!preview?.can_merge||!preview?.can_execute||reason.trim().length<5||confirmCode!==String(canonical?.agent_code||'')}><GitMerge size={15}/>{mergeBusy?'جاري الدمج...':'تنفيذ دمج الوكيل الآمن'}</Button></div>
  </form>
 </Modal>;
}
