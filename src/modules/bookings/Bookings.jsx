import React,{useEffect,useMemo,useState} from 'react';
import {Plus,Search,RefreshCw,FilterX,Ticket,RotateCcw,MessageCircle,Pencil,UsersRound,Clock3,XCircle,LayoutDashboard,ClipboardList,AlertTriangle,WalletCards} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Card,Button,Table,Input,Badge,Select,Modal,SavedViews} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import {money,statusLabel,journeyLabel,tripDisplay,phoneWa} from '../../lib/format.js';
import {has} from '../../lib/permissions.js';
import {bookingFinanceNumbers,bookingFinancialState} from '../../lib/bookingFinance.js';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';
import {DATE_PRESET_OPTIONS,dateRangeForPreset,isWithinDateRange} from '../../lib/dateRangeFilters.js';
import RuleFilterBuilder from '../../components/RuleFilterBuilder.jsx';
import {matchesRuleSet} from '../../lib/ruleFilters.js';

const num=v=>Number(v||0);
const lower=v=>String(v??'').trim().toLowerCase();
const activeForFinance=b=>!['cancelled','canceled','deleted','refunded'].includes(lower(b?.status));
function eventTime(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA')}catch{return String(v)}}
function timelineValue(v){
 if(v===null||v===undefined||v==='')return '—';
 if(v===true)return 'نعم';if(v===false)return 'لا';
 if(typeof v==='string'&&v.length>120)return `${v.slice(0,117)}...`;
 return String(v);
}

export default function Bookings({go,query=''}){
 const {user}=useAuth();const {data,refresh}=useAppData();
 const [q,setQ]=useState(query),[status,setStatus]=useState('active'),[tripId,setTripId]=useState(''),[branchId,setBranchId]=useState(''),[financial,setFinancial]=useState('all'),[sort,setSort]=useState('newest'),[datePreset,setDatePreset]=useState(''),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
 const [bookingRules,setBookingRules]=useState([]),[bookingRuleMode,setBookingRuleMode]=useState('all');
 const [timeline,setTimeline]=useState(null),[timelineBusy,setTimelineBusy]=useState(false),[timelineError,setTimelineError]=useState('');
 const [cancelTarget,setCancelTarget]=useState(null),[cancelQuote,setCancelQuote]=useState(null),[cancelReason,setCancelReason]=useState(''),[cancelOther,setCancelOther]=useState(''),[cancelMode,setCancelMode]=useState(''),[cancelRefundMethod,setCancelRefundMethod]=useState('cash'),[cancelBusy,setCancelBusy]=useState(false),[cancelError,setCancelError]=useState('');
 const [statusTarget,setStatusTarget]=useState(null),[statusValue,setStatusValue]=useState('confirmed'),[statusBusy,setStatusBusy]=useState(false),[statusError,setStatusError]=useState('');
 const [refundSummary,setRefundSummary]=useState({byId:{},byNo:{},loaded:false});
 const canEdit=has(user,'editBookings');const canRefund=has(user,'refunds')||has(user,'refund_request');const canCancel=has(user,'cancelBookings');const canPrint=has(user,'printTickets');const canActivity=has(user,'viewBookingActivity')||has(user,'viewBookings')||canEdit;
 const tripMap=useMemo(()=>new Map((data.trips||[]).map(t=>[String(t.id),t])),[data.trips]);
 const branchMap=useMemo(()=>new Map((data.branches||[]).map(b=>[String(b.id),b])),[data.branches]);
 const passengerMap=useMemo(()=>{const m=new Map();for(const p of data.passengers||[]){const k=String(p.booking_id||'');const a=m.get(k)||[];a.push(p);m.set(k,a)}return m},[data.passengers]);
 async function loadRefundSummary(){try{const x=await api.bookingRefundSummaries();setRefundSummary({byId:x?.by_booking_id||{},byNo:x?.by_booking_number||{},loaded:true})}catch{setRefundSummary({byId:{},byNo:{},loaded:true})}}
 useEffect(()=>{loadRefundSummary()},[]);
 const refundedFor=b=>num(refundSummary.byId?.[String(b.id||'')])||num(refundSummary.byNo?.[String(b.booking_number||'')]);
 const tripFilterOptions=useMemo(()=>(data.trips||[]).map(t=>({value:String(t.id),label:tripDisplay(t),searchText:[t.trip_code,t.from_city,t.origin,t.to_city,t.destination,t.departure_date]})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[data.trips]);
 const branchFilterOptions=useMemo(()=>(data.branches||[]).map(b=>({value:String(b.id),label:b.name||b.branch_name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[data.branches]);
 const bookingRuleFields=useMemo(()=>[
  {key:'bookingNumber',label:'رقم الحجز',get:b=>b.booking_number},
  {key:'customerName',label:'اسم العميل',get:b=>b.customer_name},
  {key:'customerPhone',label:'جوال العميل',get:b=>b.customer_phone},
  {key:'status',label:'حالة الحجز',options:[{value:'new',label:'جديد'},{value:'confirmed',label:'مؤكد'},{value:'pending',label:'قيد المراجعة'},{value:'cancelled',label:'ملغي'}],get:b=>lower(b.status)},
  {key:'financial',label:'الحالة المالية',options:[{value:'paid',label:'مسدد'},{value:'partial',label:'مدفوع جزئيًا'},{value:'unpaid',label:'غير مسدد'},{value:'credit',label:'رصيد للعميل'},{value:'refunded',label:'مسترد بالكامل'},{value:'no_value',label:'بدون قيمة'},{value:'mismatch',label:'عدم تطابق مالي'}],get:b=>bookingFinancialState(b,refundedFor(b)).code},
  {key:'branch',label:'الفرع',options:branchFilterOptions,get:b=>String(b.branch_id||'')},
  {key:'trip',label:'الرحلة',options:tripFilterOptions,get:b=>String(b.trip_id||'')},
  {key:'total',label:'إجمالي الحجز',type:'number',get:b=>bookingFinanceNumbers(b,refundedFor(b)).total},
  {key:'remaining',label:'المبلغ المتبقي',type:'number',get:b=>bookingFinanceNumbers(b,refundedFor(b)).remaining},
  {key:'passengers',label:'عدد المسافرين',type:'number',get:b=>(passengerMap.get(String(b.id))||[]).filter(p=>lower(p.status)!=='cancelled').length},
  {key:'createdAt',label:'تاريخ إنشاء الحجز',type:'date',get:b=>b.created_at||b.booking_date||b.created_on}
 ],[branchFilterOptions,tripFilterOptions,refundSummary,passengerMap]);
 const rows=useMemo(()=>{
   const s=q;
   const out=(data.bookings||[]).filter(b=>{
     const st=lower(b.status);
     if(status==='active'&&['cancelled','deleted','refunded'].includes(st))return false;
     if(status!=='all'&&status!=='active'&&st!==status)return false;
     if(tripId&&String(b.trip_id)!==String(tripId)&&String(b.return_trip_id)!==String(tripId))return false;
     if(branchId&&String(b.branch_id)!==String(branchId))return false;
     if(!isWithinDateRange(b.created_at||b.booking_date||b.created_on,fromDate,toDate))return false;
     const fs=bookingFinancialState(b,refundedFor(b)).code;
     if(financial!=='all'&&fs!==financial)return false;
     if(!matchesRuleSet(b,bookingRules,bookingRuleFields,bookingRuleMode))return false;
     if(!String(s||'').trim())return true;
     const t=tripMap.get(String(b.trip_id));const rt=tripMap.get(String(b.return_trip_id));const ps=passengerMap.get(String(b.id))||[];
     return matchesListQuery(s,b.booking_number,b.customer_name,b.customer_phone,b.customer_identity,b.customer_nationality,t?.trip_code,t?.from_city,t?.origin,t?.to_city,t?.destination,rt?.trip_code,branchMap.get(String(b.branch_id))?.name,branchMap.get(String(b.branch_id))?.branch_name,...ps.flatMap(p=>[p.full_name,p.identity_number,p.phone,p.nationality]));
   });
   out.sort((a,b)=>{if(sort==='oldest')return String(a.created_at||a.booking_number||'').localeCompare(String(b.created_at||b.booking_number||''));if(sort==='remaining')return bookingFinanceNumbers(b,refundedFor(b)).remaining-bookingFinanceNumbers(a,refundedFor(a)).remaining;return String(b.created_at||b.booking_number||'').localeCompare(String(a.created_at||a.booking_number||''))});
   return out;
 },[data.bookings,q,status,tripId,branchId,financial,sort,datePreset,fromDate,toDate,tripMap,passengerMap,refundSummary,bookingRules,bookingRuleFields,bookingRuleMode]);

 const totals=useMemo(()=>rows.reduce((x,b)=>{const f=bookingFinanceNumbers(b,refundedFor(b));x.total+=f.total;x.gross+=f.gross;x.net+=f.netRaw;x.refunded+=f.refund;if(activeForFinance(b)){x.remaining+=f.remaining;x.credit+=f.credit}x.passengers+=(passengerMap.get(String(b.id))||[]).filter(p=>lower(p.status)!=='cancelled').length;return x},{total:0,gross:0,net:0,refunded:0,remaining:0,credit:0,passengers:0}),[rows,passengerMap,refundSummary]);
 const overview=useMemo(()=>{const list=(data.bookings||[]),active=list.filter(b=>!['cancelled','canceled','deleted','refunded'].includes(lower(b.status))),pending=active.filter(b=>lower(b.status)==='pending').length,confirmed=active.filter(b=>lower(b.status)==='confirmed').length,newCount=active.filter(b=>lower(b.status)==='new').length,mismatch=active.filter(b=>bookingFinancialState(b,refundedFor(b)).code==='mismatch').length,unpaid=active.filter(b=>['unpaid','partial'].includes(bookingFinancialState(b,refundedFor(b)).code)).length,remaining=active.reduce((n,b)=>n+bookingFinanceNumbers(b,refundedFor(b)).remaining,0);return {active:active.length,pending,confirmed,newCount,mismatch,unpaid,remaining}},[data.bookings,refundSummary]);
 const moduleTabs=useMemo(()=>[
  {id:'overview',label:'نظرة عامة',icon:LayoutDashboard},
  {id:'bookings',label:'سجل الحجوزات',icon:ClipboardList,badge:rows.length}
 ],[rows.length]);
 const [activeTab,setActiveTab]=useModuleTab('almaher:module:bookings',moduleTabs,query?'bookings':'overview');
 useEffect(()=>{if(query)setActiveTab('bookings')},[query]);
 function applyBookingDatePreset(v){setDatePreset(v);if(!v){setFromDate('');setToDate('');return}if(v==='custom')return;const r=dateRangeForPreset(v);setFromDate(r.from);setToDate(r.to)}
 function clear(){setQ('');setStatus('active');setTripId('');setBranchId('');setFinancial('all');setSort('newest');setDatePreset('');setFromDate('');setToDate('');setBookingRules([]);setBookingRuleMode('all')}
 function applySavedView(v={}){setQ(v.q||'');setStatus(v.status||'active');setTripId(v.tripId||'');setBranchId(v.branchId||'');setFinancial(v.financial||'all');setSort(v.sort||'newest');setDatePreset(v.datePreset||'');setFromDate(v.fromDate||'');setToDate(v.toDate||'');setActiveTab('bookings')}
 async function refreshAll(){await refresh();await loadRefundSummary()}
 function wa(b,e){e.stopPropagation();const href=`https://wa.me/${phoneWa(b.customer_phone)}?text=${encodeURIComponent(`شركة الماهر الماسي\nرقم الحجز: ${b.booking_number}\nالعميل: ${b.customer_name||''}`)}`;window.open(href,'_blank')}
 async function openTimeline(b,e){e?.stopPropagation();setTimeline({booking:b,events:[]});setTimelineBusy(true);setTimelineError('');try{const out=await api.bookingTimeline(b.booking_number);setTimeline({booking:out.booking||b,events:out.events||[],count:out.count||0})}catch(x){setTimelineError(x.message)}finally{setTimelineBusy(false)}}
 async function openCancel(b,e){e?.stopPropagation();setCancelTarget(b);setCancelQuote(null);setCancelReason('');setCancelOther('');setCancelMode('');setCancelRefundMethod('cash');setCancelError('');setCancelBusy(true);try{const q=await api.admin({action:'cancel_quote',booking_number:b.booking_number});setCancelQuote(q)}catch(x){setCancelError(x.message)}finally{setCancelBusy(false)}}
 async function confirmCancel(){if(!cancelTarget||!cancelQuote)return;const due=Number(cancelQuote.settlement_due||0);const reason=cancelReason==='other'?String(cancelOther||'').trim():cancelReason;if(!reason){setCancelError('اختر سبب الإلغاء.');return}if(due>0&&!cancelMode){setCancelError('اختر طريقة تسوية المبلغ المستحق للعميل.');return}setCancelBusy(true);setCancelError('');try{await api.admin({action:'cancel_booking_settle',booking_number:cancelTarget.booking_number,reason:cancelReason,reason_other:cancelOther,settlement_mode:due>0?cancelMode:'none',refund_method:cancelRefundMethod});setCancelTarget(null);setCancelQuote(null);await refreshAll()}catch(x){setCancelError(x.message)}finally{setCancelBusy(false)}}
 function openStatus(b,e){e?.stopPropagation();setStatusTarget(b);setStatusValue(lower(b.status)==='new'?'confirmed':lower(b.status)==='confirmed'?'new':'confirmed');setStatusError('')}
 async function confirmStatus(){if(!statusTarget)return;setStatusBusy(true);setStatusError('');try{await api.admin({action:'set_booking_status',booking_number:statusTarget.booking_number,status:statusValue});setStatusTarget(null);await refreshAll()}catch(x){setStatusError(x.message)}finally{setStatusBusy(false)}}
 return <>
  <ModuleShell title="الحجوزات" subtitle="إدارة الحجز والمسافرين والتحصيل والتذكرة والاسترداد من مساحة عمل منظمة" icon={ClipboardList} tabs={moduleTabs} activeTab={activeTab} onTabChange={setActiveTab} actions={<><Button onClick={refreshAll}><RefreshCw size={16}/> تحديث</Button><Button variant="primary" onClick={()=>go('/bookings/new')}><Plus size={16}/> حجز جديد</Button></>} breadcrumbs={[{label:'الحجوزات والمبيعات'},{label:moduleTabs.find(x=>x.id===activeTab)?.label||'نظرة عامة'}]}/>
  {activeTab==='overview'&&<>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>الحجوزات الفعالة</span><strong>{overview.active}</strong><small>{overview.confirmed} مؤكد</small></div></div></Card>
    <Card><div className="stat-card"><div><span>جديدة</span><strong>{overview.newCount}</strong><small>تحتاج متابعة تشغيلية</small></div></div></Card>
    <Card><div className="stat-card"><div><span>قيد المراجعة</span><strong>{overview.pending}</strong><small>حجوزات Pending</small></div></div></Card>
    <Card><div className="stat-card"><div><span>غير مسدد / جزئي</span><strong>{overview.unpaid}</strong><small>{money(overview.remaining)} متبقي</small></div></div></Card>
    <Card><div className="stat-card"><div><span>عدم تطابق مالي</span><strong>{overview.mismatch}</strong><small>يحتاج مراجعة</small></div></div></Card>
   </div>
   <Card><div className="card-title"><div><h3>وصول سريع</h3><small>افتح سجل الحجوزات مباشرة على الحالات الأكثر استخدامًا.</small></div></div><div className="finance-actions"><Button variant="primary" onClick={()=>{setStatus('active');setFinancial('all');setActiveTab('bookings')}}><ClipboardList size={16}/> كل الحجوزات الفعالة</Button><Button onClick={()=>{setStatus('pending');setFinancial('all');setActiveTab('bookings')}}><AlertTriangle size={16}/> قيد المراجعة</Button><Button onClick={()=>{setStatus('active');setFinancial('unpaid');setActiveTab('bookings')}}><WalletCards size={16}/> غير المسدد</Button><Button onClick={()=>{setStatus('active');setFinancial('mismatch');setActiveTab('bookings')}}><AlertTriangle size={16}/> عدم تطابق مالي</Button></div></Card>
  </>}
  {activeTab==='bookings'&&<Card>
   <SmartListFilters storageKey="bookings-register-smart-filters" search={q} onSearchChange={setQ} searchPlaceholder="رقم الحجز، العميل، الجوال، الهوية، المسافر، الرحلة..." totalCount={(data.bookings||[]).length} resultCount={rows.length} onReset={clear} advanced={{getValue:()=>({rules:bookingRules,mode:bookingRuleMode}),onApply:v=>{setBookingRules(Array.isArray(v?.rules)?v.rules:[]);setBookingRuleMode(v?.mode==='any'?'any':'all')},render:()=> <RuleFilterBuilder fields={bookingRuleFields} rules={bookingRules} mode={bookingRuleMode} onRulesChange={setBookingRules} onModeChange={setBookingRuleMode}/>}} filters={[
    {key:'status',label:'الحالة',value:status,onChange:setStatus,options:[{value:'active',label:'الحجوزات الفعالة'},{value:'all',label:'كل الحالات'},{value:'new',label:'جديد'},{value:'confirmed',label:'مؤكد'},{value:'pending',label:'قيد المراجعة'},{value:'cancelled',label:'ملغي'}]},
    {key:'financial',label:'الحالة المالية',value:financial,onChange:setFinancial,options:[{value:'all',label:'كل الحالات المالية'},{value:'paid',label:'مسدد'},{value:'partial',label:'مدفوع جزئيًا'},{value:'unpaid',label:'غير مسدد'},{value:'credit',label:'رصيد للعميل'},{value:'refunded',label:'مسترد بالكامل'},{value:'no_value',label:'بدون قيمة'},{value:'mismatch',label:'عدم تطابق مالي'}]},
    {key:'tripId',label:'الرحلة',value:tripId,onChange:setTripId,options:tripFilterOptions},
    {key:'branchId',label:'الفرع',value:branchId,onChange:setBranchId,options:branchFilterOptions},
    {key:'datePreset',label:'الفترة',value:datePreset,onChange:applyBookingDatePreset,options:DATE_PRESET_OPTIONS},
    {key:'fromDate',label:'من تاريخ',value:fromDate,onChange:v=>{setFromDate(v);setDatePreset(v||toDate?'custom':'')},render:()=> <Input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);setDatePreset(e.target.value||toDate?'custom':'')}}/>},
    {key:'toDate',label:'إلى تاريخ',value:toDate,onChange:v=>{setToDate(v);setDatePreset(fromDate||v?'custom':'')},render:()=> <Input type="date" value={toDate} onChange={e=>{setToDate(e.target.value);setDatePreset(fromDate||e.target.value?'custom':'')}}/>},
    {key:'sort',label:'الترتيب',value:sort,onChange:setSort,options:[{value:'newest',label:'الأحدث أولًا'},{value:'oldest',label:'الأقدم أولًا'},{value:'remaining',label:'الأعلى متبقيًا'}]}
   ]}/>
   <div className="table-summary"><span>الحجوزات: <b>{rows.length}</b></span><span><UsersRound size={14}/> المسافرون: <b>{totals.passengers}</b></span><span>الإجمالي: <b>{money(totals.total)}</b></span><span>التحصيل التاريخي: <b>{money(totals.gross)}</b></span><span>المحصل الصافي: <b>{money(totals.net)}</b></span><span>المسترد: <b>{money(totals.refunded)}</b></span><span>المتبقي: <b>{money(totals.remaining)}</b></span>{totals.credit>0&&<span>رصيد العملاء: <b>{money(totals.credit)}</b></span>}</div>
   <Table preferenceKey="bookings-register" defaultPageSize={25} rows={rows} onRow={r=>go('/bookings/'+r.booking_number)} columns={[
    {key:'booking_number',label:'رقم الحجز',render:r=><strong>{r.booking_number}</strong>},
    {key:'customer_name',label:'العميل',render:r=><div><strong>{r.customer_name||'—'}</strong><div className="muted-small">{r.customer_phone||'—'} · {r.customer_nationality||'—'}</div></div>},
    {key:'passengers',label:'المسافرون',render:r=><Badge>{(passengerMap.get(String(r.id))||[]).filter(p=>lower(p.status)!=='cancelled').length}</Badge>},
    {key:'trip',label:'الرحلة',render:r=>{const t=tripMap.get(String(r.trip_id));return <div><strong>{t?tripDisplay(t):'—'}</strong>{r.return_trip_id&&<div className="muted-small">عودة منفصلة: {tripDisplay(tripMap.get(String(r.return_trip_id))||{})}</div>}</div>}},
    {key:'journey_mode',label:'النوع',render:r=>journeyLabel(r.journey_mode)},
    {key:'branch',label:'الفرع',render:r=>branchMap.get(String(r.branch_id))?.name||branchMap.get(String(r.branch_id))?.branch_name||'—'},
    {key:'financial',label:'المالية',render:r=>{const refunded=refundedFor(r),x=bookingFinanceNumbers(r,refunded),f=bookingFinancialState(r,refunded);return <div><Badge tone={f.tone}>{f.label}</Badge><div className="muted-small">صافي {money(x.paid)} / {money(x.total)}{x.gross!==x.paid?` · تحصيل تاريخي ${money(x.gross)}`:''}{x.refund>0?` · مسترد ${money(x.refund)}`:''}{x.credit>0?` · رصيد ${money(x.credit)}`:x.remaining>0?` · متبقي ${money(x.remaining)}`:''}</div></div>}},
    {key:'status',label:'الحالة',render:r=><Badge tone={r.status==='cancelled'?'red':r.status==='pending'?'orange':'green'}>{statusLabel(r.status)}</Badge>},
    {key:'actions',label:'إجراءات',render:r=><div className="row-actions">{canEdit&&<Button title="تعديل" onClick={e=>{e.stopPropagation();go('/bookings/'+r.booking_number)}}><Pencil size={14}/></Button>}{canEdit&&!['cancelled','canceled','refunded'].includes(lower(r.status))&&<Button title="تغيير حالة الحجز" onClick={e=>openStatus(r,e)}><RefreshCw size={14}/></Button>}{canActivity&&<Button title="الخط الزمني / سجل النشاط" onClick={e=>openTimeline(r,e)}><Clock3 size={14}/></Button>}{canPrint&&<Button title="التذكرة" onClick={e=>{e.stopPropagation();go('/ticket/'+r.booking_number)}}><Ticket size={14}/></Button>}<Button title="واتساب" onClick={e=>wa(r,e)}><MessageCircle size={14}/></Button>{canRefund&&r.status!=='cancelled'&&<Button title="استرداد" onClick={e=>{e.stopPropagation();go('/refunds?booking='+r.booking_number)}}><RotateCcw size={14}/></Button>}{canCancel&&!['cancelled','canceled'].includes(lower(r.status))&&<Button title="إلغاء الحجز" onClick={e=>openCancel(r,e)}><XCircle size={14}/></Button>}</div>}
   ]}/>
  </Card>}
  <Modal open={!!statusTarget} onClose={()=>{if(!statusBusy){setStatusTarget(null);setStatusError('')}}} title={`تغيير حالة الحجز ${statusTarget?.booking_number||''}`}>
   {statusError&&<div className="error-box">{statusError}</div>}
   <div style={{display:'grid',gap:12}}><div className="training-banner" style={{background:'#f8fafc',color:'#334155',borderColor:'#dbe3ec'}}>الحالة التشغيلية مستقلة عن الحالة المالية. الإلغاء والاسترداد يظلان من مساراتهما المخصصة.</div><label>الحالة الجديدة<Select value={statusValue} onChange={e=>setStatusValue(e.target.value)}><option value="confirmed">مؤكد</option><option value="new">جديد</option></Select></label><div className="row-actions"><Button onClick={()=>setStatusTarget(null)} disabled={statusBusy}>رجوع</Button><Button variant="primary" onClick={confirmStatus} disabled={statusBusy}>{statusBusy?'جاري الحفظ...':'حفظ الحالة'}</Button></div></div>
  </Modal>
  <Modal open={!!cancelTarget} onClose={()=>{if(!cancelBusy){setCancelTarget(null);setCancelQuote(null);setCancelError('')}}} title={`إلغاء الحجز ${cancelTarget?.booking_number||''}`}>
   {cancelError&&<div className="error-box">{cancelError}</div>}
   {cancelBusy&&!cancelQuote?<div className="empty">جاري حساب التسوية...</div>:cancelQuote?<div style={{display:'grid',gap:12}}>
    <div className="stats-grid"><div><small>إجمالي المحصل</small><strong>{money(cancelQuote.booking?.paid_amount)}</strong></div><div><small>المسترد سابقًا</small><strong>{money(cancelQuote.refunded_amount)}</strong></div><div><small>المستحق للعميل</small><strong>{money(cancelQuote.settlement_due)}</strong></div><div><small>رصيد المحفظة</small><strong>{money(cancelQuote.wallet_balance)}</strong></div></div>
    <label>سبب الإلغاء<Select value={cancelReason} onChange={e=>setCancelReason(e.target.value)}><option value="">اختر سبب الإلغاء</option><option value="طلب العميل">طلب العميل</option><option value="تغيير الموعد">تغيير الموعد</option><option value="خطأ في الحجز">خطأ في الحجز</option><option value="إلغاء الرحلة">إلغاء الرحلة</option><option value="other">أخرى</option></Select></label>
    {cancelReason==='other'&&<label>السبب الآخر<Input value={cancelOther} onChange={e=>setCancelOther(e.target.value)} placeholder="اكتب السبب"/></label>}
    {Number(cancelQuote.settlement_due||0)>0&&<><label>تسوية المستحق<Select value={cancelMode} onChange={e=>setCancelMode(e.target.value)}><option value="">اختر طريقة التسوية</option><option value="direct_refund" disabled={!cancelQuote.capabilities?.direct_refund}>استرداد مباشر{!cancelQuote.capabilities?.direct_refund?' — يحتاج صلاحية':''}</option><option value="wallet" disabled={!cancelQuote.capabilities?.wallet_credit}>إضافة إلى محفظة العميل{!cancelQuote.capabilities?.wallet_credit?' — يحتاج صلاحية':''}</option></Select></label>{cancelMode==='direct_refund'&&<label>طريقة الاسترداد<Select value={cancelRefundMethod} onChange={e=>setCancelRefundMethod(e.target.value)}><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="mada">مدى</option><option value="card">بطاقة</option><option value="other">أخرى</option></Select></label>}</>}
    <div className="row-actions"><Button onClick={()=>setCancelTarget(null)} disabled={cancelBusy}>رجوع</Button><Button variant="primary" onClick={confirmCancel} disabled={cancelBusy}>{cancelBusy?'جاري التنفيذ...':'تأكيد إلغاء الحجز'}</Button></div>
   </div>:null}
  </Modal>
  <Modal open={!!timeline} onClose={()=>{setTimeline(null);setTimelineError('')}} title={`الخط الزمني للحجز ${timeline?.booking?.booking_number||''}`} wide>
   {timelineBusy?<div className="empty">جاري تحميل سجل النشاط...</div>:timelineError?<div className="error-box">{timelineError}</div>:(timeline?.events||[]).length?<div className="booking-timeline">{timeline.events.map((ev,i)=>{const changes=Array.isArray(ev.changes)?ev.changes:Array.isArray(ev?.metadata?.changes)?ev.metadata.changes:[];return <div className="booking-timeline-item" key={ev.id||i}><div className="booking-timeline-dot"/><div className="booking-timeline-body"><div className="card-title"><h3>{ev.title||ev.action||'نشاط على الحجز'}</h3><Badge>{eventTime(ev.created_at)}</Badge></div><div className="muted-small">{ev.actor_name?`بواسطة ${ev.actor_name}${ev.actor_role?` — ${ev.actor_role}`:''}`:'عملية مسجلة بالنظام'}{ev.entity_type?` · ${ev.entity_type}`:''}</div>{changes.length>0&&<div className="timeline-changes" style={{marginTop:10,display:'grid',gap:7}}>{changes.map((c,j)=><div key={`${c.field||c.label||j}-${j}`} style={{padding:'8px 10px',border:'1px solid #e5e7eb',borderRadius:10,background:'#fafafa'}}><strong>{c.label||c.field||'بيان'}</strong><div className="muted-small" style={{marginTop:4}}><span>من: <b>{timelineValue(c.before)}</b></span><span style={{marginInline:'8px'}}>←</span><span>إلى: <b>{timelineValue(c.after)}</b></span></div></div>)}</div>}{!changes.length&&ev.action&&ev.action!==ev.title&&<div className="muted-small" style={{marginTop:4}}>العملية: {ev.action}</div>}</div></div>})}</div>:<div className="empty">لا توجد أحداث مسجلة لهذا الحجز حتى الآن.</div>}
  </Modal>
 </>;
}
