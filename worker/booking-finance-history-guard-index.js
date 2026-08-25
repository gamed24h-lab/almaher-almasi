import appWorker from './customer-housing-access-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const n=v=>Number(v||0),s=v=>String(v??'');
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(s(a.role).toLowerCase()==='developer'||s(a.role)==='مدير عام'||a.permissions?.all===true);
const allBranches=a=>elevated(a)||a?.permissions?.allBranches===true;
const canDiscount=a=>elevated(a)||a?.permissions?.bookingDiscount===true;
const canCollect=a=>elevated(a)||a?.permissions?.payments===true;
async function bookingByNo(env,no){
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
 const r=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=id,booking_number,total_price,paid_amount&limit=1`,{headers:headers(env)});
 const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الحالة المالية للحجز.');
 return Array.isArray(out)?out[0]||null:null;
}
async function completedRefundTotal(env,booking){
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY||!booking?.id)return 0;
 const r=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${enc(booking.id)}&status=eq.completed&select=amount&limit=1000`,{headers:headers(env)});
 const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الاستردادات المكتملة للحجز.');
 return (Array.isArray(out)?out:[]).reduce((sum,row)=>sum+Math.max(0,n(row?.amount)),0);
}
function discountAmounts(input={}){
 const total=n(input.totalPrice??input.total_price);
 const original=n(input.originalPrice??input.original_price??input?.snapshot?.suggestedPrice??input?.snapshot?.originalPrice??total);
 return {total,original,discount:Math.max(0,original-total)};
}
async function discountGuard(request,env,input){
 const {total,original,discount}=discountAmounts(input);
 if(discount<=0.001)return null;
 const actor=await actorFrom(request,env);
 if(!actor)return json({error:'تطبيق خصم على الحجز يتطلب تسجيل الدخول وصلاحية مستقلة.',code:'BOOKING_DISCOUNT_AUTH_REQUIRED'},401);
 if(!canDiscount(actor))return json({error:'لا توجد لديك صلاحية منح خصم على الحجز. اعتمد السعر المقترح أو اطلب من مدير مخول تطبيق الخصم.',code:'BOOKING_DISCOUNT_FORBIDDEN',suggested_price:original,final_price:total,discount_amount:discount},403);
 return null;
}
async function refundSummaries(request,env){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'REFUND_SUMMARY_AUTH_REQUIRED'},401);
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'إعدادات قاعدة البيانات غير مكتملة.',code:'REFUND_SUMMARY_ENV_MISSING'},500);
 let q='status=eq.completed&select=booking_id,booking_number,branch_id,amount&limit=10000';
 if(!allBranches(actor)){const branch=s(actor.branch_id).trim();if(!branch)return json({ok:true,by_booking_id:{},by_booking_number:{},total_refunded:0});q+=`&branch_id=eq.${enc(branch)}`}
 const r=await fetch(`${url}/rest/v1/booking_refunds?${q}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)return json({error:out?.message||out?.details||'تعذر قراءة ملخص الاستردادات.',code:'REFUND_SUMMARY_READ_FAILED'},502);
 const byId={},byNo={};let total=0;for(const row of Array.isArray(out)?out:[]){const amount=Math.max(0,n(row.amount));total+=amount;const id=s(row.booking_id).trim(),no=s(row.booking_number).trim();if(id)byId[id]=n(byId[id])+amount;if(no)byNo[no]=n(byNo[no])+amount}
 return json({ok:true,by_booking_id:byId,by_booking_number:byNo,total_refunded:total});
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.pathname==='/api/bookings/refund-summaries')return refundSummaries(request,env);
 if(request.method==='POST'&&(u.pathname==='/api/admin'||u.pathname==='/api/customer/book')){
  const body=await request.clone().json().catch(()=>({}));
  const input=u.pathname==='/api/customer/book'?body?.booking||{}:String(body?.action||'')==='update_booking'?body?.booking||{}:null;
  if(input){const blocked=await discountGuard(request,env,input);if(blocked)return blocked}
  if(u.pathname==='/api/admin'&&String(body?.action||'')==='update_booking'){
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
     if(nextPaid>oldPaid+0.001){
      const actor=await actorFrom(request,env);
      if(!actor)return json({error:'تسجيل تحصيل جديد يتطلب جلسة مستخدم صالحة.',code:'PAYMENT_AUTH_REQUIRED'},401);
      if(!canCollect(actor))return json({error:'لا توجد لديك صلاحية التحصيل. يمكنك تعديل الحجز، لكن تسجيل مبلغ جديد يحتاج صلاحية «التحصيل».',code:'PAYMENT_PERMISSION_REQUIRED'},403);
      let refunded=0;
      try{refunded=await completedRefundTotal(env,before)}catch(e){return json({error:e?.message||'تعذر التحقق من الاستردادات السابقة.',code:'BOOKING_REFUND_GUARD_READ_FAILED'},502)}
      const maxGrossPaid=Math.max(oldPaid,nextTotal+refunded);
      if(nextPaid>maxGrossPaid+0.001){
       return json({error:'التحصيل الجديد يتجاوز المبلغ المطلوب بعد احتساب الاستردادات السابقة. أدخل فقط المبلغ الذي تم تحصيله الآن.',code:'OVER_COLLECTION_BLOCKED',paid_amount:oldPaid,refunded_amount:refunded,net_paid:Math.max(0,oldPaid-refunded),total_price:nextTotal,max_gross_paid:maxGrossPaid},409);
      }
     }
    }
   }
  }
 }
 return appWorker.fetch(request,env,ctx);
}};