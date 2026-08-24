import appWorker from './housing-booking-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function bookingByNo(env,no){const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return null;const r=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=id,booking_number,branch_id,total_price,paid_amount,financial_status,status&limit=1`,{headers:headers(env)});const a=await parse(r);return r.ok&&Array.isArray(a)?a[0]||null:null}

async function validateBookingFinance(env,body){
  if(String(body?.action||'')!=='update_booking')return null;
  const input=body?.booking||{};
  const no=String(input.number||input.booking_number||'').trim();
  if(!no)return null;
  const old=await bookingByNo(env,no);if(!old)return null;
  const oldPaid=Number(old.paid_amount||0);
  const nextPaid=Number(input.paidAmount??input.paid_amount??oldPaid);
  const nextTotal=Number(input.totalPrice??input.total_price??old.total_price??0);
  if(!Number.isFinite(nextPaid)||nextPaid<0)return json({error:'المبلغ المدفوع غير صالح.'},400);
  if(!Number.isFinite(nextTotal)||nextTotal<0)return json({error:'إجمالي الحجز غير صالح.'},400);
  if(nextPaid>nextTotal+0.001)return json({error:`لا يمكن أن يكون المدفوع (${nextPaid.toFixed(2)}) أكبر من إجمالي الحجز (${nextTotal.toFixed(2)}).`},409);
  if(nextPaid<oldPaid-0.001)return json({error:'لا يمكن خفض المبلغ المدفوع من تعديل الحجز. استخدم إجراء «استرداد» ليتم إصدار سند وتسجيل العملية في السجل المالي.',code:'REFUND_WORKFLOW_REQUIRED',paid_amount:oldPaid},409);
  return null;
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/admin'&&request.method==='POST'){
    const body=await request.clone().json().catch(()=>({}));
    try{const guard=await validateBookingFinance(env,body);if(guard)return guard}catch(e){return json({error:e?.message||'تعذر التحقق من سلامة بيانات التحصيل.'},500)}
  }
  return appWorker.fetch(request,env,ctx);
}};
