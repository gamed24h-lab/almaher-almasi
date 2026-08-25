import appWorker from './customer-housing-access-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const num=v=>Number(v||0);
const str=v=>String(v??'');
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}
const elevated=a=>!!a&&(a.role==='مدير عام'||str(a.role).toLowerCase()==='developer'||a.permissions?.all===true||a.permissions?.allBranchesFinance===true);
const canRequest=a=>!!a&&(elevated(a)||a.permissions?.refund_request===true||a.permissions?.refunds===true||a.permissions?.cancelBookings===true||a.permissions?.editBookings===true);
const canApprove=a=>!!a&&(elevated(a)||a.permissions?.refund_approve===true||(a.permissions?.refunds===true&&a.permissions?.approvals===true));
const canComplete=a=>!!a&&(elevated(a)||a.permissions?.refund_complete===true||a.permissions?.refunds===true);
const canView=a=>!!a&&(elevated(a)||a.permissions?.refund_view===true||canRequest(a)||canApprove(a)||canComplete(a));
const canPrint=a=>!!a&&(elevated(a)||a.permissions?.refund_print===true||canView(a));
const inScope=(a,row)=>!!a&&(elevated(a)||str(row?.branch_id)===str(a.branch_id));
const grossPaid=b=>Math.max(num(b?.paid_amount),num(b?.snapshot?.finance?.grossPaidHistory));
async function bookingByNo(env,no){
  const r=await fetch(`${base(env)}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=*&limit=1`,{headers:headers(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الحجز.');
  return Array.isArray(out)?out[0]||null:null;
}
async function refundById(env,id){
  const r=await fetch(`${base(env)}/rest/v1/booking_refunds?id=eq.${enc(id)}&select=*&limit=1`,{headers:headers(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة طلب الاسترداد.');
  return Array.isArray(out)?out[0]||null:null;
}
async function completedTotal(env,bookingId,excludeId=''){
  const r=await fetch(`${base(env)}/rest/v1/booking_refunds?booking_id=eq.${enc(bookingId)}&status=eq.completed&select=id,amount&limit=500`,{headers:headers(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||'تعذر قراءة الاستردادات المكتملة.');
  return (Array.isArray(out)?out:[]).filter(x=>!excludeId||str(x.id)!==str(excludeId)).reduce((sum,x)=>sum+num(x.amount),0);
}
function refundReceiptNo(){const ymd=new Date().toISOString().slice(0,10).replace(/-/g,'');const tail=(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`).replace(/-/g,'').slice(-6).toUpperCase();return `REF-${ymd}-${tail}`}
async function patchBookingFinancial(env,b,financialStatus,cancelBooking){
  const r=await fetch(`${base(env)}/rest/v1/bookings?id=eq.${enc(b.id)}`,{method:'PATCH',headers:headers(env),body:JSON.stringify({financial_status:financialStatus,...(cancelBooking?{status:'cancelled'}:{})})});
  if(!r.ok){const out=await parse(r);throw new Error(out?.message||out?.details||'تعذر تحديث الحالة المالية للحجز.')}
}
async function audit(env,actor,row,action,metadata){
  await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:headers(env),body:JSON.stringify({actor_id:str(actor?.id),actor_name:str(actor?.name),actor_role:str(actor?.role),branch_id:row?.branch_id||null,entity_type:'booking_refund',entity_id:str(row?.id),action,metadata,created_at:new Date().toISOString()})}).catch(()=>{});
}
async function handleQuote(request,env,body,booking){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'},401);
  if(!canRequest(actor))return json({error:'لا توجد صلاحية طلب استرداد'},403);
  if(!inScope(actor,booking))return json({error:'الحجز خارج النطاق المالي لفرعك'},403);
  const paid=grossPaid(booking),refunded=await completedTotal(env,booking.id),available=Math.max(0,paid-refunded);
  return json({ok:true,booking:{id:booking.id,booking_number:booking.booking_number,branch_id:booking.branch_id,customer_name:booking.customer_name,customer_phone:booking.customer_phone,status:booking.status,total_price:num(booking.total_price),paid_amount:paid},refunded_amount:refunded,available_refund:available,capabilities:{request:canRequest(actor),approve:canApprove(actor),complete:canComplete(actor),view:canView(actor),print:canPrint(actor)}});
}
async function handleRequest(request,env,body,booking){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'},401);
  if(!canRequest(actor))return json({error:'لا توجد صلاحية طلب استرداد'},403);
  if(!inScope(actor,booking))return json({error:'الحجز خارج النطاق المالي لفرعك'},403);
  const p=body||{},clientRequestId=str(p.client_request_id).trim().slice(0,120),h=headers(env),url=base(env);
  if(clientRequestId){
    const ir=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${enc(booking.id)}&metadata->>client_request_id=eq.${enc(clientRequestId)}&select=*&limit=1`,{headers:h});
    const ia=await parse(ir),existing=ir.ok&&Array.isArray(ia)?ia[0]||null:null;
    if(existing)return json({ok:true,refund:existing,receipt_no:existing.receipt_no,status:existing.status,idempotent:true,direct:existing.status==='completed'});
  }
  const or=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${enc(booking.id)}&status=in.(pending,approved)&select=id,receipt_no,status,amount&order=requested_at.desc&limit=1`,{headers:h});
  const oa=await parse(or),openRefund=or.ok&&Array.isArray(oa)?oa[0]||null:null;
  if(openRefund)return json({error:`يوجد بالفعل طلب استرداد مفتوح لهذا الحجز (${openRefund.receipt_no||''}). أكمله أو ارفضه قبل إنشاء طلب جديد.`,code:'REFUND_ALREADY_OPEN',refund:openRefund},409);
  const refunded=await completedTotal(env,booking.id),paid=grossPaid(booking),available=Math.max(0,paid-refunded),amount=num(p.amount);
  if(!(amount>0)||amount>available+0.001)return json({error:`مبلغ الاسترداد غير صالح. المتاح ${available.toFixed(2)} ريال`},400);
  const direct=!!(p.direct_execute&&canApprove(actor)&&canComplete(actor)),inlineApprove=!!(!direct&&p.inline_approve&&canApprove(actor));
  const receiptNo=refundReceiptNo(),ts=new Date().toISOString();
  const row={receipt_no:receiptNo,booking_id:booking.id,booking_number:booking.booking_number,branch_id:booking.branch_id,customer_name:booking.customer_name,customer_phone:booking.customer_phone,amount,paid_amount_snapshot:paid,previous_refunded_amount:refunded,reason:str(p.reason).trim()||'إلغاء/تسوية الحجز',refund_method:str(p.refund_method||'cash'),customer_ack_name:str(p.customer_ack_name||booking.customer_name),cancel_booking:!!p.cancel_booking,status:direct?'completed':inlineApprove?'approved':'pending',requested_by:str(actor.name||actor.id),requested_by_id:str(actor.id),requested_at:ts,...((direct||inlineApprove)?{decided_by:str(actor.name||actor.id),decided_by_id:str(actor.id),decided_at:ts,decision_notes:direct?'اعتماد وتنفيذ مباشر حسب صلاحية الموظف':'اعتماد مباشر حسب صلاحية الموظف'}:{}),...(direct?{completed_by:str(actor.name||actor.id),completed_by_id:str(actor.id),completed_at:ts}:{}),metadata:{source:'booking_editor',client_request_id:clientRequestId||null,direct_approval:direct||inlineApprove,direct_execution:direct}};
  const rr=await fetch(`${url}/rest/v1/booking_refunds`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(row)});const rb=await parse(rr);
  if(!rr.ok)return json({error:rb?.message||rb?.details||'تعذر إنشاء عملية الاسترداد'},500);
  const saved=Array.isArray(rb)?rb[0]:rb;
  if(direct){
    const totalAfter=refunded+amount,fin=totalAfter>=paid-0.001?'refunded':'partially_refunded';
    try{await patchBookingFinancial(env,booking,fin,row.cancel_booking)}catch(e){return json({error:e?.message||'تعذر تحديث الحالة المالية بعد الاسترداد'},502)}
    await audit(env,actor,saved,'refund_completed_direct',{booking_number:booking.booking_number,amount,receipt_no:receiptNo,financial_status:fin});
    return json({ok:true,refund:saved,receipt_no:receiptNo,status:'completed',direct:true,financial_status:fin});
  }
  if(!inlineApprove){
    const ar=await fetch(`${url}/rest/v1/approval_requests`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({request_type:'booking_refund',entity_type:'booking',entity_id:str(booking.id),branch_id:booking.branch_id,requested_by:str(actor.name||actor.id),approver_role:'manager',status:'pending',request_payload:{refund_id:saved?.id,receipt_no:receiptNo,booking_number:booking.booking_number,amount,reason:row.reason,refund_method:row.refund_method}})});
    const ab=await parse(ar);
    if(ar.ok&&saved?.id&&Array.isArray(ab)&&ab[0]?.id)await fetch(`${url}/rest/v1/booking_refunds?id=eq.${enc(saved.id)}`,{method:'PATCH',headers:h,body:JSON.stringify({approval_request_id:ab[0].id})});
  }
  await audit(env,actor,saved,inlineApprove?'refund_approved_direct':'refund_requested',{booking_number:booking.booking_number,amount,receipt_no:receiptNo});
  return json({ok:true,refund:saved,receipt_no:receiptNo,status:inlineApprove?'approved':'pending',direct:false,inline_approved:inlineApprove});
}
async function handleDecide(request,env,body,row,booking){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'},401);
  if(!canApprove(actor))return json({error:'اعتماد الاسترداد يتطلب صلاحية الإدارة/المرتجعات والموافقات'},403);
  if(!inScope(actor,row))return json({error:'خارج نطاقك المالي'},403);
  if(row.status!=='pending')return json({error:'تم اتخاذ قرار على الطلب سابقًا'},409);
  const decision=str(body?.decision).toLowerCase();if(!['approved','rejected'].includes(decision))return json({error:'قرار غير صالح'},400);
  if(decision==='approved'){
    const done=await completedTotal(env,row.booking_id,row.id),available=Math.max(0,grossPaid(booking)-done);
    if(num(row.amount)>available+0.001)return json({error:`المتاح للاسترداد تغير وأصبح ${available.toFixed(2)} ريال`},409);
  }
  const patch={status:decision,decision_notes:str(body?.notes),decided_by:str(actor.name||actor.id),decided_by_id:str(actor.id),decided_at:new Date().toISOString()},h=headers(env),url=base(env);
  const rr=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${enc(row.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(patch)});const rb=await parse(rr);
  if(!rr.ok)return json({error:rb?.message||rb?.details||'تعذر حفظ القرار'},500);
  if(row.approval_request_id)await fetch(`${url}/rest/v1/approval_requests?id=eq.${enc(row.approval_request_id)}`,{method:'PATCH',headers:h,body:JSON.stringify({status:decision==='approved'?'approved':'rejected',approver_id:str(actor.id),decision_notes:str(body?.notes),decided_at:new Date().toISOString()})}).catch(()=>{});
  return json({ok:true,row:Array.isArray(rb)?rb[0]:rb});
}
async function handleComplete(request,env,body,row,booking){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'},401);
  if(!canComplete(actor))return json({error:'لا توجد صلاحية تنفيذ الاسترداد'},403);
  if(!inScope(actor,row))return json({error:'خارج نطاقك المالي'},403);
  if(row.status!=='approved')return json({error:'يجب اعتماد الطلب قبل تنفيذ الاسترداد'},409);
  const done=await completedTotal(env,row.booking_id,row.id),paid=grossPaid(booking),available=Math.max(0,paid-done);
  if(num(row.amount)>available+0.001)return json({error:`المبلغ المتاح حاليًا ${available.toFixed(2)} ريال`},409);
  const completedAt=new Date().toISOString(),h=headers(env),url=base(env);
  const rr=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${enc(row.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=representation'},body:JSON.stringify({status:'completed',completed_by:str(actor.name||actor.id),completed_by_id:str(actor.id),completed_at:completedAt,customer_ack_name:str(body?.customer_ack_name||row.customer_ack_name||row.customer_name)})});const rb=await parse(rr);
  if(!rr.ok)return json({error:rb?.message||rb?.details||'تعذر إتمام الاسترداد'},500);
  const totalAfter=done+num(row.amount),fin=totalAfter>=paid-0.001?'refunded':'partially_refunded';
  try{await patchBookingFinancial(env,booking,fin,row.cancel_booking)}catch(e){return json({error:e?.message||'تعذر تحديث الحالة المالية بعد الاسترداد'},502)}
  await audit(env,actor,row,'refund_completed',{booking_number:row.booking_number,amount:num(row.amount),receipt_no:row.receipt_no});
  return json({ok:true,row:Array.isArray(rb)?rb[0]:rb,financial_status:fin});
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(request.method!=='POST'||u.pathname!=='/api/admin')return appWorker.fetch(request,env,ctx);
  const body=await request.clone().json().catch(()=>({})),action=str(body?.action);
  if(!['refund_quote','refund_request','refund_decide','refund_complete'].includes(action))return appWorker.fetch(request,env,ctx);
  try{
    if(action==='refund_quote'||action==='refund_request'){
      const no=str(body?.booking_number||body?.bookingNo).trim();if(!no)return appWorker.fetch(request,env,ctx);
      const booking=await bookingByNo(env,no);if(!booking)return appWorker.fetch(request,env,ctx);
      if(grossPaid(booking)<=num(booking.paid_amount)+0.001)return appWorker.fetch(request,env,ctx);
      return action==='refund_quote'?handleQuote(request,env,body,booking):handleRequest(request,env,body,booking);
    }
    const id=str(body?.id).trim();if(!id)return appWorker.fetch(request,env,ctx);
    const row=await refundById(env,id);if(!row)return appWorker.fetch(request,env,ctx);
    const booking=await bookingByNo(env,row.booking_number);if(!booking||grossPaid(booking)<=num(booking.paid_amount)+0.001)return appWorker.fetch(request,env,ctx);
    return action==='refund_decide'?handleDecide(request,env,body,row,booking):handleComplete(request,env,body,row,booking);
  }catch(e){return json({error:e?.message||'تعذر التحقق من سجل التحصيل التاريخي للاسترداد.',code:'REFUND_GROSS_HISTORY_GUARD_FAILED'},502)}
}};
