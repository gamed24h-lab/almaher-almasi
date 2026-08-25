import appWorker from './booking-finance-history-guard-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const lower=v=>String(v??'').trim().toLowerCase();
const elevated=a=>!!a&&(lower(a.role)==='developer'||a.role==='مدير عام'||a.permissions?.all||a.permissions?.allBranchesFinance);
const bookingActive=b=>!['cancelled','canceled','deleted','refunded'].includes(lower(b?.status));
const bookingGross=b=>Math.max(0,num(b?.paid_amount),num(b?.snapshot?.finance?.grossPaidHistory));

async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){
  try{
    const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}
async function rows(env,table,query){
  const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});
  const out=await parse(r);
  if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);
  return Array.isArray(out)?out:[];
}
function refundMap(refunds){
  const m=new Map();
  for(const r of refunds||[]){
    const id=String(r.booking_id||'');if(!id)continue;
    m.set(id,Number(((m.get(id)||0)+Math.max(0,num(r.amount))).toFixed(2)));
  }
  return m;
}
function bookingFinanceRow(b,refundsByBooking){
  const total=Math.max(0,num(b.total_price));
  const gross=bookingGross(b);
  const refund=Math.max(0,num(refundsByBooking.get(String(b.id))||0));
  const net=Number((gross-refund).toFixed(2));
  const paid=Math.max(0,net);
  const remaining=Math.max(0,Number((total-paid).toFixed(2)));
  return {id:b.id,booking_number:b.booking_number,branch_id:b.branch_id,status:b.status,financial_status:b.financial_status,total,gross,refund,net,paid,remaining};
}
function mismatch(x){
  const reasons=[];
  if(x.refund>x.gross+0.001)reasons.push('الاسترداد أكبر من إجمالي التحصيل التاريخي');
  if(x.total<=0.001&&x.refund>0.001)reasons.push('يوجد استرداد على حجز بدون قيمة');
  if(['cancelled','canceled','refunded'].includes(lower(x.status))&&x.gross>0.001&&x.refund>=x.gross-0.001&&lower(x.financial_status)!=='refunded')reasons.push('الحجز مسترد بالكامل لكن الحالة المالية لا تعكس ذلك');
  if(bookingActive(x)&&lower(x.financial_status)==='paid'&&x.remaining>0.001)reasons.push('الحالة المالية مسدد رغم وجود مبلغ متبقٍ');
  return reasons.length?{booking_id:x.id,booking_number:x.booking_number,reasons}:null;
}
async function executiveBrief(request,env){
  const actor=await actorFrom(request,env);
  if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!elevated(actor)&&!actor?.permissions?.reports&&!actor?.permissions?.finance)return json({error:'Reports permission required'},403);
  const all=elevated(actor);
  const branchId=all?String(new URL(request.url).searchParams.get('branch_id')||'').trim():String(actor?.branch_id||'').trim();
  if(!all&&!branchId)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
  const scope=branchId?`branch_id=eq.${enc(branchId)}&`:'';
  try{
    const [bookings,refunds,expenses,trips,failed]=await Promise.all([
      rows(env,'bookings',`${scope}select=id,booking_number,branch_id,status,financial_status,total_price,paid_amount,snapshot,created_at,trip_id&limit=5000`),
      rows(env,'booking_refunds',`${scope}status=eq.completed&select=id,booking_id,booking_number,branch_id,amount,status&limit=5000`),
      rows(env,'expenses',`${scope}select=id,branch_id,amount,expense_date,trip_id&limit=5000`),
      rows(env,'trips',`${scope}select=id,trip_code,departure_date,status,bus_capacity,remaining_seats,branch_id&limit=1000`),
      // notifications has no branch_id column in the live schema; this warning is global only.
      rows(env,'notifications','status=eq.failed&select=id&limit=1000')
    ]);
    const rmap=refundMap(refunds),financeRows=bookings.map(b=>bookingFinanceRow(b,rmap));
    const revenue=Number(financeRows.reduce((n,x)=>n+x.total,0).toFixed(2));
    const grossCollected=Number(financeRows.reduce((n,x)=>n+x.gross,0).toFixed(2));
    const refunded=Number(refunds.reduce((n,x)=>n+Math.max(0,num(x.amount)),0).toFixed(2));
    const netCollected=Number((grossCollected-refunded).toFixed(2));
    const expense=Number(expenses.reduce((n,x)=>n+Math.max(0,num(x.amount)),0).toFixed(2));
    const outstanding=Number(financeRows.filter(bookingActive).reduce((n,x)=>n+x.remaining,0).toFixed(2));
    const activeNetPaid=Number(financeRows.filter(bookingActive).reduce((n,x)=>n+x.paid,0).toFixed(2));
    const mismatches=financeRows.map(mismatch).filter(Boolean);
    const today=new Date().toISOString().slice(0,10);
    const upcoming=trips.filter(t=>t.departure_date>=today&&!['cancelled','completed','closed'].includes(lower(t.status))).sort((a,b)=>String(a.departure_date).localeCompare(String(b.departure_date))).slice(0,10);
    const warnings=[];
    if(outstanding>0)warnings.push(`متبقي تحصيل ${outstanding.toFixed(2)}`);
    if(refunded>0)warnings.push(`استردادات مكتملة ${refunded.toFixed(2)}`);
    if(mismatches.length)warnings.push(`${mismatches.length} حالة عدم تطابق مالي`);
    if(failed.length)warnings.push(`${failed.length} إشعار فشل`);
    return json({bookings:bookings.length,revenue,paid:grossCollected,gross_collected:grossCollected,refunded,refund_total:refunded,net:netCollected,net_collected:netCollected,active_net_paid:activeNetPaid,outstanding,expenses:expense,net_after_expenses:Number((netCollected-expense).toFixed(2)),upcoming,warnings,financial_mismatches:mismatches.length,generated_at:new Date().toISOString()});
  }catch(e){return json({error:e?.message||'تعذر تحميل الملخص المالي الموحد.'},502)}
}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/mega'){
    let action=String(u.searchParams.get('action')||'');
    if(request.method==='POST'){
      const body=await request.clone().json().catch(()=>({}));
      action=String(body?.action||action);
    }
    if(action==='executive_brief')return executiveBrief(request,env);
  }
  return appWorker.fetch(request,env,ctx);
}};
