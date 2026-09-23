import React,{useEffect,useMemo,useState} from 'react';
import {CheckCircle2,ClipboardCheck,ExternalLink,Eye,FilePlus2,FileText,Paperclip,Printer,RefreshCw,Send,Settings2,ShieldCheck,Trash2,XCircle} from 'lucide-react';
import QRCode from 'qrcode';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import {TemplateBuilderEditor,TemplateBuilderHome} from './FormTemplateBuilder.jsx';

const statusLabel={draft:'مسودة',pending:'بانتظار الاعتماد',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي'};
const integrationLabel={not_applicable:'—',pending:'بانتظار التطبيق',applied:'مطبق على الحضور',needs_review:'يحتاج مراجعة حضور',failed:'فشل التطبيق'};
const tone=s=>s==='approved'?'green':s==='rejected'||s==='cancelled'?'red':s==='pending'?'orange':'blue';
const integrationTone=s=>s==='applied'?'green':s==='needs_review'||s==='pending'?'orange':s==='failed'?'red':'blue';
const text=v=>String(v??'').trim();
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtDate=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const asBase64=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(r.error||new Error('تعذر قراءة الملف'));r.readAsDataURL(file)});
const mb=n=>(Number(n||0)/1024/1024).toFixed(2)+' MB';

export default function FormsCenter(){
 const [state,setState]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editor,setEditor]=useState(null),[decision,setDecision]=useState(null),[detail,setDetail]=useState(null),[templateEditor,setTemplateEditor]=useState(null),[actionBusy,setActionBusy]=useState('');
 const tabs=useMemo(()=>[
  {id:'templates',label:'النماذج الجاهزة',icon:FilePlus2,badge:state?.templates?.length||null},
  {id:'documents',label:'المستندات والطلبات',icon:FileText,badge:state?.submissions?.length||null},
  ...(state?.permissions?.approve?[{id:'approvals',label:'بانتظار اعتمادي',icon:ClipboardCheck,badge:state?.approvals?.length||null}]:[]),
  ...(state?.permissions?.manage_templates?[{id:'builder',label:'منشئ النماذج',icon:Settings2,badge:(state?.template_admin||[]).filter(x=>!x.is_system).length||null}]:[])
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
 const submissionMap=useMemo(()=>new Map((state?.submissions||[]).map(x=>[String(x.id),x])),[state]);
 const attachmentsBySubmission=useMemo(()=>groupBy(state?.attachments||[],'submission_id'),[state]);
 const signaturesBySubmission=useMemo(()=>groupBy(state?.signatures||[],'submission_id'),[state]);
 const effectsBySubmission=useMemo(()=>new Map((state?.effects||[]).map(x=>[String(x.submission_id),x])),[state]);

 function blankEditor(template,row=null){
  const branchId=row?.branch_id||(!state?.scope?.all_branches?state?.scope?.branch_id:(state?.branches?.[0]?.id||''));
  return {id:row?.id||'',template_id:template.id,branch_id:branchId||'',attendance_employee_id:row?.attendance_employee_id||'',form_data:{...(row?.form_data||{})},notes:row?.notes||'',files:[],template};
 }
 function openTemplate(t){setEditor(blankEditor(t));setError('');setNotice('')}
 function editRow(r){const t=templateMap.get(String(r.template_id))||r.template_snapshot;if(!t)return;setEditor(blankEditor(t,r));setError('');setNotice('')}
 function setField(k,v){setEditor(x=>({...x,form_data:{...(x.form_data||{}),[k]:v}}))}
 function chooseFiles(list){
  const files=[...(list||[])];
  if(files.some(x=>x.size>8*1024*1024)){setError('الحد الأقصى لكل مرفق 8MB.');return}
  if(files.some(x=>!(x.type==='application/pdf'||String(x.type||'').startsWith('image/')))){setError('المسموح PDF أو صور فقط.');return}
  const existing=editor?.id?(attachmentsBySubmission.get(String(editor.id))||[]).length:0;
  if(existing+files.length>5){setError('الحد الأقصى 5 مرفقات لكل نموذج.');return}
  setEditor(x=>({...x,files}));
 }
 async function post(payload){
  const r=await fetch('/api/forms',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'تعذر تنفيذ الطلب.');return b;
 }
 async function uploadFiles(submissionId,files){
  for(const file of files||[]){
   await post({action:'upload_attachment',submission_id:submissionId,file_name:file.name,mime_type:file.type||'application/octet-stream',base64:await asBase64(file)});
  }
 }
 function newTemplateDraft(){
  return {id:'',name:'',category:'general',description:'',document_prefix:'FORM',requires_employee:false,requires_approval:true,active:true,form_schema:[],approval_flow:[{step:1,label:'اعتماد الموارد البشرية',role:'الموارد البشرية'}]};
 }
 function openTemplateBuilder(t=null){
  if(!state?.permissions?.manage_templates)return;
  if(t?.is_system){setError('قالب النظام محمي. أنشئ قالبًا مخصصًا جديدًا بدل تعديل القالب الأساسي.');return}
  setTemplateEditor(t?{
   id:t.id,name:t.name||'',category:t.category||'general',description:t.description||'',document_prefix:t.document_prefix||'FORM',
   requires_employee:!!t.requires_employee,requires_approval:t.requires_approval!==false,active:t.active!==false,
   form_schema:(Array.isArray(t.form_schema)?t.form_schema:[]).map(x=>({...x,options:Array.isArray(x.options)?x.options:[]})),
   approval_flow:(Array.isArray(t.approval_flow)?t.approval_flow:[]).map((x,i)=>({...x,step:i+1}))
  }:newTemplateDraft());
  setError('');setNotice('');
 }
 async function saveTemplate(){
  if(!templateEditor)return;setActionBusy('template-save');setError('');
  try{
   const result=await post({action:'save_template',...templateEditor});
   setNotice(result.message||'تم حفظ قالب النموذج.');setTemplateEditor(null);await load();setActiveTab('builder');
  }catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function toggleTemplateActive(t){
  if(t.is_system){setError('قالب النظام محمي ولا يمكن إيقافه من المنشئ.');return}
  setActionBusy('template-'+t.id);setError('');
  try{
   const result=await post({action:'save_template',id:t.id,name:t.name,category:t.category,description:t.description||'',document_prefix:t.document_prefix,
    form_schema:t.form_schema||[],approval_flow:t.approval_flow||[],requires_employee:!!t.requires_employee,requires_approval:t.requires_approval!==false,active:!t.active});
   setNotice(result.message||'تم تحديث القالب.');await load();
  }catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function save(submit=false){
  if(!editor)return;setActionBusy(submit?'submit':'save');setError('');
  try{
   const saved=await post({
    action:'save',id:editor.id||undefined,template_id:editor.template_id,branch_id:editor.branch_id,
    attendance_employee_id:editor.attendance_employee_id||null,form_data:editor.form_data||{},notes:editor.notes||''
   });
   const id=saved?.submission?.id;if(!id)throw new Error('لم يتم إنشاء رقم للمستند.');
   if(editor.files?.length)await uploadFiles(id,editor.files);
   let result=saved;
   if(submit)result=await post({action:'submit_existing',id});
   setNotice(result.message||'تم الحفظ.');setEditor(null);await load();if(submit)setActiveTab('documents');
  }catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function decide(req,which,note=''){
  setActionBusy(req.id);setError('');
  try{const b=await post({action:'decide',approval_id:req.id,decision:which,note});setNotice(b.message||'تم تحديث الطلب.');setDecision(null);setDetail(null);await load()}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function cancel(r){
  if(!window.confirm('إلغاء المستند '+r.document_no+'؟'))return;
  setActionBusy(r.id);setError('');
  try{const b=await post({action:'cancel',id:r.id});setNotice(b.message||'تم الإلغاء.');await load()}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function openAttachment(att){
  setActionBusy(att.id);setError('');
  try{const b=await post({action:'attachment_url',attachment_id:att.id,expires_in:600});if(b.signed_url)window.open(b.signed_url,'_blank','noopener,noreferrer')}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function deleteAttachment(att){
  if(!window.confirm('حذف المرفق «'+att.original_name+'»؟'))return;
  setActionBusy(att.id);setError('');
  try{const b=await post({action:'delete_attachment',attachment_id:att.id});setNotice(b.message||'تم حذف المرفق.');await load()}
  catch(e){setError(e.message)}finally{setActionBusy('')}
 }
 async function printRow(r){
  const t=r.template_snapshot||templateMap.get(String(r.template_id))||{},emp=employeeMap.get(String(r.attendance_employee_id)),branch=branchMap.get(String(r.branch_id));
  const schema=Array.isArray(t.form_schema)?t.form_schema:[],verifyUrl=window.location.origin+'/verify/form/'+r.verification_token;
  const qr=await QRCode.toDataURL(verifyUrl,{width:170,margin:1});
  const fields=schema.map(f=>'<tr><th>'+escapeHtml(f.label||f.key)+'</th><td>'+escapeHtml(r.form_data?.[f.key]??'—')+'</td></tr>').join('');
  const signs=signaturesBySubmission.get(String(r.id))||[];
  const signHtml=signs.length?signs.map(s=>'<div class="esign"><strong>'+escapeHtml(s.action==='approve'?'اعتماد إلكتروني':'رفض إلكتروني')+'</strong><br>'+escapeHtml(s.signer_name||s.signer_id)+' — '+escapeHtml(s.signer_role||'')+'<br><span>'+escapeHtml(fmtDate(s.signed_at))+'</span></div>').join(''):'<div class="sign">التوقيع / الاعتماد</div>';
  const effect=effectsBySubmission.get(String(r.id));
  const w=window.open('','_blank','width=900,height=1000');if(!w)return;
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(r.document_no)}</title><style>
  body{font-family:Arial,Tahoma,sans-serif;color:#16202a;padding:32px;line-height:1.7}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #c79a32;padding-bottom:16px;margin-bottom:24px}.head img.logo{width:110px;max-height:85px;object-fit:contain}h1{font-size:23px;margin:0}.meta{font-size:12px;color:#52606d}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d7dde3;padding:10px;text-align:right;vertical-align:top}th{width:30%;background:#f6f7f9}.footer{margin-top:30px;display:flex;justify-content:space-between;align-items:flex-end}.qr{width:130px}.status{font-weight:700}.sign{border-top:1px solid #999;width:220px;text-align:center;padding-top:8px;margin-top:45px}.esign{border:1px solid #d6dde5;border-radius:8px;padding:8px 12px;margin:6px 0;font-size:12px}.esign span{color:#667085}.integration{margin-top:12px;padding:8px;border:1px solid #d6dde5;border-radius:8px;font-size:12px}@media print{button{display:none}body{padding:12mm}}
  </style></head><body><div class="head"><div><h1>${escapeHtml(r.template_name)}</h1><div class="meta">شركة الماهر الماسي · ${escapeHtml(branch?.name||'')}</div><div class="meta">رقم المستند: ${escapeHtml(r.document_no)} · الحالة: ${escapeHtml(statusLabel[r.status]||r.status)}</div></div><img class="logo" src="/almaher-logo.jpeg"></div>
  <table><tr><th>الموظف</th><td>${escapeHtml(emp?((emp.employee_code||'')+' — '+emp.name):'—')}</td></tr><tr><th>مقدم الطلب</th><td>${escapeHtml(r.requester_name||'—')}</td></tr><tr><th>تاريخ الإنشاء</th><td>${escapeHtml(fmtDate(r.created_at))}</td></tr>${fields}<tr><th>ملاحظات</th><td>${escapeHtml(r.notes||'—')}</td></tr></table>
  ${effect?'<div class="integration">تكامل الحضور: <strong>'+escapeHtml(integrationLabel[effect.status]||effect.status)+'</strong>'+(r.integration_note?'<br>'+escapeHtml(r.integration_note):'')+'</div>':''}
  <div class="footer"><div><div class="status">الحالة: ${escapeHtml(statusLabel[r.status]||r.status)}</div>${signHtml}</div><div style="text-align:center"><img class="qr" src="${qr}"><div class="meta">امسح للتحقق من المستند</div></div></div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
 }
 if(busy&&!state)return <Loading text="تحميل مركز النماذج..."/>;

 const documentCols=[
  {key:'document_no',label:'رقم المستند',render:r=><strong>{r.document_no}</strong>},
  {key:'template_name',label:'النموذج'},
  {key:'employee',label:'الموظف',render:r=>employeeMap.get(String(r.attendance_employee_id))?.name||'—'},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
  {key:'status',label:'الحالة',render:r=><Badge tone={tone(r.status)}>{statusLabel[r.status]||r.status}</Badge>},
  {key:'integration',label:'ربط الحضور',render:r=>r.integration_status&&r.integration_status!=='not_applicable'?<Badge tone={integrationTone(r.integration_status)}>{integrationLabel[r.integration_status]||r.integration_status}</Badge>:'—'},
  {key:'attachments',label:'المرفقات',render:r=><span>{(attachmentsBySubmission.get(String(r.id))||[]).length}</span>},
  {key:'approval',label:'الاعتماد',render:r=>r.approval_total_steps?<span>{r.approval_step}/{r.approval_total_steps}</span>:'—'},
  {key:'created',label:'التاريخ',render:r=>fmtDate(r.created_at)},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>setDetail(r)}><Eye size={14}/> تفاصيل</Button><Button onClick={()=>printRow(r)}><Printer size={14}/> طباعة / PDF</Button>{['draft','rejected'].includes(r.status)&&state?.permissions?.submit&&<Button onClick={()=>editRow(r)}>تعديل</Button>}{['draft','pending','rejected'].includes(r.status)&&String(r.requester_id)&&<Button disabled={actionBusy===r.id} onClick={()=>cancel(r)}>إلغاء</Button>}</div>}
 ];
 const approvalCols=[
  {key:'document',label:'المستند',render:r=><div><strong>{r.request_payload?.document_no||'—'}</strong><div className="muted-small">{r.request_payload?.template_name||'—'}</div></div>},
  {key:'step',label:'الخطوة',render:r=><Badge tone="orange">{r.request_payload?.step_label||r.approver_role||'اعتماد'}</Badge>},
  {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||'—'},
  {key:'requested',label:'وقت الطلب',render:r=>fmtDate(r.requested_at)},
  {key:'actions',label:'',render:r=><Button disabled={actionBusy===r.id} onClick={()=>setDecision(r)}><CheckCircle2 size={14}/> مراجعة</Button>}
 ];

 return <><ModuleShell title="النماذج والموافقات" subtitle="نماذج الشركة الرسمية، المرفقات، الاعتماد الإلكتروني، الأرشيف والطباعة" icon={ClipboardCheck} tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={<Button onClick={load}><RefreshCw size={16}/> تحديث</Button>}/><ErrorBox error={error}/>{notice&&<div className="success-note">{notice}</div>}
 {activeTab==='templates'&&<div className="dashboard-grid">{(state?.templates||[]).map(t=><Card key={t.id}><div className="card-title"><div><h3>{t.name}</h3><small>{t.description||'نموذج رسمي'}</small></div><Badge>{t.document_prefix}</Badge></div><div className="muted-small">مسار الاعتماد: {(t.approval_flow||[]).map(x=>x.label||x.role).join(' ← ')||'بدون اعتماد'}</div><div className="finance-actions" style={{marginTop:12}}>{state?.permissions?.submit?<Button variant="primary" onClick={()=>openTemplate(t)}><FilePlus2 size={15}/> إنشاء النموذج</Button>:<Badge tone="orange">عرض فقط</Badge>}</div></Card>)}</div>}
 {activeTab==='documents'&&<Card><div className="card-title"><div><h3>المستندات والطلبات</h3><small>المسودات، الطلبات المعلقة، المعتمدة والمرفوضة.</small></div><Badge>{state?.submissions?.length||0}</Badge></div><Table preferenceKey="company-forms-documents" defaultPageSize={25} rows={state?.submissions||[]} columns={documentCols}/></Card>}
 {activeTab==='approvals'&&state?.permissions?.approve&&<Card><div className="card-title"><div><h3>بانتظار اعتمادي</h3><small>راجع البيانات والمرفقات قبل الاعتماد؛ الاعتماد يُسجّل كتوقيع إلكتروني باسمك ووقته.</small></div><Badge tone="orange">{state?.approvals?.length||0}</Badge></div><Table preferenceKey="company-forms-approvals" defaultPageSize={25} rows={state?.approvals||[]} columns={approvalCols}/></Card>}
 {activeTab==='builder'&&state?.permissions?.manage_templates&&<TemplateBuilderHome templates={state?.template_admin||[]} busy={actionBusy} onNew={()=>openTemplateBuilder()} onEdit={openTemplateBuilder} onToggle={toggleTemplateActive}/>}

 <Modal open={!!editor} onClose={()=>setEditor(null)} title={editor?.template?.name||'نموذج'} wide>
  {editor&&<div className="form-grid">
   {state?.scope?.all_branches&&<Field label="الفرع"><Select value={editor.branch_id} onChange={e=>setEditor(x=>({...x,branch_id:e.target.value,attendance_employee_id:''}))}><option value="">اختر الفرع</option>{(state.branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
   {editor.template.requires_employee&&<Field label="الموظف"><Select value={editor.attendance_employee_id} onChange={e=>setEditor(x=>({...x,attendance_employee_id:e.target.value}))}><option value="">اختر الموظف</option>{(state.employees||[]).filter(e=>!editor.branch_id||String(e.branch_id)===String(editor.branch_id)).map(e=><option key={e.id} value={e.id}>{e.employee_code?e.employee_code+' — ':''}{e.name}</option>)}</Select></Field>}
   {(editor.template.form_schema||[]).map(f=><Field key={f.key} label={f.label}>{f.type==='textarea'?<Textarea value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}/>:f.type==='select'?<Select value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}><option value="">اختر</option>{(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}</Select>:<Input type={['date','time','number'].includes(f.type)?f.type:'text'} value={editor.form_data?.[f.key]||''} onChange={e=>setField(f.key,e.target.value)}/>}</Field>)}
   <Field label="ملاحظات عامة"><Textarea value={editor.notes||''} onChange={e=>setEditor(x=>({...x,notes:e.target.value}))}/></Field>
   <Field label="المرفقات" hint="PDF أو صور فقط · حتى 8MB للملف · 5 مرفقات للنموذج"><Input type="file" multiple accept="image/*,.pdf,application/pdf" onChange={e=>chooseFiles(e.target.files)}/></Field>
   {editor.id&&(attachmentsBySubmission.get(String(editor.id))||[]).length>0&&<div style={{gridColumn:'1/-1'}}><strong>المرفقات المحفوظة</strong><AttachmentList rows={attachmentsBySubmission.get(String(editor.id))||[]} editable onOpen={openAttachment} onDelete={deleteAttachment} busy={actionBusy}/></div>}
   {editor.files?.length>0&&<div style={{gridColumn:'1/-1'}}><strong>مرفقات جديدة</strong>{editor.files.map((f,i)=><div key={i} className="muted-small"><Paperclip size={13}/> {f.name} · {mb(f.size)}</div>)}</div>}
   <div className="modal-actions"><Button onClick={()=>setEditor(null)}>إلغاء</Button><Button disabled={!!actionBusy} onClick={()=>save(false)}>حفظ مسودة</Button><Button variant="primary" disabled={!!actionBusy} onClick={()=>save(true)}><Send size={15}/> إرسال للاعتماد</Button></div>
  </div>}
 </Modal>

 <Modal open={!!detail} onClose={()=>setDetail(null)} title={detail?.document_no||'تفاصيل المستند'} wide>
  {detail&&<DocumentDetail row={detail} template={detail.template_snapshot||templateMap.get(String(detail.template_id))} employee={employeeMap.get(String(detail.attendance_employee_id))} branch={branchMap.get(String(detail.branch_id))} attachments={attachmentsBySubmission.get(String(detail.id))||[]} signatures={signaturesBySubmission.get(String(detail.id))||[]} effect={effectsBySubmission.get(String(detail.id))} onOpenAttachment={openAttachment} onPrint={()=>printRow(detail)} busy={actionBusy}/>}
 </Modal>

 <Modal open={!!decision} onClose={()=>setDecision(null)} title="مراجعة واعتماد النموذج" wide>
  {decision&&<DecisionForm request={decision} submission={submissionMap.get(String(decision.reference_id))} attachments={attachmentsBySubmission.get(String(decision.reference_id))||[]} signatures={signaturesBySubmission.get(String(decision.reference_id))||[]} employeeMap={employeeMap} branchMap={branchMap} busy={actionBusy===decision.id} onOpenAttachment={openAttachment} onDecide={decide}/>}
 </Modal>

 <Modal open={!!templateEditor} onClose={()=>setTemplateEditor(null)} title={templateEditor?.id?'تعديل قالب مخصص':'إنشاء قالب نموذج جديد'} wide>
  {templateEditor&&<TemplateBuilderEditor value={templateEditor} onChange={setTemplateEditor} roles={state?.roles||[]} busy={actionBusy==='template-save'} onSave={saveTemplate} onCancel={()=>setTemplateEditor(null)}/>}
 </Modal>
 </>;
}

function groupBy(rows,key){
 const m=new Map();for(const r of rows||[]){const k=String(r?.[key]||''),a=m.get(k)||[];a.push(r);m.set(k,a)}return m;
}
function AttachmentList({rows,editable=false,onOpen,onDelete,busy}){
 if(!rows?.length)return <div className="muted-small">لا توجد مرفقات.</div>;
 return <div style={{display:'grid',gap:6,marginTop:8}}>{rows.map(a=><div key={a.id} className="finance-actions" style={{justifyContent:'space-between'}}><span><Paperclip size={13}/> {a.original_name} · {mb(a.size_bytes)}</span><span className="finance-actions"><Button disabled={busy===a.id} onClick={()=>onOpen(a)}><ExternalLink size={13}/> فتح</Button>{editable&&<Button disabled={busy===a.id} onClick={()=>onDelete(a)}><Trash2 size={13}/> حذف</Button>}</span></div>)}</div>;
}
function SignatureList({rows}){
 if(!rows?.length)return <div className="muted-small">لا توجد اعتمادات إلكترونية مسجلة بعد.</div>;
 return <div style={{display:'grid',gap:8}}>{rows.map(s=><div key={s.id} className="success-note" style={{background:s.action==='approve'?'#ecfdf3':'#fff1f2',color:s.action==='approve'?'#166534':'#991b1b',borderColor:s.action==='approve'?'#bbf7d0':'#fecdd3'}}><strong>{s.action==='approve'?'✓ اعتماد إلكتروني':'✕ رفض إلكتروني'}</strong> · الخطوة {s.step_no}<br/>{s.signer_name||s.signer_id} — {s.signer_role||'—'}<br/><span className="muted-small">{fmtDate(s.signed_at)}{s.decision_note?' · '+s.decision_note:''}</span></div>)}</div>;
}
function DocumentDetail({row,template,employee,branch,attachments,signatures,effect,onOpenAttachment,onPrint,busy}){
 const schema=Array.isArray(template?.form_schema)?template.form_schema:[];
 return <div className="form-grid">
  <div style={{gridColumn:'1/-1'}} className="finance-actions"><Badge tone={tone(row.status)}>{statusLabel[row.status]||row.status}</Badge>{row.integration_status&&row.integration_status!=='not_applicable'&&<Badge tone={integrationTone(row.integration_status)}>{integrationLabel[row.integration_status]||row.integration_status}</Badge>}</div>
  <Field label="النموذج"><Input readOnly value={row.template_name||'—'}/></Field><Field label="رقم المستند"><Input readOnly dir="ltr" value={row.document_no||'—'}/></Field>
  <Field label="الفرع"><Input readOnly value={branch?.name||'—'}/></Field><Field label="الموظف"><Input readOnly value={employee?((employee.employee_code||'')+' — '+employee.name):'—'}/></Field>
  {schema.map(f=><Field key={f.key} label={f.label}><Input readOnly value={row.form_data?.[f.key]??'—'}/></Field>)}
  <Field label="ملاحظات"><Textarea readOnly value={row.notes||'—'}/></Field>
  {effect&&<div style={{gridColumn:'1/-1'}} className="success-note"><strong>تكامل الحضور:</strong> {integrationLabel[effect.status]||effect.status}<br/>{row.integration_note||effect.details?.note||''}</div>}
  <div style={{gridColumn:'1/-1'}}><h4>المرفقات ({attachments.length})</h4><AttachmentList rows={attachments} onOpen={onOpenAttachment} busy={busy}/></div>
  <div style={{gridColumn:'1/-1'}}><h4>الاعتمادات الإلكترونية</h4><SignatureList rows={signatures}/></div>
  <div className="modal-actions"><Button onClick={onPrint}><Printer size={14}/> طباعة / PDF</Button></div>
 </div>;
}
function DecisionForm({request,submission,attachments,signatures,employeeMap,branchMap,busy,onOpenAttachment,onDecide}){
 const [note,setNote]=useState('');
 const t=submission?.template_snapshot||{},schema=Array.isArray(t.form_schema)?t.form_schema:[],emp=employeeMap.get(String(submission?.attendance_employee_id)),branch=branchMap.get(String(submission?.branch_id));
 return <div className="form-grid">
  <div className="success-note" style={{gridColumn:'1/-1'}}>المستند: <strong>{request.request_payload?.document_no||'—'}</strong><br/>الخطوة: {request.request_payload?.step_label||request.approver_role||'اعتماد'}<br/><strong>اعتمادك سيُسجل باسم حسابك ووقته كتوقيع إلكتروني.</strong></div>
  <Field label="الفرع"><Input readOnly value={branch?.name||'—'}/></Field><Field label="الموظف"><Input readOnly value={emp?((emp.employee_code||'')+' — '+emp.name):'—'}/></Field>
  {schema.map(f=><Field key={f.key} label={f.label}><Input readOnly value={submission?.form_data?.[f.key]??'—'}/></Field>)}
  {attachments.length>0&&<div style={{gridColumn:'1/-1'}}><h4>المرفقات</h4><AttachmentList rows={attachments} onOpen={onOpenAttachment} busy={busy}/></div>}
  {signatures.length>0&&<div style={{gridColumn:'1/-1'}}><h4>اعتمادات سابقة</h4><SignatureList rows={signatures}/></div>}
  <Field label="ملاحظة المعتمد"><Textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
  <div className="modal-actions"><Button disabled={busy} onClick={()=>onDecide(request,'reject',note)}><XCircle size={15}/> رفض</Button><Button variant="primary" disabled={busy} onClick={()=>onDecide(request,'approve',note)}><ShieldCheck size={15}/> اعتماد إلكتروني</Button></div>
 </div>;
}
