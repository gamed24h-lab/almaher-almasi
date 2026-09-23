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

   let branchQ='branches?select=id,name,status&status=eq.active&order=name.asc';
   if(!allBranches(actor)&&actor.branch_id)branchQ+='&id=eq.'+enc(actor.branch_id);
   const branches=await db(env,branchQ).catch(()=>[]);

   return json({ok:true,mode,templates,submissions,approvals,approval_history:approvalHistory,employees,branches,
    scope:{all_branches:allBranches(actor),branch_id:actor.branch_id||null},
    permissions:{view:true,submit:elevated(actor)||actor.permissions?.forms_submit===true,approve:elevated(actor)||actor.permissions?.forms_approve===true,manage_templates:elevated(actor)||actor.permissions?.forms_manage_templates===true}
   });
  }

  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=txt(body.action);

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
   const decision=body.decision==='reject'?'reject':'approve',stamp=now(),note=txt(body.note)||null;
   if(decision==='reject'){
    await db(env,'approval_requests?id=eq.'+enc(req.id),{method:'PATCH',body:{status:'rejected',rejected_by:String(actor.id),rejected_at:stamp,decided_at:stamp,decision_notes:note,updated_at:stamp},prefer:'return=minimal'});
    const rows=await db(env,'company_form_submissions?id=eq.'+enc(sub.id),{method:'PATCH',body:{status:'rejected',rejected_at:stamp,rejected_by:String(actor.id),updated_at:stamp},prefer:'return=representation'});
    const after=rows?.[0]||sub;await audit(env,actor,'company_form_reject',after,sub,after,note||'رفض النموذج');
    return json({ok:true,submission:after,message:'تم رفض النموذج.'});
   }
   await db(env,'approval_requests?id=eq.'+enc(req.id),{method:'PATCH',body:{status:'approved',approved_by:String(actor.id),approved_at:stamp,decided_at:stamp,decision_notes:note,updated_at:stamp},prefer:'return=minimal'});
   const templateSnapshot=cleanObj(sub.template_snapshot),flow=flowOf(templateSnapshot),currentStep=Number(req?.metadata?.step_no||req?.request_payload?.step_no||sub.approval_step||1),nextIndex=currentStep;
   if(nextIndex<flow.length){
    const rows=await db(env,'company_form_submissions?id=eq.'+enc(sub.id),{method:'PATCH',body:{status:'pending',approval_step:nextIndex+1,updated_at:stamp},prefer:'return=representation'});
    const after=rows?.[0]||sub;await createApproval(env,actor,after,templateSnapshot,nextIndex);await audit(env,actor,'company_form_step_approved',after,sub,after,note||'اعتماد خطوة');
    return json({ok:true,submission:after,message:'تم اعتماد الخطوة وانتقل الطلب للمعتمد التالي.'});
   }
   const rows=await db(env,'company_form_submissions?id=eq.'+enc(sub.id),{method:'PATCH',body:{status:'approved',approval_step:flow.length,approved_at:stamp,approved_by:String(actor.id),updated_at:stamp},prefer:'return=representation'});
   const after=rows?.[0]||sub;await audit(env,actor,'company_form_approve',after,sub,after,note||'اعتماد نهائي');
   return json({ok:true,submission:after,message:'تم اعتماد النموذج نهائيًا.'});
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
 }catch(e){return json({error:e?.message||'تعذر تنفيذ طلب النماذج.'},Number(e?.status)||500)}
}
