import React,{useMemo,useState} from 'react';
import {BadgeDollarSign,CalendarClock,History,Package,Plus,ShieldCheck,Wrench} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table,Textarea} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function money(v){return (Number(v)||0).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2})+' ر.س'}
function dateOnly(v){return v?String(v).slice(0,10):''}
function daysLabel(v){if(v==null)return 'غير محدد';if(v<0)return 'منتهي منذ '+Math.abs(v)+' يوم';if(v===0)return 'ينتهي اليوم';return 'متبقي '+v+' يوم'}
function statusLabel(v){return ({active:'نشط',repair:'قيد الصيانة',storage:'مخزن',retired:'متقاعد'})[v]||'نشط'}
function criticalityLabel(v){return ({low:'منخفضة',medium:'متوسطة',high:'حرجة'})[v]||'متوسطة'}
function eventLabel(v){return ({purchase:'شراء',installation:'تركيب',relocation:'نقل موقع',warranty_service:'خدمة ضمان',contract_service:'خدمة عقد',repair:'إصلاح',upgrade:'ترقية',replacement_review:'مراجعة استبدال',retirement:'تقاعد',reactivation:'إعادة تشغيل',note:'ملاحظة',profile_created:'تسجيل الأصل',profile_updated:'تحديث الأصل'})[v]||v||'حدث'}
const blankAsset={device_id:'',asset_tag:'',purchase_date:'',installation_date:'',purchase_cost:'',replacement_cost:'',expected_life_months:60,warranty_start_date:'',warranty_end_date:'',service_contract_end_date:'',vendor_name:'',vendor_contact:'',criticality:'medium',asset_status:'active',notes:''};
const blankEvent={event_type:'note',event_date:'',title:'',details:'',amount:''};

