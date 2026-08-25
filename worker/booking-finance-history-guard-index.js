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
const canReactivate=a=>elevated(a)||a?.permissions?.reactivateBooking===true;
const cancelled=b=>['cancelled','canceled','ملغي','ملغى'].includes(s(b?.status).trim().toLowerCase());
const grossPaidOf=b=>Math.max(n(b?.paid_amount),n(b?.snapshot?.finance?.grossPaidHistory));
async function bookingByNo(env,no){
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
 const r=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=id,booking_number,branch_id,trip_id,return_trip_id,customer_name,total_price,paid_amount,payment_method,status,snapshot&limit=1`,{headers:headers(env)});
 const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الحالة المالية للحجز.');
 return Array.isArray(out)?out[0]||null:null;
}
async function completedRefundTotal(env,booking){
 const url=base(env);if(!url||!env.SUPABASE_SERVICE_ROLE_KEY||!booking?.id)return 0;
 const r=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${enc(booking.id)}&status=eq.completed&select=amount&limit=1000`,{headers:headers(env)});
 const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الاستردادات المكتملة للحجز.');
 return (Array.isArray(out)?out:[]).reduce((sum,row)=>sum+Math.max(0,n(row?.amount)),0);
}
function receiptNo(){const ymd=new Date().toISOString().slice(0,10).replace(/-/g,'');const tail=(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`).replace(/-/g,'').slice(-8).toUpperCase();return `PAY-${ymd}-${tail}`}
async function insertPayment(env,booking,amount,ref){
 const url=base(env),h=headers(env),row={booking_id:booking.id,branch_id:booking.branch_id,transaction_type:'payment',amount,status:'pending',reference_no:ref,created_at:new Date().toISOString()};
 const r=await fetch(`${url}/rest/v1/transactions`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const out=await parse(r);
 if(r.ok)return Array.isArray(out)?out[0]||row:out;
 throw new Error(out?.message||out?.details||'تعذر إنشاء سند القبض.');
}
async function deletePayment(env,id){if(!id)return;await fetch(`${base(env)}/rest/v1/transactions?id=eq.${enc(id)}`,{method:'DELETE',headers:headers(env)}).catch(()=>{})}
async function markPaymentPosted(env,id){if(!id)return false;const r=await fetch(`${base(env)}/rest/v1/transactions?id=eq.${enc(id)}`,{method:'PATCH',headers:headers(env),body:JSON.stringify({status:'posted'})});return r.ok}
async function patchGrossHistory(env,bookingId,paid){
 const url=base(env),h=headers(env);
 const rr=await fetch(`${url}/rest/v1/bookings?id=eq.${enc(bookingId)}&select=snapshot&limit=1`,{headers:h});
 const rows=await parse(rr);if(!rr.ok)throw new Error(rows?.message||rows?.details||'تعذر قراءة Snapshot المالية للحجز.');
 const current=Array.isArray(rows)?rows[0]?.snapshot||{}:{};const snapshot=current&&typeof current==='object'?current:{};
 const nextSnapshot={...snapshot,finance:{...(snapshot.finance&&typeof snapshot.finance==='object'?snapshot.finance:{}),grossPaidHistory:paid,grossPaidHistoryUpdatedAt:new Date().toISOString()}};
 const r=await fetch(`${url}/rest/v1/bookings?id=eq.${enc(bookingId)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({snapshot:nextSnapshot,updated_at:new Date().toISOString()})});
 if(!r.ok){const out=await parse(r);throw new Error(out?.message||out?.details||'تعذر تثبيت إجمالي التحصيل التاريخي في Snapshot المالية.')}
}
async function auditPayment(env,actor,booking,meta){await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:headers(env),body:JSON.stringify({actor_id:s(actor?.id),actor_name:s(actor?.name),actor_role:s(actor?.role),branch_id:booking.branch_id,entity_type:'booking',entity_id:s(booking.id),action:'payment_collected',metadata:meta,created_at:new Date().toISOString()})}).catch(()=>{})}
async function auditReactivation(env,actor,booking){await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:headers(env),body:JSON.stringify({actor_id:s(actor?.id),actor_name:s(actor?.name),actor_role:s(actor?.role),branch_id:booking.branch_id,entity_type:'booking',entity_id:s(booking.id),action:'booking_reactivated',metadata:{booking_number:booking.booking_number,previous_status:booking.status,new_status:'confirmed',trip_id:booking.trip_id,return_trip_id:booking.return_trip_id},created_at:new Date().toISOString()})}).catch(()=>{})}
function requestWithPaid(request,body,paid){const original=body?.booking||{};const snap=original?.snapshot&&typeof original.snapshot==='object'&&!Array.isArray(original.snapshot)?{...original.snapshot,paidAmount:paid,paid_amount:paid}:original?.snapshot;const next={...body,booking:{...original,paidAmount:paid,paid_amount:paid,...(snap!==undefined?{snapshot:snap}:{})}};const h=new Headers(request.headers);h.delete('content-length');return new Request(request.url,{method:request.method,headers:h,body:JSON.stringify(next)})}
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
async function reactivateBooking(request,env,no){
 const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.',code:'BOOKING_REACTIVATION_AUTH_REQUIRED'},401);
 if(!canReactivate(actor))return json({error:'لا توجد لديك صلاحية إعادة تفعيل الحجوزات الملغية.',code:'BOOKING_REACTIVATION_FORBIDDEN'},403);
 let booking=null;try{booking=await bookingByNo(env,no)}catch(e){return json({error:e?.message||'تعذر قراءة الحجز.',code:'BOOKING_REACTIVATION_READ_FAILED'},502)}
 if(!booking)return json({error:'الحجز غير موجود.',code:'BOOKING_NOT_FOUND'},404);
 if(!allBranches(actor)&&s(actor.branch_id)!==s(booking.branch_id))return json({error:'الحجز خارج نطاق فرعك.',code:'BOOKING_REACTIVATION_BRANCH_FORBIDDEN'},403);
 if(!cancelled(booking))return json({error:'الحجز غير ملغي ولا يحتاج إعادة تفعيل.',code:'BOOKING_NOT_CANCELLED'},409);
 const payload={p_booking_number:no,p_booking:{status:'confirmed'},p_passengers:null,p_actor:{id:s(actor.id),name:s(actor.name),role:s(actor.role),action:'reactivate_booking'}};
 const r=await fetch(`${base(env)}/rest/v1/rpc/almaher_update_booking_atomic`,{method:'POST',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify(payload)});
 const out=await parse(r);if(!r.ok)return json({error:out?.message||out?.details||'تعذر إعادة تفعيل الحجز. تأكد من توفر مقاعد كافية في الرحلة.',code:'BOOKING_REACTIVATION_FAILED'},409);
 await auditReactivation(env,actor,booking);
 return json({ok:true,booking_number:no,status:'confirmed',message:'تمت إعادة تفعيل الحجز بنجاح. يمكنك تعديله الآن.',result:out});
}

