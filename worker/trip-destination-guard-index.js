import bookingVerifyWorker from './destination-pricing-persist-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const active=v=>v!==false&&String(v??'true').toLowerCase()!=='false';

async function destinationCatalog(env){
  const b=base(env);if(!b)return [];
  const r=await fetch(`${b}/rest/v1/travel_destinations?select=id,name,city,active`,{headers:headers(env)});
  const out=await parse(r);return r.ok&&Array.isArray(out)?out:[];
}
function matchesDestination(row,value){const v=norm(value);return !!v&&[row?.city,row?.name].some(x=>norm(x)===v)}
async function tripExists(env,row){
  const b=base(env),h=headers(env);if(!b)return false;
  const filters=[`from_city=eq.${encodeURIComponent(String(row.from_city||''))}`,`to_city=eq.${encodeURIComponent(String(row.to_city||''))}`,`departure_date=eq.${encodeURIComponent(String(row.departure_date||''))}`];
  if(row.branch_id)filters.push(`branch_id=eq.${encodeURIComponent(String(row.branch_id))}`);
  const r=await fetch(`${b}/rest/v1/trips?${filters.join('&')}&select=id,trip_code,departure_time,status&limit=10`,{headers:h});
  const out=await parse(r);if(!r.ok||!Array.isArray(out))return false;
  const t=String(row.departure_time||'').slice(0,5);
  return out.some(x=>String(x.id)!==String(row.id||'')&&String(x.status||'').toLowerCase()!=='cancelled'&&String(x.departure_time||'').slice(0,5)===t);
}
async function validateSyncTrips(env,body){
  const rows=Array.isArray(body?.rows)?body.rows:[];if(!rows.length)return null;
  const catalog=await destinationCatalog(env);
  for(const row of rows){
    const from=String(row?.from_city||'').trim(),to=String(row?.to_city||'').trim();
    if(!from||!to)return 'مدينة المغادرة والوجهة مطلوبتان.';
    if(norm(from)===norm(to))return 'مدينة المغادرة والوجهة يجب أن تكونا مختلفتين.';
    if(!row?.departure_date)return 'تاريخ الرحلة مطلوب.';
    const isNew=!row?.id;
    const fromRow=catalog.find(x=>matchesDestination(x,from));
    const toRow=catalog.find(x=>matchesDestination(x,to));
    if(isNew){
      if(!fromRow||!toRow)return 'لا يمكن إنشاء الرحلة لأن مدينة المغادرة أو الوجهة غير موجودة في إدارة الوجهات. استخدم «استيراد الموجود بالنظام» أو أضف الوجهة أولًا.';
      if(!active(fromRow.active)||!active(toRow.active))return 'لا يمكن إنشاء رحلة باستخدام وجهة موقوفة. فعّل الوجهة أولًا من إدارة الوجهات.';
    }else{
      if(fromRow&&!active(fromRow.active))return 'لا يمكن تعديل الرحلة إلى مدينة مغادرة موقوفة.';
      if(toRow&&!active(toRow.active))return 'لا يمكن تعديل الرحلة إلى وجهة موقوفة.';
    }
    if(await tripExists(env,row))return `يوجد بالفعل رحلة فعالة بنفس المسار والتاريخ والوقت${row.branch_id?' لنفس الفرع':''}.`;
  }
  return null;
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/admin'&&request.method==='POST'){
    const body=await request.clone().json().catch(()=>({}));
    if(String(body?.action||'')==='sync_trips'){
      if(!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات قاعدة البيانات على الخادم غير مكتملة.'},500);
      const error=await validateSyncTrips(env,body);if(error)return json({error},409);
    }
  }
  return bookingVerifyWorker.fetch(request,env,ctx);
}};