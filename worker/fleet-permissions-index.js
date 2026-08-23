import seatWorker from './seat-atomic-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await seatWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const has=(a,...keys)=>!!a&&(elevated(a)||keys.some(k=>!!a.permissions?.[k]));
const allBranches=a=>elevated(a)||!!a?.permissions?.allBranches;
const legacyFleet=a=>has(a,'fleet','vehicles');
function requiredPermission(table,action){
  if(table==='drivers'){
    if(action==='insert')return ['addDrivers','manageDrivers'];
    if(action==='update')return ['editDrivers','manageDrivers'];
    if(action==='delete')return ['deleteDrivers','manageDrivers'];
  }
  if(table==='vehicles'){
    if(action==='insert')return ['addVehicles','vehicles'];
    if(action==='update')return ['editVehicles','vehicles'];
    if(action==='delete')return ['deleteVehicles','vehicles'];
  }
  if(table==='trip_vehicles')return ['assignFleet','fleet','vehicles'];
  if(table==='vehicle_maintenance')return ['manageMaintenance','fleet','vehicles'];
  return null;
}

async function directDriverList(env,actor){
  const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  if(!allBranches(actor)&&!actor.branch_id)return json({error:'حساب الموظف غير مرتبط بفرع، لذلك لا يمكن تحديد نطاق السائقين.'},409);
  const params=new URLSearchParams();
  params.set('select','id,name,phone,national_id,license_no,license_expiry,status,notes,branch_id,created_at');
  params.set('order','name.asc');
  if(!allBranches(actor))params.set('branch_id',`eq.${actor.branch_id}`);
  const r=await fetch(`${b}/rest/v1/drivers?${params.toString()}`,{headers:headers(env)});
  const out=await parse(r);
  if(!r.ok)return json({error:out?.message||'تعذر قراءة قائمة السائقين.',code:'DRIVERS_READ_FAILED'},r.status>=400&&r.status<600?r.status:502);
  return json({ok:true,drivers:Array.isArray(out)?out:[],count:Array.isArray(out)?out.length:0,scope:allBranches(actor)?'all':'branch'});
}

async function directDriverWrite(request,env,actor,body){
  const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات Supabase على الخادم غير مكتملة.'},500);
  const action=String(body?.action||''),id=String(body?.id||''),h=headers(env);
  let row=body?.row&&typeof body.row==='object'?{...body.row}:{};

  if(!allBranches(actor)){
    if(!actor.branch_id)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
    if(action==='insert')row.branch_id=actor.branch_id;
    if(action==='update'||action==='delete'){
      if(!id)return json({error:'معرّف السائق مطلوب.'},400);
      const rr=await fetch(`${b}/rest/v1/drivers?id=eq.${encodeURIComponent(id)}&select=id,branch_id&limit=1`,{headers:h});
      const rb=await parse(rr);if(!rr.ok)return json({error:rb?.message||'تعذر التحقق من السائق.'},502);
      const current=Array.isArray(rb)?rb[0]:null;if(!current)return json({error:'السائق غير موجود.'},404);
      if(String(current.branch_id||'')!==String(actor.branch_id||''))return json({error:'لا يمكن تعديل أو حذف سائق تابع لفرع آخر.'},403);
      if(action==='update')row.branch_id=actor.branch_id;
    }
  }

  if(action==='insert'){
    const r=await fetch(`${b}/rest/v1/drivers`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);
    if(!r.ok)return json({error:out?.message||'تعذر إضافة السائق.'},r.status>=400&&r.status<600?r.status:502);
    const created=Array.isArray(out)?out[0]:out;
    if(!created?.id)return json({error:'تم إرسال طلب إضافة السائق لكن الخادم لم يرجع سجلًا يمكن التحقق منه.',code:'DRIVER_WRITE_UNVERIFIED'},502);
    return json({ok:true,row:created,verified:true});
  }
  if(action==='update'){
    if(!id)return json({error:'معرّف السائق مطلوب.'},400);
    const r=await fetch(`${b}/rest/v1/drivers?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);
    if(!r.ok)return json({error:out?.message||'تعذر تعديل السائق.'},r.status>=400&&r.status<600?r.status:502);
    const updated=Array.isArray(out)?out[0]:out;
    if(!updated?.id)return json({error:'تم إرسال تعديل السائق لكن الخادم لم يرجع السجل بعد التعديل.',code:'DRIVER_UPDATE_UNVERIFIED'},502);
    return json({ok:true,row:updated,verified:true});
  }
  if(action==='delete'){
    if(!id)return json({error:'معرّف السائق مطلوب.'},400);
    const r=await fetch(`${b}/rest/v1/drivers?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{...h,Prefer:'return=representation'}});const out=await parse(r);
    if(!r.ok)return json({error:out?.message||'تعذر حذف السائق. قد يكون مرتبطًا برحلة.'},r.status>=400&&r.status<600?r.status:502);
    const deleted=Array.isArray(out)?out[0]:out;
    if(!deleted?.id)return json({error:'لم يتم تأكيد حذف السائق من قاعدة البيانات.',code:'DRIVER_DELETE_UNVERIFIED'},502);
    return json({ok:true,row:deleted,verified:true});
  }
  return json({error:'عملية السائق غير مدعومة.'},400);
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/module'){
    if(request.method==='GET'){
      const resource=String(u.searchParams.get('resource')||'');
      if(resource==='drivers'){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        if(!(has(actor,'viewDrivers','addDrivers','editDrivers','deleteDrivers','manageDrivers')||legacyFleet(actor)))return json({error:'لا توجد صلاحية لعرض السائقين.'},403);
        return directDriverList(env,actor);
      }
      if(resource==='fleet'){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        if(!(has(actor,'viewFleet','fleet','vehicles','addVehicles','editVehicles','deleteVehicles','assignFleet','manageMaintenance')||has(actor,'viewDrivers','manageDrivers')))return json({error:'لا توجد صلاحية لعرض الأسطول.'},403);
      }
    }
    if(request.method==='POST'){
      const body=await request.clone().json().catch(()=>({}));const table=String(body?.table||''),action=String(body?.action||'');const need=requiredPermission(table,action);
      if(need){
        const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
        const allowed=has(actor,...need)||(table==='drivers'&&legacyFleet(actor));
        if(!allowed)return json({error:'لا توجد صلاحية لتنفيذ هذه العملية على الأسطول أو السائقين.'},403);
        // Granular driver permissions are enforced here directly so they do not fall through
        // to older generic fleet authorization that only understands legacy fleet/vehicles keys.
        if(table==='drivers')return directDriverWrite(request,env,actor,body);
      }
    }
  }
  return seatWorker.fetch(request,env,ctx);
 }
};
