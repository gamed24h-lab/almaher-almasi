import appWorker from './finance-integrity-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
const enc=v=>encodeURIComponent(String(v??''));
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
async function parse(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
async function bookingByNo(env,no){const b=base(env);if(!b||!env.SUPABASE_SERVICE_ROLE_KEY)return null;const r=await fetch(`${b}/rest/v1/bookings?booking_number=eq.${enc(no)}&select=id,booking_number,branch_id,customer_name,customer_phone,total_price,paid_amount,payment_method,payment_reference,financial_status,status&limit=1`,{headers:headers(env)});const a=await parse(r);return r.ok&&Array.isArray(a)?a[0]||null:null}
async function actorFrom(request,env){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env);if(!r.ok)return null;const b=await r.json().catch(()=>({}));return b?.user||null}catch{return null}}
const elevated=a=>!!a&&(String(a.role||'').toLowerCase()==='developer'||a.role==='مدير عام'||a.permissions?.all||a.permissions?.allBranchesFinance);
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
function explicitOrLegacy(actor,key,legacy=[]){if(elevated(actor))return true;const p=actor?.permissions||{};if(hasOwn(p,key))return p[key]===true;return legacy.some(k=>p[k]===true)}
const canViewReceipt=a=>!!a&&explicitOrLegacy(a,'viewPaymentReceipts',['finance','payments']);
const canPrintReceipt=a=>!!a&&explicitOrLegacy(a,'printPaymentReceipts',['finance','payments']);
const inScope=(a,branchId)=>!!a&&(elevated(a)||String(a.branch_id||'')===String(branchId||''));
function receiptNo(){const d=new Date(),ymd=d.toISOString().slice(0,10).replace(/-/g,'');const tail=(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`).replace(/-/g,'').slice(-8).toUpperCase();return `PAY-${ymd}-${tail}`}
async function insertTransaction(env,row){const b=base(env),h=headers(env);const attempts=[row,((({reference,...rest})=>rest))(row)];let last=null;for(const candidate of attempts){const r=await fetch(`${b}/rest/v1/transactions`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify(candidate)});const out=await parse(r);if(r.ok){const saved=Array.isArray(out)?out[0]||candidate:out;return {ok:true,row:saved}}last=out}return {ok:false,error:last?.message||last?.details||'تعذر إنشاء حركة التحصيل'}}
async function deleteTransaction(env,id){if(!id)return;const b=base(env),h=headers(env);await fetch(`${b}/rest/v1/transactions?id=eq.${enc(id)}`,{method:'DELETE',headers:h}).catch(()=>{})}
async function markPosted(env,id){if(!id)return false;const b=base(env),h=headers(env);const r=await fetch(`${b}/rest/v1/transactions?id=eq.${enc(id)}`,{method:'PATCH',headers:h,body:JSON.stringify({status:'posted'})});return r.ok}
async function audit(env,actor,booking,meta){const b=base(env),h=headers(env);await fetch(`${b}/rest/v1/activity_events`,{method:'POST',headers:h,body:JSON.stringify({actor_id:String(actor?.id||''),actor_name:String(actor?.name||''),actor_role:String(actor?.role||''),branch_id:booking.branch_id,entity_type:'booking',entity_id:String(booking.id),action:'payment_collected',metadata:meta,created_at:new Date().toISOString()})}).catch(()=>{})}
async function one(env,table,query){const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});const out=await parse(r);return r.ok&&Array.isArray(out)?out[0]||null:null}
async function receiptData(request,env,ref,mode='view'){
  const actor=await actorFrom(request,env);if(!actor)return {error:json({error:'انتهت الجلسة.'},401)};
  if(mode==='print'?!canPrintReceipt(actor):!canViewReceipt(actor))return {error:json({error:mode==='print'?'لا توجد صلاحية طباعة سندات القبض.':'لا توجد صلاحية عرض سندات القبض.'},403)};
  const tx=await one(env,'transactions',`reference=eq.${enc(ref)}&type=eq.payment&select=id,booking_id,branch_id,type,amount,status,reference,created_at&limit=1`);
  if(!tx)return {error:json({error:'سند القبض غير موجود.'},404)};if(!inScope(actor,tx.branch_id))return {error:json({error:'سند القبض خارج النطاق المالي لفرعك.'},403)};
  const booking=await one(env,'bookings',`id=eq.${enc(tx.booking_id)}&select=id,booking_number,branch_id,customer_name,customer_phone,total_price,paid_amount,payment_method,payment_reference,financial_status,status&limit=1`);
  const branch=tx.branch_id?await one(env,'branches',`id=eq.${enc(tx.branch_id)}&select=id,name,address,phone,whatsapp&limit=1`):null;
  const ev=await one(env,'activity_events',`entity_id=eq.${enc(tx.booking_id)}&action=eq.payment_collected&metadata->>receipt_no=eq.${enc(ref)}&select=actor_id,actor_name,actor_role,metadata,created_at&limit=1`).catch(()=>null);
  return {data:{receipt_no:ref,transaction:tx,booking,branch,collector:{id:ev?.actor_id||null,name:ev?.actor_name||null,role:ev?.actor_role||null},payment_method:ev?.metadata?.payment_method||booking?.payment_method||null,payment_reference:ev?.metadata?.payment_reference||booking?.payment_reference||null,previous_paid:Number(ev?.metadata?.previous_paid||0),new_paid:Number(ev?.metadata?.new_paid||booking?.paid_amount||0),created_at:ev?.created_at||tx.created_at}};
}
function receiptHtml(d,autoPrint=false){const b=d.booking||{},br=d.branch||{},tx=d.transaction||{};return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>سند قبض ${esc(d.receipt_no)}</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:Arial,Tahoma,sans-serif;color:#14213d;margin:0;background:#f8fafc}.toolbar{max-width:760px;margin:18px auto 8px;display:flex;gap:8px}.toolbar button{border:1px solid #cbd5e1;border-radius:9px;background:white;padding:9px 14px;cursor:pointer}.sheet{max-width:760px;margin:auto;background:white;border:1px solid #d9e1ea;border-radius:16px;padding:24px}.head{text-align:center;border-bottom:2px solid #14213d;padding-bottom:14px;margin-bottom:18px}.head h1{margin:0 0 6px;font-size:26px}.head p{margin:3px 0;color:#5b6472}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px}.item{border-bottom:1px solid #e6ebf0;padding:8px 0}.item span{display:block;color:#667085;font-size:12px}.item b{display:block;margin-top:4px}.amount{margin:20px 0;text-align:center;border:2px solid #14213d;border-radius:14px;padding:16px}.amount span{display:block;color:#667085}.amount strong{font-size:28px}.foot{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:30px}.sig{border-top:1px solid #667085;padding-top:8px;text-align:center;color:#667085}@media print{body{background:white}.toolbar{display:none}.sheet{border:0;border-radius:0;padding:0}}</style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / PDF</button><button onclick="window.close()">إغلاق</button></div><div class="sheet"><div class="head"><h1>سند قبض</h1><p>شركة الماهر الماسي</p><p>${esc(br.name||'')} ${br.address?`— ${esc(br.address)}`:''}</p></div><div class="grid"><div class="item"><span>رقم السند</span><b>${esc(d.receipt_no)}</b></div><div class="item"><span>التاريخ</span><b>${esc(new Date(d.created_at||Date.now()).toLocaleString('ar-SA'))}</b></div><div class="item"><span>رقم الحجز</span><b>${esc(b.booking_number||'—')}</b></div><div class="item"><span>العميل</span><b>${esc(b.customer_name||'—')}</b></div><div class="item"><span>الجوال</span><b>${esc(b.customer_phone||'—')}</b></div><div class="item"><span>طريقة الدفع</span><b>${esc(d.payment_method||'—')}</b></div><div class="item"><span>مرجع العملية</span><b>${esc(d.payment_reference||'—')}</b></div><div class="item"><span>الموظف</span><b>${esc(d.collector?.name||'—')}</b></div></div><div class="amount"><span>المبلغ المستلم</span><strong>${Number(tx.amount||0).toFixed(2)} ريال</strong></div><div class="grid"><div class="item"><span>المدفوع قبل العملية</span><b>${Number(d.previous_paid||0).toFixed(2)} ريال</b></div><div class="item"><span>المدفوع بعد العملية</span><b>${Number(d.new_paid||0).toFixed(2)} ريال</b></div><div class="item"><span>إجمالي الحجز</span><b>${Number(b.total_price||0).toFixed(2)} ريال</b></div><div class="item"><span>حالة الحركة</span><b>${esc(tx.status||'posted')}</b></div></div><div class="foot"><div class="sig">توقيع الموظف</div><div class="sig">توقيع العميل</div></div></div>${autoPrint?`<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))<\/script>`:''}</body></html>`}

