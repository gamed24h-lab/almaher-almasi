import appWorker from './finance-month-compare-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const serviceHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const isDeveloper=u=>String(u?.role||'').toLowerCase()==='developer';
const has=(u,key)=>!!u&&(isDeveloper(u)||u.permissions?.[key]===true);
const actorId=u=>txt(u?.id||u?.user_id||u?.username||u?.email||'');
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
async function rest(env,path,{method='GET',body,prefer}={}){const h=serviceHeaders(env);if(prefer)h.Prefer=prefer;const r=await fetch(`${base(env)}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||b?.hint||`Database request failed (${r.status})`);e.status=r.status;throw e}return b}
async function audit(env,cardId,action,me,beforeData=null,afterData=null,reason=null){await rest(env,'id_card_audit_logs',{method:'POST',body:{card_id:cardId||null,action,actor_id:actorId(me)||null,before_data:beforeData,after_data:afterData,reason:reason||null},prefer:'return=minimal'}).catch(()=>{})}
function requirePerm(me,key){if(!has(me,key)){const e=new Error('لا توجد لديك صلاحية لتنفيذ هذه العملية في ID Studio.');e.status=403;throw e}}
function branchFilter(me){if(has(me,'id_card_view_all_branches'))return '';const bid=txt(me?.branch_id||me?.home_branch_id);return bid?`&owner_branch_id=eq.${enc(bid)}`:'&owner_branch_id=is.null'}
function forceBranch(me,row={}){if(has(me,'id_card_view_all_branches'))return row;const bid=txt(me?.branch_id||me?.home_branch_id);return {...row,owner_branch_id:bid||null}}
const CARD_FIELDS=new Set(['linked_employee_id','holder_type','source_type','owner_branch_id','name_ar','name_en','job_title_ar','job_title_en','department_ar','department_en','phone','photo_path','license_number','season_label','issue_date','expiry_date','print_mode','template_code','template_version','translation_auto','metadata','orientation']);
const ORIENTATIONS=new Set(['portrait','landscape']);
const PRINT_SIDES=new Set(['full','front','back','both']);
const ISSUED_STATUSES=new Set(['active','suspended','lost','expired']);
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function todayKey(){return new Date().toISOString().slice(0,10)}
function effectiveStatus(card,today=todayKey()){return card?.status==='active'&&card?.expiry_date&&card.expiry_date<today?'expired':card?.status}
function withEffectiveStatus(card,today=todayKey()){const status=effectiveStatus(card,today);return status===card?.status?card:{...card,status}}
function cleanCard(input={}){const out={};for(const [k,v] of Object.entries(input||{}))if(CARD_FIELDS.has(k))out[k]=v;if(out.source_type==='standalone')out.linked_employee_id=null;if(out.orientation!==undefined){out.orientation=txt(out.orientation)||'landscape';if(!ORIENTATIONS.has(out.orientation))throw Object.assign(new Error('اتجاه البطاقة غير مدعوم. اختر طولي أو عرضي.'),{status:400})}return out}
async function getCard(env,id,me){requirePerm(me,'id_card_view');const rows=await rest(env,`id_cards?id=eq.${enc(id)}&select=*${branchFilter(me)}&limit=1`);if(!rows?.[0]){const e=new Error('البطاقة غير موجودة أو خارج نطاق صلاحيتك.');e.status=404;throw e}return rows[0]}
async function publicVerify(env,token){if(!/^[0-9a-f-]{36}$/i.test(token))return json({ok:false,valid:false,error:'رمز التحقق غير صالح.'},400);const rows=await rest(env,`id_cards?qr_token=eq.${enc(token)}&select=card_number,name_ar,name_en,job_title_ar,job_title_en,department_ar,department_en,status,issue_date,expiry_date,holder_type,template_code,metadata&limit=1`);const card=rows?.[0];if(!card)return json({ok:false,valid:false,error:'لم يتم العثور على البطاقة.'},404);const effective=withEffectiveStatus(card);return json({ok:true,valid:effective.status==='active',card:effective,verified_at:new Date().toISOString()})}
async function handleIdStudio(env,me,body){const action=txt(body.action);requirePerm(me,'id_studio_access');
  if(action==='id_studio_dashboard'){
    requirePerm(me,'id_card_view');const rows=await rest(env,`id_cards?select=id,status,expiry_date${branchFilter(me)}&limit=10000`);const today=todayKey(),soon=new Date(Date.now()+30*86400000).toISOString().slice(0,10);const stats={active:0,draft:0,pending_approval:0,suspended:0,expired:0,lost:0,revoked:0,expiring_soon:0,total:rows.length};
    for(const r of rows){const status=effectiveStatus(r,today);if(stats[status]!==undefined)stats[status]++;if(r.status==='active'&&r.expiry_date&&r.expiry_date>=today&&r.expiry_date<=soon)stats.expiring_soon++}return {ok:true,stats}
  }
  if(action==='id_studio_cards_list'){
    requirePerm(me,'id_card_view');const f=body.filters||{},wantedStatus=txt(f.status);let q=`select=*&order=created_at.desc${branchFilter(me)}&limit=500`;
    if(wantedStatus==='active')q+='&status=eq.active';else if(wantedStatus==='expired')q+='&status=in.(active,expired)';else if(wantedStatus)q+=`&status=eq.${enc(wantedStatus)}`;
    if(txt(f.q)){const k=enc(`*${txt(f.q)}*`);q+=`&or=(name_ar.ilike.${k},name_en.ilike.${k},card_number.ilike.${k})`}
    const today=todayKey(),rows=(await rest(env,`id_cards?${q}`)).map(card=>withEffectiveStatus(card,today));return {ok:true,rows:wantedStatus?rows.filter(card=>card.status===wantedStatus):rows}
  }
  if(action==='id_studio_card_get')return {ok:true,card:withEffectiveStatus(await getCard(env,body.id,me))};
  if(action==='id_studio_templates_list')return {ok:true,rows:await rest(env,'id_card_templates?is_active=eq.true&select=*&order=name_ar.asc')};
  if(action==='id_studio_card_create'){requirePerm(me,'id_card_create');let row=cleanCard(body.card||{});if(!txt(row.name_ar))throw Object.assign(new Error('اسم حامل البطاقة بالعربية مطلوب.'),{status:400});if(row.source_type==='linked_employee'){requirePerm(me,'id_card_link_employee');if(!txt(row.linked_employee_id))throw Object.assign(new Error('اختر الموظف المراد ربط البطاقة به.'),{status:400})}row=forceBranch(me,{...row,status:'draft',metadata:{...(row.metadata||{}),issue_version:1},created_by:actorId(me)||null,updated_by:actorId(me)||null});const made=await rest(env,'id_cards',{method:'POST',body:row,prefer:'return=representation'});const card=made?.[0];await rest(env,'id_card_versions',{method:'POST',body:{card_id:card.id,version:1,snapshot:card,reason:'initial_issue',created_by:actorId(me)||null},prefer:'return=minimal'});await audit(env,card.id,'create',me,null,card);return {ok:true,card}}
  if(action==='id_studio_card_update'){
    requirePerm(me,'id_card_edit');const before=await getCard(env,body.id,me);
    if(ISSUED_STATUSES.has(before.status))throw Object.assign(new Error('البطاقة مصدرة سابقًا. استخدم مسار تعديل البطاقة المصدرة أو إعادة الإصدار للحفاظ على سجل الإصدارات.'),{status:409});
    if(!['draft','pending_approval'].includes(before.status))throw Object.assign(new Error('حالة البطاقة الحالية لا تسمح بالتعديل.'),{status:400});
    let patch=cleanCard(body.patch||{});if(patch.source_type==='linked_employee'||patch.linked_employee_id)requirePerm(me,'id_card_link_employee');patch=forceBranch(me,{...patch,updated_by:actorId(me)||null});const updated=await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:patch,prefer:'return=representation'});const card=updated?.[0];await audit(env,card.id,'update',me,before,card);return {ok:true,card}
  }
  if(action==='id_studio_card_submit'){requirePerm(me,'id_card_edit');const before=await getCard(env,body.id,me);if(before.status!=='draft')throw Object.assign(new Error('يمكن إرسال البطاقات المسودة فقط للاعتماد.'),{status:400});const updated=await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:{status:'pending_approval',updated_by:actorId(me)||null},prefer:'return=representation'});await audit(env,before.id,'submit_for_approval',me,before,updated?.[0]);return {ok:true,card:updated?.[0]}}
  if(action==='id_studio_card_approve'){
    requirePerm(me,'id_card_approve');const before=await getCard(env,body.id,me);if(!['draft','pending_approval'].includes(before.status))throw Object.assign(new Error('حالة البطاقة لا تسمح بالاعتماد.'),{status:400});
    const today=todayKey();if(before.expiry_date&&before.expiry_date<today)throw Object.assign(new Error('لا يمكن اعتماد بطاقة منتهية الصلاحية. حدّث تاريخ الانتهاء أولًا.'),{status:400});
    const updated=await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:{status:'active',approved_at:new Date().toISOString(),approved_by:actorId(me)||null,updated_by:actorId(me)||null},prefer:'return=representation'});await audit(env,before.id,'approve',me,before,updated?.[0]);return {ok:true,card:updated?.[0]}
  }
  if(action==='id_studio_card_suspend'||action==='id_studio_card_revoke'){
    const revoke=action.endsWith('revoke');requirePerm(me,revoke?'id_card_revoke':'id_card_edit');const before=await getCard(env,body.id,me);
    if(!revoke&&before.status!=='active')throw Object.assign(new Error('يمكن إيقاف البطاقة الفعالة فقط.'),{status:400});
    if(revoke&&['revoked','reissued'].includes(before.status))throw Object.assign(new Error('البطاقة ملغاة أو مستبدلة بالفعل.'),{status:400});
    const status=revoke?'revoked':'suspended';const updated=await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:{status,updated_by:actorId(me)||null},prefer:'return=representation'});await audit(env,before.id,revoke?'revoke':'suspend',me,before,updated?.[0],txt(body.reason)||null);return {ok:true,card:updated?.[0]}
  }
  if(action==='id_studio_card_reissue'){requirePerm(me,'id_card_reissue');const before=await getCard(env,body.id,me);if(!['active','suspended','lost','expired'].includes(before.status))throw Object.assign(new Error('حالة البطاقة لا تسمح بإعادة الإصدار.'),{status:400});const versions=await rest(env,`id_card_versions?card_id=eq.${enc(before.id)}&select=version&order=version.desc&limit=1`),nextVersion=Number(versions?.[0]?.version||Number(before.metadata?.issue_version)||1)+1;const patch={status:'draft',qr_token:crypto.randomUUID(),approved_at:null,approved_by:null,updated_by:actorId(me)||null,metadata:{...(before.metadata||{}),issue_version:nextVersion,reissued_at:new Date().toISOString(),reissue_reason:txt(body.reason)||'reissue'}};const updated=(await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0];await rest(env,'id_card_versions',{method:'POST',body:{card_id:before.id,version:nextVersion,snapshot:updated,reason:txt(body.reason)||'reissue',created_by:actorId(me)||null},prefer:'return=minimal'});await audit(env,before.id,'reissue',me,before,updated,txt(body.reason)||null);return {ok:true,card:updated,version:nextVersion}}
  if(action==='id_studio_print_log'){
    requirePerm(me,'id_card_print');
    const card=await getCard(env,body.id,me),today=todayKey();
    if(card.status!=='active')throw Object.assign(new Error('لا يمكن طباعة بطاقة غير معتمدة/فعالة.'),{status:400});
    if(card.expiry_date&&card.expiry_date<today)throw Object.assign(new Error('لا يمكن طباعة بطاقة منتهية الصلاحية.'),{status:400});
    const printSide=txt(body.print_side)||'full';
    if(!PRINT_SIDES.has(printSide))throw Object.assign(new Error('وجه الطباعة المطلوب غير صالح.'),{status:400});
    if((printSide==='back'||printSide==='both')&&card.print_mode!=='front_back')throw Object.assign(new Error('البطاقة وجه واحد ولا تحتوي على وجه خلفي للطباعة.'),{status:400});
    const copies=body.copies===undefined||body.copies===null||body.copies===''?1:Number(body.copies);
    if(!Number.isInteger(copies)||copies<1||copies>50)throw Object.assign(new Error('عدد النسخ يجب أن يكون رقمًا صحيحًا من 1 إلى 50.'),{status:400});
    let printerProfileId=txt(body.printer_profile_id)||null;
    if(printerProfileId){
      if(!UUID_RE.test(printerProfileId))throw Object.assign(new Error('معرّف Profile الطابعة غير صالح.'),{status:400});
      const profiles=await rest(env,`id_card_printer_profiles?id=eq.${enc(printerProfileId)}&owner_user_id=eq.${enc(actorId(me))}&select=id&limit=1`);
      if(!profiles?.[0])throw Object.assign(new Error('Profile الطابعة غير موجود أو لا يخص المستخدم الحالي.'),{status:400});
    }
    const row={card_id:card.id,print_side:printSide,copies,printer_profile_id:printerProfileId,printed_by:actorId(me)||null};
    const made=await rest(env,'id_card_print_logs',{method:'POST',body:row,prefer:'return=representation'});await audit(env,card.id,'print',me,null,row);return {ok:true,log:made?.[0]}
  }
  if(action==='id_studio_printer_profile_save'){requirePerm(me,'id_card_manage_settings');const p=body.profile||{},id=txt(p.id),row={name:txt(p.name)||'الطابعة الافتراضية',printer_name:txt(p.printer_name)||null,offset_x_mm:Number(p.offset_x_mm)||0,offset_y_mm:Number(p.offset_y_mm)||0,scale_x:Number(p.scale_x)||1,scale_y:Number(p.scale_y)||1,is_default:!!p.is_default,owner_user_id:actorId(me)||null};if(id){const out=await rest(env,`id_card_printer_profiles?id=eq.${enc(id)}&owner_user_id=eq.${enc(actorId(me))}`,{method:'PATCH',body:row,prefer:'return=representation'});return {ok:true,profile:out?.[0]}}const out=await rest(env,'id_card_printer_profiles',{method:'POST',body:row,prefer:'return=representation'});return {ok:true,profile:out?.[0]}}
  if(action==='id_studio_audit_list'){requirePerm(me,'id_card_audit_view');if(has(me,'id_card_view_all_branches'))return {ok:true,rows:await rest(env,'id_card_audit_logs?select=*&order=created_at.desc&limit=500')};const scoped=await rest(env,`id_cards?select=id${branchFilter(me)}&limit=10000`);const ids=(scoped||[]).map(x=>txt(x.id)).filter(Boolean);if(!ids.length)return {ok:true,rows:[]};const inList=ids.map(x=>`"${String(x).replace(/"/g,'')}"`).join(',');return {ok:true,rows:await rest(env,`id_card_audit_logs?card_id=in.(${enc(inList)})&select=*&order=created_at.desc&limit=500`)}}
  throw Object.assign(new Error('عملية ID Studio غير معروفة.'),{status:400});
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/id-studio/verify'&&request.method==='GET'){try{return await publicVerify(env,txt(url.searchParams.get('token')))}catch(e){return json({ok:false,valid:false,error:'تعذر التحقق من البطاقة.'},e.status||500)}}if(url.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);const body=await request.clone().json().catch(()=>({}));const action=txt(body.action);if(!action.startsWith('id_studio_'))return appWorker.fetch(request,env,ctx);const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);try{return json(await handleIdStudio(env,me,body))}catch(e){return json({error:e.message||'تعذر تنفيذ عملية ID Studio'},e.status||500)}}};