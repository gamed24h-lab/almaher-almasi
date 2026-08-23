import securedWorker from './secure-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}};

async function actorFrom(request,env){
  try{
    const u=new URL('/api/auth/me',request.url);
    const r=await securedWorker.fetch(new Request(u,{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}

function canAudit(actor){
  return !!(actor&&(actor.role==='developer'||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.auditLog||actor.permissions?.managePermissions));
}
function globalAudit(actor){return !!(actor&&(actor.role==='developer'||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.allBranches));}

async function auditList(request,env){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canAudit(actor))return json({error:'لا توجد صلاحية لعرض سجل التدقيق.'},403);
  const url=base(env);if(!url)return json({error:'إعدادات قاعدة البيانات غير مكتملة.'},500);
  const q=new URL(request.url).searchParams;
  const limit=Math.min(Math.max(Number(q.get('limit')||200),1),500);
  const params=new URLSearchParams({select:'id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at',order:'created_at.desc',limit:String(limit)});
  if(!globalAudit(actor)){
    if(!actor.branch_id)return json({ok:true,rows:[],scope:'branch',summary:{total:0,security:0,finance:0,developer:0}});
    params.set('branch_id',`eq.${actor.branch_id}`);
  }
  const r=await fetch(`${url}/rest/v1/activity_events?${params.toString()}`,{headers:headers(env)});
  let rows=await r.json().catch(()=>[]);
  if(!r.ok)return json({error:rows?.message||'تعذر قراءة سجل التدقيق.'},500);
  rows=Array.isArray(rows)?rows:[];
  const needle=String(q.get('q')||'').trim().toLowerCase();
  const actionFilter=String(q.get('action')||'').trim().toLowerCase();
  if(actionFilter)rows=rows.filter(x=>String(x.action||'').toLowerCase().includes(actionFilter));
  if(needle)rows=rows.filter(x=>[
    x.actor_name,x.actor_role,x.action,x.entity_type,x.entity_id,x.branch_id,
    JSON.stringify(x.metadata||{})
  ].some(v=>String(v||'').toLowerCase().includes(needle)));
  const summary={
    total:rows.length,
    security:rows.filter(x=>/permission|security|login|auth|user|staff|approval/i.test(String(x.action||'')+' '+String(x.entity_type||''))).length,
    finance:rows.filter(x=>/finance|payment|refund|expense|cash|shift/i.test(String(x.action||'')+' '+String(x.entity_type||''))).length,
    developer:rows.filter(x=>/developer|backup|restore|purge|snapshot|setting|release/i.test(String(x.action||'')+' '+String(x.entity_type||''))).length
  };
  return json({ok:true,rows,scope:globalAudit(actor)?'all':'branch',summary});
}

async function appendAudit(env,actor,{action,path,method,status,table,entityType,entityId}){
  if(!actor||!base(env))return;
  const row={
    actor_id:String(actor.id||''),actor_name:String(actor.name||actor.username||''),actor_role:String(actor.role||''),
    branch_id:actor.branch_id||null,action:String(action||`${method} ${path}`),entity_type:entityType||table||'system',entity_id:entityId||null,
    metadata:{path,method,status:Number(status||0),table:table||null,source:'audit_wrapper'}
  };
  try{await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify([row])})}catch{}
}

function auditDescriptor(path,body={}){
  const action=String(body?.action||'');
  const table=String(body?.table||'');
  if(path==='/api/admin')return {action:action||'admin_write',table:table||null,entityType:table||'admin',entityId:body?.id||body?.row?.id||null};
  if(path==='/api/module')return {action:action||'module_write',table:table||null,entityType:table||'module',entityId:body?.id||body?.row?.id||null};
  if(path==='/api/mega')return {action:action||'mega_write',table:null,entityType:'mega',entityId:body?.id||null};
  if(path==='/api/platform')return {action:action||'platform_write',table:table||null,entityType:table||'platform',entityId:body?.id||null};
  return null;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/audit'&&request.method==='GET')return auditList(request,env);

    let actor=null,descriptor=null;
    if(request.method!=='GET'&&['/api/admin','/api/module','/api/mega','/api/platform'].includes(url.pathname)){
      actor=await actorFrom(request,env);
      let body={};try{body=await request.clone().json()}catch{}
      descriptor=auditDescriptor(url.pathname,body);
    }

    const response=await securedWorker.fetch(request,env,ctx);
    if(descriptor&&actor&&response.ok){
      const task=appendAudit(env,actor,{...descriptor,path:url.pathname,method:request.method,status:response.status});
      if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
    }
    return response;
  }
};
