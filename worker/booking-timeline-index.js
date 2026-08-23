import fleetWorker from './fleet-permissions-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await fleetWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all);
const allBranches=a=>elevated(a)||!!a?.permissions?.allBranches;
const canView=a=>elevated(a)||!!a?.permissions?.viewBookingActivity||!!a?.permissions?.viewBookings||!!a?.permissions?.editBookings||!!a?.permissions?.branchBooking;
const text=v=>String(v??'');
const ts=v=>v?new Date(v).toISOString():null;

function eventLabel(action,entityType=''){
 const a=text(action).toLowerCase(),e=text(entityType).toLowerCase();
 if(/customer_book|create_booking|booking_created|insert_booking/.test(a))return 'إنشاء الحجز';
 if(/update_booking|booking_update|edit_booking/.test(a))return 'تعديل الحجز';
 if(/refund/.test(a+e))return 'استرداد / تعديل استرداد';
 if(/payment|transaction|receipt|collect/.test(a+e))return 'تحصيل / حركة مالية';
 if(/seat/.test(a+e))return 'تغيير مقعد';
 if(/room|housing|accommodation/.test(a+e))return 'تغيير التسكين';
 if(/passenger/.test(a+e))return 'تعديل بيانات مسافر';
 if(/scan|qr/.test(a+e))return 'مسح QR / حركة ركوب';
 if(/cancel/.test(a))return 'إلغاء';
 if(/approve/.test(a+e))return 'اعتماد';
 return action||'نشاط على الحجز';
}

async function bookingTimeline(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
 if(!canView(actor))return json({error:'لا توجد صلاحية لعرض سجل نشاط الحجز.'},403);
 const u=new URL(request.url),bookingNo=text(u.searchParams.get('bookingNo')).trim();if(!bookingNo)return json({error:'رقم الحجز مطلوب.'},400);
 const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات قاعدة البيانات على الخادم غير مكتملة.'},500);
 const h=headers(env);
 const br=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=*&limit=1`,{headers:h});const bb=await parse(br);const booking=Array.isArray(bb)?bb[0]:null;
 if(!br.ok)return json({error:bb?.message||'تعذر قراءة الحجز.'},502);if(!booking)return json({error:'الحجز غير موجود.'},404);
 if(!allBranches(actor)&&actor.branch_id&&String(booking.branch_id||'')!==String(actor.branch_id))return json({error:'لا توجد صلاحية لعرض نشاط حجز تابع لفرع آخر.'},403);
 const ar=await fetch(`${b}/rest/v1/activity_events?select=id,actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata,created_at&order=created_at.asc&limit=2000`,{headers:h});const ab=await parse(ar);
 let audit=ar.ok&&Array.isArray(ab)?ab:[];
 const bookingId=text(booking.id);
 audit=audit.filter(x=>{
   const m=x?.metadata&&typeof x.metadata==='object'?x.metadata:{};
   return [x.entity_id,m.booking_id,m.bookingId,m.booking_number,m.bookingNumber,m.entity_id].some(v=>text(v)===bookingId||text(v)===bookingNo);
 });
 const events=audit.map(x=>({
   id:`audit-${x.id}`,kind:'audit',title:eventLabel(x.action,x.entity_type),action:x.action||'',entity_type:x.entity_type||'',actor_name:x.actor_name||'',actor_role:x.actor_role||'',created_at:ts(x.created_at),metadata:x.metadata||{}
 }));
 if(booking.created_at)events.push({id:`booking-created-${booking.id}`,kind:'booking',title:'إنشاء الحجز',action:'booking_created',entity_type:'bookings',actor_name:booking.created_by||'',actor_role:'',created_at:ts(booking.created_at),metadata:{status:booking.status,total_price:booking.total_price,paid_amount:booking.paid_amount}});
 events.sort((a,b2)=>String(a.created_at||'').localeCompare(String(b2.created_at||'')));
 return json({ok:true,booking:{id:booking.id,booking_number:booking.booking_number,customer_name:booking.customer_name,branch_id:booking.branch_id,status:booking.status,created_at:booking.created_at},events,count:events.length,audit_available:ar.ok});
}

export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/bookings/timeline'&&request.method==='GET')return bookingTimeline(request,env);
  return fleetWorker.fetch(request,env,ctx);
 }
};
