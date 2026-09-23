const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const now=()=>new Date().toISOString();
const elevated=a=>!!a&&(a.role==='مدير عام'||String(a.role||'').toLowerCase()==='developer'||a.permissions?.all===true);
const can=a=>k=>elevated(a)||a?.permissions?.[k]===true;
const allBranches=a=>elevated(a)||a?.permissions?.forms_all_branches===true;
const modeOf=a=>a?.permissions?._accountMode==='production'?'production':'training';

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function cleanObj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
function flowOf(template){return Array.isArray(template?.approval_flow)?template.approval_flow:[]}
function schemaOf(template){return Array.isArray(template?.form_schema)?template.form_schema:[]}
function bytesFromBase64(base64){
 const clean=String(base64||'').replace(/^data:[^,]+,/,'');
 const bin=atob(clean),out=new Uint8Array(bin.length);
 for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
 return out;
}
async function sha256Hex(bytes){
 const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function safeFileName(v){
 const x=txt(v)||'attachment';
 return x.replace(/[^A-Za-z0-9._-]/g,'_').slice(-140)||'attachment';
}
async function ensureFormsBucket(env){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 const id='almaher-form-attachments';
 const check=await fetch(base+'/storage/v1/bucket/'+encodeURIComponent(id),{headers});
 if(check.ok)return id;
 const create=await fetch(base+'/storage/v1/bucket',{method:'POST',headers,body:JSON.stringify({id,name:id,public:false,file_size_limit:8388608})});
 if(!create.ok&&create.status!==409){const b=await create.json().catch(()=>({}));throw Object.assign(new Error(b?.message||'تعذر تجهيز مساحة مرفقات النماذج.'),{status:500})}
 return id;
}
async function storageUpload(env,bucket,path,bytes,mime){
 await ensureFormsBucket(env);
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const r=await fetch(base+'/storage/v1/object/'+bucket+'/'+path.split('/').map(enc).join('/'),{
  method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':mime||'application/octet-stream','x-upsert':'false'},
  body:bytes
 });
 if(!r.ok){const b=await r.json().catch(()=>({}));throw Object.assign(new Error(b?.message||'تعذر رفع المرفق.'),{status:r.status>=500?500:400})}
}
async function storageSigned(env,bucket,path,expiresIn=600){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const r=await fetch(base+'/storage/v1/object/sign/'+bucket+'/'+path.split('/').map(enc).join('/'),{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({expiresIn:Math.max(60,Math.min(3600,Number(expiresIn)||600))})
 });
 const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b?.message||'تعذر إنشاء رابط المرفق.'),{status:400});
 const s=b.signedURL||b.signedUrl||b.signed_url||'';
 return s?(s.startsWith('http')?s:base+'/storage/v1'+s):'';
}
async function storageDelete(env,bucket,path){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const r=await fetch(base+'/storage/v1/object/'+bucket+'/'+path.split('/').map(enc).join('/'),{
  method:'DELETE',headers:{apikey:key,Authorization:'Bearer '+key}
 });
 if(!r.ok&&r.status!==404){const b=await r.json().catch(()=>({}));throw Object.assign(new Error(b?.message||'تعذر حذف المرفق.'),{status:400})}
}
function canReadSubmission(actor,row){
 if(!scoped(actor,row))return false;
 if(elevated(actor)||actor?.permissions?.forms_approve===true||actor?.permissions?.forms_manage_templates===true)return true;
 return String(row?.requester_id||'')===String(actor?.id||'');
}
function roleCanApprove(actor,req){
 if(elevated(actor))return true;
 if(actor?.permissions?.forms_approve!==true)return false;
 if(req?.approver_id&&String(req.approver_id)===String(actor.id))return true;
 if(req?.approver_role&&String(req.approver_role)===String(actor.role))return true;
 return false;
}
function assertRequired(template,data){
 for(const f of schemaOf(template)){
  if(!f?.required)continue;
  const v=data?.[f.key];
  if(v===null||v===undefined||String(v).trim()==='')throw Object.assign(new Error('الحقل مطلوب: '+String(f.label||f.key)),{status:400});
 }
}
async function db(env,path,{method='GET',body,prefer}={}){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!base||!key)throw Object.assign(new Error('Supabase غير مهيأ للنماذج.'),{status:500});
 const headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json'};
 if(prefer)headers.Prefer=prefer;
 const r=await fetch(base+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const t=await r.text();let out=null;try{out=t?JSON.parse(t):null}catch{out=t}
 if(!r.ok)throw Object.assign(new Error(out?.message||out?.error||('Database '+r.status)),{status:r.status===401||r.status===403?403:r.status>=500?500:400,details:out});
 return out;
}
async function audit(env,actor,action,submission,beforeData=null,afterData=null,reason=''){
 try{
  await db(env,'audit_events',{method:'POST',prefer:'return=minimal',body:{
   actor_id:txt(actor?.id)||null,actor_name:txt(actor?.name)||null,actor_role:txt(actor?.role)||null,
   action,entity_type:'company_form_submission',entity_id:txt(submission?.id)||null,branch_id:submission?.branch_id||null,
   before_data:beforeData,after_data:afterData,reason:txt(reason)||null
  }});
 }catch{}
}
async function getTemplate(env,id,mode){
 const rows=await db(env,'company_form_templates?id=eq.'+enc(id)+'&data_environment=eq.'+enc(mode)+'&active=eq.true&select=*&limit=1');
 return rows?.[0]||null;
}
async function getSubmission(env,id){
 const rows=await db(env,'company_form_submissions?id=eq.'+enc(id)+'&select=*&limit=1');
 return rows?.[0]||null;
}
function scoped(actor,row){
 if(allBranches(actor))return true;
 return !!actor?.branch_id&&String(row?.branch_id||'')===String(actor.branch_id);
}
async function validateBranch(env,actor,branchId){
 const resolved=allBranches(actor)?txt(branchId):txt(actor?.branch_id);
 if(!resolved)throw Object.assign(new Error('اختر الفرع أولًا.'),{status:400});
 const rows=await db(env,'branches?id=eq.'+enc(resolved)+'&select=id,name,status&limit=1');
 const b=rows?.[0]||null;if(!b)throw Object.assign(new Error('الفرع غير موجود.'),{status:404});
 return b;
}
async function validateEmployee(env,actor,employeeId,branchId,mode,required){
 if(!employeeId){if(required)throw Object.assign(new Error('اختر الموظف لهذا النموذج.'),{status:400});return null}
 const rows=await db(env,'attendance_employees?id=eq.'+enc(employeeId)+'&data_environment=eq.'+enc(mode)+'&select=id,name,employee_code,branch_id,staff_user_id,status&limit=1');
 const e=rows?.[0]||null;if(!e)throw Object.assign(new Error('موظف الحضور غير موجود.'),{status:404});
 if(String(e.branch_id||'')!==String(branchId||''))throw Object.assign(new Error('الموظف لا يتبع الفرع المختار.'),{status:400});
 return e;
}
async function createApproval(env,actor,submission,template,stepIndex){
 const flow=flowOf(template),step=flow[stepIndex];if(!step)return null;
 const body={
  request_type:'company_form',reference_table:'company_form_submissions',reference_id:submission.id,
  branch_id:submission.branch_id,requested_by:submission.requester_id,requested_at:now(),status:'pending',
  reason:submission.notes||null,metadata:{company_form:true,step_no:stepIndex+1,total_steps:flow.length,step_label:step.label||null},
  data_environment:submission.data_environment,entity_type:'company_form_submission',entity_id:submission.id,
  approver_role:step.role||null,approver_id:step.approver_id||null,
  request_payload:{document_no:submission.document_no,template_name:submission.template_name,step_no:stepIndex+1,total_steps:flow.length,step_label:step.label||null}
 };
 const rows=await db(env,'approval_requests',{method:'POST',body,prefer:'return=representation'});
 return rows?.[0]||null;
}
async function publicVerify(request,env){
 const url=new URL(request.url),token=txt(url.searchParams.get('token'));
 if(!token)return json({valid:false,error:'رمز التحقق مفقود'},400);
 const rows=await db(env,'company_form_submissions?verification_token=eq.'+enc(token)+'&select=id,document_no,template_name,status,branch_id,approved_at,created_at&limit=1');
 const row=rows?.[0]||null;if(!row)return json({valid:false,error:'المستند غير موجود'},404);
 let branchName=null;
 if(row.branch_id){const b=await db(env,'branches?id=eq.'+enc(row.branch_id)+'&select=name&limit=1').catch(()=>[]);branchName=b?.[0]?.name||null}
 return json({valid:true,document:{document_no:row.document_no,template_name:row.template_name,status:row.status,branch_name:branchName,approved_at:row.approved_at,created_at:row.created_at}});
}

