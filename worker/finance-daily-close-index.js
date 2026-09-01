import appWorker from './finance-daily-cash-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const txt=v=>String(v??'').trim(),low=v=>txt(v).toLowerCase(),enc=v=>encodeURIComponent(String(v??''));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const elevated=u=>!!u&&(low(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranchesFinance===true);
const canView=u=>!!u&&(elevated(u)||u.permissions?.finance===true||u.permissions?.payments===true||u.permissions?.viewPayments===true||u.permissions?.reports===true);
const canClose=u=>!!u&&(elevated(u)||u.permissions?.closeFinanceDay===true||u.permissions?.manageFinance===true);
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
async function rows(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)}),b=await readJson(r);if(!r.ok)throw new Error(b?.message||b?.details||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[]}
function dayWindow(key){if(!/^\d{4}-\d{2}-\d{2}$/.test(key))throw Object.assign(new Error('تاريخ التسوية غير صالح.'),{status:400});const [y,m,d]=key.split('-').map(Number);return {from:new Date(Date.UTC(y,m-1,d-1,21)).toISOString(),to:new Date(Date.UTC(y,m-1,d,21)).toISOString()}}
function inWindow(v,from,to){if(!v)return false;const t=new Date(v).getTime();return Number.isFinite(t)&&t>=new Date(from).getTime()&&t<new Date(to).getTime()}
function txType(r){return low(r?.transaction_type||r?.type||r?.kind)}
function isPayment(r){return txType(r)==='payment'||txt(r?.reference_no||r?.reference).startsWith('PAY-')}
function posted(r){return !['pending','failed','cancelled','canceled','reversed'].includes(low(r?.status||'posted'))}
async function scopeBranch(env,me,requested){if(!elevated(me))return txt(me.branch_id);const id=txt(requested);if(!id)throw Object.assign(new Error('اختر الفرع قبل فحص تسوية اليوم.'),{status:400});const b=(await rows(env,'branches',`id=eq.${enc(id)}&select=id,name&limit=1`))[0];if(!b)throw Object.assign(new Error('الفرع غير موجود.'),{status:404});return id}
async function snapshot(env,branchId,key){
 const {from,to}=dayWindow(key);
 const [transactions,registers,shifts,refunds,events]=await Promise.all([
  rows(env,'transactions',`branch_id=eq.${enc(branchId)}&created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=*&order=created_at.asc&limit=5000`),
  rows(env,'cash_registers',`branch_id=eq.${enc(branchId)}&select=*&limit=500`),
  rows(env,'cash_shifts',`select=*&order=opened_at.asc&limit=5000`),
  rows(env,'booking_refunds',`branch_id=eq.${enc(branchId)}&select=*&order=created_at.asc&limit=5000`),
  rows(env,'activity_events',`branch_id=eq.${enc(branchId)}&action=eq.payment_collected&created_at=gte.${enc(from)}&created_at=lt.${enc(to)}&select=id,created_at,actor_id,actor_name,entity_id,metadata&order=created_at.asc&limit=5000`)
 ]);
 const regIds=new Set(registers.map(r=>txt(r.id)));
 const dayShifts=shifts.filter(s=>regIds.has(txt(s.register_id))&&(inWindow(s.opened_at,from,to)||inWindow(s.closed_at,from,to)||(low(s.status||'open')==='open'&&new Date(s.opened_at||0)<new Date(to))));
 const openShifts=dayShifts.filter(s=>low(s.status||'open')==='open');
 const varianceShifts=dayShifts.filter(s=>low(s.status)==='closed'&&Math.abs(num(s.variance))>.01);
 const pendingTx=transactions.filter(r=>low(r.status)==='pending');
 const payments=transactions.filter(r=>isPayment(r)&&posted(r));
 const eventRefs=new Set(events.map(e=>txt(e.metadata?.receipt_no)).filter(Boolean));
 const unattributed=payments.filter(p=>{const ref=txt(p.reference_no);return ref&&!eventRefs.has(ref)});
 const openRefunds=refunds.filter(r=>!['completed','rejected','reversed','cancelled','canceled'].includes(low(r.status))&&new Date(r.created_at||r.requested_at||0)<new Date(to));
 const blockers={open_shifts:openShifts.length,pending_transactions:pendingTx.length,open_refunds:openRefunds.length,unattributed_payments:unattributed.length};
 const warnings={variance_shifts:varianceShifts.length,variance_total:varianceShifts.reduce((n,s)=>n+Math.abs(num(s.variance)),0)};
 const blockerCount=Object.values(blockers).reduce((a,b)=>a+num(b),0);
 return {date:key,branch_id:branchId,from,to,ready:blockerCount===0,blocker_count:blockerCount,warning_count:warnings.variance_shifts,blockers,warnings,totals:{posted_payments:payments.reduce((n,r)=>n+num(r.amount),0),unattributed_payments:unattributed.reduce((n,r)=>n+num(r.amount),0)},details:{open_shifts:openShifts.slice(0,30),pending_transactions:pendingTx.slice(0,30),open_refunds:openRefunds.slice(0,30),unattributed_payments:unattributed.slice(0,30),variance_shifts:varianceShifts.slice(0,30)}}
}
function fingerprint(s){return JSON.stringify({b:s.blockers,w:s.warnings,p:Number(s.totals?.posted_payments||0).toFixed(2),u:Number(s.totals?.unattributed_payments||0).toFixed(2)})}
async function latestClose(env,branchId,key){return (await rows(env,'activity_events',`branch_id=eq.${enc(branchId)}&action=eq.finance_daily_close&metadata->>date=eq.${enc(key)}&select=id,created_at,actor_id,actor_name,actor_role,metadata&order=created_at.desc&limit=1`))[0]||null}
async function state(env,me,branchId,key){const snap=await snapshot(env,branchId,key),closed=await latestClose(env,branchId,key);let closure=null;if(closed){closure={id:closed.id,created_at:closed.created_at,actor_id:closed.actor_id,actor_name:closed.actor_name,actor_role:closed.actor_role,note:closed.metadata?.note||null,stale:txt(closed.metadata?.fingerprint)!==fingerprint(snap),snapshot:closed.metadata?.snapshot||null}}return {ok:true,snapshot:snap,closure,can_close:canClose(me),scope:{branch_id:branchId,all_branches:elevated(me)}}}
async function approve(env,me,branchId,key,note){const st=await state(env,me,branchId,key),snap=st.snapshot;if(snap.blocker_count>0)throw Object.assign(new Error('لا يمكن اعتماد تسوية اليوم قبل معالجة جميع الموانع.'),{status:409,data:st});if(snap.warning_count>0&&txt(note).length<5)throw Object.assign(new Error('توجد فروقات ورديات؛ اكتب ملاحظة تسوية واضحة قبل الاعتماد.'),{status:409,data:st});const payload={actor_id:txt(me.id),actor_name:txt(me.name||me.username||me.id),actor_role:txt(me.role),branch_id:branchId,action:'finance_daily_close',entity_type:'finance_day',entity_id:`${branchId}:${key}`,metadata:{source:'finance_360',date:key,note:txt(note).slice(0,1500)||null,fingerprint:fingerprint(snap),snapshot:{blockers:snap.blockers,warnings:snap.warnings,totals:snap.totals}}};const r=await fetch(`${base(env)}/rest/v1/activity_events`,{method:'POST',headers:{...headers(env),Prefer:'return=representation'},body:JSON.stringify([payload])}),out=await readJson(r);if(!r.ok)throw new Error(out?.message||out?.details||'تعذر اعتماد تسوية اليوم.');return state(env,me,branchId,key)}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname!=='/api/admin'||request.method!=='POST')return appWorker.fetch(request,env,ctx);const body=await request.clone().json().catch(()=>({})),action=txt(body.action);if(!['finance_daily_close_state','finance_daily_close_approve'].includes(action))return appWorker.fetch(request,env,ctx);const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);if(!canView(me))return json({error:'لا توجد صلاحية لعرض تسوية نهاية اليوم'},403);try{const key=txt(body.date),branchId=await scopeBranch(env,me,body.branch_id);if(action==='finance_daily_close_state')return json(await state(env,me,branchId,key));if(!canClose(me))return json({error:'لا توجد صلاحية اعتماد تسوية نهاية اليوم'},403);return json(await approve(env,me,branchId,key,body.note))}catch(e){return json({error:e.message||'تعذر تنفيذ تسوية نهاية اليوم',...(e.data||{})},e.status||500)}}};
