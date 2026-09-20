import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,BriefcaseBusiness,CalendarClock,Download,HandCoins,Printer,RefreshCw,ShieldAlert,UserRoundCheck,WalletCards} from 'lucide-react';
import {api} from '../../lib/api.js';
import {money} from '../../lib/format.js';
import {basicPrintDocument,printHtmlDocument} from '../../lib/print.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Loading,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import ModuleShell from '../../components/ModuleShell.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import RuleFilterBuilder from '../../components/RuleFilterBuilder.jsx';
import {matchesRuleSet} from '../../lib/ruleFilters.js';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const dateOnly=v=>{if(!v)return '—';try{return new Date(v+'T12:00:00').toLocaleDateString('ar-SA')}catch{return String(v)}};
const today=()=>new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);
const PRIORITY={urgent:'عاجل',high:'مرتفع',normal:'عادي'};
const PRIORITY_TONE={urgent:'red',high:'orange',normal:'blue'};
const MANUAL={urgent:'عاجل',high:'مرتفع',normal:'عادي'};
const esc=v=>String(v??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

export default function AgentCollectionsCenter({go}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [filter,setFilter]=useState({q:'',branch:'',priority:'',collector:'',case:'',aging:''});
 const [rules,setRules]=useState([]),[ruleMode,setRuleMode]=useState('all');
 const [assignRow,setAssignRow]=useState(null),[saving,setSaving]=useState(false);

 async function load(){
  setBusy(true);setError('');
  try{setData(await api.agentCollectionsCenter())}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[]);

 const rows=data?.rows||[],collectors=data?.collectors||[];
 const collectorOptions=useMemo(()=>collectors.map(x=>({value:String(x.id),label:`${x.name||x.username||x.id} · ${x.role||'موظف'}`})),[collectors]);
 const branchOptions=useMemo(()=>[...new Map(rows.map(r=>[String(r.agent?.branch_id||''),r.agent?.branch_name||'بدون فرع']).filter(([id])=>id)).entries()].map(([value,label])=>({value,label})),[rows]);

 const ruleFields=useMemo(()=>[
  {key:'priority_score',label:'درجة الأولوية',type:'number',get:r=>Number(r.priority?.score||0)},
  {key:'balance',label:'الرصيد المدين',type:'number',get:r=>Number(r.credit?.balance||0)},
  {key:'overdue',label:'المبلغ المتأخر',type:'number',get:r=>Number(r.credit?.aging?.overdue||0)},
  {key:'aging31',label:'أكثر من 30 يوم',type:'number',get:r=>Number(r.credit?.aging?.days_31_plus||0)},
  {key:'utilization',label:'استهلاك الحد %',type:'number',get:r=>Number(r.credit?.utilization_percent||0)},
  {key:'branch',label:'الفرع',get:r=>r.agent?.branch_name||''},
  {key:'collector',label:'موظف التحصيل',get:r=>r.assignment?.collector_name||''},
  {key:'next_followup',label:'المتابعة القادمة',type:'date',get:r=>r.assignment?.next_followup_date||''},
  {key:'next_promise',label:'وعد السداد القادم',type:'date',get:r=>r.next_open_promise?.due_date||''}
 ],[]);

 const filtered=useMemo(()=>rows.filter(r=>{
  const q=lower(filter.q);
  if(q&&![r.agent?.agent_code,r.agent?.name,r.agent?.company_name,r.agent?.phone,r.agent?.branch_name,r.assignment?.collector_name,r.assignment?.note,r.next_open_promise?.note].some(v=>lower(v).includes(q)))return false;
  if(filter.branch&&String(r.agent?.branch_id||'')!==filter.branch)return false;
  if(filter.priority&&r.priority?.level!==filter.priority)return false;
  if(filter.collector&&String(r.assignment?.collector_user_id||'')!==filter.collector)return false;
  if(filter.aging==='0_7'&&Number(r.credit?.aging?.days_0_7||0)<=0)return false;
  if(filter.aging==='8_15'&&Number(r.credit?.aging?.days_8_15||0)<=0)return false;
  if(filter.aging==='16_30'&&Number(r.credit?.aging?.days_16_30||0)<=0)return false;
  if(filter.aging==='31_plus'&&Number(r.credit?.aging?.days_31_plus||0)<=0)return false;
  if(filter.case==='over_limit'&&!r.credit?.exceeded)return false;
  if(filter.case==='overdue_debt'&&Number(r.credit?.aging?.overdue||0)<=0)return false;
  if(filter.case==='overdue_promise'&&Number(r.promises?.overdue_count||0)<=0)return false;
  if(filter.case==='due_today'&&Number(r.promises?.due_today_count||0)<=0)return false;
  if(filter.case==='broken'&&Number(r.promises?.broken_count||0)<=0)return false;
  if(filter.case==='unassigned'&&r.assignment?.collector_user_id)return false;
  if(filter.case==='followup_due'&&(!r.assignment?.next_followup_date||String(r.assignment.next_followup_date)>today()))return false;
  return matchesRuleSet(r,rules,ruleFields,ruleMode);
 }),[rows,filter,rules,ruleFields,ruleMode]);

 const summary=useMemo(()=>({
  receivables:filtered.reduce((n,r)=>n+Math.max(0,Number(r.credit?.balance||0)),0),
  overdue:filtered.reduce((n,r)=>n+Number(r.credit?.aging?.overdue||0),0),
  overLimit:filtered.filter(r=>r.credit?.exceeded).length,
  urgent:filtered.filter(r=>r.priority?.level==='urgent').length,
  promiseOverdue:filtered.reduce((n,r)=>n+Number(r.promises?.overdue_count||0),0),
  dueToday:filtered.reduce((n,r)=>n+Number(r.promises?.due_today_count||0),0),
  broken:filtered.reduce((n,r)=>n+Number(r.promises?.broken_count||0),0),
  unassigned:filtered.filter(r=>!r.assignment?.collector_user_id).length
 }),[filtered]);

 const columns=[
  {key:'priority',label:'الأولوية',render:r=><div><Badge tone={PRIORITY_TONE[r.priority?.level]||'blue'}>{PRIORITY[r.priority?.level]||'عادي'} · {Number(r.priority?.score||0)}</Badge><div className="muted-small">يدوي: {MANUAL[r.assignment?.manual_priority]||'عادي'}</div></div>},
  {key:'agent',label:'الوكيل',render:r=><div><strong>{r.agent?.agent_code||'—'} · {r.agent?.company_name||r.agent?.name||'—'}</strong><div className="muted-small">{r.agent?.phone||'—'}</div></div>},
  {key:'branch',label:'الفرع',render:r=>r.agent?.branch_name||'—'},
  {key:'balance',label:'الرصيد المدين',render:r=><div><strong>{money(Math.max(0,Number(r.credit?.balance||0)))}</strong>{r.credit?.exceeded&&<div><Badge tone="red">متجاوز الحد</Badge></div>}{!r.credit?.exceeded&&r.credit?.warning&&<div><Badge tone="orange">تحذير</Badge></div>}</div>},
  {key:'aging',label:'Aging',render:r=><div><strong>متأخر: {money(r.credit?.aging?.overdue||0)}</strong><div className="muted-small">+30: {money(r.credit?.aging?.days_31_plus||0)} · أقدم {r.credit?.aging?.oldest_unpaid_days||0} يوم</div></div>},
  {key:'promises',label:'وعود السداد',render:r=><div>{r.next_open_promise?<><strong>{money(r.next_open_promise.amount)} · {dateOnly(r.next_open_promise.due_date)}</strong><div className="muted-small">{String(r.next_open_promise.due_date)<today()?'متأخر':String(r.next_open_promise.due_date)===today()?'مستحق اليوم':'قادم'}</div></>:<span>لا يوجد وعد مفتوح</span>}{Number(r.promises?.broken_count||0)>0&&<div><Badge tone="red">مكسور: {r.promises.broken_count}</Badge></div>}</div>},
  {key:'collector',label:'مسؤول التحصيل',render:r=><div><strong>{r.assignment?.collector_name||'غير معيّن'}</strong><div className="muted-small">{r.assignment?.next_followup_date?'المتابعة '+dateOnly(r.assignment.next_followup_date):'لا يوجد موعد متابعة'}</div></div>},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>go?.('/partners/agents/'+encodeURIComponent(r.agent.id)+'?tab=credit')}>فتح الوكيل</Button>{data?.capabilities?.assign&&<Button variant="primary" onClick={()=>setAssignRow(r)}><UserRoundCheck size={14}/> توزيع</Button>}</div>}
 ];

 async function saveAssignment(e){
  e.preventDefault();if(!assignRow)return;
  const f=Object.fromEntries(new FormData(e.currentTarget));setSaving(true);setError('');
  try{
   await api.admin({
    action:'agent_collection_assignment_update',agent_id:assignRow.agent.id,
    collector_user_id:f.collector_user_id||null,manual_priority:f.manual_priority||'normal',
    next_followup_date:f.next_followup_date||null,note:f.note||''
   });
   setNotice('تم تحديث مسؤول وأولوية التحصيل وتسجيل التغيير في Timeline.');
   setAssignRow(null);await load();
  }catch(err){setError(err.message)}finally{setSaving(false)}
 }

 function exportCsv(){
  const matrix=[['الأولوية','الدرجة','كود الوكيل','الوكيل','الفرع','الرصيد المدين','المتأخر','+30 يوم','وعد متأخر','موظف التحصيل','المتابعة القادمة'],
   ...filtered.map(r=>[
    PRIORITY[r.priority?.level]||'عادي',r.priority?.score||0,r.agent?.agent_code||'',r.agent?.company_name||r.agent?.name||'',
    r.agent?.branch_name||'',Math.max(0,Number(r.credit?.balance||0)),Number(r.credit?.aging?.overdue||0),Number(r.credit?.aging?.days_31_plus||0),
    Number(r.promises?.overdue_count||0),r.assignment?.collector_name||'',r.assignment?.next_followup_date||''
   ])];
  const csv=matrix.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='agent-collections-'+today()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function printReport(){
  const body=`<h1>مركز تحصيل الوكلاء</h1><p>البيئة: ${esc(data?.data_environment==='production'?'Production':'Training')} · تاريخ التقرير: ${esc(new Date().toLocaleString('ar-SA'))}</p>
  <div class="summary"><div>إجمالي المديونية<b>${esc(money(summary.receivables))}</b></div><div>متأخر<b>${esc(money(summary.overdue))}</b></div><div>متجاوز الحد<b>${summary.overLimit}</b></div><div>عاجل<b>${summary.urgent}</b></div><div>وعود متأخرة<b>${summary.promiseOverdue}</b></div><div>غير موزع<b>${summary.unassigned}</b></div></div>
  <table><thead><tr><th>الأولوية</th><th>الوكيل</th><th>الفرع</th><th>الرصيد</th><th>المتأخر</th><th>+30</th><th>وعود متأخرة</th><th>المحصل</th><th>المتابعة</th></tr></thead><tbody>
  ${filtered.map(r=>`<tr><td>${esc(PRIORITY[r.priority?.level]||'عادي')} · ${Number(r.priority?.score||0)}</td><td>${esc(r.agent?.agent_code)} · ${esc(r.agent?.company_name||r.agent?.name)}</td><td>${esc(r.agent?.branch_name)}</td><td>${esc(money(Math.max(0,Number(r.credit?.balance||0))))}</td><td>${esc(money(r.credit?.aging?.overdue||0))}</td><td>${esc(money(r.credit?.aging?.days_31_plus||0))}</td><td>${Number(r.promises?.overdue_count||0)}</td><td>${esc(r.assignment?.collector_name||'غير معيّن')}</td><td>${esc(r.assignment?.next_followup_date||'—')}</td></tr>`).join('')||'<tr><td colspan="9">لا توجد نتائج</td></tr>'}</tbody></table>`;
  const html=basicPrintDocument({title:'مركز تحصيل الوكلاء',body,styles:'.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin:14px 0}.summary div{border:1px solid #dbe3ec;border-radius:9px;padding:8px}.summary b{display:block;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #dbe3ec;padding:6px;text-align:start}th{background:#f1f5f9}'});
  printHtmlDocument(html,{title:'مركز تحصيل الوكلاء'});
 }

 if(busy&&!data)return <Loading text="جاري تحميل مركز تحصيل الوكلاء..."/>;
 return <>
  <ModuleShell
   title="مركز تحصيل الوكلاء"
   subtitle="قائمة موحدة للمديونيات، Aging، وعود السداد، أولويات المتابعة وتوزيع ملفات التحصيل"
   icon={HandCoins}
   actions={<><Button onClick={load} disabled={busy}><RefreshCw size={15}/> تحديث</Button><Button onClick={exportCsv}><Download size={15}/> CSV</Button><Button onClick={printReport}><Printer size={15}/> طباعة / PDF</Button></>}
   breadcrumbs={[{label:'المالية'},{label:'تحصيل الوكلاء'}]}
  />
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}

  <div className="stats-grid">
   <Card><div className="stat-card"><WalletCards/><div><span>إجمالي المديونية</span><strong>{money(summary.receivables)}</strong><small>{filtered.length} وكيل في النتائج</small></div></div></Card>
   <Card><div className="stat-card"><CalendarClock/><div><span>متأخر حسب مدة السداد</span><strong>{money(summary.overdue)}</strong><small>أولوية متابعة</small></div></div></Card>
   <Card><div className="stat-card"><ShieldAlert/><div><span>متجاوزو الحد</span><strong>{summary.overLimit}</strong><small>Credit Limit</small></div></div></Card>
   <Card><div className="stat-card"><AlertTriangle/><div><span>أولوية عاجلة</span><strong>{summary.urgent}</strong><small>حسب درجة المخاطر</small></div></div></Card>
   <Card><div className="stat-card"><HandCoins/><div><span>وعود سداد متأخرة</span><strong>{summary.promiseOverdue}</strong><small>لم تُغلق بعد</small></div></div></Card>
   <Card><div className="stat-card"><CalendarClock/><div><span>وعود مستحقة اليوم</span><strong>{summary.dueToday}</strong><small>متابعة اليوم</small></div></div></Card>
   <Card><div className="stat-card"><AlertTriangle/><div><span>وعود مكسورة</span><strong>{summary.broken}</strong><small>تحتاج مراجعة</small></div></div></Card>
   <Card><div className="stat-card"><UserRoundCheck/><div><span>غير موزع</span><strong>{summary.unassigned}</strong><small>بدون موظف تحصيل</small></div></div></Card>
  </div>

  <Card>
   <div className="card-title"><div><h3>قائمة المتابعة</h3><small>الترتيب الأساسي من الأعلى أولوية. الدرجة الآلية لا تلغي أولوية الإدارة أو مسؤول التحصيل.</small></div><Badge>{filtered.length}</Badge></div>
   <SmartListFilters
    storageKey="agent-collections-center-filters"
    search={filter.q}
    onSearchChange={v=>setFilter(x=>({...x,q:v}))}
    searchPlaceholder="ابحث بكود الوكيل أو الشركة أو الجوال أو المحصل..."
    totalCount={rows.length}
    resultCount={filtered.length}
    onReset={()=>{setFilter({q:'',branch:'',priority:'',collector:'',case:'',aging:''});setRules([]);setRuleMode('all')}}
    advanced={{getValue:()=>({rules,mode:ruleMode}),onApply:v=>{setRules(Array.isArray(v?.rules)?v.rules:[]);setRuleMode(v?.mode==='any'?'any':'all')},render:()=> <RuleFilterBuilder fields={ruleFields} rules={rules} mode={ruleMode} onRulesChange={setRules} onModeChange={setRuleMode}/>}}
    filters={[
     ...(data?.capabilities?.all_branches?[{key:'branch',label:'الفرع',value:filter.branch,onChange:v=>setFilter(x=>({...x,branch:v})),options:branchOptions}]:[]),
     {key:'priority',label:'الأولوية',value:filter.priority,onChange:v=>setFilter(x=>({...x,priority:v})),options:[{value:'urgent',label:'عاجل'},{value:'high',label:'مرتفع'},{value:'normal',label:'عادي'}]},
     {key:'collector',label:'موظف التحصيل',value:filter.collector,onChange:v=>setFilter(x=>({...x,collector:v})),options:collectorOptions},
     {key:'case',label:'الحالة',value:filter.case,onChange:v=>setFilter(x=>({...x,case:v})),options:[
      {value:'over_limit',label:'متجاوز حد الائتمان'},{value:'overdue_debt',label:'مديونية متأخرة'},{value:'overdue_promise',label:'وعد سداد متأخر'},
      {value:'due_today',label:'وعد مستحق اليوم'},{value:'broken',label:'وعد مكسور'},{value:'unassigned',label:'غير موزع'},{value:'followup_due',label:'موعد متابعة مستحق'}
     ]},
     {key:'aging',label:'عمر المديونية',value:filter.aging,onChange:v=>setFilter(x=>({...x,aging:v})),options:[{value:'0_7',label:'0–7 أيام'},{value:'8_15',label:'8–15 يوم'},{value:'16_30',label:'16–30 يوم'},{value:'31_plus',label:'+30 يوم'}]}
    ]}
   />
   {filtered.length?<Table preferenceKey="agent-collections-center-table" defaultPageSize={30} rows={filtered} columns={columns}/>:<div className="empty">لا توجد حالات مطابقة للفلاتر الحالية.</div>}
  </Card>

  <Modal open={!!assignRow} onClose={()=>!saving&&setAssignRow(null)} title={'توزيع ملف التحصيل — '+(assignRow?.agent?.agent_code||'')}>
   <form className="form-grid" onSubmit={saveAssignment}>
    <Card><div className="detail-grid">
     <div><span>الوكيل</span><strong>{assignRow?.agent?.company_name||assignRow?.agent?.name||'—'}</strong></div>
     <div><span>الرصيد</span><strong>{money(Math.max(0,Number(assignRow?.credit?.balance||0)))}</strong></div>
     <div><span>الأولوية الآلية</span><strong>{PRIORITY[assignRow?.priority?.level]||'عادي'} · {assignRow?.priority?.score||0}</strong></div>
     <div><span>متأخر</span><strong>{money(assignRow?.credit?.aging?.overdue||0)}</strong></div>
    </div></Card>
    <Field label="موظف التحصيل"><Select name="collector_user_id" defaultValue={assignRow?.assignment?.collector_user_id||''}><option value="">غير معيّن</option>{collectorOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select></Field>
    <Field label="أولوية الإدارة"><Select name="manual_priority" defaultValue={assignRow?.assignment?.manual_priority||'normal'}><option value="normal">عادي</option><option value="high">مرتفع</option><option value="urgent">عاجل</option></Select></Field>
    <Field label="موعد المتابعة القادم"><Input name="next_followup_date" type="date" defaultValue={assignRow?.assignment?.next_followup_date||''}/></Field>
    <Field label="ملاحظة التكليف"><Textarea name="note" defaultValue={assignRow?.assignment?.note||''} placeholder="مثال: التواصل قبل الظهر ومتابعة التحويل البنكي"/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setAssignRow(null)}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري الحفظ...':'حفظ التوزيع'}</Button></div>
   </form>
  </Modal>
 </>;
}
