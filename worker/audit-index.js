import securedWorker from './secure-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}};
const txt=v=>String(v??'').trim();
const low=v=>txt(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const SENSITIVE=/(password|passwd|secret|authorization|cookie|session|service[_-]?role|api[_-]?key|access[_-]?token|refresh[_-]?token|ticket_qr_token|qr_token)$/i;

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

async function restRows(env,table,params){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${params.toString()}`,{headers:headers(env)});
  const b=await r.json().catch(()=>[]);
  if(!r.ok){const e=new Error(b?.message||`تعذر قراءة ${table}`);e.status=r.status;throw e}
  return Array.isArray(b)?b:[];
}
function redact(value,depth=0){
  if(depth>7)return '[deep]';
  if(Array.isArray(value))return value.slice(0,250).map(v=>redact(v,depth+1));
  if(value&&typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(SENSITIVE.test(k))out[k]='[REDACTED]';
      else out[k]=redact(v,depth+1);
    }
    return out;
  }
  return value;
}
function comparable(v){
  if(v===undefined)return null;
  if(v&&typeof v==='object'){try{return JSON.stringify(v)}catch{return String(v)}}
  return v;
}
function displayValue(v){
  if(v===undefined||v===null||v==='')return '—';
  if(typeof v==='object'){try{return JSON.stringify(v)}catch{return String(v)}}
  return String(v);
}
function diffObjects(before,after,prefix='',depth=0,out=[]){
  const a=before&&typeof before==='object'&&!Array.isArray(before)?before:{};
  const b=after&&typeof after==='object'&&!Array.isArray(after)?after:{};
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  for(const key of keys){
    if(SENSITIVE.test(key))continue;
    const av=a[key],bv=b[key],path=prefix?`${prefix}.${key}`:key;
    const bothObjects=av&&bv&&typeof av==='object'&&typeof bv==='object'&&!Array.isArray(av)&&!Array.isArray(bv);
    if(bothObjects&&depth<2){diffObjects(av,bv,path,depth+1,out);continue}
    if(comparable(av)!==comparable(bv))out.push({field:path,before:displayValue(av),after:displayValue(bv)});
    if(out.length>=160)break;
  }
  return out;
}
function activityRow(r){
  return {...r,id:`activity:${r.id}`,metadata:redact(r.metadata||{})};
}
function richAuditRow(r){
  const before=redact(r.before_data||null),after=redact(r.after_data||null);
  return {
    id:`audit:${r.id}`,
    actor_id:r.actor_id,actor_name:r.actor_name,actor_role:r.actor_role,branch_id:r.branch_id,
    action:r.action,entity_type:r.entity_type,entity_id:r.entity_id,created_at:r.created_at,
    metadata:{
      source:'audit_events',
      reason:r.reason||null,
      before_data:before,
      after_data:after,
      changes:diffObjects(before,after)
    }
  };
}
function eventKey(r){return [low(r.action),low(r.entity_type),txt(r.entity_id),txt(r.actor_id)].join('|')}
function timeMs(v){const n=new Date(v||0).getTime();return Number.isFinite(n)?n:0}
function dedupe(activity,rich){
  const richByKey=new Map();
  for(const r of rich){const k=eventKey(r);const list=richByKey.get(k)||[];list.push(r);richByKey.set(k,list)}
  return activity.filter(a=>{
    if(a.metadata?.source!=='audit_wrapper')return true;
    const candidates=richByKey.get(eventKey(a))||[];
    return !candidates.some(r=>Math.abs(timeMs(r.created_at)-timeMs(a.created_at))<=12000);
  });
}
function categoryOf(x){
  const s=low((x.action||'')+' '+(x.entity_type||''));
  if(/permission|security|login|auth|staff|approval/.test(s))return 'security';
  if(/finance|payment|refund|expense|cash|shift|budget|wallet/.test(s))return 'finance';
  if(/attendance|employee|schedule|policy|violation/.test(s))return 'hr';
  if(/booking|passenger|trip|seat|room|housing|fleet|scan|operation/.test(s))return 'operations';
  return 'system';
}
async function auditList(request,env){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canAudit(actor))return json({error:'لا توجد صلاحية لعرض سجل التدقيق.'},403);
  const url=base(env);if(!url)return json({error:'إعدادات قاعدة البيانات غير مكتملة.'},500);
  const q=new URL(request.url).searchParams;
  const limit=Math.min(Math.max(Number(q.get('limit')||300),1),1000);
  const fetchLimit=Math.min(Math.max(limit,300),1000);
  const commonBranch=!globalAudit(actor)?actor.branch_id:null;
  if(!globalAudit(actor)&&!actor.branch_id)return json({ok:true,rows:[],scope:'branch',summary:{total:0,security:0,finance:0,hr:0,operations:0,system:0,sources:{activity:0,detailed:0}}});

  const activityParams=new URLSearchParams({
    select:'id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at',
    order:'created_at.desc',limit:String(fetchLimit)
  });
  const richParams=new URLSearchParams({
    select:'id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,before_data,after_data,reason,created_at',
    order:'created_at.desc',limit:String(fetchLimit)
  });
  if(commonBranch){activityParams.set('branch_id',`eq.${commonBranch}`);richParams.set('branch_id',`eq.${commonBranch}`)}

  const [activityResult,richResult]=await Promise.allSettled([
    restRows(env,'activity_events',activityParams),
    restRows(env,'audit_events',richParams)
  ]);
  if(activityResult.status==='rejected'&&richResult.status==='rejected')return json({error:'تعذر قراءة مصادر سجل التدقيق.'},500);

  const activity=(activityResult.status==='fulfilled'?activityResult.value:[]).map(activityRow);
  const rich=(richResult.status==='fulfilled'?richResult.value:[]).map(richAuditRow);
  let rows=[...rich,...dedupe(activity,rich)].sort((a,b)=>timeMs(b.created_at)-timeMs(a.created_at));

  const needle=low(q.get('q'));
  const actionFilter=low(q.get('action'));
  const entityType=low(q.get('entity_type'));
  const entityId=txt(q.get('entity_id'));
  const entityIds=new Set(txt(q.get('entity_ids')).split(',').map(txt).filter(Boolean));
  const actorNeedle=low(q.get('actor'));
  const from=q.get('from')?timeMs(q.get('from')):0;
  const to=q.get('to')?timeMs(q.get('to')):0;
  if(actionFilter)rows=rows.filter(x=>low(x.action).includes(actionFilter));
  if(entityType)rows=rows.filter(x=>low(x.entity_type)===entityType);
  if(entityId)rows=rows.filter(x=>txt(x.entity_id)===entityId||txt(x.metadata?.canonical_id)===entityId||txt(x.metadata?.duplicate_id)===entityId);
  if(entityIds.size)rows=rows.filter(x=>entityIds.has(txt(x.entity_id))||entityIds.has(txt(x.metadata?.canonical_id))||entityIds.has(txt(x.metadata?.duplicate_id)));
  if(actorNeedle)rows=rows.filter(x=>[x.actor_name,x.actor_id,x.actor_role].some(v=>low(v).includes(actorNeedle)));
  if(from)rows=rows.filter(x=>timeMs(x.created_at)>=from);
  if(to)rows=rows.filter(x=>timeMs(x.created_at)<=to);
  if(needle)rows=rows.filter(x=>[
    x.actor_name,x.actor_role,x.action,x.entity_type,x.entity_id,x.branch_id,
    x.metadata?.reason,JSON.stringify(x.metadata||{})
  ].some(v=>low(v).includes(needle)));

  const totalBeforeLimit=rows.length;
  rows=rows.slice(0,limit);
  const summary={total:rows.length,total_matched:totalBeforeLimit,security:0,finance:0,hr:0,operations:0,system:0,sources:{activity:0,detailed:0}};
  for(const r of rows){summary[categoryOf(r)]+=1;if(r.metadata?.source==='audit_events')summary.sources.detailed+=1;else summary.sources.activity+=1}
  return json({
    ok:true,rows,scope:globalAudit(actor)?'all':'branch',summary,
    warnings:[
      ...(activityResult.status==='rejected'?['تعذر تحميل سجل activity_events.']:[]),
      ...(richResult.status==='rejected'?['تعذر تحميل سجل audit_events التفصيلي.']:[])
    ]
  });
}

async function snapshotById(env,table,id){
  if(!id)return null;
  const params=new URLSearchParams({select:'*',id:`eq.${id}`,limit:'1'});
  try{return (await restRows(env,table,params))?.[0]||null}catch{return null}
}
function detailedWriteDescriptor(path,body={}){
  if(path!=='/api/admin')return null;
  const action=String(body?.action||'');
  if(action==='sync_users'&&Array.isArray(body?.rows)&&body.rows.length){
    return {table:'staff_users',entityType:'staff_users',items:body.rows.map(x=>({id:txt(x?.id)})).filter(x=>x.id),reason:txt(body?.reason)||'تعديل حساب موظف'};
  }
  return null;
}
async function captureBefore(env,spec){
  if(!spec)return new Map();
  const out=new Map();
  for(const item of spec.items){out.set(item.id,await snapshotById(env,spec.table,item.id))}
  return out;
}
async function appendDetailedWrites(env,actor,spec,beforeMap){
  if(!actor||!spec||!base(env))return 0;
  let count=0;
  for(const item of spec.items){
    const before=beforeMap.get(item.id)||null,after=await snapshotById(env,spec.table,item.id);
    if(!after)continue;
    const action=spec.entityType==='staff_users'?(before?'staff_updated':'staff_created'):'record_updated';
    const row={
      actor_id:String(actor.id||'')||null,actor_name:String(actor.name||actor.username||'')||null,actor_role:String(actor.role||'')||null,
      branch_id:after?.branch_id||before?.branch_id||actor.branch_id||null,action,entity_type:spec.entityType,entity_id:item.id,
      before_data:before?redact(before):null,after_data:redact(after),reason:spec.reason||null,created_at:new Date().toISOString()
    };
    try{
      const r=await fetch(`${base(env)}/rest/v1/audit_events`,{method:'POST',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify(row)});
      if(r.ok)count++;
    }catch{}
  }
  return count;
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
  if(path==='/api/admin'){
    if(action==='sync_users'&&Array.isArray(body?.rows)&&body.rows.length===1)return {action:'sync_users',table:'staff_users',entityType:'staff_users',entityId:body.rows[0]?.id||null};
    if(action==='sync_trips'&&Array.isArray(body?.rows)&&body.rows.length===1)return {action:'sync_trips',table:'trips',entityType:'trips',entityId:body.rows[0]?.id||null};
    return {action:action||'admin_write',table:table||null,entityType:table||'admin',entityId:body?.id||body?.row?.id||null};
  }
  if(path==='/api/module')return {action:action||'module_write',table:table||null,entityType:table||'module',entityId:body?.id||body?.row?.id||null};
  if(path==='/api/mega')return {action:action||'mega_write',table:null,entityType:'mega',entityId:body?.id||null};
  if(path==='/api/platform')return {action:action||'platform_write',table:table||null,entityType:table||'platform',entityId:body?.id||null};
  return null;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/audit'&&request.method==='GET')return auditList(request,env);
    if(url.pathname==='/api/audit/query'&&request.method==='POST'){
      const body=await request.clone().json().catch(()=>({}));
      const u=new URL('/api/audit',request.url);
      const ids=Array.isArray(body?.entity_ids)?body.entity_ids.map(txt).filter(Boolean):[];
      if(ids.length)u.searchParams.set('entity_ids',ids.join(','));
      if(body?.entity_id)u.searchParams.set('entity_id',txt(body.entity_id));
      if(body?.entity_type)u.searchParams.set('entity_type',txt(body.entity_type));
      if(body?.limit)u.searchParams.set('limit',String(body.limit));
      return auditList(new Request(u,{method:'GET',headers:request.headers}),env);
    }

    let actor=null,descriptor=null,detailedSpec=null,beforeMap=new Map();
    if(request.method!=='GET'&&['/api/admin','/api/module','/api/mega','/api/platform'].includes(url.pathname)){
      actor=await actorFrom(request,env);
      let body={};try{body=await request.clone().json()}catch{}
      descriptor=auditDescriptor(url.pathname,body);
      detailedSpec=detailedWriteDescriptor(url.pathname,body);
      if(detailedSpec&&actor)beforeMap=await captureBefore(env,detailedSpec);
    }

    const response=await securedWorker.fetch(request,env,ctx);
    if(descriptor&&actor&&response.ok){
      const task=(async()=>{
        const detailedCount=detailedSpec?await appendDetailedWrites(env,actor,detailedSpec,beforeMap):0;
        if(!detailedCount)await appendAudit(env,actor,{...descriptor,path:url.pathname,method:request.method,status:response.status});
      })();
      if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
    }
    return response;
  }
};
