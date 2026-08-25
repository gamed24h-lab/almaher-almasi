import appWorker from './customer-housing-access-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const n=v=>Number(v||0);
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function bookingByNo(env,no){
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
 const r=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=id,booking_number,total_price,paid_amount&limit=1`,{headers:headers(env)});
 const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الحالة المالية للحجز.');
 return Array.isArray(out)?out[0]||null:null;
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='POST'&&u.pathname==='/api/admin'){
  const body=await request.clone().json().catch(()=>({}));
  if(String(body?.action||'')==='update_booking'){
   const input=body?.booking||{};
   const no=String(input.number||input.booking_number||'').trim();
   if(no){
    let before=null;
    try{before=await bookingByNo(env,no)}catch(e){return json({error:e?.message||'تعذر التحقق من السجل المالي للحجز.',code:'BOOKING_FINANCE_GUARD_READ_FAILED'},502)}
    if(before){
     const oldPaid=n(before.paid_amount),oldTotal=n(before.total_price);
     const nextPaid=n(input.paidAmount??input.paid_amount??oldPaid);
     const nextTotal=n(input.totalPrice??input.total_price??oldTotal);
     if(nextPaid<oldPaid-0.001){
      return json({error:'لا يمكن تخفيض المبلغ المدفوع من تعديل الحجز. نفّذ أي مبلغ راجع للعميل من شاشة الاسترداد حتى يبقى السجل المالي وسند الاسترداد صحيحين.',code:'REFUND_REQUIRED',paid_amount:oldPaid},409);
     }
     if(nextPaid>oldPaid+0.001&&nextPaid>Math.max(oldPaid,nextTotal)+0.001){
      return json({error:'لا يمكن تسجيل تحصيل جديد يتجاوز إجمالي الحجز. إذا انخفض سعر الحجز وأصبح المدفوع السابق أعلى من الإجمالي، اترك المدفوع كما هو ونفّذ الفرق من شاشة الاسترداد.',code:'OVER_COLLECTION_BLOCKED',paid_amount:oldPaid,total_price:nextTotal},409);
     }
    }
   }
  }
 }
 return appWorker.fetch(request,env,ctx);
}};