export default function AttendanceDeviceLifecycle({state,onChanged,onError,onNotice,onOpenPreventive,onOpenIncidents}){
 const devices=state.devices||[],branches=state.branches||[],assets=state.deviceAssets||[],rows=state.deviceLifecycle||[],events=state.deviceAssetEvents||[],analytics=state.deviceLifecycleAnalytics||{},alerts=state.deviceLifecycleAlerts||[];
 const [filters,setFilters]=useState({q:'',branch:'',status:'',risk:'',warranty:''}),[busy,setBusy]=useState('');
 const [assetOpen,setAssetOpen]=useState(false),[assetForm,setAssetForm]=useState(blankAsset),[assetBusy,setAssetBusy]=useState(false);
 const [detailOpen,setDetailOpen]=useState(false),[detailRow,setDetailRow]=useState(null),[eventForm,setEventForm]=useState(blankEvent),[eventBusy,setEventBusy]=useState(false);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]),assetMap=useMemo(()=>new Map(assets.map(x=>[String(x.device_id),x])),[assets]);
 const eventMap=useMemo(()=>{const m=new Map();for(const e of events){const k=String(e.device_id),a=m.get(k)||[];a.push(e);m.set(k,a)}return m},[events]);
 const branchOptions=useMemo(()=>branches.map(x=>({value:String(x.id),label:x.name||x.id})),[branches]);
 const filtered=useMemo(()=>rows.filter(r=>{
  const d=deviceMap.get(String(r.device_id)),a=r.asset||assetMap.get(String(r.device_id));
  if(filters.branch&&String(r.branch_id)!==String(filters.branch))return false;
  if(filters.status&&String(a?.asset_status||'unregistered')!==filters.status)return false;
  if(filters.risk==='replace'&&!['replace_soon','replacement_review'].includes(r.recommendation))return false;
  if(filters.risk==='normal'&&r.recommendation!=='normal')return false;
  if(filters.warranty==='expired'&&!(r.warranty_days_left!=null&&r.warranty_days_left<0))return false;
  if(filters.warranty==='soon'&&!(r.warranty_days_left!=null&&r.warranty_days_left>=0&&r.warranty_days_left<=30))return false;
  if(filters.warranty==='valid'&&!(r.warranty_days_left!=null&&r.warranty_days_left>30))return false;
  return matchesListQuery(filters.q,d?.name,d?.serial_number,d?.model,a?.asset_tag,a?.vendor_name,a?.vendor_contact,branchMap.get(String(r.branch_id)),...(r.signals||[]));
 }),[rows,filters,deviceMap,assetMap,branchMap]);
 const canManage=!!(state.permissions?.manage_devices||state.permissions?.manage_policies);

 function resetFilters(){setFilters({q:'',branch:'',status:'',risk:'',warranty:''})}
 function openAsset(row){
  const d=deviceMap.get(String(row.device_id)),a=row.asset||assetMap.get(String(row.device_id));
  setAssetForm(a?{device_id:row.device_id,asset_tag:a.asset_tag||'',purchase_date:dateOnly(a.purchase_date),installation_date:dateOnly(a.installation_date),purchase_cost:a.purchase_cost??'',replacement_cost:a.replacement_cost??'',expected_life_months:a.expected_life_months??60,warranty_start_date:dateOnly(a.warranty_start_date),warranty_end_date:dateOnly(a.warranty_end_date),service_contract_end_date:dateOnly(a.service_contract_end_date),vendor_name:a.vendor_name||'',vendor_contact:a.vendor_contact||'',criticality:a.criticality||'medium',asset_status:a.asset_status||'active',notes:a.notes||''}:{...blankAsset,device_id:row.device_id,asset_tag:d?.serial_number?('ASSET-'+d.serial_number):''});setAssetOpen(true);
 }
 async function saveAsset(e){
  e.preventDefault();setAssetBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'save_device_asset',...assetForm});setAssetOpen(false);onNotice?.('تم حفظ بيانات أصل الجهاز ودورة حياته.');await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setAssetBusy(false)}
 }
 function openDetail(row){setDetailRow(row);setEventForm({...blankEvent,event_date:new Date().toISOString().slice(0,10)});setDetailOpen(true)}
 async function addEvent(e){
  e.preventDefault();if(!detailRow)return;setEventBusy(true);onError?.('');
  try{await api.attendanceWrite({action:'add_device_asset_event',device_id:detailRow.device_id,...eventForm,event_date:eventForm.event_date?eventForm.event_date+'T12:00:00+03:00':undefined});setEventForm({...blankEvent,event_date:new Date().toISOString().slice(0,10)});onNotice?.('تمت إضافة حدث دورة حياة الجهاز.');await onChanged?.()}
  catch(e2){onError?.(e2.message)}finally{setEventBusy(false)}
 }

 const cols=[
  {key:'device',label:'الجهاز / الأصل',render:r=>{const d=deviceMap.get(String(r.device_id)),a=r.asset;return <div><strong>{d?.name||'—'}</strong><div className="muted-small">{d?.model||'—'} · {d?.serial_number||'—'}</div><div className="muted-small">{a?.asset_tag?('Asset '+a.asset_tag):'غير مسجل كأصل'} · {branchMap.get(String(r.branch_id))||'—'}</div></div>}},
  {key:'status',label:'الحالة',render:r=>r.asset?<div><Badge tone={r.asset.asset_status==='retired'?'gray':r.asset.asset_status==='repair'?'orange':'green'}>{statusLabel(r.asset.asset_status)}</Badge><div className="muted-small">الأهمية: {criticalityLabel(r.asset.criticality)}</div></div>:<Badge tone="orange">بيانات الأصل ناقصة</Badge>},
  {key:'life',label:'العمر التشغيلي',render:r=><div><strong>{r.age_months==null?'—':r.age_months+' شهر'}</strong><div className="muted-small">{r.life_used_pct==null?'العمر المتوقع غير قابل للحساب':r.life_used_pct+'% من العمر المتوقع'}</div></div>},
  {key:'warranty',label:'الضمان / العقد',render:r=><div><Badge tone={r.warranty_days_left==null?'gray':r.warranty_days_left<0?'red':r.warranty_days_left<=30?'orange':'green'}>الضمان: {daysLabel(r.warranty_days_left)}</Badge><div className="muted-small" style={{marginTop:4}}>عقد الصيانة: {daysLabel(r.contract_days_left)}</div></div>},
  {key:'history',label:'أداء 12 شهر',render:r=><div><strong>{r.incidents_365d} حادثة</strong><div className="muted-small">{r.incidents_90d} خلال 90 يوم</div><div className="muted-small">تعطل {Math.round((Number(r.downtime_365_seconds)||0)/3600)} س · صيانة {money(r.maintenance_cost_365)}</div></div>},
  {key:'risk',label:'ضغط الاستبدال',render:r=><div><Badge tone={r.tone}>{r.recommendation_label} · {r.replacement_pressure_score}/100</Badge>{(r.signals||[]).slice(0,2).map((s,i)=><div className="muted-small" key={i} style={{maxWidth:280}}>{s}</div>)}</div>},
  {key:'action',label:'',render:r=><div className="finance-actions"><Button onClick={()=>openDetail(r)}><History size={14}/> السجل</Button>{canManage&&<Button onClick={()=>openAsset(r)}><Package size={14}/> بيانات الأصل</Button>}{r.recommendation!=='normal'&&r.recommendation!=='retired'&&<Button onClick={()=>onOpenPreventive?.()}><Wrench size={14}/> الصيانة</Button>}</div>}
 ];
 const eventCols=[
  {key:'date',label:'التاريخ',render:e=>fmt(e.event_date)},
  {key:'type',label:'النوع',render:e=><Badge>{eventLabel(e.event_type)}</Badge>},
  {key:'title',label:'الحدث',render:e=><div><strong>{e.title}</strong>{e.details&&<div className="muted-small">{e.details}</div>}</div>},
  {key:'amount',label:'القيمة',render:e=>Number(e.amount)>0?money(e.amount):'—'},
  {key:'actor',label:'بواسطة',render:e=>e.actor_name||e.actor_id||'النظام'}
 ];
 const detailEvents=detailRow?eventMap.get(String(detailRow.device_id))||[]:[];

 return <>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>أصول مسجلة</span><strong>{analytics.registered_assets||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>أجهزة بلا ملف أصل</span><strong>{analytics.unregistered_devices||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>ضمان ينتهي ≤ 30 يوم</span><strong>{analytics.warranty_expiring||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تحتاج مراجعة استبدال</span><strong>{Number(analytics.replacement_review||0)+Number(analytics.replace_soon||0)}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><Package size={19}/> Device Asset Lifecycle</h3><small>العمر، الضمان، عقد الصيانة، التكلفة التاريخية، الحوادث، وزمن التعطل في مكان واحد.</small></div><Badge tone={Number(analytics.replace_soon||0)>0?'red':Number(analytics.replacement_review||0)>0?'orange':'green'}>{Number(analytics.replace_soon||0)>0?'يوجد استبدال قريب':Number(analytics.replacement_review||0)>0?'توجد أجهزة للمراجعة':'دورة الحياة مستقرة'}</Badge></div>
   <SmartListFilters storageKey="attendance-device-lifecycle-filters" search={filters.q} onSearchChange={v=>setFilters(x=>({...x,q:v}))} searchPlaceholder="ابحث بالجهاز أو Asset Tag أو المورد..." totalCount={rows.length} resultCount={filtered.length} onReset={resetFilters} filters={[
    {key:'branch',label:'الفرع',value:filters.branch,onChange:v=>setFilters(x=>({...x,branch:v})),options:branchOptions},
    {key:'status',label:'حالة الأصل',value:filters.status,onChange:v=>setFilters(x=>({...x,status:v})),options:[{value:'unregistered',label:'غير مسجل'},{value:'active',label:'نشط'},{value:'repair',label:'قيد الصيانة'},{value:'storage',label:'مخزن'},{value:'retired',label:'متقاعد'}]},
    {key:'risk',label:'قرار الاستبدال',value:filters.risk,onChange:v=>setFilters(x=>({...x,risk:v})),options:[{value:'replace',label:'مراجعة / استبدال'},{value:'normal',label:'طبيعي'}]},
    {key:'warranty',label:'الضمان',value:filters.warranty,onChange:v=>setFilters(x=>({...x,warranty:v})),options:[{value:'expired',label:'منتهي'},{value:'soon',label:'ينتهي قريبًا'},{value:'valid',label:'ساري'}]}
   ]}/>
   {filtered.length?<Table preferenceKey="attendance-device-lifecycle" defaultPageSize={25} rows={filtered} columns={cols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد أجهزة مطابقة للفلاتر الحالية.</div>}
  </Card>
  <div className="stats-grid">
   <Card><div className="card-title"><h3><BadgeDollarSign size={18}/> قيمة الشراء المسجلة</h3></div><div className="stat-card"><div><span>إجمالي الأصول المسجلة</span><strong style={{fontSize:18}}>{money(analytics.total_purchase_value)}</strong></div></div></Card>
   <Card><div className="card-title"><h3>قيمة الاستبدال التقديرية</h3></div><div className="stat-card"><div><span>حسب الملفات المسجلة</span><strong style={{fontSize:18}}>{money(analytics.total_replacement_value)}</strong></div></div></Card>
   <Card><div className="card-title"><h3>تكلفة الصيانة — 12 شهر</h3></div><div className="stat-card"><div><span>وقائية + أعطال موثقة</span><strong style={{fontSize:18}}>{money(analytics.maintenance_cost_365)}</strong></div></div></Card>
   <Card><div className="card-title"><h3><CalendarClock size={18}/> عقود تنتهي قريبًا</h3></div><div className="stat-card"><div><span>خلال 30 يوم</span><strong>{analytics.contract_expiring||0}</strong></div></div></Card>
  </div>
  {alerts.length>0&&<Card><div className="card-title"><div><h3>تنبيهات دورة الحياة</h3><small>الضمان والعقود ومؤشرات الاستبدال تظهر أيضًا في مركز التنبيهات.</small></div><Badge tone="orange">{alerts.length}</Badge></div><div style={{display:'grid',gap:8}}>{alerts.slice(0,12).map((a,i)=><div key={a.notification_key||i} className="training-banner"><strong>{a.title}</strong><div>{a.message}</div></div>)}</div></Card>}

  <Modal open={assetOpen} onClose={()=>setAssetOpen(false)} title="بيانات أصل جهاز البصمة" wide>
   <form onSubmit={saveAsset} className="form-grid">
    <Field label="الجهاز"><Select value={assetForm.device_id} onChange={e=>setAssetForm(x=>({...x,device_id:e.target.value}))} required><option value="">اختر الجهاز</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name} — {d.serial_number}</option>)}</Select></Field>
    <Field label="Asset Tag"><Input value={assetForm.asset_tag} onChange={e=>setAssetForm(x=>({...x,asset_tag:e.target.value}))} placeholder="مثال: BIO-MKK-001"/></Field>
    <Field label="تاريخ الشراء"><Input type="date" value={assetForm.purchase_date} onChange={e=>setAssetForm(x=>({...x,purchase_date:e.target.value}))}/></Field>
    <Field label="تاريخ التركيب"><Input type="date" value={assetForm.installation_date} onChange={e=>setAssetForm(x=>({...x,installation_date:e.target.value}))}/></Field>
    <Field label="تكلفة الشراء"><Input type="number" min="0" step="0.01" value={assetForm.purchase_cost} onChange={e=>setAssetForm(x=>({...x,purchase_cost:e.target.value}))}/></Field>
    <Field label="تكلفة الاستبدال الحالية"><Input type="number" min="0" step="0.01" value={assetForm.replacement_cost} onChange={e=>setAssetForm(x=>({...x,replacement_cost:e.target.value}))}/></Field>
    <Field label="العمر المتوقع — شهر"><Input type="number" min="1" max="240" value={assetForm.expected_life_months} onChange={e=>setAssetForm(x=>({...x,expected_life_months:e.target.value}))}/></Field>
    <Field label="أهمية الجهاز"><Select value={assetForm.criticality} onChange={e=>setAssetForm(x=>({...x,criticality:e.target.value}))}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">حرجة</option></Select></Field>
    <Field label="حالة الأصل"><Select value={assetForm.asset_status} onChange={e=>setAssetForm(x=>({...x,asset_status:e.target.value}))}><option value="active">نشط</option><option value="repair">قيد الصيانة</option><option value="storage">مخزن</option><option value="retired">متقاعد</option></Select></Field>
    <Field label="بداية الضمان"><Input type="date" value={assetForm.warranty_start_date} onChange={e=>setAssetForm(x=>({...x,warranty_start_date:e.target.value}))}/></Field>
    <Field label="نهاية الضمان"><Input type="date" value={assetForm.warranty_end_date} onChange={e=>setAssetForm(x=>({...x,warranty_end_date:e.target.value}))}/></Field>
    <Field label="نهاية عقد الصيانة"><Input type="date" value={assetForm.service_contract_end_date} onChange={e=>setAssetForm(x=>({...x,service_contract_end_date:e.target.value}))}/></Field>
    <Field label="المورد"><Input value={assetForm.vendor_name} onChange={e=>setAssetForm(x=>({...x,vendor_name:e.target.value}))}/></Field>
    <Field label="تواصل المورد"><Input value={assetForm.vendor_contact} onChange={e=>setAssetForm(x=>({...x,vendor_contact:e.target.value}))}/></Field>
    <Field label="ملاحظات"><Textarea rows="3" value={assetForm.notes} onChange={e=>setAssetForm(x=>({...x,notes:e.target.value}))}/></Field>
    <div className="modal-actions"><Button type="button" onClick={()=>setAssetOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={assetBusy}>{assetBusy?'جاري الحفظ...':'حفظ الأصل'}</Button></div>
   </form>
  </Modal>

  <Modal open={detailOpen} onClose={()=>setDetailOpen(false)} title={detailRow?'سجل دورة الحياة — '+(deviceMap.get(String(detailRow.device_id))?.name||'الجهاز'):'سجل دورة الحياة'} wide>
   {detailRow&&<div style={{display:'grid',gap:14}}>
    <div className="stats-grid"><Card><div className="stat-card"><div><span>العمر</span><strong>{detailRow.age_months==null?'—':detailRow.age_months+' شهر'}</strong></div></div></Card><Card><div className="stat-card"><div><span>حوادث 90 يوم</span><strong>{detailRow.incidents_90d}</strong></div></div></Card><Card><div className="stat-card"><div><span>صيانة 12 شهر</span><strong style={{fontSize:17}}>{money(detailRow.maintenance_cost_365)}</strong></div></div></Card><Card><div className="stat-card"><div><span>ضغط الاستبدال</span><strong>{detailRow.replacement_pressure_score}/100</strong></div></div></Card></div>
    <Card><div className="card-title"><div><h3><History size={18}/> Timeline الأصل</h3><small>شراء، تركيب، نقل، ضمان، إصلاح، ترقية ومراجعة استبدال.</small></div><Badge>{detailEvents.length}</Badge></div>{detailEvents.length?<Table preferenceKey={'attendance-device-asset-events-'+detailRow.device_id} defaultPageSize={25} rows={detailEvents} columns={eventCols}/>:<div className="muted-small">لا توجد أحداث مسجلة بعد.</div>}</Card>
    {canManage&&<Card><div className="card-title"><h3><Plus size={18}/> إضافة حدث</h3></div><form onSubmit={addEvent} className="form-grid">
     <Field label="النوع"><Select value={eventForm.event_type} onChange={e=>setEventForm(x=>({...x,event_type:e.target.value}))}><option value="note">ملاحظة</option><option value="purchase">شراء</option><option value="installation">تركيب</option><option value="relocation">نقل موقع</option><option value="warranty_service">خدمة ضمان</option><option value="contract_service">خدمة عقد</option><option value="repair">إصلاح</option><option value="upgrade">ترقية</option><option value="replacement_review">مراجعة استبدال</option><option value="retirement">تقاعد</option><option value="reactivation">إعادة تشغيل</option></Select></Field>
     <Field label="التاريخ"><Input type="date" value={eventForm.event_date} onChange={e=>setEventForm(x=>({...x,event_date:e.target.value}))}/></Field>
     <Field label="العنوان"><Input required value={eventForm.title} onChange={e=>setEventForm(x=>({...x,title:e.target.value}))}/></Field>
     <Field label="القيمة / التكلفة"><Input type="number" min="0" step="0.01" value={eventForm.amount} onChange={e=>setEventForm(x=>({...x,amount:e.target.value}))}/></Field>
     <Field label="التفاصيل"><Textarea rows="3" value={eventForm.details} onChange={e=>setEventForm(x=>({...x,details:e.target.value}))}/></Field>
     <div className="modal-actions"><Button variant="primary" type="submit" disabled={eventBusy}>{eventBusy?'جاري الإضافة...':'إضافة للسجل'}</Button></div>
    </form></Card>}
    <div className="modal-actions"><Button onClick={()=>onOpenIncidents?.()}>فتح الحوادث</Button><Button onClick={()=>onOpenPreventive?.()}>فتح الصيانة الوقائية</Button></div>
   </div>}
  </Modal>
 </>;
}
