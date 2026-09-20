import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,Banknote,Download,Printer,RefreshCw,RotateCcw,Scale,WalletCards} from 'lucide-react';
import {api} from '../../lib/api.js';
import {money,statusLabel} from '../../lib/format.js';
import {basicPrintDocument,printHtmlDocument} from '../../lib/print.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const dt=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const TYPES={
 opening_balance:'رصيد افتتاحي',booking_charge:'تحميل حجز',booking_adjustment:'تعديل قيمة حجز',booking_reversal:'عكس حجز',
 payment:'دفعة من الوكيل',commission:'عمولة للوكيل',discount:'خصم للوكيل',refund:'استرداد / تسوية للوكيل',
 adjustment_debit:'تسوية مدينة',adjustment_credit:'تسوية دائنة',reversal:'عكس حركة'
};
const MANUAL=[
 ['payment','دفعة من الوكيل — Credit'],
 ['commission','عمولة للوكيل — Credit'],
 ['discount','خصم للوكيل — Credit'],
 ['refund','استرداد / تسوية للوكيل — Credit'],
 ['adjustment_debit','تسوية مدينة — Debit'],
 ['adjustment_credit','تسوية دائنة — Credit']
];
const METHODS=[['cash','نقدي'],['bank_transfer','تحويل بنكي'],['card','بطاقة / مدى'],['wallet','محفظة'],['other','أخرى']];
const systemType=t=>['opening_balance','booking_charge','booking_adjustment','booking_reversal','reversal'].includes(String(t||''));
const balanceLabel=n=>Number(n)>0?'مدين للشركة':Number(n)<0?'دائن للوكيل':'متزن';

