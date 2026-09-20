import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,BadgeDollarSign,CalendarClock,CheckCircle2,HandCoins,RefreshCw,ShieldAlert,XCircle} from 'lucide-react';
import {api} from '../../lib/api.js';
import {money} from '../../lib/format.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const dt=v=>{if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}};
const dateOnly=v=>{if(!v)return '—';try{return new Date(v+'T12:00:00').toLocaleDateString('ar-SA')}catch{return String(v)}};
const today=()=>new Date().toISOString().slice(0,10);
const PROMISE_STATUS={open:'مفتوح',kept:'تم الوفاء',broken:'لم يتم الوفاء',cancelled:'ملغي'};
const PROMISE_TONE={open:'orange',kept:'green',broken:'red',cancelled:'blue'};
const MODE_LABEL={off:'متوقف',warn:'تحذير فقط',block:'منع عند التجاوز'};
const EVENT_LABEL={created:'إنشاء الوعد',followup:'متابعة',kept:'تم الوفاء',broken:'لم يتم الوفاء',cancelled:'إلغاء'};

export default function AgentCreditPanel({agent,onChanged}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [modal,setModal]=useState(''),[saving,setSaving]=useState(false),[promiseRow,setPromiseRow]=useState(null),[promiseAction,setPromiseAction]=useState('followup');
 const [filter,setFilter]=useState({q:'',status:''});

 async function load(){
  if(!agent?.id)return;
  setBusy(true);setError('');
  try{setData(await api.agentCredit(agent.id))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[agent?.id]);

 const snapshot=data?.snapshot||{},policy=snapshot.policy||{},aging=snapshot.aging||{},summary=data?.collection_summary||{};
 const promises=useMemo(()=>{
  const q=lower(filter.q);
  return (data?.promises||[]).filter(p=>{
   if(filter.status&&p.status!==filter.status)return false;
   if(!q)return true;
   return [p.amount,p.due_date,p.note,p.status,p.created_by_name,...(p.events||[]).flatMap(e=>[e.note,e.actor_name,e.event_type])].some(v=>lower(v).includes(q));
  });
 },[data,filter]);

 function dueState(p){
  if(p.status!=='open')return '';
  const d=String(p.due_date||'');
  if(!d)return '';
  if(d<today())return 'متأخر';
  if(d===today())return 'مستحق اليوم';
  return 'قادم';
 }
 const cols=[
  {key:'due',label:'تاريخ الوعد',render:r=><div><strong>{dateOnly(r.due_date)}</strong><div className="muted-small">{dueState(r)}</div></div>},
  {key:'amount',label:'المبلغ',render:r=><strong>{money(r.amount)}</strong>},
  {key:'status',label:'الحالة',render:r=><Badge tone={PROMISE_TONE[r.status]||'orange'}>{PROMISE_STATUS[r.status]||r.status}</Badge>},
  {key:'note',label:'آخر ملاحظة',render:r=><div>{r.note||'—'}<div className="muted-small">{r.created_by_name||'—'} · {dt(r.updated_at||r.created_at)}</div></div>},
  {key:'events',label:'المتابعات',render:r=><span>{r.events?.length||0}</span>},
  {key:'actions',label:'',render:r=>r.status==='open'&&data?.capabilities?.collections?<div className="finance-actions">
    <Button onClick={()=>{setPromiseRow(r);setPromiseAction('followup');setModal('promise-action')}}>متابعة</Button>
    <Button onClick={()=>{setPromiseRow(r);setPromiseAction('kept');setModal('promise-action')}}><CheckCircle2 size={14}/> تم الوفاء</Button>
    <Button onClick={()=>{setPromiseRow(r);setPromiseAction('broken');setModal('promise-action')}}><XCircle size={14}/> لم يتم</Button>
  </div>:'—'}
 ];

 async function savePolicy(e){
  e.preventDefault();setSaving(true);setError('');
  const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api.admin({
    action:'agent_credit_policy_update',agent_id:agent.id,allow_credit:f.allow_credit==='on',
    credit_limit:Number(f.credit_limit||0),mode:f.mode,warning_percent:Number(f.warning_percent||0),
    terms_days:Number(f.terms_days||0),reason:f.reason
   });
   setNotice('تم تحديث سياسة ائتمان الوكيل وتسجيلها في Timeline.');setModal('');await load();await onChanged?.();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }
 async function createPromise(e){
  e.preventDefault();setSaving(true);setError('');
  const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api.admin({action:'agent_collection_promise_create',agent_id:agent.id,amount:Number(f.amount||0),due_date:f.due_date,note:f.note});
   setNotice('تم إنشاء وعد السداد وإضافته لمتابعة التحصيل.');setModal('');await load();await onChanged?.();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }
 async function actPromise(e){
  e.preventDefault();if(!promiseRow)return;
  setSaving(true);setError('');const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api.admin({
    action:'agent_collection_promise_action',agent_id:agent.id,promise_id:promiseRow.id,promise_action:promiseAction,
    note:f.note,payment_entry_id:f.payment_entry_id||null
   });
   setNotice(promiseAction==='kept'?'تم تسجيل الوفاء بوعد السداد.':promiseAction==='broken'?'تم تسجيل عدم الوفاء بوعد السداد.':'تم حفظ متابعة التحصيل.');
   setModal('');setPromiseRow(null);await load();await onChanged?.();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }

 if(busy&&!data)return <Loading text="جاري تحميل الائتمان والتحصيل..."/>;
 return <>
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}

  {(snapshot.exceeded||snapshot.warning)&&<div className={snapshot.exceeded?'error-box':'warning-list'}>
   <div><AlertTriangle size={17}/><strong>{snapshot.exceeded?'تجاوز حد الائتمان':'اقترب من حد الائتمان'}</strong> — الرصيد {money(snapshot.balance||0)} من حد فعلي {money(policy.effective_limit||0)}، والاستهلاك {Number(snapshot.utilization_percent||0).toFixed(1)}%.</div>
  </div>}

  <div className="stats-grid">
   <Card><div className="stat-card"><BadgeDollarSign/><div><span>الرصيد المدين</span><strong>{money(snapshot.balance||0)}</strong><small>{snapshot.balance>0?'مطلوب من الوكيل':snapshot.balance<0?'رصيد دائن للوكيل':'متزن'}</small></div></div></Card>
   <Card><div className="stat-card"><ShieldAlert/><div><span>الحد الفعلي</span><strong>{money(policy.effective_limit||0)}</strong><small>{MODE_LABEL[policy.mode]||policy.mode||'—'}</small></div></div></Card>
   <Card><div className="stat-card"><HandCoins/><div><span>المتاح من الائتمان</span><strong>{money(snapshot.available_credit||0)}</strong><small>{Number(snapshot.utilization_percent||0).toFixed(1)}% مستخدم</small></div></div></Card>
   <Card><div className="stat-card"><CalendarClock/><div><span>وعود سداد مفتوحة</span><strong>{summary.open||0}</strong><small>{money(summary.open_amount||0)} · المتأخر {summary.overdue||0}</small></div></div></Card>
  </div>

  <Card>
   <div className="card-title"><div><h3>Aging — أعمار المديونية</h3><small>يتم توزيع الدفعات والقيود الدائنة على أقدم المديونيات أولًا (FIFO).</small></div><Badge tone={Number(aging.overdue||0)>0?'red':'green'}>متأخر: {money(aging.overdue||0)}</Badge></div>
   <div className="stats-grid">
    <div className="stat-card"><div><span>0–7 أيام</span><strong>{money(aging.days_0_7||0)}</strong><small>حديث</small></div></div>
    <div className="stat-card"><div><span>8–15 يوم</span><strong>{money(aging.days_8_15||0)}</strong><small>متابعة مبكرة</small></div></div>
    <div className="stat-card"><div><span>16–30 يوم</span><strong>{money(aging.days_16_30||0)}</strong><small>أولوية تحصيل</small></div></div>
    <div className="stat-card"><div><span>أكثر من 30 يوم</span><strong>{money(aging.days_31_plus||0)}</strong><small>أقدم مديونية: {aging.oldest_unpaid_days||0} يوم</small></div></div>
   </div>
  </Card>

  <Card>
   <div className="card-title"><div><h3>سياسة الائتمان</h3><small>وضع Warn يسمح بالحجز مع تنبيه. وضع Block يمنع الحجز أو زيادة السعر إذا تجاوز الرصيد المتوقع الحد الفعلي.</small></div>{data?.capabilities?.policy&&<Button onClick={()=>setModal('policy')}>تعديل السياسة</Button>}</div>
   <div className="detail-grid">
    <div><span>السماح بالآجل</span><strong>{policy.allow_credit?'نعم':'لا'}</strong></div>
    <div><span>حد الائتمان</span><strong>{money(policy.credit_limit||0)}</strong></div>
    <div><span>الحد الفعلي</span><strong>{money(policy.effective_limit||0)}</strong></div>
    <div><span>الوضع</span><strong>{MODE_LABEL[policy.mode]||'—'}</strong></div>
    <div><span>نسبة التحذير</span><strong>{Number(policy.warning_percent||0)}%</strong></div>
    <div><span>مدة السداد</span><strong>{Number(policy.terms_days||0)} يوم</strong></div>
   </div>
  </Card>

  <Card>
   <div className="card-title"><div><h3>وعود السداد والمتابعة</h3><small>كل متابعة محفوظة كسجل مستقل، وإغلاق الوعد لا يحذف تاريخه.</small></div>{data?.capabilities?.collections&&<Button variant="primary" onClick={()=>setModal('promise-create')}><HandCoins size={15}/> وعد سداد جديد</Button>}</div>
   <SmartListFilters
    storageKey={'agent-collections-'+agent.id}
    search={filter.q}
    onSearchChange={v=>setFilter(x=>({...x,q:v}))}
    searchPlaceholder="ابحث بالمبلغ أو الملاحظة أو المنفذ..."
    totalCount={data?.promises?.length||0}
    resultCount={promises.length}
    onReset={()=>setFilter({q:'',status:''})}
    filters={[{key:'status',label:'الحالة',value:filter.status,onChange:v=>setFilter(x=>({...x,status:v})),options:Object.entries(PROMISE_STATUS).map(([value,label])=>({value,label}))}]}
   />
   {promises.length?<Table preferenceKey={'agent-collections-table-'+agent.id} defaultPageSize={20} rows={promises} columns={cols}/>:<div className="empty">لا توجد وعود سداد مطابقة.</div>}
  </Card>

  <Modal open={modal==='policy'} onClose={()=>!saving&&setModal('')} title="سياسة ائتمان الوكيل">
   <form className="form-grid" onSubmit={savePolicy}>
    <div className="training-banner" style={{gridColumn:'1/-1'}}>لو «السماح بالآجل» غير مفعّل، الحد الفعلي يصبح صفر. وضع Block سيمنع أي رصيد مدين جديد للوكيل.</div>
    <Field label="وضع التحكم"><Select name="mode" defaultValue={policy.mode||'warn'}><option value="off">متوقف</option><option value="warn">تحذير فقط</option><option value="block">منع عند التجاوز</option></Select></Field>
    <Field label="حد الائتمان"><Input name="credit_limit" type="number" min="0" step="0.01" defaultValue={policy.credit_limit||0}/></Field>
    <Field label="نسبة التحذير %"><Input name="warning_percent" type="number" min="0" max="100" step="0.1" defaultValue={policy.warning_percent??80}/></Field>
    <Field label="مدة السداد بالأيام"><Input name="terms_days" type="number" min="0" max="365" defaultValue={policy.terms_days??30}/></Field>
    <label className="check"><input name="allow_credit" type="checkbox" defaultChecked={!!policy.allow_credit}/> السماح للوكيل بالشراء الآجل</label>
    <Field label="سبب التعديل"><Textarea name="reason" placeholder="مثال: اعتماد حد ائتمان بعد مراجعة الإدارة المالية" required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setModal('')}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري الحفظ...':'حفظ السياسة'}</Button></div>
   </form>
  </Modal>

  <Modal open={modal==='promise-create'} onClose={()=>!saving&&setModal('')} title="إنشاء وعد سداد">
   <form className="form-grid" onSubmit={createPromise}>
    <Field label="المبلغ"><Input name="amount" type="number" min="0.01" step="0.01" required/></Field>
    <Field label="تاريخ السداد"><Input name="due_date" type="date" min={today()} required/></Field>
    <Field label="ملاحظة الوعد"><Textarea name="note" placeholder="مثال: الوكيل أكد تحويل المبلغ يوم الخميس" required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setModal('')}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>حفظ وعد السداد</Button></div>
   </form>
  </Modal>

  <Modal open={modal==='promise-action'} onClose={()=>{if(!saving){setModal('');setPromiseRow(null)}}} title={(EVENT_LABEL[promiseAction]||'متابعة')+' — '+money(promiseRow?.amount||0)}>
   <form className="form-grid" onSubmit={actPromise}>
    <Card><div className="detail-grid"><div><span>تاريخ الوعد</span><strong>{dateOnly(promiseRow?.due_date)}</strong></div><div><span>المبلغ</span><strong>{money(promiseRow?.amount||0)}</strong></div><div><span>الحالة</span><strong>{PROMISE_STATUS[promiseRow?.status]||'—'}</strong></div><div><span>آخر ملاحظة</span><strong>{promiseRow?.note||'—'}</strong></div></div></Card>
    {promiseAction==='kept'&&<Field label="ربط بدفعة فعلية — اختياري"><Select name="payment_entry_id"><option value="">بدون ربط</option>{(data?.credit_entries||[]).map(x=><option key={x.id} value={x.id}>{x.reference_no} · {money(x.amount)} · {dt(x.created_at)}</option>)}</Select></Field>}
    <Field label="ملاحظة المتابعة"><Textarea name="note" placeholder={promiseAction==='followup'?'اكتب نتيجة التواصل مع الوكيل':'اكتب سبب الإجراء أو تفاصيل السداد'} required/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>{setModal('');setPromiseRow(null)}}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري الحفظ...':'تأكيد'}</Button></div>
   </form>
  </Modal>
 </>;
}
