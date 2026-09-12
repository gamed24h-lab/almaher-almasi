import versionWorker from './id-studio-version-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const isDeveloper=u=>String(u?.role||'').toLowerCase()==='developer';
const has=(u,p)=>!!u&&(isDeveloper(u)||u.permissions?.[p]===true);
const actorId=u=>txt(u?.id||u?.user_id||u?.username||u?.email||'');
const ORIENTATIONS=new Set(['portrait','landscape']);
const HOLDER_TYPES=new Set(['employee','seasonal','contractor','driver','supervisor','visitor','other']);
const PRINT_MODES=new Set(['full','front_back']);
const TEMPLATE_CODES=new Set(['makkah_luxury','executive_side','clean_formal','royal_dark','minimal_corporate']);
const EDITABLE_FIELDS=new Set(['linked_employee_id','holder_type','source_type','name_ar','name_en','job_title_ar','job_title_en','department_ar','department_en','phone','license_number','season_label','issue_date','expiry_date','print_mode','template_code','translation_auto','orientation']);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function rest(env,path,{method='GET',body,prefer}={}){const h=headers(env);if(prefer)h.Prefer=prefer;const r=await fetch(`${base(env)}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||`Database request failed (${r.status})`);e.status=r.status;throw e}return b}
async function actor(request,env,ctx){try{const r=await versionWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
function requirePerm(me,p){if(!has(me,p))throw Object.assign(new Error('لا توجد لديك صلاحية لتنفيذ هذه العملية في ID Studio.'),{status:403})}
function branchFilter(me){if(has(me,'id_card_view_all_branches'))return '';const bid=txt(me?.branch_id||me?.home_branch_id);return bid?`&owner_branch_id=eq.${enc(bid)}`:'&owner_branch_id=is.null'}
async function getCard(env,id,me){requirePerm(me,'id_card_view');const rows=await rest(env,`id_cards?id=eq.${enc(id)}&select=*${branchFilter(me)}&limit=1`);if(!rows?.[0])throw Object.assign(new Error('البطاقة غير موجودة أو خارج نطاق صلاحيتك.'),{status:404});return rows[0]}
async function audit(env,cardId,action,me,beforeData,afterData,reason){await rest(env,'id_card_audit_logs',{method:'POST',body:{card_id:cardId,action,actor_id:actorId(me)||null,before_data:beforeData||null,after_data:afterData||null,reason:reason||null},prefer:'return=minimal'}).catch(()=>{})}
function cleanPatch(input={}){const out={};for(const [k,v] of Object.entries(input||{}))if(EDITABLE_FIELDS.has(k))out[k]=v;if(out.orientation!==undefined){out.orientation=txt(out.orientation);if(!ORIENTATIONS.has(out.orientation))throw Object.assign(new Error('اتجاه البطاقة غير صالح.'),{status:400})}if(out.holder_type!==undefined&&!HOLDER_TYPES.has(txt(out.holder_type)))throw Object.assign(new Error('نوع حامل البطاقة غير صالح.'),{status:400});if(out.print_mode!==undefined&&!PRINT_MODES.has(txt(out.print_mode)))throw Object.assign(new Error('نظام الطباعة غير صالح.'),{status:400});if(out.template_code!==undefined&&!TEMPLATE_CODES.has(txt(out.template_code)))throw Object.assign(new Error('قالب البطاقة غير صالح.'),{status:400});if(out.source_type==='standalone')out.linked_employee_id=null;if(!txt(out.name_ar)&&out.name_ar!==undefined)throw Object.assign(new Error('اسم حامل البطاقة بالعربية مطلوب.'),{status:400});return out}
async function templateSnapshot(env,code){const rows=await rest(env,`id_card_templates?code=eq.${enc(code)}&select=id,code,version,published_version,default_orientation,config,published_config&limit=1`);const t=rows?.[0];if(!t)throw Object.assign(new Error('القالب المحدد غير موجود.'),{status:404});let versions=await rest(env,`id_card_template_versions?template_id=eq.${enc(t.id)}&is_published=eq.true&select=id,version,orientation,config&order=version.desc&limit=1`).catch(()=>[]);const v=versions?.[0];return {version:Number(v?.version||t.published_version||t.version||1),version_id:v?.id||null,config:v?.config||(t.published_config&&Object.keys(t.published_config).length?t.published_config:t.config)||{}}}
async function nextIssueVersion(env,card){const rows=await rest(env,`id_card_versions?card_id=eq.${enc(card.id)}&select=version&order=version.desc&limit=1`);return Math.max(Number(rows?.[0]?.version)||0,Number(card.metadata?.issue_version)||1)+1}
async function updateIssued(env,me,body){
 requirePerm(me,'id_studio_access');requirePerm(me,'id_card_edit');requirePerm(me,'id_card_reissue');
 const before=await getCard(env,body.id,me),mode=body.mode==='revision'?'revision':'reissue',patch=cleanPatch(body.patch||{}),reason=txt(body.reason)||'تعديل بطاقة مصدرة';
 if(!['active','suspended','lost','expired'].includes(before.status))throw Object.assign(new Error('هذه العملية مخصصة للبطاقات المصدرة سابقًا.'),{status:400});
 if(mode==='revision'){requirePerm(me,'id_card_approve');if(!['active','suspended'].includes(before.status))throw Object.assign(new Error('التعديل المباشر مع بقاء البطاقة فعالة متاح للبطاقات الفعالة أو الموقوفة فقط.'),{status:400})}
 const nextTemplate=txt(patch.template_code||before.template_code),nextOrientation=txt(patch.orientation||before.orientation)||'landscape';
 const orientationChanged=nextOrientation!==txt(before.orientation||'landscape'),templateChanged=nextTemplate!==txt(before.template_code);
 if(mode==='revision'&&(orientationChanged||templateChanged))throw Object.assign(new Error('تغيير اتجاه البطاقة أو القالب يتطلب «إعادة إصدار» للحفاظ على النسخة القديمة كما طُبعت.'),{status:409,code:'ID_CARD_REISSUE_REQUIRED'});
 const version=await nextIssueVersion(env,before),metadata={...(before.metadata||{}),issue_version:version,last_issued_edit_at:new Date().toISOString(),last_issued_edit_mode:mode,last_issued_edit_reason:reason};
 let templateFields={template_version:before.template_version,template_version_id:before.template_version_id,template_config_snapshot:before.template_config_snapshot};
 if(mode==='reissue'&&(templateChanged||!before.template_config_snapshot||!Object.keys(before.template_config_snapshot||{}).length)){const snap=await templateSnapshot(env,nextTemplate);templateFields={template_version:snap.version,template_version_id:snap.version_id,template_config_snapshot:snap.config}}
 const row={...patch,...templateFields,metadata,updated_by:actorId(me)||null};
 if(mode==='reissue'){row.status='draft';row.qr_token=crypto.randomUUID();row.approved_at=null;row.approved_by=null}
 const updated=(await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:row,prefer:'return=representation'}))?.[0];
 await rest(env,'id_card_versions',{method:'POST',body:{card_id:before.id,version,snapshot:updated,reason:`issued_${mode}:${reason}`,created_by:actorId(me)||null},prefer:'return=minimal'});
 await audit(env,before.id,mode==='revision'?'issued_revision':'issued_reissue_edit',me,before,updated,reason);
 return {ok:true,card:updated,version,mode,orientation_changed:orientationChanged,template_changed:templateChanged,qr_rotated:mode==='reissue'};
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return versionWorker.fetch(request,env,ctx);const body=await request.clone().json().catch(()=>({}));if(txt(body.action)!=='id_studio_card_issued_update')return versionWorker.fetch(request,env,ctx);const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);try{return json(await updateIssued(env,me,body))}catch(e){return json({error:e.message||'تعذر تعديل البطاقة المصدرة',code:e.code||null},e.status||500)}}};
