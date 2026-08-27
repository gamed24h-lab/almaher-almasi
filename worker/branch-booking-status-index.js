import appWorker from './refund-control-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));

const normalizeBranchBookingStatus=async request=>{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/customer/book')return request;
  let body;
  try{body=await request.clone().json()}catch{return request}
  const booking=body?.booking&&typeof body.booking==='object'?{...body.booking}:null;
  if(!booking||String(booking.source||'').trim().toLowerCase()!=='branch')return request;
  const status=String(booking.status||'').trim().toLowerCase();
  if(status&&status!=='new')return request;
  booking.status='confirmed';
  booking.booking_status='confirmed';
  const headers=new Headers(request.headers);
  headers.set('Content-Type','application/json');
  return new Request(request,{headers,body:JSON.stringify({...body,booking})});
};

async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    return (await r.json().catch(()=>({})))?.user||null;
  }catch{return null}
}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||String(a.role||'')==='مدير عام'||a.permissions?.all===true);
const canChangeStatus=a=>elevated(a)||a?.permissions?.editBookings===true||a?.permissions?.manageBookings===true;
const canAllBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function setBookingStatus(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canChangeStatus(actor))return json({error:'لا توجد صلاحية لتغيير حالة الحجز.'},403);
  const bookingNo=String(body?.booking_number||'').trim();
  const next=String(body?.status||'').trim().toLowerCase();
  if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
  if(!['new','confirmed'].includes(next))return json({error:'الحالة اليدوية المسموحة هي «جديد» أو «مؤكد». الإلغاء يتم من مسار إلغاء الحجز.'},400);
  const h=dbHeaders(env),b=base(env);
  const q=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id,status,booking_status&limit=1`,{headers:h});
  const rows=await parse(q);if(!q.ok)return json({error:rows?.message||'تعذر قراءة الحجز.'},502);
  const booking=Array.isArray(rows)?rows[0]:null;if(!booking)return json({error:'الحجز غير موجود.'},404);
  if(!canAllBranches(actor)&&String(booking.branch_id||'')!==String(actor.branch_id||''))return json({error:'لا يمكنك تغيير حالة حجز تابع لفرع آخر.'},403);
  const current=String(booking.status||booking.booking_status||'').toLowerCase();
  if(['cancelled','canceled','refunded'].includes(current))return json({error:'الحجز الملغي أو المسترد لا يُغيّر يدويًا من هنا. استخدم مسار إعادة التفعيل المخصص.'},409);
  if(current===next&&String(booking.booking_status||'').toLowerCase()===next)return json({ok:true,unchanged:true,status:next});
  const r=await fetch(`${b}/rest/v1/bookings?id=eq.${enc(booking.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({status:next,booking_status:next,last_modified_at:new Date().toISOString()})});
  const out=await parse(r);if(!r.ok)return json({error:out?.message||out?.details||'تعذر تحديث حالة الحجز.'},r.status>=500?502:r.status);
  const audit={actor_id:String(actor.id||''),actor_name:String(actor.name||actor.username||''),actor_role:String(actor.role||''),branch_id:booking.branch_id||actor.branch_id||null,action:'booking_status_changed',entity_type:'booking',entity_id:String(booking.id),metadata:{booking_number:bookingNo,before:current||null,after:next,source:'booking_status_control'}};
  try{await fetch(`${b}/rest/v1/activity_events`,{method:'POST',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify([audit])})}catch{}
  return json({ok:true,booking:Array.isArray(out)?out[0]:out,status:next});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      if(String(body?.action||'')==='set_booking_status')return setBookingStatus(request,env,body);
    }
    return appWorker.fetch(await normalizeBranchBookingStatus(request),env,ctx);
  }
};
