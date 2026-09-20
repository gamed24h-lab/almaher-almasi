import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,ArrowRight,BriefcaseBusiness,Building2,CalendarDays,GitMerge,RefreshCw,UsersRound,WalletCards} from 'lucide-react';
import {api} from '../../lib/api.js';
import {money,statusLabel} from '../../lib/format.js';
import {Badge,Button,Card,ErrorBox,Input,Loading,Table} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import RecordTimeline from '../../components/RecordTimeline.jsx';
import AgentMergeModal from '../audit/AgentMergeModal.jsx';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const fmtDate=v=>{if(!v)return '—';try{return new Date(v).toLocaleDateString('ar-SA')}catch{return String(v)}};
const tripName=t=>t?(t.trip_code||[t.from_city,t.to_city].filter(Boolean).join(' ← ')||t.id):'—';
const matchSearch=(row,q,fields)=>{const k=lower(q);if(!k)return true;return fields.some(f=>lower(typeof f==='function'?f(row):row?.[f]).includes(k))};

export default function Agent360({id,go}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[q,setQ]=useState(''),[mergeGroup,setMergeGroup]=useState(null),[notice,setNotice]=useState('');
 async function load(){
  if(!id)return;
  setBusy(true);setError('');
  try{setData(await api.agent360(id))}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[id]);

 const tabs=useMemo(()=>[
  {id:'overview',label:'نظرة عامة',icon:BriefcaseBusiness},
  {id:'bookings',label:'الحجوزات',icon:UsersRound,badge:data?.bookings?.length||null},
  {id:'allocations',label:'التوزيعات',icon:CalendarDays,badge:data?.allocations?.length||null},
  {id:'quotas',label:'Quotas',icon:Building2,badge:data?.quotas?.length||null},
  {id:'history',label:'الدمج والتدقيق',icon:GitMerge,badge:(data?.merge_history?.length||0)+(data?.duplicate_candidates?.length||0)||null}
 ],[data]);
 const [tab,setTab]=useModuleTab('almaher:agent-360:'+String(id||''),tabs,'overview');
 const agent=data?.agent||null,summary=data?.summary||{},financial=!!data?.financial_access;

 const bookings=useMemo(()=>(data?.bookings||[]).filter(r=>matchSearch(r,q,['booking_number','customer_name','customer_phone','booking_status','status'])),[data,q]);
 const allocations=useMemo(()=>(data?.allocations||[]).filter(r=>matchSearch(r,q,['allocation_type','status',x=>tripName(x.trip)])),[data,q]);
 const quotas=useMemo(()=>(data?.quotas||[]).filter(r=>matchSearch(r,q,['resource_type','status',x=>tripName(x.trip)])),[data,q]);

 const bookingCols=[
  {key:'booking_number',label:'الحجز',render:r=><strong>{r.booking_number}</strong>},
  {key:'customer',label:'العميل',render:r=><div><strong>{r.customer_name||'—'}</strong><div className="muted-small" dir="ltr">{r.customer_phone||'—'}</div></div>},
  {key:'status',label:'الحالة',render:r=><Badge>{statusLabel(r.booking_status||r.status||'—')}</Badge>},
  {key:'value',label:'قيمة الحجز',render:r=>financial?money(Number(r.total_price||0)):'مخفي'},
  {key:'paid',label:'المدفوع',render:r=>financial?money(Number(r.paid_amount||0)):'مخفي'},
  {key:'date',label:'التاريخ',render:r=>fmtDate(r.created_at)},
  {key:'open',label:'',render:r=><Button onClick={()=>go?.('/bookings/'+encodeURIComponent(r.booking_number))}>فتح الحجز</Button>}
 ];
 const allocationCols=[
  {key:'trip',label:'الرحلة',render:r=><div><strong>{tripName(r.trip)}</strong><div className="muted-small">{r.trip?.departure_date||'—'}</div></div>},
  {key:'type',label:'النوع',render:r=>r.allocation_type==='seats'?'مقاعد':r.allocation_type==='rooms'?'غرف':r.allocation_type==='mixed'?'مختلط':r.allocation_type||'—'},
  {key:'qty',label:'المخصص',render:r=><strong>{Number(r.allocated_quantity||0)}</strong>},
  {key:'used',label:'المستخدم',render:r=>Number(r.used_quantity||0)},
  {key:'remaining',label:'المتبقي',render:r=>Math.max(0,Number(r.allocated_quantity||0)-Number(r.used_quantity||0))},
  {key:'status',label:'الحالة',render:r=><Badge>{statusLabel(r.status||'—')}</Badge>},
  {key:'open',label:'',render:r=>r.trip_id?<Button onClick={()=>go?.('/trips/'+encodeURIComponent(r.trip_id))}>فتح الرحلة</Button>:'—'}
 ];
 const quotaCols=[
  {key:'trip',label:'الرحلة',render:r=><div><strong>{tripName(r.trip)}</strong><div className="muted-small">{r.trip?.departure_date||'—'}</div></div>},
  {key:'resource_type',label:'المورد',render:r=>r.resource_type||'—'},
  {key:'qty',label:'الكمية',render:r=><strong>{Number(r.quantity||0)}</strong>},
  {key:'used',label:'المستخدم',render:r=>Number(r.used_quantity||0)},
  {key:'remaining',label:'المتبقي',render:r=>Math.max(0,Number(r.quantity||0)-Number(r.used_quantity||0))},
  {key:'status',label:'الحالة',render:r=><Badge>{statusLabel(r.status||'—')}</Badge>}
 ];
 const mergeCols=[
  {key:'date',label:'التاريخ',render:r=>fmtDate(r.created_at)},
  {key:'match',label:'المطابقة',render:r=>r.match_type||'—'},
  {key:'actor',label:'نفذ بواسطة',render:r=><div><strong>{r.actor_name||'النظام'}</strong><div className="muted-small">{r.actor_role||'—'}</div></div>},
  {key:'reason',label:'السبب',render:r=>r.reason||'—'},
  {key:'moved',label:'المراجع المنقولة',render:r=>Object.values(r.moved_references||{}).reduce((n,v)=>n+Number(v||0),0)}
 ];

 if(busy&&!data)return <Loading text="جاري تحميل Agent 360..."/>;
 if(error&&!data)return <><ErrorBox error={error}/><Button onClick={()=>go?.('/partners')}><ArrowRight size={15}/> العودة للوكلاء</Button></>;
 if(!agent)return <Card><div className="empty">تعذر تحميل بيانات الوكيل.</div></Card>;

 return <>
  <ModuleShell
   title={'Agent 360 — '+(agent.company_name||agent.name||agent.agent_code)}
   subtitle={(agent.agent_code||'')+(data?.branch?.name?' · '+data.branch.name:'')+(data?.account_mode?' · '+(data.account_mode==='production'?'Production':'Training'):'')}
   icon={BriefcaseBusiness}
   tabs={tabs}
   activeTab={tab}
   onTabChange={setTab}
   breadcrumbs={[{label:'الموردون والوكلاء'},{label:agent.agent_code||'Agent 360'}]}
   actions={<><Button onClick={()=>go?.('/partners')}><ArrowRight size={15}/> الوكلاء</Button><RecordTimeline entityId={agent.id} title={'تاريخ الوكيل — '+(agent.company_name||agent.name||agent.agent_code)} subtitle="إنشاء وتعديل ودمج الوكيل وكل أحداث التدقيق المرتبطة به."/><Button onClick={load} disabled={busy}><RefreshCw size={15}/> تحديث</Button></>}
  />
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}
  {data.merged_into&&<div className="warning-list"><div><AlertTriangle size={16}/> هذا السجل مدموج وغير نشط. السجل الأساسي الآن: <strong>{data.merged_into.agent_code} · {data.merged_into.company_name||data.merged_into.name}</strong> <Button onClick={()=>go?.('/partners/agents/'+encodeURIComponent(data.merged_into.id))}>فتح الأساسي</Button></div></div>}

  {tab==='overview'&&<>
   <div className="stats-grid">
    <Card><div className="stat-card"><WalletCards/><div><span>الرصيد الحالي</span><strong>{financial?money(Number(agent.current_balance||0)):'مخفي'}</strong><small>{financial?'من سجل الوكيل':'تحتاج صلاحية مالية'}</small></div></div></Card>
    <Card><div className="stat-card"><UsersRound/><div><span>الحجوزات المرتبطة</span><strong>{summary.bookings?.total||0}</strong><small>{summary.bookings?.confirmed||0} مؤكدة/مدفوعة</small></div></div></Card>
    <Card><div className="stat-card"><CalendarDays/><div><span>التوزيعات</span><strong>{summary.allocations?.active||0}</strong><small>{summary.allocations?.used||0} مستخدم من {summary.allocations?.allocated||0}</small></div></div></Card>
    <Card><div className="stat-card"><Building2/><div><span>Resource Quotas</span><strong>{summary.quotas?.active||0}</strong><small>{summary.quotas?.used||0} مستخدم من {summary.quotas?.quantity||0}</small></div></div></Card>
   </div>
   {financial&&<div className="stats-grid">
    <Card><div className="stat-card"><WalletCards/><div><span>قيمة الحجوزات</span><strong>{money(Number(summary.bookings?.total_value||0))}</strong><small>إجمالي الحجوزات المرتبطة في البيئة الحالية</small></div></div></Card>
    <Card><div className="stat-card"><WalletCards/><div><span>المدفوع بالحجوزات</span><strong>{money(Number(summary.bookings?.paid_value||0))}</strong><small>ليس بديلًا عن رصيد الوكيل المحاسبي</small></div></div></Card>
    <Card><div className="stat-card"><WalletCards/><div><span>المتبقي بالحجوزات</span><strong>{money(Number(summary.bookings?.outstanding_value||0))}</strong><small>فرق قيمة الحجوزات والمدفوع</small></div></div></Card>
   </div>}
   <Card><div className="card-title"><div><h3>بيانات الوكيل</h3><small>الهوية التجارية وبيانات التواصل والسياسات الأساسية.</small></div><Badge tone={agent.status==='active'?'green':'orange'}>{statusLabel(agent.status||'—')}</Badge></div>
    <div className="detail-grid">
     <div><span>كود الوكيل</span><strong>{agent.agent_code||'—'}</strong></div>
     <div><span>الاسم</span><strong>{agent.name||'—'}</strong></div>
     <div><span>الجهة / الشركة</span><strong>{agent.company_name||'—'}</strong></div>
     <div><span>الفرع</span><strong>{data?.branch?.name||'—'}</strong></div>
     <div><span>الجوال</span><strong dir="ltr">{agent.phone||'—'}</strong></div>
     <div><span>واتساب</span><strong dir="ltr">{agent.whatsapp||'—'}</strong></div>
     <div><span>البريد</span><strong>{agent.email||'—'}</strong></div>
     <div><span>السجل التجاري</span><strong>{agent.commercial_registration||'—'}</strong></div>
     <div><span>الرقم الضريبي</span><strong>{agent.tax_number||'—'}</strong></div>
     <div><span>بوابة الوكيل</span><strong>{agent.portal_enabled?'مفعلة':'غير مفعلة'}</strong></div>
    </div>
   </Card>
   {financial&&<Card><div className="card-title"><div><h3>الإعدادات المالية</h3><small>القيم الحالية المعتمدة على سجل الوكيل.</small></div></div><div className="detail-grid">
    <div><span>حد الائتمان</span><strong>{money(Number(agent.credit_limit||0))}</strong></div>
    <div><span>السماح بالآجل</span><strong>{agent.allow_credit?'نعم':'لا'}</strong></div>
    <div><span>نوع العمولة</span><strong>{agent.default_commission_type||'—'}</strong></div>
    <div><span>قيمة العمولة</span><strong>{agent.default_commission_value??'—'}</strong></div>
    <div><span>نوع الخصم</span><strong>{agent.default_discount_type||'—'}</strong></div>
    <div><span>قيمة الخصم</span><strong>{agent.default_discount_value??'—'}</strong></div>
    <div><span>حجز المجموعات</span><strong>{agent.allow_group_booking?'مسموح':'غير مسموح'}</strong></div>
   </div></Card>}
  </>}

  {['bookings','allocations','quotas'].includes(tab)&&<Card><div className="operation-filters"><Input value={q} onChange={e=>setQ(e.target.value)} placeholder={tab==='bookings'?'ابحث برقم الحجز أو العميل أو الجوال':tab==='allocations'?'ابحث بالرحلة أو النوع أو الحالة':'ابحث بالرحلة أو المورد أو الحالة'}/><Badge>{tab==='bookings'?bookings.length:tab==='allocations'?allocations.length:quotas.length} سجل</Badge></div></Card>}
  {tab==='bookings'&&<Card><div className="card-title"><div><h3>حجوزات الوكيل</h3><small>الحجوزات المرتبطة بالوكيل في بيئة الحساب الحالية.</small></div></div>{bookings.length?<Table preferenceKey={'agent360-bookings-'+id} defaultPageSize={25} rows={bookings} columns={bookingCols}/>:<div className="empty">لا توجد حجوزات مرتبطة بهذا الوكيل.</div>}</Card>}
  {tab==='allocations'&&<Card><div className="card-title"><div><h3>توزيعات الوكيل</h3><small>المقاعد والغرف والتوزيعات المخصصة للوكيل.</small></div></div>{allocations.length?<Table preferenceKey={'agent360-allocations-'+id} defaultPageSize={25} rows={allocations} columns={allocationCols}/>:<div className="empty">لا توجد توزيعات مرتبطة بهذا الوكيل.</div>}</Card>}
  {tab==='quotas'&&<Card><div className="card-title"><div><h3>Resource Quotas</h3><small>الحصص التشغيلية المرتبطة بالوكيل.</small></div></div>{quotas.length?<Table preferenceKey={'agent360-quotas-'+id} defaultPageSize={25} rows={quotas} columns={quotaCols}/>:<div className="empty">لا توجد Quotas مرتبطة بهذا الوكيل.</div>}</Card>}

  {tab==='history'&&<>
   <Card><div className="card-title"><div><h3>تكرارات محتملة لهذا الوكيل</h3><small>لا يتم الدمج مباشرة؛ كل مرشح يمر على Preview مالي وتشغيلي كامل.</small></div><Badge tone={data.duplicate_candidates?.length?'orange':'green'}>{data.duplicate_candidates?.length||0}</Badge></div>
    {data.duplicate_candidates?.length?<div className="warning-list">{data.duplicate_candidates.map((x,i)=><div key={x.record.id}><GitMerge size={16}/><div style={{flex:1}}><strong>{x.record.agent_code} · {x.record.company_name||x.record.name}</strong><div className="muted-small">{x.match.label}</div></div><Button variant="primary" onClick={()=>setMergeGroup({id:'agent360-'+i,entity_type:'agents',label:'وكيل',match:x.match.label,records:[agent,x.record]})}>معاينة الدمج</Button></div>)}</div>:<div className="success-note">لا توجد مطابقة قوية مع وكيل آخر داخل نفس الفرع.</div>}
   </Card>
   <Card><div className="card-title"><div><h3>سجل عمليات الدمج</h3><small>الأثر المحفوظ في record_merge_history لهذا الوكيل.</small></div><Badge>{data.merge_history?.length||0}</Badge></div>{data.merge_history?.length?<Table preferenceKey={'agent360-merge-history-'+id} defaultPageSize={20} rows={data.merge_history} columns={mergeCols}/>:<div className="empty">لا توجد عمليات دمج مسجلة لهذا الوكيل.</div>}</Card>
  </>}

  <AgentMergeModal group={mergeGroup} onClose={()=>setMergeGroup(null)} onMerged={async out=>{setNotice(`تم دمج الوكيل بنجاح داخل ${out?.result?.agent_code||'السجل الأساسي'} مع الاحتفاظ بأثر الدمج.`);setMergeGroup(null);await load();}}/>
 </>;
}