export default {async fetch(request,env,ctx){
 const u=new URL(request.url);
 if(request.method==='GET'&&u.pathname==='/api/bookings/refund-summaries')return refundSummaries(request,env);
 if(request.method==='POST'&&(u.pathname==='/api/admin'||u.pathname==='/api/customer/book')){
  const body=await request.clone().json().catch(()=>({}));
  if(u.pathname==='/api/admin'&&String(body?.action||'')==='reactivate_booking'){
   const no=s(body?.booking_number||body?.number).trim();if(!no)return json({error:'رقم الحجز مطلوب.',code:'BOOKING_NUMBER_REQUIRED'},400);
   return reactivateBooking(request,env,no);
  }
  const input=u.pathname==='/api/customer/book'?body?.booking||{}:String(body?.action||'')==='update_booking'?body?.booking||{}:null;
  if(input){const blocked=await discountGuard(request,env,input);if(blocked)return blocked}
  if(u.pathname==='/api/admin'&&String(body?.action||'')==='update_booking'){
   const input=body?.booking||{};
   const no=String(input.number||input.booking_number||'').trim();
   if(no){
    let before=null;
    try{before=await bookingByNo(env,no)}catch(e){return json({error:e?.message||'تعذر التحقق من السجل المالي للحجز.',code:'BOOKING_FINANCE_GUARD_READ_FAILED'},502)}
    if(before){
     if(cancelled(before))return json({error:'الحجز ملغي ومتاح للعرض فقط. لا يمكن تعديل الرحلة أو السكن أو الركاب أو السعر أو التحصيل قبل إعادة التفعيل بإجراء مستقل.',code:'CANCELLED_BOOKING_READ_ONLY',booking_number:no},409);
     const storedPaid=n(before.paid_amount),oldPaid=grossPaidOf(before),oldTotal=n(before.total_price);
     const nextPaid=n(input.paidAmount??input.paid_amount??oldPaid);
     const nextTotal=n(input.totalPrice??input.total_price??oldTotal);
     let refunded=0;
     try{refunded=await completedRefundTotal(env,before)}catch(e){return json({error:e?.message||'تعذر التحقق من الاستردادات السابقة.',code:'BOOKING_REFUND_GUARD_READ_FAILED'},502)}
     if(nextPaid<oldPaid-0.001){
      return json({error:'لا يمكن تخفيض المبلغ المدفوع من تعديل الحجز. نفّذ أي مبلغ راجع للعميل من شاشة الاسترداد حتى يبقى السجل المالي وسند الاسترداد صحيحين.',code:'REFUND_REQUIRED',paid_amount:oldPaid},409);
     }
     if(nextPaid>oldPaid+0.001){
      const actor=await actorFrom(request,env);
      if(!actor)return json({error:'تسجيل تحصيل جديد يتطلب جلسة مستخدم صالحة.',code:'PAYMENT_AUTH_REQUIRED'},401);
      if(!canCollect(actor))return json({error:'لا توجد لديك صلاحية تحصيل دفعات الحجوزات. يمكنك تعديل الحجز بدون تسجيل دفعة جديدة.',code:'PAYMENT_PERMISSION_REQUIRED'},403);
      const maxGrossPaid=Math.max(oldPaid,nextTotal+refunded);
      if(nextPaid>maxGrossPaid+0.001){
       return json({error:'التحصيل الجديد يتجاوز المبلغ المطلوب بعد احتساب الاستردادات السابقة. أدخل فقط المبلغ الذي تم تحصيله الآن.',code:'OVER_COLLECTION_BLOCKED',paid_amount:oldPaid,refunded_amount:refunded,net_paid:Math.max(0,oldPaid-refunded),total_price:nextTotal,max_gross_paid:maxGrossPaid},409);
      }
      if(refunded>0.001&&nextPaid>nextTotal+0.001){
       const delta=Number((nextPaid-oldPaid).toFixed(2)),ref=receiptNo();let tx=null;
       try{tx=await insertPayment(env,before,delta,ref)}catch(e){return json({error:e?.message||'تعذر إنشاء سند القبض.',code:'PAYMENT_LEDGER_WRITE_FAILED'},500)}
       const downstream=await appWorker.fetch(requestWithPaid(request,body,storedPaid),env,ctx);
       if(!downstream.ok){await deletePayment(env,tx?.id);return downstream}
       try{await patchGrossHistory(env,before.id,nextPaid)}catch(e){await deletePayment(env,tx?.id);return json({error:e?.message||'تعذر تثبيت سجل التحصيل التاريخي بعد الاسترداد.',code:'REFUND_AWARE_GROSS_HISTORY_PATCH_FAILED'},502)}
       const posted=await markPaymentPosted(env,tx?.id);
       await auditPayment(env,actor,before,{receipt_no:ref,amount:delta,previous_paid:oldPaid,new_paid:nextPaid,stored_paid_amount:storedPaid,refunded_amount:refunded,net_paid_after:Math.max(0,nextPaid-refunded),payment_method:input.paymentMethod||input.payment_method||before.payment_method||null,payment_reference:input.paymentReference||input.payment_reference||null,transaction_id:tx?.id||null,ledger_status:posted?'posted':'pending'});
       const out=await downstream.clone().json().catch(()=>null);const receipt={receipt_no:ref,amount:delta,previous_paid:oldPaid,new_paid:nextPaid,transaction_id:tx?.id||null,status:posted?'posted':'pending',view_url:`/api/payments/receipt/view?receipt_no=${encodeURIComponent(ref)}`,print_url:`/api/payments/receipt/print?receipt_no=${encodeURIComponent(ref)}`};
       if(out&&typeof out==='object')return json({...out,payment_receipt:receipt,refund_aware_collection:true,gross_paid:nextPaid,refunded_amount:refunded,net_paid:Math.max(0,nextPaid-refunded)},downstream.status);
       return downstream;
      }
     }
     if(refunded>0.001&&oldPaid>storedPaid+0.001){
      return appWorker.fetch(requestWithPaid(request,body,storedPaid),env,ctx);
     }
    }
   }
  }
 }
 return appWorker.fetch(request,env,ctx);
}};