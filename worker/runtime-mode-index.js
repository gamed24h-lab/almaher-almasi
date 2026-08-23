import inventoryWorker from './inventory-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await inventoryWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const isDeveloper=actor=>String(actor?.role||'').toLowerCase()==='developer';

async function getMode(env){
  if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return {ok:false,mode:'training',schema_missing:false,error:'إعدادات Supabase على الخادم غير مكتملة.'};
  const r=await fetch(`${base(env)}/rest/v1/system_runtime_state?id=eq.main&select=id,runtime_mode,changed_at,changed_by,details&limit=1`,{headers:headers(env)});const b=await parse(r);
  if(!r.ok){const msg=String(b?.message||'');if(/system_runtime_state|relation .* does not exist|schema cache/i.test(msg))return {ok:true,mode:'training',schema_missing:true,row:null};return {ok:false,mode:'training',schema_missing:false,error:msg||`HTTP ${r.status}`}}
  const row=Array.isArray(b)?b[0]:null;return {ok:true,mode:String(row?.runtime_mode||'training'),schema_missing:false,row};
}

async function runtimeMode(request,env){
  if(request.method==='GET'){
    const x=await getMode(env);if(!x.ok)return json({error:x.error},500);
    return json({ok:true,mode:x.mode,schema_missing:x.schema_missing,changed_at:x.row?.changed_at||null,changed_by:x.row?.changed_by||null});
  }
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!isDeveloper(actor))return json({error:'تغيير وضع النظام متاح للمطور الحقيقي فقط.'},403);
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({}));const target=String(body?.mode||'').toLowerCase();
  if(target!=='training')return json({error:'العودة إلى Production ما زالت مقفولة داخل بوابة الإطلاق الآمن.',code:'PRODUCTION_ACTIVATION_LOCKED'},409);
  const current=await getMode(env);if(!current.ok)return json({error:current.error},500);if(current.schema_missing)return json({error:'جدول system_runtime_state غير مثبت بعد. شغّل Migration الخاصة بوضع النظام أولًا.',code:'RUNTIME_MODE_SCHEMA_MISSING'},409);
  const now=new Date().toISOString(),rec={runtime_mode:'training',changed_at:now,changed_by:actor.name||actor.id,details:{reason:'developer_manual_switch_to_training',preserve_production_data:true}};
  const r=await fetch(`${base(env)}/rest/v1/system_runtime_state?id=eq.main`,{method:'PATCH',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(rec)});const b=await parse(r);if(!r.ok)return json({error:b?.message||'تعذر تحويل النظام إلى وضع التدريب.'},502);
  return json({ok:true,mode:'training',changed_at:now,changed_by:actor.name||actor.id,production_data_preserved:true,warnings:['لم يتم حذف أو تحويل أي بيانات Production.','أي سجلات تشغيلية جديدة ستُوسم training بواسطة Trigger قاعدة البيانات.','العودة إلى Production تظل عبر بوابة الإطلاق الآمن فقط.']});
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/system/runtime-mode')return runtimeMode(request,env);return inventoryWorker.fetch(request,env,ctx)}};
