import React,{useEffect,useMemo,useState} from 'react';
import {CheckCircle2,ClipboardCheck,FilePlus2,FileText,Printer,RefreshCw,Send,XCircle} from 'lucide-react';
import QRCode from 'qrcode';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';

const statusLabel={draft:'مسودة',pending:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي'};
const tone=s=>s==='approved'?'green':s==='rejected'||s==='cancelled'?'red':s==='pending'?'orange':'blue';
const text=v=>String(v??'').trim();
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtDate=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};

export default function FormsCenter(){
 const [state,setState]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editor,setEditor]=useState(null),[decision,setDecision]=useState(null),[actionBusy,setActionBusy]=useState('');
 const tabs=useMemo(()=>[
  {id:'templates',label:'النماذج الجاهزة',icon:FilePlus2,badge:state?.templates?.length||null},
  {id:'documents',label:'المستندات والطلبات',icon:FileText,badge:state?.submissions?.length||null},
  ...(state?.permissions?.approve?[{id:'approvals',label:'بانتظار اعتمادي',icon:ClipboardCheck,badge:state?.approvals?.length||null}]:[])
 ],[state]);
 const [activeTab,setActiveTab]=useModuleTab('almaher:module:forms',tabs,'templates');

 async function load(){
  setBusy(true);setError('');
  try{const r=await fetch('/api/forms',{credentials:'include',cache:'no-store'});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر تحميل النماذج.');setState(b)}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[]);
 const templateMap=useMemo(()=>new Map((state?.templates||[]).map(x=>[String(x.id),x])),[state]);
 const employeeMap=useMemo(()=>new Map((state?.employees||[]).map(x=>[String(x.id),x])),[state]);
 const branchMap=useMemo(()=>new Map((state?.branches||[]).map(x=>[String(x.id),x])),[state]);

 function blankEditor(template,row=null){
  const branchId=row?.branch_id||(!state?.scope?.all_branches?state?.scope?.branch_id:(state?.branches?.[0]?.id||''));
  return {id:row?.id||'',template_id:template.id,branch_id:branchId||'',attendance_employee_id:row?.attendance_employee_id||'',form_data:{...(row?.form_data||{})},notes:row?.notes||'',template};
 }
 function openTemplate(t){setEditor(blankEditor(t));setError('');setNotice('')}
 function editRow(r){const t=templateMap.get(String(r.template_id))||r.template_snapshot;if(!t)return;setEditor(blankEditor(t,r));setError('');setNotice('')}
 function setField(k,v){setEditor(x=>({...x,form_data:{...(x.form_data||{}),[k]:v}}))}
 async function save(submit=false){
  if(!editor)return;setActionBusy(submit?'submit':'save');setError('');
  try{
   const r=await fetch('/api/forms',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({
    action:submit?'submit':'save',id:editor.id||undefined,template_id:editor.template_id,branch_id:editor.branch_id,
    attendance_employee_id:editor.attendance_employee_id||null,form_data:editor.form_data||{},notes:editor.notes||''
   })});
   const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر حفظ النموذج.');
   setNotice(b.message||'تم الحفظ.');setEditor(null);await load();if(submit)setActiveTab('documents');
  }catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function decide(req,which,note=''){
  setActionBusy(req.id);setError('');
  try{const r=await fetch('/api/forms',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({action:'decide',approval_id:req.id,decision:which,note})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر اعتماد الطلب.');setNotice(b.message||'تم تحديث الطلب.');setDecision(null);await load()}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function cancel(r){
  if(!window.confirm('إلغاء المستند '+r.document_no+'؟'))return;
  setActionBusy(r.id);setError('');
  try{const x=await fetch('/api/forms',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel',id:r.id})});const b=await x.json().catch(()=>({}));if(!x.ok)throw new Error(b.error||'تعذر الإلغاء.');setNotice(b.message||'تم الإلغاء.');await load()}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function printRow(r){
  const t=r.template_snapshot||templateMap.get(String(r.template_id))||{},emp=employeeMap.get(String(r.attendance_employee_id)),branch=branchMap.get(String(r.branch_id));
  const schema=Array.isArray(t.form_schema)?t.form_schema:[],verifyUrl=window.location.origin+'/verify/form/'+r.verification_token;
  const qr=await QRCode.toDataURL(verifyUrl,{width:170,margin:1});
  const fields=schema.map(f=>'<tr><th>'+escapeHtml(f.label||f.key)+'</th><td>'+escapeHtml(r.form_data?.[f.key]??'—')+'</td></tr>').join('');
  const w=window.open('','_blank','width=900,height=1000');if(!w)return;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(r.document_no)}</title><style>
  body{font-family:Arial,Tahoma,sans-serif;color:#16202a;padding:32px;line-height:1.7}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #c79a32;padding-bottom:16px;margin-bottom:24px}.head img.logo{width:110px;max-height:85px;object-fit:contain}h1{font-size:23px;margin:0}.meta{font-size:12px;color:#52606d}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d7dde3;padding:10px;text-align:right;vertical-align:top}th{width:30%;background:#f6f7f9}.footer{margin-top:30px;display:flex;justify-content:space-between;align-items:flex-end}.qr{width:130px}.status{font-weight:700}.sign{border-top:1px solid #999;width:220px;text-align:center;padding-top:8px;margin-top:45px}@media print{button{display:none}body{padding:12mm}}
  </style></head><body><div class="head"><div><h1>${escapeHtml(r.template_name)}</h1><div class="meta">شركة الماهر الماسي · ${escapeHtml(branch?.name||'')}</div><div class="meta">رقم المستند: ${escapeHtml(r.document_no)} · الحالة: ${escapeHtml(statusLabel[r.status]||r.status)}</div></div><img class="logo" src="/almaher-logo.jpeg"></div>
  <table><tr><th>الموظف</th><td>${escapeHtml(emp?((emp.employee_code||'')+' — '+emp.name):'—')}</td></tr><tr><th>مقدم الطلب</th><td>${escapeHtml(r.requester_name||'—')}</td></tr><tr><th>تاريخ الإنشاء</th><td>${escapeHtml(fmtDate(r.created_at))}</td></tr>${fields}<tr><th>ملاحظات</th><td>${escapeHtml(r.notes||'—')}</td></tr></table>
  <div class="footer"><div><div class="status">الحالة: ${escapeHtml(statusLabel[r.status]||r.status)}</div><div class="sign">التوقيع / الاعتماد</div></div><div style="text-align:center"><img class="qr" src="${qr}"><div class="meta">امسح للتحقق من المستند</div></div></div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
 }
 if(busy&&!state)return <Loading text="تحميل مركز النماذج..."/>;

 const documentCols=[
  {key:'document_no',label:'رقم المستند',render:r=><strong>{r.document_no}</strong>},
  {key:'template_name',label:'النموذج'},
  {key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||'—'},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
  {key:'status',label:'الحالة',render:r=><Badge tone={tone(r.status)}>{statusLabel[r.status]||r.status}</Badge>},
  {key:'approval',label:'الاعتماد',render:r=>r.approval_total_steps?<span>{r.approval_step}/{r.approval_total_steps}</span>:'—'},
  {key:'created',label:'التاريخ',render:r=>fmtDate(r.created_at)},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>printRow(r)}><Printer size={14}/> طباعة / PDF</Button>{['draft','rejected'].includes(r.status)&&state?.permissions?.submit&&<Button onClick={()=>editRow(r)}>تعديل</Button>}{['draft','pending','rejected'].includes(r.status)&&String(r.requester_id)&&<Button disabled={actionBusy===r.id} onClick={()=>cancel(r)}>إلغاء</Button>}</div>}
 ];
 const approvalCols=[
  {key:'document',label:'المستند',render:r=><div><strong>{r.request_payload?.document_no||'—'}</strong><div className="muted-small">{r.request_payload?.template_name||'—'}</div></div>},
  {key:'step',label:'الخطوة',render:r=><Badge tone="orange">{r.request_payload?.step_label||r.approver_role||'اعتماد'}</Badge>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
  {key:'requested',label:'وقت الطلب',render:r=>fmtDate(r.requested_at)},
  {key:'actions',label:'',render:r=><Button disabled={actionBusy===r.id} onClick={()=>setDecision(r)}><CheckCircle2 size={14}/> مراجعة</Button>}
 ];

 return <><ModuleShell title="النماذج والموافقات" subtitle="نماذج الشركة الرسمية، مسارات الاعتماد، الأرشيف والطباعة" icon={ClipboardCheck} tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={<Button onClick={load}><RefreshCw size={16}/> تحديث</Button>}/><ErrorBox error={error}/>{notice&&<div className="success-note">{notice}</div>}
 {activeTab==='templates'&&<div className="dashboard-grid">{(state?.templates||[]).map(t=><Card key={t.id}><div className="card-title"><div><h3>{t.name}</h3><small>{t.description||'نموذج رسمي'}</small></div><Badge>{t.document_prefix}</Badge></div><div className="muted-small">مسار الاعتماد: {(t.approval_flow||[]).map(x=>x.label||x.role).join(' ← ')||'بدون اعتماد'}</div><div className="finance-actions" style={{marginTop:12}}>{state?.permissions?.submit?<Button variant="primary" onClick={()=>openTemplate(t)}><FilePlus2 size={15}/> إنشاء النموذج</Button>:<Badge tone="orange">عرض فقط</Badge>}</div></Card>)}</div>}
 {activeTab==='documents'&&<Card><div className="card-title"><div><h3>المستندات والطلبات</h3><small>المسودات، الطلبات المعلقة، المعتمدة والمرفوضة.</small></div><Badge>{state?.submissions?.length||0}</Badge></div><Table preferenceKey="company-forms-documents" defaultPageSize={25} rows={state?.submissions||[]} columns={documentCols}/></Card>}
 {activeTab==='approvals'&&state?.permissions?.approve&&<Card><div className="card-title"><div><h3>بانتظار اعتمادي</h3><small>تظهر فقط الخطوات الموجهة لدورك ونطاق فروعك.</small></div><Badge tone="orange">{state?.approvals?.length||0}</Badge></div><Table preferenceKey="company-forms-approvals" defaultPageSize={25} rows={state?.approvals||[]} columns={approvalCols}/></Card>}

 <Modal open={!!editor} onClose={()=>setEditor(null)} title={editor?.template?.name||'نموذج'} wide>
  {editor&&<div className="form-grid">
   {state?.scope?.all_branches&&<Field label="الفرع"><Select value={editor.branch_id} onChange={e=>setEditor(x=>({...x,branch_id:e.target.value,attendance_employee_id:''}))}><option value="">اختر الفرع</option>{(state.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
   {editor.template.requires_employee&&<Field label="الموظف"><Select value={editor.attendance_employee_id} onChange={e=>setEditor(x=>({...x,attendance_employee_id:e.target.value}))}><option value="">اختر الموظف</option>{(state.employees||[]).filter(e=>!editor.branch_id||String(e.branch_id)===String(editor.branch_id)).map(e=><option key={e.id} value={e.id}>{e.employee_code?e.employee_code+' — ':''}{e.name}</option>)}</Select></Field>}
   {(editor.template.form_schema||[]).map(f=><Field key={f.key} label={f.label}>{f.type==='textarea'?<Textarea value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}/>:f.type==='select'?<Select value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}><option value="">اختر</option>{(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}</Select>:<Input type={f.type==='date'||f.type==='time'?f.type:'text'} value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}/>}</Field>)}
   <Field label="ملاحظات عامة"><Textarea value={editor.notes||''} onChange={e=>setEditor(x=>({...x,notes:e.target.value}))}/></Field>
   <div className="modal-actions"><Button onClick={()=>setEditor(null)}>إلغاء</Button><Button disabled={!!actionBusy} onClick={()=>save(false)}>حفظ مسودة</Button><Button variant="primary" disabled={!!actionBusy} onClick={()=>save(true)}><Send size={15}/> إرسال للاعتماد</Button></div>
  </div>}
 </Modal>

 <Modal open={!!decision} onClose={()=>setDecision(null)} title="مراجعة واعتماد النموذج">
  {decision&&<DecisionForm request={decision} busy={actionBusy===decision.id} onDecide={decide}/>}
 </Modal>
 </>;
}

function DecisionForm({request,busy,onDecide}){
 const [note,setNote]=useState('');
 return <div className="form-grid"><div className="success-note" style={{gridColumn:'1/-1'}}>المستند: <strong>{request.request_payload?.document_no||'—'}</strong><br/>الخطوة: {request.request_payload?.step_label||request.approver_role||'اعتماد'}</div><Field label="ملاحظة المعتمد"><Textarea value={note} onChange={e=>setNote(e.target.value)}/></Field><div className="modal-actions"><Button disabled={busy} onClick={()=>onDecide(request,'reject',note)}><XCircle size={15}/> رفض</Button><Button variant="primary" disabled={busy} onClick={()=>onDecide(request,'approve',note)}><CheckCircle2 size={15}/> اعتماد</Button></div></div>
}
