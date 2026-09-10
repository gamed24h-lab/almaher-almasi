import opsWorker from './id-studio-ops-index.js';

const ID_KEYS=new Set([
  'id_studio_access','id_card_view','id_card_create','id_card_edit','id_card_approve',
  'id_card_print','id_card_export','id_card_reissue','id_card_revoke','id_card_link_employee',
  'id_card_view_all_branches','id_card_manage_templates','id_card_manage_settings','id_card_import','id_card_audit_view'
]);
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const serviceKey=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:serviceKey(env),Authorization:`Bearer ${serviceKey(env)}`,Accept:'application/json','Content-Type':'application/json'});
const isDeveloper=u=>String(u?.role||'').toLowerCase()==='developer';
const exact=(u,key)=>isDeveloper(u)||u?.permissions?.[key]===true;

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {}}}
async function actor(request,env,ctx){
  try{
    const r=await opsWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);
    if(!r.ok)return null;
    return (await readJson(r))?.user||null;
  }catch{return null}
}
async function existingByUsername(env,username){
  const u=String(username||'').trim();if(!u)return null;
  const r=await fetch(`${base(env)}/rest/v1/staff_users?username=eq.${encodeURIComponent(u)}&select=id,username,permissions&limit=1`,{headers:headers(env)});
  const rows=await r.json().catch(()=>[]);return r.ok&&Array.isArray(rows)?rows[0]||null:null;
}
async function existingById(env,id){
  const x=String(id||'').trim();if(!x)return null;
  const r=await fetch(`${base(env)}/rest/v1/staff_users?id=eq.${encodeURIComponent(x)}&select=id,username,permissions&limit=1`,{headers:headers(env)});
  const rows=await r.json().catch(()=>[]);return r.ok&&Array.isArray(rows)?rows[0]||null:null;
}
function changedIdKeys(before={},after={}){
  const out=[];for(const key of ID_KEYS)if(!!before?.[key]!==!!after?.[key])out.push(key);return out;
}
function denyMissing(actorUser,keys){
  const denied=keys.filter(k=>!exact(actorUser,k));
  if(!denied.length)return null;
  return json({error:'صلاحيات ID Studio مستقلة. لا يمكنك منح أو سحب صلاحية ID Studio لا تملكها أنت بشكل صريح.',code:'ID_STUDIO_EXACT_GRANT_REQUIRED',permissions:denied},403);
}
async function guardSyncUsers(env,actorUser,body){
  if(isDeveloper(actorUser))return null;
  const rows=Array.isArray(body?.rows)?body.rows:[];
  for(const incoming of rows){
    const old=await existingByUsername(env,incoming?.username);
    const changed=changedIdKeys(old?.permissions||{},incoming?.permissions||{});
    const denied=denyMissing(actorUser,changed);if(denied)return denied;
  }
  return null;
}
async function guardApproval(env,actorUser,body){
  if(isDeveloper(actorUser)||String(body?.decision||'')!=='approve')return null;
  const id=String(body?.id||'').trim();if(!id)return null;
  const r=await fetch(`${base(env)}/rest/v1/approval_requests?id=eq.${encodeURIComponent(id)}&request_type=eq.staff_permission_change&select=entity_id,request_payload&limit=1`,{headers:headers(env)});
  const rows=await r.json().catch(()=>[]),req=r.ok&&Array.isArray(rows)?rows[0]:null;if(!req)return null;
  const target=await existingById(env,req.entity_id);
  const after=req.request_payload?.changes?.permissions||target?.permissions||{};
  return denyMissing(actorUser,changedIdKeys(target?.permissions||{},after));
}

export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/admin'&&request.method==='POST'){
    const body=await request.clone().json().catch(()=>({}));
    if(body?.action==='sync_users'||body?.action==='security_permission_approval_decide'){
      const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);
      const denied=body.action==='sync_users'?await guardSyncUsers(env,me,body):await guardApproval(env,me,body);
      if(denied)return denied;
    }
  }
  return opsWorker.fetch(request,env,ctx);
}};
