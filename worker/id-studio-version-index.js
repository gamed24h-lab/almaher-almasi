import opsWorker from './id-studio-ops-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const serviceKey=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:serviceKey(env),Authorization:`Bearer ${serviceKey(env)}`,Accept:'application/json','Content-Type':'application/json'});
const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const isDeveloper=u=>String(u?.role||'').toLowerCase()==='developer';
const has=(u,p)=>!!u&&(isDeveloper(u)||u.permissions?.[p]===true);
const actorId=u=>txt(u?.id||u?.user_id||u?.username||u?.email||'');
const TEMPLATE_CODES=new Set(['makkah_luxury','executive_side','clean_formal','royal_dark','minimal_corporate']);
const ORIENTATIONS=new Set(['portrait','landscape']);
const LAYOUT_KEYS=new Set(['logo','brand','serviceLine','makkah','photo','person','number','meta','qr','approval','bus','slogan','footer']);
const LAYOUT_FIELDS=new Set(['x','y','w','h','z','opacity','locked']);
const SNAPSHOT_ACTIONS=new Set(['id_studio_card_create','id_studio_card_update','id_studio_card_reissue','id_studio_card_clone','id_studio_bulk_import']);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function rest(env,path,{method='GET',body,prefer}={}){const h=headers(env);if(prefer)h.Prefer=prefer;const r=await fetch(`${base(env)}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||`Database request failed (${r.status})`);e.status=r.status;throw e}return b}
async function actor(request,env,ctx){try{const r=await opsWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
function requirePerm(me,p){if(!has(me,p))throw Object.assign(new Error('لا توجد لديك صلاحية لتنفيذ هذه العملية في ID Studio.'),{status:403})}
async function audit(env,action,me,beforeData,afterData,reason){await rest(env,'id_card_audit_logs',{method:'POST',body:{card_id:null,action,actor_id:actorId(me)||null,before_data:beforeData||null,after_data:afterData||null,reason:reason||null},prefer:'return=minimal'}).catch(()=>{})}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v)}
function cleanTemplateConfig(value){
 if(!plain(value))throw Object.assign(new Error('إعدادات القالب غير صالحة.'),{status:400});
 const serialized=JSON.stringify(value);if(serialized.length>60000)throw Object.assign(new Error('إعدادات القالب أكبر من الحد المسموح.'),{status:400});
 const out=JSON.parse(serialized),d=out.designer;
 if(d!==undefined&&!plain(d))throw Object.assign(new Error('إعدادات محرر القالب غير صالحة.'),{status:400});
 if(plain(d?.assets))for(const [k,v] of Object.entries(d.assets)){if(typeof v!=='string'||v.length>2048)throw Object.assign(new Error(`رابط ملف التصميم ${k} غير صالح.`),{status:400});if(v&&!/^\/|^https?:\/\//i.test(v))throw Object.assign(new Error(`رابط ملف التصميم ${k} غير مسموح.`),{status:400})}
 if(plain(d?.visibility))for(const [k,v] of Object.entries(d.visibility))if(typeof v!=='boolean')throw Object.assign(new Error(`قيمة إظهار العنصر ${k} غير صالحة.`),{status:400});
 if(plain(d?.theme))for(const [k,v] of Object.entries(d.theme))if(typeof v!=='string'||!/^#[0-9a-f]{3,8}$/i.test(v))throw Object.assign(new Error(`لون ${k} غير صالح.`),{status:400});
 if(plain(d?.brand))for(const [k,v] of Object.entries(d.brand))if(typeof v!=='string'||v.length>500)throw Object.assign(new Error(`النص ${k} غير صالح أو أطول من الحد المسموح.`),{status:400});
 if(d?.layout!==undefined){if(!plain(d.layout))throw Object.assign(new Error('إعدادات مواضع عناصر القالب غير صالحة.'),{status:400});for(const [ori,elements] of Object.entries(d.layout)){if(!ORIENTATIONS.has(ori)||!plain(elements))throw Object.assign(new Error('اتجاه مواضع القالب غير صالح.'),{status:400});for(const [element,props] of Object.entries(elements)){if(!LAYOUT_KEYS.has(element)||!plain(props))throw Object.assign(new Error(`عنصر التصميم ${element} غير مدعوم.`),{status:400});for(const [field,val] of Object.entries(props)){if(!LAYOUT_FIELDS.has(field))throw Object.assign(new Error(`خاصية التصميم ${field} غير مدعومة.`),{status:400});if(field==='locked'){if(typeof val!=='boolean')throw Object.assign(new Error('قيمة قفل العنصر غير صالحة.'),{status:400});continue}const n=Number(val);if(!Number.isFinite(n))throw Object.assign(new Error(`قيمة ${field} للعنصر ${element} غير صالحة.`),{status:400});if(['x','y','w','h'].includes(field)&&(n<0||n>100))throw Object.assign(new Error(`قيمة ${field} للعنصر ${element} خارج النطاق.`),{status:400});if(field==='z'&&(n<0||n>50))throw Object.assign(new Error('طبقة العنصر خارج النطاق.'),{status:400});if(field==='opacity'&&(n<0||n>1))throw Object.assign(new Error('شفافية العنصر خارج النطاق.'),{status:400})}}}}
 return out;
}
async function getTemplate(env,code){const c=txt(code);if(!TEMPLATE_CODES.has(c))throw Object.assign(new Error('قالب البطاقة غير معروف.'),{status:400});const rows=await rest(env,`id_card_templates?code=eq.${enc(c)}&select=*&limit=1`);if(!rows?.[0])throw Object.assign(new Error('القالب غير موجود.'),{status:404});return rows[0]}
async function getPublishedVersion(env,code){const template=await getTemplate(env,code);let rows=await rest(env,`id_card_template_versions?template_id=eq.${enc(template.id)}&is_published=eq.true&select=*&order=version.desc&limit=1`);if(!rows?.[0])rows=await rest(env,`id_card_template_versions?template_id=eq.${enc(template.id)}&version=eq.${enc(template.published_version||template.version||1)}&select=*&limit=1`);const version=rows?.[0]||{id:null,template_id:template.id,version:Number(template.published_version||template.version||1),orientation:template.default_orientation,config:template.published_config&&Object.keys(template.published_config).length?template.published_config:template.config};return {template,version}}
async function versionsList(env,me,body){requirePerm(me,'id_studio_access');requirePerm(me,'id_card_manage_templates');const template=await getTemplate(env,body.code);const rows=await rest(env,`id_card_template_versions?template_id=eq.${enc(template.id)}&select=id,template_id,version,orientation,config,is_original,is_published,change_reason,created_by,created_at&order=version.desc&limit=100`);return {ok:true,template:{id:template.id,code:template.code,name_ar:template.name_ar,published_version:template.published_version},rows}}
async function insertVersion(env,template,version,orientation,config,me,reason){return (await rest(env,'id_card_template_versions',{method:'POST',body:{template_id:template.id,version,orientation,config,is_original:false,is_published:false,change_reason:reason||null,created_by:actorId(me)||null},prefer:'return=representation'}))?.[0]}
async function markPublished(env,templateId,versionId){await rest(env,`id_card_template_versions?template_id=eq.${enc(templateId)}&is_published=eq.true`,{method:'PATCH',body:{is_published:false},prefer:'return=minimal'});return (await rest(env,`id_card_template_versions?id=eq.${enc(versionId)}`,{method:'PATCH',body:{is_published:true},prefer:'return=representation'}))?.[0]}
async function publishTemplate(env,me,body){
 requirePerm(me,'id_studio_access');requirePerm(me,'id_card_manage_templates');
 const before=await getTemplate(env,body.code),config=cleanTemplateConfig(body.config),orientation=ORIENTATIONS.has(txt(body.default_orientation))?txt(body.default_orientation):before.default_orientation;
 const nextVersion=Math.max(Number(before.version)||1,Number(before.published_version)||1)+1,reason=txt(body.reason)||`publish:v${nextVersion}`;
 const staged=await insertVersion(env,before,nextVersion,orientation,config,me,reason);
 try{const patch={config,published_config:config,version:nextVersion,published_version:nextVersion,default_orientation:orientation,updated_by:actorId(me)||null,updated_at:new Date().toISOString()};const template=(await rest(env,`id_card_templates?id=eq.${enc(before.id)}`,{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0];const version=await markPublished(env,before.id,staged.id);await audit(env,'template_publish',me,before,template,`template:${before.code}:v${nextVersion}`);return {ok:true,template,version}}catch(e){await rest(env,`id_card_template_versions?id=eq.${enc(staged.id)}`,{method:'DELETE'}).catch(()=>{});throw e}
}
async function restoreTemplate(env,me,body){
 requirePerm(me,'id_studio_access');requirePerm(me,'id_card_manage_templates');
 const before=await getTemplate(env,body.code);let target;
 if(Number.isFinite(Number(body.version))&&Number(body.version)>0)target=(await rest(env,`id_card_template_versions?template_id=eq.${enc(before.id)}&version=eq.${enc(Number(body.version))}&select=*&limit=1`))?.[0];
 else target=(await rest(env,`id_card_template_versions?template_id=eq.${enc(before.id)}&is_original=eq.true&select=*&order=version.asc&limit=1`))?.[0];
 if(!target)throw Object.assign(new Error('إصدار القالب المطلوب غير موجود.'),{status:404});
 const nextVersion=Math.max(Number(before.version)||1,Number(before.published_version)||1)+1,config=cleanTemplateConfig(target.config),orientation=ORIENTATIONS.has(txt(target.orientation))?txt(target.orientation):before.default_orientation,reason=`restore_from_v${target.version}`;
 const staged=await insertVersion(env,before,nextVersion,orientation,config,me,reason);
 try{const patch={config,published_config:config,version:nextVersion,published_version:nextVersion,default_orientation:orientation,updated_by:actorId(me)||null,updated_at:new Date().toISOString()};const template=(await rest(env,`id_card_templates?id=eq.${enc(before.id)}`,{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0];const version=await markPublished(env,before.id,staged.id);await audit(env,'template_restore',me,before,template,`template:${before.code}:${reason}:v${nextVersion}`);return {ok:true,template,version,restored_from:target.version}}catch(e){await rest(env,`id_card_template_versions?id=eq.${enc(staged.id)}`,{method:'DELETE'}).catch(()=>{});throw e}
}
async function freezeCard(env,card,{syncHistory=true}={}){if(!card?.id||!TEMPLATE_CODES.has(txt(card.template_code)))return card;const {version}=await getPublishedVersion(env,card.template_code);const patch={template_version:Number(version.version)||1,template_version_id:version.id||null,template_config_snapshot:version.config||{}};const updated=(await rest(env,`id_cards?id=eq.${enc(card.id)}`,{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0]||{...card,...patch};if(syncHistory){const issueVersion=Number(updated.metadata?.issue_version)||1;await rest(env,`id_card_versions?card_id=eq.${enc(updated.id)}&version=eq.${enc(issueVersion)}`,{method:'PATCH',body:{snapshot:updated},prefer:'return=minimal'}).catch(()=>{})}return updated}
async function snapshotResponse(env,action,requestBody,response){if(!response.ok)return response;const payload=await readJson(response.clone());if(action==='id_studio_card_update'&&!requestBody?.patch?.template_code&&payload?.card?.template_config_snapshot&&Object.keys(payload.card.template_config_snapshot).length)return response;if(payload?.card)payload.card=await freezeCard(env,payload.card);if(Array.isArray(payload?.cards)){const out=[];for(const card of payload.cards)out.push(await freezeCard(env,card));payload.cards=out}return json(payload,response.status)}

export default {async fetch(request,env,ctx){
 const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return opsWorker.fetch(request,env,ctx);
 const body=await request.clone().json().catch(()=>({})),action=txt(body.action);
 if(action==='id_studio_template_save'||action==='id_studio_template_restore'||action==='id_studio_template_versions_list'){
  const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);
  try{if(action==='id_studio_template_save')return json(await publishTemplate(env,me,body));if(action==='id_studio_template_restore')return json(await restoreTemplate(env,me,body));return json(await versionsList(env,me,body))}catch(e){return json({error:e.message||'تعذر تنفيذ عملية إصدار القالب'},e.status||500)}
 }
 const response=await opsWorker.fetch(request,env,ctx);
 if(!SNAPSHOT_ACTIONS.has(action))return response;
 try{return await snapshotResponse(env,action,body,response)}catch(e){return json({error:e.message||'تم تنفيذ العملية ولكن تعذر تثبيت نسخة تصميم البطاقة.'},e.status||500)}
}};