export default function AgentLedgerPanel({agent,bookings=[],go,onChanged}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [filter,setFilter]=useState({q:'',type:'',direction:'',from:'',to:''});
 const [modal,setModal]=useState(''),[postType,setPostType]=useState('payment'),[saving,setSaving]=useState(false),[reverseRow,setReverseRow]=useState(null);

 async function load(){
  if(!agent?.id)return;
  setBusy(true);setError('');
  try{setData(await api.agentLedger(agent.id))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[agent?.id]);

 const rows=useMemo(()=>{
  const q=lower(filter.q),from=filter.from?new Date(filter.from+'T00:00:00').getTime():null,to=filter.to?new Date(filter.to+'T23:59:59').getTime():null;
  return (data?.entries||[]).filter(r=>{
   if(filter.type&&r.entry_type!==filter.type)return false;
   if(filter.direction&&r.direction!==filter.direction)return false;
   const t=r.created_at?new Date(r.created_at).getTime():0;
   if(from&&t<from)return false;if(to&&t>to)return false;
   if(!q)return true;
   return [r.reference_no,TYPES[r.entry_type],r.reason,r.payment_method,r.actor_name,r.booking?.booking_number,r.booking?.customer_name,r.amount,r.balance_after].some(v=>lower(v).includes(q));
  });
 },[data,filter]);

 const typeOptions=useMemo(()=>[...new Set((data?.entries||[]).map(x=>x.entry_type))].map(v=>({value:v,label:TYPES[v]||v})),[data]);
 const columns=[
  {key:'created_at',label:'التاريخ',render:r=>dt(r.created_at)},
  {key:'reference',label:'المرجع',render:r=><div><strong>{r.reference_no}</strong>{r.reversed&&<div><Badge tone="blue">تم عكسها</Badge></div>}</div>},
  {key:'type',label:'الحركة',render:r=><Badge tone={r.direction==='debit'?'orange':'green'}>{TYPES[r.entry_type]||r.entry_type}</Badge>},
  {key:'booking',label:'الحجز',render:r=>r.booking?<button type="button" className="link-button" onClick={()=>go?.('/bookings/'+encodeURIComponent(r.booking.booking_number))}>{r.booking.booking_number}</button>:'—'},
  {key:'debit',label:'مدين',render:r=>r.direction==='debit'?<strong>{money(r.amount)}</strong>:'—'},
  {key:'credit',label:'دائن',render:r=>r.direction==='credit'?<strong>{money(r.amount)}</strong>:'—'},
  {key:'balance',label:'الرصيد بعد الحركة',render:r=><div><strong>{money(r.balance_after)}</strong><div className="muted-small">{balanceLabel(r.balance_after)}</div></div>},
  {key:'reason',label:'البيان',render:r=><div>{r.reason||'—'}<div className="muted-small">{r.actor_name||'النظام'}</div></div>},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button title="طباعة سند الحركة" onClick={()=>printReceipt(r)}><Printer size={14}/> سند</Button>{data?.capabilities?.reverse&&!systemType(r.entry_type)&&!r.reversed&&<Button title="عكس الحركة" onClick={()=>{setReverseRow(r);setModal('reverse')}}><RotateCcw size={14}/> عكس</Button>}</div>}
 ];

 function printReceipt(r){
  const isPayment=r.entry_type==='payment';
  const title=isPayment?'سند قبض من وكيل':r.entry_type==='refund'?'سند استرداد / تسوية وكيل':'سند حركة حساب وكيل';
  const body=`<div class="doc"><div class="head"><img src="/almaher-logo.jpeg"><div><h1>شركة الماهر الماسي</h1><h2>${esc(title)}</h2></div></div>
  <div class="grid">
   <div class="box"><small>رقم السند / المرجع</small><b>${esc(r.reference_no)}</b></div>
   <div class="box"><small>التاريخ</small><b>${esc(dt(r.created_at))}</b></div>
   <div class="box"><small>كود الوكيل</small><b>${esc(agent.agent_code||'—')}</b></div>
   <div class="box"><small>الوكيل</small><b>${esc(agent.company_name||agent.name||'—')}</b></div>
   <div class="box amount"><small>المبلغ</small><b>${esc(money(r.amount))}</b><span>${r.direction==='debit'?'مدين':'دائن'}</span></div>
   <div class="box"><small>نوع الحركة</small><b>${esc(TYPES[r.entry_type]||r.entry_type)}</b></div>
   <div class="box"><small>الحجز</small><b>${esc(r.booking?.booking_number||'—')}</b></div>
   <div class="box"><small>طريقة الدفع</small><b>${esc(r.payment_method||'—')}</b></div>
   <div class="box"><small>البيان / السبب</small><b>${esc(r.reason||'—')}</b></div>
   <div class="box"><small>الرصيد بعد الحركة</small><b>${esc(money(r.balance_after))}</b></div>
   <div class="box"><small>منفذ الحركة</small><b>${esc(r.actor_name||'النظام')}</b></div>
   <div class="box"><small>البيئة</small><b>${esc(data?.data_environment==='production'?'Production':'Training')}</b></div>
  </div><div class="sign"><div>توقيع / ختم الشركة</div><div>توقيع الوكيل / المستلم</div></div></div>`;
  const html=basicPrintDocument({title:`${title} ${r.reference_no}`,body,styles:'.doc{min-height:250mm;border:1.5px solid #c7a14a;border-radius:18px;padding:16mm}.head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #123b72;padding-bottom:12px}.head img{width:120px}.head h1,.head h2{margin:2px 0}.head h1{color:#123b72}.head h2{color:#a7802d}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}.box{border:1px solid #dde4ed;border-radius:10px;padding:10px}.box small{display:block;color:#718096;margin-bottom:5px}.amount{grid-column:1/-1;background:#faf6ea;border-color:#c7a14a;font-size:20px;display:flex;justify-content:space-between;align-items:end}.amount small{font-size:12px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:55px;text-align:center}.sign div{border-top:1px solid #777;padding-top:8px}'});
  printHtmlDocument(html,{title});
 }
 function printStatement(){
  const s=data?.summary||{};
  const table=rows.map(r=>`<tr><td>${esc(dt(r.created_at))}</td><td>${esc(r.reference_no)}</td><td>${esc(TYPES[r.entry_type]||r.entry_type)}</td><td>${esc(r.booking?.booking_number||'—')}</td><td>${r.direction==='debit'?esc(money(r.amount)):'—'}</td><td>${r.direction==='credit'?esc(money(r.amount)):'—'}</td><td>${esc(money(r.balance_after))}</td><td>${esc(r.reason||'—')}</td></tr>`).join('');
  const body=`<div class="statement"><div class="head"><img src="/almaher-logo.jpeg"><div><h1>كشف حساب وكيل</h1><b>${esc(agent.agent_code||'')} · ${esc(agent.company_name||agent.name||'')}</b><p>${esc(data?.data_environment==='production'?'Production':'Training')} · تاريخ الطباعة ${esc(dt(new Date().toISOString()))}</p></div></div>
  <div class="summary"><div>إجمالي مدين<b>${esc(money(s.debit||0))}</b></div><div>إجمالي دائن<b>${esc(money(s.credit||0))}</b></div><div>الرصيد الحالي<b>${esc(money(s.current_balance||0))}</b><small>${esc(balanceLabel(s.current_balance||0))}</small></div><div>عدد الحركات<b>${esc(rows.length)}</b></div></div>
  <table><thead><tr><th>التاريخ</th><th>المرجع</th><th>الحركة</th><th>الحجز</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>البيان</th></tr></thead><tbody>${table||'<tr><td colspan="8">لا توجد حركات</td></tr>'}</tbody></table></div>`;
  const html=basicPrintDocument({title:'كشف حساب '+(agent.agent_code||''),body,styles:'.head{display:flex;gap:20px;align-items:center;border-bottom:2px solid #123b72;padding-bottom:12px}.head img{width:110px}.head h1{margin:0;color:#123b72}.head p{color:#64748b}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.summary div{border:1px solid #dbe3ec;border-radius:10px;padding:9px}.summary b,.summary small{display:block;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #dbe3ec;padding:6px;text-align:start}th{background:#f1f5f9}@media print{thead{display:table-header-group}}'});
  printHtmlDocument(html,{title:'كشف حساب '+(agent.agent_code||'')});
 }
 async function initialize(e){
  e.preventDefault();setSaving(true);setError('');
  const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api.admin({action:'agent_ledger_initialize',agent_id:agent.id,opening_balance:Number(f.opening_balance||0),reason:f.reason});
   setNotice('تم تهيئة كشف حساب الوكيل والرصيد الافتتاحي بنجاح.');setModal('');await load();await onChanged?.();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }
 async function post(e){
  e.preventDefault();setSaving(true);setError('');
  const f=Object.fromEntries(new FormData(e.currentTarget));
  const idem=globalThis.crypto?.randomUUID?.()||('ledger-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  try{
   const out=await api.admin({action:'agent_ledger_post',agent_id:agent.id,entry_type:postType,amount:Number(f.amount||0),booking_id:f.booking_id||null,payment_method:f.payment_method||null,reason:f.reason,idempotency_key:idem});
   setNotice('تم تسجيل حركة الوكيل بنجاح بدون تعديل أو حذف أي حركة سابقة.');setModal('');await load();await onChanged?.();
   if(out?.result&&['payment','refund'].includes(postType))printReceipt({...out.result,booking:(data?.entries||[]).find(x=>x.booking_id===out.result.booking_id)?.booking||bookings.find(b=>b.id===out.result.booking_id)||null});
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }
 async function reverse(e){
  e.preventDefault();if(!reverseRow)return;
  setSaving(true);setError('');const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api.admin({action:'agent_ledger_reverse',agent_id:agent.id,entry_id:reverseRow.id,reason:f.reason});
   setNotice('تم عكس الحركة بقيد معاكس مع الاحتفاظ بالحركة الأصلية في السجل.');setModal('');setReverseRow(null);await load();await onChanged?.();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }

 if(busy&&!data)return <Loading text="جاري تحميل كشف حساب الوكيل..."/>;
 return <>
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}
  {data?.setup_required&&<Card><div className="warning-list"><div><AlertTriangle size={17}/><div style={{flex:1}}><strong>كشف الحساب يحتاج تهيئة أول مرة</strong><div className="muted-small">الرصيد القديم غير مقسم بين Training وProduction، لذلك لن يتم نقله تلقائيًا حتى لا نخلط البيئتين.</div>{data.legacy_balance_requires_setup&&<div className="muted-small">الرصيد القديم المسجل: {money(data.agent?.legacy_current_balance||0)}</div>}</div>{data.capabilities?.initialize&&<Button variant="primary" onClick={()=>setModal('init')}>تهيئة الرصيد الافتتاحي</Button>}</div></Card>}

  <div className="stats-grid">
   <Card><div className="stat-card"><WalletCards/><div><span>الرصيد الحالي</span><strong>{money(data?.summary?.current_balance||0)}</strong><small>{balanceLabel(data?.summary?.current_balance||0)}</small></div></div></Card>
   <Card><div className="stat-card"><Scale/><div><span>إجمالي مدين</span><strong>{money(data?.summary?.debit||0)}</strong><small>تحميلات وتسويات مدينة</small></div></div></Card>
   <Card><div className="stat-card"><Banknote/><div><span>إجمالي دائن</span><strong>{money(data?.summary?.credit||0)}</strong><small>دفعات وعمولات وخصومات</small></div></div></Card>
   <Card><div className="stat-card"><RefreshCw/><div><span>الحركات</span><strong>{data?.summary?.entry_count||0}</strong><small>{data?.reconciliation_ok?'الرصيد متطابق':'يوجد فرق يحتاج مراجعة'}</small></div></div></Card>
  </div>

  {!data?.reconciliation_ok&&<div className="error-box">فرق مطابقة داخلي: {money(data?.summary?.discrepancy||0)}. تم إيقاف الاعتماد على الرصيد المخزن حتى تتم المراجعة.</div>}
  <Card>
   <div className="card-title"><div><h3>كشف حساب الوكيل</h3><small>الرصيد الموجب = الوكيل مدين للشركة · الرصيد السالب = للوكيل رصيد دائن.</small></div><div className="finance-actions"><Badge>{data?.data_environment==='production'?'Production':'Training'}</Badge><Button onClick={load} disabled={busy}><RefreshCw size={15}/> تحديث</Button>{data?.capabilities?.payment&&<Button variant="primary" onClick={()=>{setPostType('payment');setModal('post')}}>إضافة حركة</Button>}<Button onClick={printStatement}><Download size={15}/> كشف / PDF</Button></div></div>
   <SmartListFilters
    storageKey={'agent-ledger-'+agent.id}
    search={filter.q}
    onSearchChange={v=>setFilter(x=>({...x,q:v}))}
    searchPlaceholder="ابحث بالمرجع أو الحجز أو البيان أو المنفذ..."
    totalCount={data?.entries?.length||0}
    resultCount={rows.length}
    onReset={()=>setFilter({q:'',type:'',direction:'',from:'',to:''})}
    filters={[
     {key:'type',label:'نوع الحركة',value:filter.type,onChange:v=>setFilter(x=>({...x,type:v})),options:typeOptions},
     {key:'direction',label:'الطرف',value:filter.direction,onChange:v=>setFilter(x=>({...x,direction:v})),options:[{value:'debit',label:'مدين'},{value:'credit',label:'دائن'}]},
     {key:'from',label:'من تاريخ',value:filter.from,onChange:v=>setFilter(x=>({...x,from:v})),render:()=> <Input type="date" value={filter.from} onChange={e=>setFilter(x=>({...x,from:e.target.value}))}/>},
     {key:'to',label:'إلى تاريخ',value:filter.to,onChange:v=>setFilter(x=>({...x,to:v})),render:()=> <Input type="date" value={filter.to} onChange={e=>setFilter(x=>({...x,to:e.target.value}))}/>}
    ]}
   />
   {rows.length?<Table preferenceKey={'agent-ledger-table-'+agent.id} defaultPageSize={30} rows={rows} columns={columns}/>:<div className="empty">لا توجد حركات مطابقة للفلاتر الحالية.</div>}
  </Card>

  <Modal open={modal==='init'} onClose={()=>!saving&&setModal('')} title="تهيئة كشف حساب الوكيل">
   <form className="form-grid" onSubmit={initialize}>
    <div className="training-banner" style={{gridColumn:'1/-1'}}>اكتب الرصيد الافتتاحي لهذه البيئة فقط. رقم موجب = الوكيل مدين للشركة، رقم سالب = للوكيل رصيد دائن. لن يتم نسخ الرصيد القديم تلقائيًا.</div>
    <Field label="الرصيد الافتتاحي"><Input name="opening_balance" type="number" step="0.01" defaultValue={data?.agent?.legacy_current_balance||0}/></Field>
    <Field label="سبب التهيئة"><Textarea name="reason" placeholder="مثال: اعتماد الرصيد الافتتاحي بعد مطابقة حساب الوكيل" required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setModal('')}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري التهيئة...':'اعتماد الرصيد الافتتاحي'}</Button></div>
   </form>
  </Modal>

  <Modal open={modal==='post'} onClose={()=>!saving&&setModal('')} title="إضافة حركة على حساب الوكيل" wide>
   <form className="form-grid" onSubmit={post}>
    <Field label="نوع الحركة"><Select value={postType} onChange={e=>setPostType(e.target.value)}>{MANUAL.filter(([v])=>v==='payment'?data?.capabilities?.payment:data?.capabilities?.adjust).map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></Field>
    <Field label="المبلغ"><Input name="amount" type="number" min="0.01" step="0.01" required/></Field>
    <Field label="الحجز المرتبط — اختياري"><Select name="booking_id"><option value="">بدون حجز</option>{bookings.map(b=><option key={b.id} value={b.id}>{b.booking_number} · {b.customer_name||''}</option>)}</Select></Field>
    <Field label="طريقة الدفع / التسوية"><Select name="payment_method"><option value="">—</option>{METHODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></Field>
    <Field label="السبب / البيان"><Textarea name="reason" placeholder="اكتب سبب الحركة بوضوح" required/></Field>
    <div className="training-banner" style={{gridColumn:'1/-1'}}>{['payment','commission','discount','refund','adjustment_credit'].includes(postType)?'هذه الحركة دائنة وتُخفض المبلغ المستحق على الوكيل.':'هذه الحركة مدينة وتزيد المبلغ المستحق على الوكيل.'}</div>
    <div className="modal-actions"><Button type="button" onClick={()=>setModal('')}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري التسجيل...':'ترحيل الحركة'}</Button></div>
   </form>
  </Modal>

  <Modal open={modal==='reverse'} onClose={()=>{if(!saving){setModal('');setReverseRow(null)}}} title={'عكس الحركة '+(reverseRow?.reference_no||'')}>
   <form className="form-grid" onSubmit={reverse}>
    <div className="error-box" style={{gridColumn:'1/-1'}}>لن تُحذف أو تُعدّل الحركة الأصلية. سيتم إنشاء قيد معاكس بنفس المبلغ ويحفظ مرجع الحركة الأصلية.</div>
    <Card><div className="detail-grid"><div><span>الحركة</span><strong>{TYPES[reverseRow?.entry_type]||'—'}</strong></div><div><span>المبلغ</span><strong>{money(reverseRow?.amount||0)}</strong></div><div><span>المرجع</span><strong>{reverseRow?.reference_no||'—'}</strong></div><div><span>الرصيد بعدها</span><strong>{money(reverseRow?.balance_after||0)}</strong></div></div></Card>
    <Field label="سبب العكس"><Textarea name="reason" placeholder="اكتب سبب التصحيح بالتفصيل" required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>{setModal('');setReverseRow(null)}}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري العكس...':'تأكيد العكس'}</Button></div>
   </form>
  </Modal>
 </>;
}
