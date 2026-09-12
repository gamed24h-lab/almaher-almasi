import nextWorker from './id-studio-issued-edit-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const isDeveloper=u=>String(u?.role||'').toLowerCase()==='developer';
const has=(u,p)=>!!u&&(isDeveloper(u)||u.permissions?.[p]===true);
const actorId=u=>txt(u?.id||u?.user_id||u?.username||u?.email||'');
const ISSUED=new Set(['active','suspended','lost','expired']);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function rest(env,path,{method='GET',body,prefer}={}){const h=headers(env);if(prefer)h.Prefer=prefer;const r=await fetch(`${base(env)}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||`Database request failed (${r.status})`);e.status=r.status;throw e}return b}
async function actor(request,env,ctx){try{const r=await nextWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
function requirePerm(me,p){if(!has(me,p))throw Object.assign(new Error('لا توجد لديك صلاحية لتنفيذ هذه العملية في ID Studio.'),{status:403})}
function branchFilter(me){if(has(me,'id_card_view_all_branches'))return '';const bid=txt(me?.branch_id||me?.home_branch_id);return bid?`&owner_branch_id=eq.${enc(bid)}`:'&owner_branch_id=is.null'}
async function getCard(env,id,me){requirePerm(me,'id_card_view');const rows=await rest(env,`id_cards?id=eq.${enc(id)}&select=*${branchFilter(me)}&limit=1`);if(!rows?.[0])throw Object.assign(new Error('البطاقة غير موجودة أو خارج نطاق صلاحيتك.'),{status:404});return rows[0]}
async function audit(env,cardId,action,me,beforeData,afterData,reason){await rest(env,'id_card_audit_logs',{method:'POST',body:{card_id:cardId,action,actor_id:actorId(me)||null,before_data:beforeData||null,after_data:afterData||null,reason:reason||null},prefer:'return=minimal'}).catch(()=>{})}
function parseDataUrl(value,maxBytes=4*1024*1024){const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value||''));if(!m)throw Object.assign(new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.'),{status:400});const raw=atob(m[2].replace(/\s/g,''));if(raw.length>maxBytes)throw Object.assign(new Error('حجم الصورة كبير. الحد الأقصى 4MB.'),{status:400});const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return {mime:m[1],bytes}}
function extFor(mime){return mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'}
async function uploadStorage(env,path,mime,bytes){const r=await fetch(`${base(env)}/storage/v1/object/id-card-photos/${path}`,{method:'POST',headers:{apikey:key(env),Authorization:`Bearer ${key(env)}`,'Content-Type':mime,'x-upsert':'false'},body:bytes});if(!r.ok){const b=await readJson(r);throw Object.assign(new Error(b?.message||'تعذر رفع الصورة.'),{status:r.status})}}
async function deleteStorage(env,path){if(!path)return;await fetch(`${base(env)}/storage/v1/object/id-card-photos/${path}`,{method:'DELETE',headers:{apikey:key(env),Authorization:`Bearer ${key(env)}`}}).catch(()=>{})}
async function nextIssueVersion(env,card){const rows=await rest(env,`id_card_versions?card_id=eq.${enc(card.id)}&select=version&order=version.desc&limit=1`);return Math.max(Number(rows?.[0]?.version)||0,Number(card.metadata?.issue_version)||1)+1}
async function uploadPhoto(env,me,body){
 requirePerm(me,'id_studio_access');requirePerm(me,'id_card_edit');
 const before=await getCard(env,body.id,me);
 if(['revoked','reissued'].includes(before.status))throw Object.assign(new Error('لا يمكن تغيير صورة بطاقة ملغاة أو مستبدلة.'),{status:400});
 const {mime,bytes}=parseDataUrl(body.data_url),path=`${before.id}/${crypto.randomUUID()}.${extFor(mime)}`;
 await uploadStorage(env,path,mime,bytes);
 try{
  if(ISSUED.has(before.status)){
   requirePerm(me,'id_card_reissue');
   const reason=txt(body.reason)||'تغيير صورة حامل البطاقة',version=await nextIssueVersion(env,before);
   const metadata={...(before.metadata||{}),issue_version:version,last_issued_edit_at:new Date().toISOString(),last_issued_edit_mode:'reissue',last_issued_edit_reason:reason,previous_photo_path:before.photo_path||null};
   const updated=(await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:{photo_path:path,status:'draft',qr_token:crypto.randomUUID(),approved_at:null,approved_by:null,metadata,updated_by:actorId(me)||null},prefer:'return=representation'}))?.[0];
   await rest(env,'id_card_versions',{method:'POST',body:{card_id:before.id,version,snapshot:updated,reason:`issued_photo_reissue:${reason}`,created_by:actorId(me)||null},prefer:'return=minimal'});
   await audit(env,before.id,'issued_photo_reissue',me,before,updated,reason);
   return {ok:true,card:{...updated,photo_url:`/api/id-studio/photo?id=${encodeURIComponent(before.id)}&v=${Date.now()}`},version,mode:'reissue',qr_rotated:true,old_photo_preserved:!!before.photo_path};
  }
  if(!['draft','pending_approval'].includes(before.status))throw Object.assign(new Error('حالة البطاقة الحالية لا تسمح بتغيير الصورة.'),{status:400});
  const updated=(await rest(env,`id_cards?id=eq.${enc(before.id)}`,{method:'PATCH',body:{photo_path:path,updated_by:actorId(me)||null},prefer:'return=representation'}))?.[0];
  const issueVersion=Number(updated?.metadata?.issue_version)||1;
  await rest(env,`id_card_versions?card_id=eq.${enc(before.id)}&version=eq.${enc(issueVersion)}`,{method:'PATCH',body:{snapshot:updated},prefer:'return=minimal'}).catch(()=>{});
  await audit(env,before.id,'photo_update',me,before,updated,txt(body.reason)||'تحديث صورة بطاقة غير مصدرة');
  if(before.photo_path&&before.photo_path!==path)await deleteStorage(env,before.photo_path);
  return {ok:true,card:{...updated,photo_url:`/api/id-studio/photo?id=${encodeURIComponent(before.id)}&v=${Date.now()}`},version:issueVersion,mode:'draft_update',qr_rotated:false,old_photo_preserved:false};
 }catch(e){await deleteStorage(env,path);throw e}
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return nextWorker.fetch(request,env,ctx);const body=await request.clone().json().catch(()=>({}));if(txt(body.action)!=='id_studio_photo_upload')return nextWorker.fetch(request,env,ctx);const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);try{return json(await uploadPhoto(env,me,body))}catch(e){return json({error:e.message||'تعذر تحديث صورة البطاقة',code:e.code||null},e.status||500)}}};
