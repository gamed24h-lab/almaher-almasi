import appWorker from './finance-monthly-close-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim(),low=v=>txt(v).toLowerCase(),enc=v=>encodeURIComponent(String(v??''));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const elevated=u=>!!u&&(low(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranchesFinance===true);
const canView=u=>!!u&&(elevated(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.viewPayments===true||u.permissions?.reports===true);
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)}),b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
function monthWindow(month){if(!/^\d{4}-\d{2}$/.test(month))throw Object.assign(new Error('الشهر غير صالح.'),{status:400});const [y,m]=month.split('-').map(Number);return {from:new Date(Date.UTC(y,m-1,0,21)).toISOString(),to:new Date(Date.UTC(y,m,0,21)).toISOString()}}
function inWindow(v,from,to){if(!v)return false;const t=new Date(v).getTime();return Number.isFinite(t)&&t>=new Date(from).getTime()&&t<new Date(to).getTime()}
function txType(r){return low(r?.transaction_type||r?.type||r?.kind)}
function isPayment(r){return txType(r)==='payment'||txt(r?.reference_no||r?.reference).startsWith('PAY-')}
function posted(r){return !['pending','failed','cancelled','canceled','reversed'].includes(low(r?.status||'posted'))}
function refundDate(r){return r?.completed_at||r?.processed_at||r?.updated_at||r?.created_at||r?.requested_at||null}
function activeBooking(r){return !['cancelled','canceled','deleted','refunded'].includes(low(r?.status))}
async function monthlyCloseState(request,env,ctx,month,branchId){const r=await appWorker.fetch(new Request(new URL('/api/admin',request.url),{method:'POST',headers:{...Object.fromEntries(request.headers.entries()),'Content-Type':'application/json'},body:JSON.stringify({action:'finance_monthly_close_state',month,branch_id:branchId})}),env,ctx),b=await readJson(r);if(!r.ok)throw Object.assign(new Error(b?.error||'تعذر تحميل حالة الإقفال الشهري'),{status:r.status});return b}
async function summary(request,env,ctx,me,body){const month=txt(body.month),branchId=elevated(me)?txt(body.branch_id):txt(me.branch_id);if(!branchId)throw Object.assign(new Error('اختر الفرع للملخص الشهري.'),{status:400});const {from,to}=monthWindow(month),scope=`branch_id=eq.${enc(branchId)}&`;
 const [transactions,refunds,expenses,bookings,payables,closeState]=await Promise.all([
  rows(env,'transactions',`${scope}created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=*&order=created_at.asc&limit=8000`),
  rows(env,'booking_refunds',`${scope}select=*&order=created_at.asc&limit=8000`),
  rows(env,'expenses',`${scope}select=*&order=expense_date.asc&limit=8000`),
  rows(env,'bookings',`${scope}select=id,booking_number,customer_name,customer_phone,status,total_price,paid_amount,created_at&limit=8000`),
  rows(env,'supplier_payables',`${scope}select=*&limit=8000`).catch(()=>[]),
  monthlyCloseState(request,env,ctx,month,branchId)
 ]);
 const payments=transactions.filter(r=>isPayment(r)&&posted(r));
 const completedRefunds=refunds.filter(r=>low(r.status)==='completed'&&inWindow(refundDate(r),from,to));
 const monthExpenses=expenses.filter(r=>String(r.expense_date||r.created_at||'').slice(0,7)===month);
 const collected=Number(payments.reduce((a,r)=>a+Math.max(0,num(r.amount)),0).toFixed(2));
 const refunded=Number(completedRefunds.reduce((a,r)=>a+Math.max(0,num(r.amount)),0).toFixed(2));
 const expenseTotal=Number(monthExpenses.reduce((a,r)=>a+Math.max(0,num(r.amount)),0).toFixed(2));
 const netCollected=Number((collected-refunded).toFixed(2)),netMovement=Number((netCollected-expenseTotal).toFixed(2));
 const active=bookings.filter(activeBooking),receivables=Number(active.reduce((a,r)=>a+Math.max(0,num(r.total_price)-num(r.paid_amount)),0).toFixed(2));
 const receivableBookings=active.filter(r=>Math.max(0,num(r.total_price)-num(r.paid_amount))>.001).length;
 const openPayables=payables.filter(r=>!['paid','closed','cancelled','canceled'].includes(low(r.status))&&Math.max(0,num(r.amount)-num(r.paid_amount))>.001);
 const supplierOutstanding=Number(openPayables.reduce((a,r)=>a+Math.max(0,num(r.amount)-num(r.paid_amount)),0).toFixed(2));
 const topReceivables=active.map(r=>({...r,remaining:Number(Math.max(0,num(r.total_price)-num(r.paid_amount)).toFixed(2))})).filter(r=>r.remaining>.001).sort((a,b)=>b.remaining-a.remaining).slice(0,10).map(r=>({booking_id:r.id,booking_number:r.booking_number,customer_name:r.customer_name||'',customer_phone:r.customer_phone||'',remaining:r.remaining}));
 return {ok:true,month,branch_id:branchId,period:{from,to},flows:{collected,refunds:refunded,net_collected:netCollected,expenses:expenseTotal,net_movement:netMovement,payment_count:payments.length,refund_count:completedRefunds.length,expense_count:monthExpenses.length},positions:{receivables,receivable_bookings:receivableBookings,supplier_payables:supplierOutstanding,supplier_payable_items:openPayables.length},close:{summary:closeState.summary||{},ready:!!closeState.summary?.ready},top_receivables:topReceivables,generated_at:new Date().toISOString(),scope:{branch_id:branchId,all_branches:elevated(me)}}}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);const body=await request.clone().json().catch(()=>({}));if(txt(body.action)!=='finance_monthly_management_summary')return appWorker.fetch(request,env,ctx);const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);if(!canView(me))return json({error:'لا توجد صلاحية لعرض الملخص المالي الشهري'},403);try{return json(await summary(request,env,ctx,me,body))}catch(e){return json({error:e.message||'تعذر تحميل الملخص المالي الشهري'},e.status||500)}}};
