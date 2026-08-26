import appWorker from './booking-verify-index.js';

const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);

async function persistTripPricing(rows,env){
  const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY)return;
  for(const row of rows||[]){
    const code=String(row?.trip_code||'').trim();if(!code)continue;
    const patch={};
    if(has(row,'price_return_only'))patch.price_return_only=row.price_return_only===''||row.price_return_only==null?null:Number(row.price_return_only);
    if(has(row,'price_round_trip'))patch.price_round_trip=row.price_round_trip===''||row.price_round_trip==null?null:Number(row.price_round_trip);
    if(has(row,'price_shared_daily'))patch.price_shared_daily=row.price_shared_daily===''||row.price_shared_daily==null?null:Number(row.price_shared_daily);
    if(!Object.keys(patch).length)continue;
    const r=await fetch(`${url}/rest/v1/trips?trip_code=eq.${enc(code)}`,{method:'PATCH',headers:{...headers(env),Prefer:'return=minimal'},body:JSON.stringify(patch)});
    if(!r.ok){const t=await r.text();throw new Error(t||`Unable to persist modular pricing for ${code}`)}
  }
}

export default {async fetch(request,env,ctx){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/api/admin')return appWorker.fetch(request,env,ctx);
  const body=await request.clone().json().catch(()=>null);
  if(body?.action!=='sync_trips'||!Array.isArray(body?.rows))return appWorker.fetch(request,env,ctx);
  const response=await appWorker.fetch(request,env,ctx);
  if(!response.ok)return response;
  try{await persistTripPricing(body.rows,env)}catch(error){return new Response(JSON.stringify({error:error?.message||'تعذر حفظ حقول التسعير الجديدة.'}),{status:502,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
  return response;
}};
