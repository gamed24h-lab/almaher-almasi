import appWorker from './trip-pricing-persist-index.js';

const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}

function pricingPatch(row={}){
  const patch={};
  if(has(row,'price_return_only'))patch.price_return_only=row.price_return_only===''||row.price_return_only==null?null:Number(row.price_return_only);
  if(has(row,'price_round_trip'))patch.price_round_trip=row.price_round_trip===''||row.price_round_trip==null?null:Number(row.price_round_trip);
  if(has(row,'price_shared_daily'))patch.price_shared_daily=row.price_shared_daily===''||row.price_shared_daily==null?null:Number(row.price_shared_daily);
  return patch;
}
async function routeIdFor(env,row,responseBody){
  const direct=responseBody?.row?.id||responseBody?.route?.id||responseBody?.id||row?.id;
  if(direct)return String(direct);
  const b=base(env);if(!b)return '';
  const name=String(row?.name||'').trim(),from=String(row?.from_destination_id||''),to=String(row?.to_destination_id||'');
  if(!name||!from||!to)return '';
  const r=await fetch(`${b}/rest/v1/destination_routes?name=eq.${enc(name)}&from_destination_id=eq.${enc(from)}&to_destination_id=eq.${enc(to)}&select=id&order=updated_at.desc&limit=1`,{headers:headers(env)});
  const a=await parse(r);return r.ok&&Array.isArray(a)&&a[0]?.id?String(a[0].id):'';
}
async function persistRoutePricing(env,row,responseBody){
  const patch=pricingPatch(row);if(!Object.keys(patch).length)return;
  const id=await routeIdFor(env,row,responseBody);if(!id)throw new Error('تعذر تحديد المسار لحفظ حقول التسعير الجديدة.');
  const r=await fetch(`${base(env)}/rest/v1/destination_routes?id=eq.${enc(id)}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify(patch)});
  if(!r.ok){const e=await parse(r);throw new Error(e?.message||e?.details||'تعذر حفظ تسعير المسار الجديد.')}
}
async function enrichCatalog(env,response){
  if(!response.ok)return response;
  const body=await response.clone().json().catch(()=>null);if(!body||!Array.isArray(body.routes))return response;
  const r=await fetch(`${base(env)}/rest/v1/destination_routes?select=id,price_return_only,price_round_trip,price_shared_daily&limit=2000`,{headers:headers(env)});
  const rows=await parse(r);if(!r.ok||!Array.isArray(rows))return response;
  const map=new Map(rows.map(x=>[String(x.id),x]));
  const routes=body.routes.map(x=>({...x,...(map.get(String(x.id))||{})}));
  const h=new Headers(response.headers);h.set('Content-Type','application/json; charset=utf-8');h.set('Cache-Control','no-store');
  return new Response(JSON.stringify({...body,routes}),{status:response.status,headers:h});
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname!=='/api/destinations')return appWorker.fetch(request,env,ctx);
  if(request.method==='GET')return enrichCatalog(env,await appWorker.fetch(request,env,ctx));
  if(request.method==='POST'){
    const body=await request.clone().json().catch(()=>null);
    const response=await appWorker.fetch(request,env,ctx);
    if(!response.ok||body?.action!=='save_route'||!body?.row)return response;
    const responseBody=await response.clone().json().catch(()=>({}));
    try{await persistRoutePricing(env,body.row,responseBody)}catch(error){return new Response(JSON.stringify({error:error?.message||'تعذر حفظ تسعير المسار.'}),{status:502,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
    return response;
  }
  return appWorker.fetch(request,env,ctx);
}};
