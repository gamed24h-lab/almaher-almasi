import appWorker from './branch-booking-status-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const dbHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const low=v=>String(v??'').trim().toLowerCase();
const txt=v=>String(v??'').trim();

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function rows(env,table,query){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:dbHeaders(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);
  return Array.isArray(out)?out:[];
}
async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    return (await r.json().catch(()=>({})))?.user||null;
  }catch{return null}
}
const elevated=a=>!!a&&(low(a.role)==='developer'||String(a.role||'')==='مدير عام'||a.permissions?.all===true);
const canAllBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canWrite=a=>elevated(a)||a?.permissions?.editBookings===true||a?.permissions?.manageBookings===true;
const actorBranch=a=>txt(a?.branch_id||a?.branchId);

async function bookingForActor(env,actor,bookingNo){
  const booking=(await rows(env,'bookings',`booking_number=eq.${enc(bookingNo)}&select=id,booking_number,branch_id,status,booking_status&limit=1`))[0]||null;
  if(!booking)return {error:json({error:'الحجز غير موجود.'},404)};
  if(!canAllBranches(actor)&&txt(booking.branch_id)!==actorBranch(actor))return {error:json({error:'هذا الحجز خارج نطاق فرعك.'},403)};
  return {booking};
}

function noteRow(r){
  const m=r?.metadata&&typeof r.metadata==='object'?r.metadata:{};
  return {
    id:r?.id||null,
    booking_number:txt(m.booking_number),
    note:txt(m.note),
    category:txt(m.category)||'operations',
    priority:txt(m.priority)||'normal',
    actor_name:txt(r?.actor_name)||'النظام',
    actor_role:txt(r?.actor_role),
    created_at:r?.created_at||null
  };
}

async function listNotes(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  const bookingNo=txt(body?.booking_number);
  if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
  const access=await bookingForActor(env,actor,bookingNo);
  if(access.error)return access.error;
  const booking=access.booking;
  const notes=await rows(env,'activity_events',`entity_type=eq.booking&entity_id=eq.${enc(booking.id)}&action=eq.booking_internal_note&select=id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at&order=created_at.desc&limit=100`);
  return json({ok:true,booking_number:bookingNo,can_write:canWrite(actor),notes:notes.map(noteRow)});
}

async function addNote(request,env,body){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!canWrite(actor))return json({error:'لا توجد صلاحية لإضافة ملاحظات على الحجز.'},403);
  const bookingNo=txt(body?.booking_number);
  const note=txt(body?.note);
  const category=low(body?.category)||'operations';
  const priority=low(body?.priority)||'normal';
  if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
  if(!note)return json({error:'اكتب الملاحظة أولًا.'},400);
  if(note.length>2000)return json({error:'الملاحظة طويلة جدًا. الحد الأقصى 2000 حرف.'},400);
  if(!['operations','finance','customer','housing','seats','other'].includes(category))return json({error:'تصنيف الملاحظة غير صالح.'},400);
  if(!['normal','important'].includes(priority))return json({error:'أولوية الملاحظة غير صالحة.'},400);
  const access=await bookingForActor(env,actor,bookingNo);
  if(access.error)return access.error;
  const booking=access.booking;
  const payload={
    actor_id:txt(actor.id),
    actor_name:txt(actor.name||actor.username)||'موظف',
    actor_role:txt(actor.role),
    branch_id:booking.branch_id||actorBranch(actor)||null,
    action:'booking_internal_note',
    entity_type:'booking',
    entity_id:txt(booking.id),
    metadata:{booking_number:bookingNo,note,category,priority,visibility:'internal',source:'booking_360'}
  };
  const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...dbHeaders(env),Prefer:'return=representation'},body:JSON.stringify([payload])});
  const out=await parse(r);
  if(!r.ok)return json({error:out?.message||out?.details||'تعذر حفظ الملاحظة.'},r.status>=500?502:r.status);
  const saved=Array.isArray(out)?out[0]:out;
  return json({ok:true,note:noteRow(saved)});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/admin'){
      const body=await request.clone().json().catch(()=>({}));
      const action=txt(body?.action);
      if(action==='booking_internal_notes')return listNotes(request,env,body);
      if(action==='booking_internal_note_add')return addNote(request,env,body);
    }
    return appWorker.fetch(request,env,ctx);
  }
};