export default {async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/api/payments/receipt'&&request.method==='GET'){
    const ref=String(u.searchParams.get('receipt_no')||'').trim();if(!ref)return json({error:'رقم سند القبض مطلوب.'},400);const r=await receiptData(request,env,ref,'view');if(r.error)return r.error;return json({ok:true,...r.data});
  }
  if(u.pathname==='/api/payments/receipt/view'&&request.method==='GET'){
    const ref=String(u.searchParams.get('receipt_no')||'').trim();if(!ref)return json({error:'رقم سند القبض مطلوب.'},400);const r=await receiptData(request,env,ref,'view');if(r.error)return r.error;return new Response(receiptHtml(r.data,false),{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"}});
  }
  if(u.pathname==='/api/payments/receipt/print'&&request.method==='GET'){
    const ref=String(u.searchParams.get('receipt_no')||'').trim();if(!ref)return json({error:'رقم سند القبض مطلوب.'},400);const r=await receiptData(request,env,ref,'print');if(r.error)return r.error;return new Response(receiptHtml(r.data,true),{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"}});
  }
  if(u.pathname==='/api/admin'&&request.method==='POST'){
    const body=await request.clone().json().catch(()=>({}));
    if(String(body?.action||'')==='update_booking'){
      const input=body?.booking||{};const no=String(input.number||input.booking_number||'').trim();
      if(no){
        const before=await bookingByNo(env,no);
        if(before){
          const oldPaid=Number(before.paid_amount||0),nextPaid=Number(input.paidAmount??input.paid_amount??oldPaid),delta=Number((nextPaid-oldPaid).toFixed(2));
          if(delta>0.001){
            const actor=await actorFrom(request,env);const ref=receiptNo();const ts=new Date().toISOString();
            const pending={booking_id:before.id,branch_id:before.branch_id,type:'payment',amount:delta,status:'pending',reference:ref,created_at:ts};
            const created=await insertTransaction(env,pending);
            if(!created.ok)return json({error:`تعذر تسجيل سند القبض قبل حفظ التحصيل: ${created.error}`,code:'PAYMENT_LEDGER_WRITE_FAILED'},500);
            const downstream=await appWorker.fetch(request,env,ctx);
            if(!downstream.ok){await deleteTransaction(env,created.row?.id);return downstream}
            const posted=await markPosted(env,created.row?.id);
            await audit(env,actor,before,{receipt_no:ref,amount:delta,previous_paid:oldPaid,new_paid:nextPaid,payment_method:input.paymentMethod||input.payment_method||before.payment_method||null,payment_reference:input.paymentReference||input.payment_reference||before.payment_reference||null,transaction_id:created.row?.id||null,ledger_status:posted?'posted':'pending'});
            const out=await downstream.clone().json().catch(()=>null);
            if(out&&typeof out==='object')return json({...out,payment_receipt:{receipt_no:ref,amount:delta,previous_paid:oldPaid,new_paid:nextPaid,transaction_id:created.row?.id||null,status:posted?'posted':'pending',view_url:`/api/payments/receipt/view?receipt_no=${encodeURIComponent(ref)}`,print_url:`/api/payments/receipt/print?receipt_no=${encodeURIComponent(ref)}`}},downstream.status);
            return downstream;
          }
        }
      }
    }
  }
  return appWorker.fetch(request,env,ctx);
}};
