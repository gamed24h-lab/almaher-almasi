import appWorker from './payment-ledger-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function actorFrom(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all||a.permissions?.allBranchesFinance);
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const canReconcile=a=>{if(!a)return false;if(elevated(a))return true;const p=a.permissions||{};if(hasOwn(p,'reconcileFinance'))return p.reconcileFinance===true;return !!(p.finance||p.reports)};
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);if(!r.ok)throw new Error(out?.message||out?.details||`تعذر قراءة ${table}`);return Array.isArray(out)?out:[]}
const sum=(arr,key='amount')=>Number(arr.reduce((n,x)=>n+Number(x?.[key]||0),0).toFixed(2));
const txKind=x=>String(x?.type??x?.transaction_type??x?.kind??x?.category??x?.action??'').trim().toLowerCase();
const txRef=x=>String(x?.reference??x?.reference_no??'').trim();
const isPayment=x=>txKind(x)==='payment'||txRef(x).startsWith('PAY-');
const isRefund=x=>['refund','refunded','refund_payment'].includes(txKind(x))||/^(REF|RFD|REFUND)-/i.test(txRef(x))||Number(x?.amount||0)<0;
const shiftStatus=x=>String(x?.status??x?.shift_status??'').trim().toLowerCase();
const shiftActual=x=>x?.actual_closing??x?.closing_balance??x?.actual_balance;
const shiftVariance=x=>Number(x?.variance??x?.difference??0);

async function reconcile(request,env){
  const actor=await actorFrom(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);if(!canReconcile(actor))return json({error:'لا توجد صلاحية مراجعة المطابقة المالية.'},403);
  const all=elevated(actor),branchId=all?String(new URL(request.url).searchParams.get('branch_id')||'').trim():String(actor.branch_id||'').trim();
  if(!all&&!branchId)return json({error:'حساب الموظف غير مرتبط بفرع.'},409);
  const scope=branchId?`branch_id=eq.${enc(branchId)}&`:'';
  try{
    const [transactions,expenses,registers]=await Promise.all([
      rows(env,'transactions',`${scope}select=*&order=created_at.desc&limit=2000`),
      rows(env,'expenses',`${scope}select=*&limit=2000`),
      rows(env,'cash_registers',`${scope}select=*&limit=500`)
    ]);
    const regIds=registers.map(x=>String(x.id)).filter(Boolean);
    const shifts=regIds.length?await rows(env,'cash_shifts',`register_id=in.(${regIds.join(',')})&select=*&limit=1000`):[];
    const posted=transactions.filter(x=>String(x.status||'posted').toLowerCase()==='posted');
    const pending=transactions.filter(x=>String(x.status||'').toLowerCase()==='pending');
    const payments=posted.filter(isPayment);
    const refunds=posted.filter(x=>!isPayment(x)&&isRefund(x));
    const otherIn=posted.filter(x=>!isPayment(x)&&!isRefund(x)&&Number(x.amount||0)>0);
    const now=Date.now();
    const stalePending=pending.filter(x=>{const t=Date.parse(x.created_at||'');return Number.isFinite(t)&&now-t>10*60*1000});
    const openShifts=shifts.filter(x=>shiftStatus(x)==='open');
    const closedMissingActual=shifts.filter(x=>shiftStatus(x)==='closed'&&(shiftActual(x)===null||shiftActual(x)===undefined));
    const varianceShifts=shifts.filter(x=>Math.abs(shiftVariance(x))>0.01);
    const paymentsWithoutReceipt=payments.filter(x=>!txRef(x).startsWith('PAY-'));
    const duplicateRefs=[];const refCount=new Map();for(const x of transactions){const r=txRef(x);if(!r)continue;refCount.set(r,(refCount.get(r)||0)+1)}for(const [reference,count] of refCount)if(count>1)duplicateRefs.push({reference,count});
    const collected=sum(payments),refundTotal=Number(refunds.reduce((n,x)=>n+Math.abs(Number(x.amount||0)),0).toFixed(2)),expenseTotal=sum(expenses),net=Number((collected+sum(otherIn)-refundTotal-expenseTotal).toFixed(2));
    return json({ok:true,scope:{all_branches:all&&!branchId,branch_id:branchId||null},summary:{posted_payments:payments.length,collected,refunds:refunds.length,refund_total:refundTotal,expenses:expenses.length,expense_total:expenseTotal,net_movement:net,open_shifts:openShifts.length,registers:registers.length,pending_transactions:pending.length},anomalies:{stale_pending_transactions:stalePending,payments_without_receipt:paymentsWithoutReceipt,duplicate_references:duplicateRefs,closed_shifts_missing_actual:closedMissingActual,shift_variances:varianceShifts},generated_at:new Date().toISOString()});
  }catch(e){return json({error:e?.message||'تعذر إجراء المطابقة المالية.'},502)}
}

export default {async fetch(request,env,ctx){const u=new URL(request.url);if(u.pathname==='/api/finance/reconcile'&&request.method==='GET')return reconcile(request,env);return appWorker.fetch(request,env,ctx)}};