export default async function formsApi(request,env,actor){
 try{
  const url=new URL(request.url);
  if(url.pathname==='/api/forms/verify'&&request.method==='GET')return publicVerify(request,env);
  if(!actor)return json({error:'انتهت الجلسة'},401);
  const canView=can(actor)('forms_view')||can(actor)('forms_submit')||can(actor)('forms_approve')||can(actor)('forms_manage_templates');
  if(!canView)return json({error:'لا توجد صلاحية للنماذج والموافقات.'},403);
  const mode=modeOf(actor);

  if(request.method==='GET'){
   const templates=await db(env,'company_form_templates?data_environment=eq.'+enc(mode)+'&active=eq.true&select=*&order=category.asc,name.asc');
   let subQ='company_form_submissions?data_environment=eq.'+enc(mode)+'&select=*&order=created_at.desc&limit=1000';
   if(!allBranches(actor))subQ+='&branch_id=eq.'+enc(actor.branch_id||'');
   if(!elevated(actor)&&actor.permissions?.forms_approve!==true&&actor.permissions?.forms_manage_templates!==true)subQ+='&requester_id=eq.'+enc(actor.id);
   const submissions=await db(env,subQ);

   let approvalQ='approval_requests?request_type=eq.company_form&data_environment=eq.'+enc(mode)+'&select=*&order=requested_at.desc&limit=2000';
   if(!allBranches(actor))approvalQ+='&branch_id=eq.'+enc(actor.branch_id||'');
   const approvalHistory=await db(env,approvalQ);
   const approvals=(approvalHistory||[]).filter(r=>r.status==='pending'&&roleCanApprove(actor,r)&&String(r.requested_by||'')!==String(actor.id||''));

   let empQ='attendance_employees?data_environment=eq.'+enc(mode)+'&merged_into_id=is.null&status=eq.active&select=id,name,employee_code,branch_id,staff_user_id&order=name.asc&limit=5000';
   if(!allBranches(actor))empQ+='&branch_id=eq.'+enc(actor.branch_id||'');
   const employees=await db(env,empQ).catch(()=>[]);

   const visibleIds=new Set((submissions||[]).map(x=>String(x.id)));
   const allAttachments=await db(env,'company_form_attachments?data_environment=eq.'+enc(mode)+'&select=*&order=created_at.asc&limit=5000').catch(()=>[]);
   const attachments=(allAttachments||[]).filter(x=>visibleIds.has(String(x.submission_id)));
   const allSignatures=await db(env,'company_form_signatures?data_environment=eq.'+enc(mode)+'&select=*&order=step_no.asc,signed_at.asc&limit=5000').catch(()=>[]);
   const signatures=(allSignatures||[]).filter(x=>visibleIds.has(String(x.submission_id)));
   const allEffects=await db(env,'company_form_effects?data_environment=eq.'+enc(mode)+'&select=*&order=created_at.asc&limit=5000').catch(()=>[]);
   const effects=(allEffects||[]).filter(x=>visibleIds.has(String(x.submission_id)));

   let branchQ='branches?select=id,name,status&status=eq.active&order=name.asc';
   if(!allBranches(actor)&&actor.branch_id)branchQ+='&id=eq.'+enc(actor.branch_id);
   const branches=await db(env,branchQ).catch(()=>[]);

   return json({ok:true,mode,templates,submissions,approvals,approval_history:approvalHistory,employees,branches,attachments,signatures,effects,
    scope:{all_branches:allBranches(actor),branch_id:actor.branch_id||null},
    permissions:{view:true,submit:elevated(actor)||actor.permissions?.forms_submit===true,approve:elevated(actor)||actor.permissions?.forms_approve===true,manage_templates:elevated(actor)||actor.permissions?.forms_manage_templates===true}
   });
  }

  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=txt(body.action);

  if(action==='upload_attachment'){
   if(!(elevated(actor)||actor.permissions?.forms_submit===true))return json({error:'لا توجد صلاحية رفع مرفقات للنماذج.'},403);
   const sub=await getSubmission(env,body.submission_id);if(!sub)return json({error:'المستند غير موجود.'},404);
   if(!canReadSubmission(actor,sub)||(!elevated(actor)&&String(sub.requester_id)!==String(actor.id)))return json({error:'لا يمكنك تعديل مرفقات هذا المستند.'},403);
   if(!['draft','rejected'].includes(sub.status))return json({error:'المرفقات تُثبت عند الإرسال للاعتماد ولا يمكن تعديلها بعد ذلك.'},409);
   const countRows=await db(env,'company_form_attachments?submission_id=eq.'+enc(sub.id)+'&select=id');
   if((countRows||[]).length>=5)return json({error:'الحد الأقصى 5 مرفقات لكل نموذج.'},409);
   const mime=txt(body.mime_type)||'application/octet-stream';
   if(!(mime==='application/pdf'||mime.startsWith('image/')))return json({error:'المسموح PDF أو صور فقط.'},400);
   if(!body.base64)return json({error:'الملف مطلوب.'},400);
   const bytes=bytesFromBase64(body.base64);
   if(!bytes.length||bytes.length>8*1024*1024)return json({error:'حجم المرفق يجب ألا يتجاوز 8MB.'},413);
   const bucket='almaher-form-attachments',name=safeFileName(body.file_name),hash=await sha256Hex(bytes);
   const path='forms/'+sub.data_environment+'/'+sub.id+'/'+Date.now()+'-'+globalThis.crypto.randomUUID()+'-'+name;
   await storageUpload(env,bucket,path,bytes,mime);
   let row=null;
   try{
    const rows=await db(env,'company_form_attachments',{method:'POST',body:{
     submission_id:sub.id,bucket,storage_path:path,original_name:txt(body.file_name)||name,mime_type:mime,size_bytes:bytes.length,
     sha256:hash,uploaded_by:String(actor.id),uploaded_name:actor.name||null,data_environment:sub.data_environment
    },prefer:'return=representation'});row=rows?.[0]||null;
   }catch(e){await storageDelete(env,bucket,path).catch(()=>{});throw e}
   await audit(env,actor,'company_form_attachment_upload',sub,null,{attachment_id:row?.id,original_name:row?.original_name,size_bytes:row?.size_bytes,sha256:row?.sha256},'رفع مرفق للنموذج');
   return json({ok:true,attachment:row,message:'تم رفع المرفق.'});
  }

  if(action==='attachment_url'){
   const rows=await db(env,'company_form_attachments?id=eq.'+enc(body.attachment_id)+'&select=*&limit=1'),att=rows?.[0]||null;
   if(!att)return json({error:'المرفق غير موجود.'},404);
   const sub=await getSubmission(env,att.submission_id);if(!sub||!canReadSubmission(actor,sub))return json({error:'المرفق خارج نطاق صلاحيتك.'},403);
   const signed_url=await storageSigned(env,att.bucket,att.storage_path,body.expires_in||600);
   return json({ok:true,signed_url});
  }

  if(action==='delete_attachment'){
   if(!(elevated(actor)||actor.permissions?.forms_submit===true))return json({error:'لا توجد صلاحية حذف المرفقات.'},403);
   const rows=await db(env,'company_form_attachments?id=eq.'+enc(body.attachment_id)+'&select=*&limit=1'),att=rows?.[0]||null;
   if(!att)return json({error:'المرفق غير موجود.'},404);
   const sub=await getSubmission(env,att.submission_id);if(!sub)return json({error:'المستند غير موجود.'},404);
   if(!canReadSubmission(actor,sub)||(!elevated(actor)&&String(sub.requester_id)!==String(actor.id)))return json({error:'لا يمكنك حذف مرفقات هذا المستند.'},403);
   if(!['draft','rejected'].includes(sub.status))return json({error:'لا يمكن حذف المرفقات بعد إرسال النموذج للاعتماد.'},409);
   await storageDelete(env,att.bucket,att.storage_path);
   await db(env,'company_form_attachments?id=eq.'+enc(att.id),{method:'DELETE',prefer:'return=minimal'});
   await audit(env,actor,'company_form_attachment_delete',sub,{attachment_id:att.id,original_name:att.original_name,sha256:att.sha256},null,'حذف مرفق من النموذج');
   return json({ok:true,message:'تم حذف المرفق.'});
  }

  if(action==='submit_existing'){
   if(!(elevated(actor)||actor.permissions?.forms_submit===true))return json({error:'لا توجد صلاحية إرسال النماذج.'},403);
   const row=await getSubmission(env,body.id);if(!row)return json({error:'المستند غير موجود.'},404);
   if(!canReadSubmission(actor,row)||(!elevated(actor)&&String(row.requester_id)!==String(actor.id)))return json({error:'لا يمكنك إرسال هذا المستند.'},403);
   if(!['draft','rejected'].includes(row.status))return json({error:'هذا المستند دخل مسار الاعتماد بالفعل.'},409);
   const template=await getTemplate(env,row.template_id,mode);if(!template)return json({error:'قالب النموذج غير موجود أو غير فعال.'},404);
   assertRequired(template,cleanObj(row.form_data));
   const flow=flowOf(template);
   if(template.requires_approval===false||flow.length===0){
    const rows=await db(env,'company_form_submissions?id=eq.'+enc(row.id),{method:'PATCH',body:{status:'approved',submitted_at:now(),approved_at:now(),approved_by:String(actor.id),approval_step:0,updated_at:now()},prefer:'return=representation'});
    const after=rows?.[0]||row;await audit(env,actor,'company_form_auto_approved',after,row,after,'قالب بدون مسار اعتماد');
    return json({ok:true,submission:after,message:'تم اعتماد النموذج مباشرة.'});
   }
   const stamp=now(),rows=await db(env,'company_form_submissions?id=eq.'+enc(row.id),{method:'PATCH',body:{status:'pending',submitted_at:stamp,approval_step:1,approval_total_steps:flow.length,rejected_at:null,rejected_by:null,updated_at:stamp},prefer:'return=representation'});
   const after=rows?.[0]||row;
   await createApproval(env,actor,after,template,0);
   await audit(env,actor,'company_form_submit',after,row,after,'إرسال النموذج للاعتماد');
   return json({ok:true,submission:after,message:'تم إرسال النموذج للاعتماد.'});
  }

  if(action==='save'||action==='submit'){
   if(!(elevated(actor)||actor.permissions?.forms_submit===true))return json({error:'لا توجد صلاحية إنشاء النماذج.'},403);
   const template=await getTemplate(env,body.template_id,mode);if(!template)return json({error:'قالب النموذج غير موجود أو غير فعال.'},404);
   const branch=await validateBranch(env,actor,body.branch_id);
   const employee=await validateEmployee(env,actor,body.attendance_employee_id,branch.id,mode,template.requires_employee===true);
   const formData=cleanObj(body.form_data);assertRequired(template,formData);
   let before=null,row=null;
   if(body.id){
    before=await getSubmission(env,body.id);if(!before)return json({error:'المستند غير موجود.'},404);
    if(!scoped(actor,before))return json({error:'المستند خارج نطاق فرعك.'},403);
    if(!elevated(actor)&&String(before.requester_id)!==String(actor.id))return json({error:'لا يمكنك تعديل طلب موظف آخر.'},403);
    if(!['draft','rejected'].includes(before.status))return json({error:'لا يمكن تعديل المستند بعد دخوله مسار الاعتماد.'},409);
    const patch={branch_id:branch.id,attendance_employee_id:employee?.id||null,staff_user_id:employee?.staff_user_id||null,
      form_data:formData,notes:txt(body.notes)||null,status:'draft',rejected_at:null,rejected_by:null,updated_at:now()};
    const rows=await db(env,'company_form_submissions?id=eq.'+enc(before.id),{method:'PATCH',body:patch,prefer:'return=representation'});row=rows?.[0]||null;
   }else{
    const payload={template_id:template.id,template_code:template.code,template_name:template.name,template_version:template.version,
      template_snapshot:template,branch_id:branch.id,attendance_employee_id:employee?.id||null,staff_user_id:employee?.staff_user_id||null,
      requester_id:String(actor.id),requester_name:actor.name||null,requester_role:actor.role||null,status:'draft',form_data:formData,
      notes:txt(body.notes)||null,approval_step:0,approval_total_steps:flowOf(template).length,data_environment:mode};
    const rows=await db(env,'company_form_submissions',{method:'POST',body:payload,prefer:'return=representation'});row=rows?.[0]||null;
   }
   if(!row)return json({error:'تعذر حفظ النموذج.'},500);
   await audit(env,actor,before?'company_form_update':'company_form_create',row,before,row,body.notes||'');
   if(action==='save')return json({ok:true,submission:row,message:'تم حفظ النموذج كمسودة.'});

   const flow=flowOf(template);
   if(template.requires_approval===false||flow.length===0){
    const rows=await db(env,'company_form_submissions?id=eq.'+enc(row.id),{method:'PATCH',body:{status:'approved',submitted_at:now(),approved_at:now(),approved_by:String(actor.id),approval_step:0,updated_at:now()},prefer:'return=representation'});
    row=rows?.[0]||row;await audit(env,actor,'company_form_auto_approved',row,null,row,'قالب بدون مسار اعتماد');
    return json({ok:true,submission:row,message:'تم اعتماد النموذج مباشرة.'});
   }
   const rows=await db(env,'company_form_submissions?id=eq.'+enc(row.id),{method:'PATCH',body:{status:'pending',submitted_at:now(),approval_step:1,approval_total_steps:flow.length,updated_at:now()},prefer:'return=representation'});
   row=rows?.[0]||row;
   await createApproval(env,actor,row,template,0);
   await audit(env,actor,'company_form_submit',row,null,row,'إرسال النموذج للاعتماد');
   return json({ok:true,submission:row,message:'تم إرسال النموذج للاعتماد.'});
  }

  if(action==='decide'){
   if(!(elevated(actor)||actor.permissions?.forms_approve===true))return json({error:'لا توجد صلاحية اعتماد النماذج.'},403);
   const reqs=await db(env,'approval_requests?id=eq.'+enc(body.approval_id)+'&request_type=eq.company_form&select=*&limit=1');
   const req=reqs?.[0]||null;if(!req)return json({error:'طلب الاعتماد غير موجود.'},404);
   if(req.status!=='pending')return json({error:'طلب الاعتماد تمت معالجته بالفعل.'},409);
   if(!roleCanApprove(actor,req))return json({error:'هذه الخطوة ليست موجهة لدورك.'},403);
   if(String(req.requested_by||'')===String(actor.id||'')&&!elevated(actor))return json({error:'لا يمكن اعتماد طلبك بنفسك.'},403);
   const sub=await getSubmission(env,req.reference_id);if(!sub)return json({error:'المستند المرتبط غير موجود.'},404);
   if(!scoped(actor,sub))return json({error:'المستند خارج نطاق فرعك.'},403);
   const decision=body.decision==='reject'?'reject':'approve',note=txt(body.note)||null;
   let result;
   try{
    result=await db(env,'rpc/company_form_decide_approval',{method:'POST',body:{
     p_submission_id:sub.id,p_approval_request_id:req.id,p_decision:decision,
     p_actor_id:String(actor.id),p_actor_name:actor.name||null,p_actor_role:actor.role||null,p_note:note,
     p_metadata:{source:'forms_center',user_agent:request.headers.get('user-agent')||null,ip:request.headers.get('cf-connecting-ip')||null}
    }});
   }catch(e){
    const m=String(e?.message||'');
    if(m.includes('attendance_month_closed'))throw Object.assign(new Error('لا يمكن اعتماد هذا النموذج لأن شهر الحضور المرتبط به مغلق. افتح الشهر أولًا أو راجع الموارد البشرية.'),{status:409});
    if(m.includes('company_form_permission_time_invalid'))throw Object.assign(new Error('وقت نهاية الاستئذان يجب أن يكون بعد وقت البداية.'),{status:400});
    throw e;
   }
   const after=result?.submission||await getSubmission(env,sub.id);
   const event=decision==='reject'?'company_form_reject':result?.status==='approved'?'company_form_approve':'company_form_step_approved';
   await audit(env,actor,event,after,sub,after,note||(decision==='reject'?'رفض النموذج':result?.status==='approved'?'اعتماد نهائي':'اعتماد خطوة'));
   const integration=result?.integration_status;
   let message=decision==='reject'?'تم رفض النموذج وتسجيل التوقيع الإلكتروني.':result?.status==='approved'?'تم اعتماد النموذج نهائيًا وتسجيل التوقيع الإلكتروني.':'تم اعتماد الخطوة وانتقل الطلب للمعتمد التالي.';
   if(result?.status==='approved'&&integration==='applied')message+=' وتم تطبيقه تلقائيًا على الحضور.';
   if(result?.status==='approved'&&integration==='needs_review')message+=' وربط الحضور يحتاج مراجعة إضافية قبل التطبيق.';
   return json({ok:true,...result,submission:after,message});
  }

  if(action==='cancel'){
   const sub=await getSubmission(env,body.id);if(!sub)return json({error:'المستند غير موجود.'},404);
   if(!scoped(actor,sub))return json({error:'المستند خارج نطاق فرعك.'},403);
   if(!elevated(actor)&&String(sub.requester_id)!==String(actor.id))return json({error:'لا يمكنك إلغاء طلب موظف آخر.'},403);
   if(['approved','cancelled'].includes(sub.status))return json({error:'لا يمكن إلغاء هذا المستند.'},409);
   const stamp=now();
   await db(env,'approval_requests?request_type=eq.company_form&reference_id=eq.'+enc(sub.id)+'&status=eq.pending',{method:'PATCH',body:{status:'cancelled',decided_at:stamp,decision_notes:'ألغاه مقدم الطلب',updated_at:stamp},prefer:'return=minimal'}).catch(()=>{});
   const rows=await db(env,'company_form_submissions?id=eq.'+enc(sub.id),{method:'PATCH',body:{status:'cancelled',cancelled_at:stamp,cancelled_by:String(actor.id),updated_at:stamp},prefer:'return=representation'});
   const after=rows?.[0]||sub;await audit(env,actor,'company_form_cancel',after,sub,after,'إلغاء النموذج');
   return json({ok:true,submission:after,message:'تم إلغاء النموذج.'});
  }

  return json({error:'إجراء غير معروف.'},400);
 }catch(e){
  const message=String(e?.message||'تعذر تنفيذ طلب النماذج.');
  if(message.includes('attendance_month_closed'))return json({error:'شهر الحضور المرتبط بهذا النموذج مغلق ولا يمكن تطبيقه تلقائيًا.'},409);
  return json({error:message},Number(e?.status)||500);
 }
}
