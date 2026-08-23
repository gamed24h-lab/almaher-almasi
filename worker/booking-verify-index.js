import appWorker from './strict-permissions-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
const text=v=>String(v??'').trim();
const num=v=>Number(v??0);
const close=(a,b)=>Math.abs(num(a)-num(b))<0.001;

function descriptor(path,body={}){
  if(path==='/api/customer/book'){
    const b=body?.booking||{};
    return {kind:'create',number:text(b.booking_number||b.number),expected:b};
  }
  if(path==='/api/admin'&&String(body?.action||'').toLowerCase()==='update_booking'){
    const b=body?.booking||{};
    return {kind:'update',number:text(b.booking_number||b.number),expected:b};
  }
  return null;
}

async function verifyBooking(env,d){
  if(!d?.number||!base(env)||!env.SUPABASE_SERVICE_ROLE_KEY)return {ok:false,reason:'verification_context_missing'};
  const r=await fetch(`${base(env)}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(d.number)}&select=id,booking_number,trip_id,return_trip_id,customer_name,customer_phone,customer_identity,total_price,paid_amount,status&limit=1`,{headers:headers(env)});
  const b=await parse(r);if(!r.ok||!Array.isArray(b)||!b[0])return {ok:false,reason:'booking_not_found'};
  const row=b[0],e=d.expected||{};
  const expectedTrip=text(e.trip_id||e.tripId),expectedName=text(e.customer_name||e.name),expectedPhone=text(e.customer_phone||e.phone),expectedIdentity=text(e.customer_identity||e.identity);
  if(expectedTrip&&text(row.trip_id)!==expectedTrip)return {ok:false,reason:'trip_mismatch'};
  if(expectedName&&text(row.customer_name)!==expectedName)return {ok:false,reason:'name_mismatch'};
  if(expectedPhone&&text(row.customer_phone)!==expectedPhone)return {ok:false,reason:'phone_mismatch'};
  if(expectedIdentity&&text(row.customer_identity)!==expectedIdentity)return {ok:false,reason:'identity_mismatch'};
  if(e.total_price!==undefined||e.totalPrice!==undefined){const v=e.total_price??e.totalPrice;if(!close(row.total_price,v))return {ok:false,reason:'total_mismatch'}}
  if(e.paid_amount!==undefined||e.paidAmount!==undefined){const v=e.paid_amount??e.paidAmount;if(!close(row.paid_amount,v))return {ok:false,reason:'paid_mismatch'}}
  return {ok:true,row};
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(request.method==='POST'&&(u.pathname==='/api/customer/book'||u.pathname==='/api/admin')){
      const body=await request.clone().json().catch(()=>({}));
      const d=descriptor(u.pathname,body);
      if(d){
        const response=await appWorker.fetch(request,env,ctx);
        if(!response.ok)return response;
        const verified=await verifyBooking(env,d);
        if(!verified.ok)return json({error:'تم تنفيذ طلب الحجز على الخادم لكن تعذر التحقق من حفظ البيانات النهائية. حدّث الصفحة وراجع الحجز قبل إعادة المحاولة.',code:'BOOKING_WRITE_NOT_VERIFIED',verification:verified.reason},502);
        const out=await parse(response.clone());
        return json({...out,verified:true,verified_booking_id:verified.row.id},response.status||200);
      }
    }
    return appWorker.fetch(request,env,ctx);
  }
};
