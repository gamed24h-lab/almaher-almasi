import React,{useEffect,useMemo,useState} from 'react';
import {BellRing,CheckCheck,Eye,Link2,Mail,MessageCircle,RotateCcw,ServerCog,Settings2,ShieldCheck} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Field,Input,Modal,Select,Table} from '../../components/UI.jsx';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
function severityView(v){
 if(v==='critical')return {tone:'red',label:'حرج'};
 if(v==='warning')return {tone:'orange',label:'تحذير'};
 return {tone:'blue',label:'معلومة'};
}
function statusView(v,active){
 if(v==='resolved')return {tone:'green',label:active?'تمت المعالجة — الحالة ما زالت قائمة':'تم الحل'};
 if(v==='seen')return {tone:'blue',label:'تمت المشاهدة'};
 return {tone:'orange',label:'جديد'};
}
function categoryLabel(v){return v==='predictive'?'استباقي':v==='linking'?'ربط الحركات':v==='device_health'?'صحة الجهاز':v==='maintenance'?'صيانة وقائية':'كل الأنواع'}
function severityLabel(v){return v==='critical'?'حرج':v==='warning'?'تحذير':v==='info'?'معلومة':'كل الأولويات'}
function roleLabel(v){return v||'بدون مستلم'}
function levelLabel(v){const n=Number(v)||0;return n>=3?'المستوى 3 — مدير عام':n===2?'المستوى 2 — مدير فرع':n===1?'المستوى 1 — موارد بشرية':'لم يبدأ التصعيد'}
function deliveryStatus(v){
 if(v==='delivered'||v==='read')return {tone:'green',label:v==='read'?'تمت القراءة':'تم التسليم'};
 if(v==='sent')return {tone:'green',label:'تم الإرسال'};
 if(v==='queued'||v==='sending')return {tone:'blue',label:v==='sending'?'جاري الإرسال':'في الطابور'};
 if(v==='failed')return {tone:'red',label:'فشل'};
 if(v==='blocked')return {tone:'orange',label:'محجوب'};
 if(v==='cancelled')return {tone:'gray',label:'ملغي'};
 return {tone:'orange',label:'جاهز'};
}
const blankRule={id:'',branch_id:'',category:'*',severity:'warning',active:true,level1_minutes:0,level2_minutes:120,level3_minutes:240,level1_role:'الموارد البشرية',level2_role:'مدير فرع',level3_role:'مدير عام',whatsapp:false,email:false};
const blankDeliverySettings={whatsapp_enabled:false,email_enabled:false,auto_dispatch:false,whatsapp_provider:'notification_jobs',email_provider:''};

export default function AttendanceNotifications({state,onChanged,onError,onNotice,onOpenDevices,onOpenLinks}){
 const notifications=state.notifications||[],devices=state.devices||[],branches=state.branches||[],counts=state.notificationCounts||{},rules=state.escalationRules||[],events=state.escalationEvents||[],deliveries=state.deliveries||[],deliveryCounts=state.deliveryCounts||{},deliverySettings=state.deliverySettings||blankDeliverySettings,watchdog=state.watchdog||null;
 const [status,setStatus]=useState('open'),[severity,setSeverity]=useState('all'),[deviceId,setDeviceId]=useState('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState('');
 const [rulesOpen,setRulesOpen]=useState(false),[ruleForm,setRuleForm]=useState(blankRule),[ruleBusy,setRuleBusy]=useState(false),[deliveryForm,setDeliveryForm]=useState(blankDeliverySettings),[deliveryBusy,setDeliveryBusy]=useState(false);
 useEffect(()=>{setDeliveryForm({...blankDeliverySettings,...deliverySettings,email_provider:deliverySettings?.email_provider||''})},[deliverySettings?.whatsapp_enabled,deliverySettings?.email_enabled,deliverySettings?.auto_dispatch,deliverySettings?.whatsapp_provider,deliverySettings?.email_provider]);
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]),branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x.name||x.id])),[branches]);
 const lastEscalationByNotification=useMemo(()=>{const m=new Map();for(const e of events){const k=String(e.notification_id);if(!m.has(k))m.set(k,e)}return m},[events]);
 const rows=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return notifications.filter(n=>{
   if(status==='open'&&!n.active)return false;
   if(status==='new'&&n.status!=='new')return false;
   if(status==='seen'&&n.status!=='seen')return false;
   if(status==='resolved'&&n.status!=='resolved')return false;
   if(severity!=='all'&&n.severity!==severity)return false;
   if(deviceId!=='all'&&String(n.device_id)!==String(deviceId))return false;
   if(q){
    const d=deviceMap.get(String(n.device_id));
    const hay=[n.title,n.message,n.category,d?.name,d?.serial_number,branchMap.get(String(n.branch_id)),...(n.target_roles||[])].filter(Boolean).join(' ').toLowerCase();
    if(!hay.includes(q))return false;
   }
   return true;
  });
 },[notifications,status,severity,deviceId,query,deviceMap,branchMap]);

 async function update(row,notification_action){
  setBusy(row.id+notification_action);onError?.('');
  try{
   await api.attendanceWrite({action:'update_notification',id:row.id,notification_action});
   onNotice?.(notification_action==='seen'?'تم تحديد التنبيه كمشاهَد.':'تم تسجيل التنبيه كمعالَج.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function markAllSeen(){
  setBusy('all');onError?.('');
  try{
   const out=await api.attendanceWrite({action:'mark_notifications_seen'});
   onNotice?.('تم تحديد '+String(out?.count||0)+' تنبيه جديد كمشاهَد.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 function openTarget(row){
  if(row.category==='linking'){onOpenLinks?.();return}
  onOpenDevices?.();
 }
 function editRule(r){
  setRuleForm({id:r.id||'',branch_id:r.branch_id||'',category:r.category||'*',severity:r.severity||'*',active:r.active!==false,level1_minutes:r.level1_minutes??'',level2_minutes:r.level2_minutes??'',level3_minutes:r.level3_minutes??'',level1_role:r.level1_roles?.[0]||'',level2_role:r.level2_roles?.[0]||'',level3_role:r.level3_roles?.[0]||'',whatsapp:r.channels?.whatsapp===true,email:r.channels?.email===true});
 }
 async function saveRule(e){
  e.preventDefault();setRuleBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_escalation_rule',id:ruleForm.id||undefined,branch_id:ruleForm.branch_id||null,category:ruleForm.category,severity:ruleForm.severity,active:ruleForm.active,level1_minutes:ruleForm.level1_minutes,level2_minutes:ruleForm.level2_minutes,level3_minutes:ruleForm.level3_minutes,level1_roles:ruleForm.level1_role?[ruleForm.level1_role]:[],level2_roles:ruleForm.level2_role?[ruleForm.level2_role]:[],level3_roles:ruleForm.level3_role?[ruleForm.level3_role]:[],channels:{in_app:true,whatsapp:ruleForm.whatsapp===true,email:ruleForm.email===true}});
   onNotice?.('تم حفظ قاعدة تصعيد التنبيهات.');setRuleForm(blankRule);await onChanged?.();
  }catch(e2){onError?.(e2.message)}finally{setRuleBusy(false)}
 }
 async function saveDeliverySettings(e){
  e.preventDefault();setDeliveryBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_delivery_settings',whatsapp_enabled:deliveryForm.whatsapp_enabled===true,email_enabled:deliveryForm.email_enabled===true,auto_dispatch:deliveryForm.auto_dispatch===true,whatsapp_provider:deliveryForm.whatsapp_provider||'notification_jobs',email_provider:deliveryForm.email_provider||null});
   onNotice?.('تم حفظ إعدادات قنوات تصعيد التنبيهات.');await onChanged?.();
  }catch(e2){onError?.(e2.message)}finally{setDeliveryBusy(false)}
 }
 async function retryDelivery(row){
  setBusy('delivery-'+row.id);onError?.('');
  try{await api.attendanceWrite({action:'retry_notification_delivery',id:row.id});onNotice?.('تمت إعادة محاولة إرسال التنبيه إلى الطابور.');await onChanged?.()}
  catch(e){onError?.(e.message)}finally{setBusy('')}
 }
 async function runWatchdog(){
  setBusy('watchdog');onError?.('');
  try{
   const out=await api.attendanceWrite({action:'run_watchdog'});
   onNotice?.('اكتمل الفحص الخلفي: '+String(out?.devices_count||0)+' أجهزة · '+String(out?.active_notifications||0)+' تنبيهات نشطة.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }

 const cols=[
  {key:'severity',label:'الأولوية',render:r=>{const x=severityView(r.severity);return <Badge tone={x.tone}>{x.label}</Badge>}},
  {key:'alert',label:'التنبيه',render:r=><div><strong>{r.title}</strong><div className="muted-small" style={{marginTop:3,maxWidth:500}}>{r.message||'—'}</div><div className="muted-small" style={{marginTop:3}}>{categoryLabel(r.category)}</div></div>},
  {key:'device',label:'الجهاز / الفرع',render:r=>{const d=deviceMap.get(String(r.device_id));return <div><strong>{d?.name||'—'}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))||'—'}</div>{d?.serial_number&&<div className="muted-small" dir="ltr">{d.serial_number}</div>}</div>}},
  {key:'escalation',label:'التصعيد',render:r=>{const level=Number(r.escalation_level)||0,last=lastEscalationByNotification.get(String(r.id));return <div><Badge tone={level>=3?'red':level>=2?'orange':level>=1?'blue':'gray'}>{levelLabel(level)}</Badge><div className="muted-small" style={{marginTop:3}}>{(r.target_roles||[]).length?'موجّه إلى: '+r.target_roles.join('، '):'بانتظار موعد التصعيد'}</div>{r.next_escalation_at&&<div className="muted-small">التالي: {fmt(r.next_escalation_at)}</div>}{last&&<div className="muted-small">آخر تصعيد: {fmt(last.created_at)}</div>}</div>}},
  {key:'status',label:'الحالة',render:r=>{const x=statusView(r.status,r.active);return <div><Badge tone={x.tone}>{x.label}</Badge>{!r.active&&<div className="muted-small">الحالة الأصلية زالت</div>}</div>}},
  {key:'time',label:'آخر ظهور',render:r=><div><strong>{fmt(r.last_seen_at)}</strong><div className="muted-small">أول ظهور: {fmt(r.first_seen_at)}</div></div>},
  {key:'actions',label:'',render:r=><div className="finance-actions"><Button onClick={()=>openTarget(r)}>{r.category==='linking'?<Link2 size={14}/>:<ServerCog size={14}/>} فتح</Button>{r.status==='new'&&<Button onClick={()=>update(r,'seen')} disabled={busy===r.id+'seen'}><Eye size={14}/> تمت المشاهدة</Button>}{r.status!=='resolved'&&(state.permissions?.manage_devices||state.permissions?.manage_links)&&<Button variant="primary" onClick={()=>update(r,'resolved')} disabled={busy===r.id+'resolved'}><CheckCheck size={14}/> تمت المعالجة</Button>}</div>}
 ];
 const ruleCols=[
  {key:'match',label:'ينطبق على',render:r=><div><strong>{categoryLabel(r.category)} · {severityLabel(r.severity)}</strong><div className="muted-small">{r.branch_id?branchMap.get(String(r.branch_id))||'فرع محدد':'كل الفروع'}</div></div>},
  {key:'l1',label:'المستوى 1',render:r=><div><strong>{r.level1_minutes==null?'معطل':r.level1_minutes+' دقيقة'}</strong><div className="muted-small">{(r.level1_roles||[]).join('، ')||'—'}</div></div>},
  {key:'l2',label:'المستوى 2',render:r=><div><strong>{r.level2_minutes==null?'معطل':r.level2_minutes+' دقيقة'}</strong><div className="muted-small">{(r.level2_roles||[]).join('، ')||'—'}</div></div>},
  {key:'l3',label:'المستوى 3',render:r=><div><strong>{r.level3_minutes==null?'معطل':r.level3_minutes+' دقيقة'}</strong><div className="muted-small">{(r.level3_roles||[]).join('، ')||'—'}</div></div>},
  {key:'channels',label:'القنوات',render:r=><div className="finance-actions"><Badge tone="blue">داخل النظام</Badge>{r.channels?.whatsapp===true&&<Badge tone="green">WhatsApp</Badge>}{r.channels?.email===true&&<Badge tone="blue">Email</Badge>}</div>},
  {key:'active',label:'الحالة',render:r=><Badge tone={r.active===false?'gray':'green'}>{r.active===false?'موقوفة':'نشطة'}</Badge>},
  {key:'action',label:'',render:r=><Button onClick={()=>editRule(r)}>تعديل</Button>}
 ];
 const deliveryCols=[
  {key:'channel',label:'القناة',render:r=>r.channel==='whatsapp'?<Badge tone="green"><MessageCircle size={13}/> WhatsApp</Badge>:r.channel==='email'?<Badge tone="blue"><Mail size={13}/> Email</Badge>:<Badge tone="blue">داخل النظام</Badge>},
  {key:'recipient',label:'المستلم',render:r=><div><strong>{r.recipient_name||'—'}</strong><div className="muted-small">{r.recipient_role||'—'} · {r.destination_masked||'—'}</div></div>},
  {key:'alert',label:'التنبيه',render:r=><div><strong>{r.metadata?.notification_title||'تنبيه حضور'}</strong><div className="muted-small">مستوى التصعيد {r.escalation_level||0}</div></div>},
  {key:'status',label:'حالة الإرسال',render:r=>{const x=deliveryStatus(r.status);return <div><Badge tone={x.tone}>{x.label}</Badge>{r.error_text&&<div className="muted-small" style={{maxWidth:300}}>{r.error_text}</div>}</div>}},
  {key:'attempts',label:'المحاولات',render:r=>r.attempt_count??0},
  {key:'time',label:'الوقت',render:r=><div>{fmt(r.delivered_at||r.sent_at||r.queued_at||r.created_at)}{r.provider&&<div className="muted-small">{r.provider}</div>}</div>},
  {key:'action',label:'',render:r=>r.channel==='whatsapp'&&['failed','cancelled'].includes(r.status)&&deliverySettings.whatsapp_enabled?<Button onClick={()=>retryDelivery(r)} disabled={busy==='delivery-'+r.id}><RotateCcw size={14}/> إعادة المحاولة</Button>:'—'}
 ];

 return <>
  <Card>
   <div className="card-title"><div><h3><RotateCcw size={19}/> المراقب الخلفي للتنبيهات</h3><small>يفحص صحة الأجهزة والتصعيد وسجل التوصيل تلقائيًا كل 5 دقائق حتى لو لم تكن صفحة الحضور مفتوحة.</small></div><div className="finance-actions"><Badge tone={watchdog?.status==='failed'?'red':watchdog?.status==='running'?'blue':watchdog?.status==='success'?'green':'gray'}>{watchdog?.status==='failed'?'آخر فحص فشل':watchdog?.status==='running'?'الفحص يعمل الآن':watchdog?.status==='success'?'يعمل تلقائيًا':'بانتظار أول تشغيل'}</Badge>{state.permissions?.manage_policies&&<Button onClick={runWatchdog} disabled={busy==='watchdog'}><RotateCcw size={15}/>{busy==='watchdog'?' جاري الفحص...':' تشغيل الفحص الآن'}</Button>}</div></div>
   <div className="stats-grid">
    <Card><div className="stat-card"><div><span>آخر تشغيل</span><strong style={{fontSize:16}}>{fmt(watchdog?.completed_at||watchdog?.started_at)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>الأجهزة المفحوصة</span><strong>{watchdog?.devices_count??'—'}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>تنبيهات نشطة</span><strong>{watchdog?.active_notifications??'—'}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>تصعيدات نشطة</span><strong>{watchdog?.escalations_count??'—'}</strong></div></div></Card>
   </div>
   {watchdog?.status==='failed'&&watchdog?.error_text&&<div className="training-banner" style={{marginTop:12}}>{watchdog.error_text}</div>}
  </Card>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>جديد</span><strong>{counts.new||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تنبيهات نشطة</span><strong>{counts.active||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>وصلت لمدير فرع</span><strong>{counts.level2||0}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>وصلت للمدير العام</span><strong>{counts.level3||0}</strong></div></div></Card>
  </div>
  <Card>
   <div className="card-title"><div><h3><BellRing size={19}/> مركز تنبيهات الحضور والأجهزة</h3><small>التنبيهات تُجمع من صحة الأجهزة، المراقبة الاستباقية، والأرقام التي تحتاج ربط موظف، ثم تُصعّد تلقائيًا حسب المدة والأولوية.</small></div><div className="finance-actions">{state.permissions?.manage_policies&&<Button onClick={()=>setRulesOpen(true)}><Settings2 size={15}/> قواعد التصعيد</Button>}{Number(counts.new||0)>0&&<Button onClick={markAllSeen} disabled={busy==='all'}><Eye size={15}/>{busy==='all'?' جاري التحديث...':' مشاهدة الكل'}</Button>}<Badge tone={Number(counts.critical||0)>0?'red':Number(counts.active||0)>0?'orange':'green'}>{Number(counts.active||0)>0?'توجد تنبيهات نشطة':'لا توجد تنبيهات نشطة'}</Badge></div></div>
   <div className="form-grid" style={{marginBottom:14}}>
    <Field label="بحث"><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="اسم الجهاز، الفرع، الرسالة، المستلم..."/></Field>
    <Field label="الحالة"><Select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">النشطة</option><option value="all">الكل</option><option value="new">جديد</option><option value="seen">تمت المشاهدة</option><option value="resolved">تم الحل / المعالجة</option></Select></Field>
    <Field label="الأولوية"><Select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">كل الأولويات</option><option value="critical">حرج</option><option value="warning">تحذير</option><option value="info">معلومة</option></Select></Field>
    <Field label="الجهاز"><Select value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="all">كل الأجهزة</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
   </div>
   {rows.length?<Table preferenceKey="attendance-notification-center" defaultPageSize={25} rows={rows} columns={cols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد تنبيهات مطابقة للفلاتر الحالية.</div>}
  </Card>
  <Card>
   <div className="card-title"><div><h3><MessageCircle size={19}/> سجل توصيل التصعيد</h3><small>كل مستلم وقناة لها حالة مستقلة: جاهز، في الطابور، تم الإرسال، تم التسليم أو فشل.</small></div><div className="finance-actions"><Badge tone={deliverySettings.auto_dispatch?'green':'orange'}>{deliverySettings.auto_dispatch?'الإرسال الآلي مفعّل':'الإرسال الآلي متوقف'}</Badge><Badge>{deliveries.length}</Badge></div></div>
   <div className="stats-grid" style={{marginBottom:14}}>
    <Card><div className="stat-card"><div><span>في الطابور</span><strong>{(deliveryCounts.queued||0)+(deliveryCounts.sending||0)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>تم التسليم</span><strong>{(deliveryCounts.delivered||0)+(deliveryCounts.read||0)}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>فشل</span><strong>{deliveryCounts.failed||0}</strong></div></div></Card>
    <Card><div className="stat-card"><div><span>محجوب</span><strong>{deliveryCounts.blocked||0}</strong></div></div></Card>
   </div>
   {deliveries.length?<Table preferenceKey="attendance-notification-deliveries" defaultPageSize={25} rows={deliveries} columns={deliveryCols}/>:<div className="success-note"><ShieldCheck size={16}/> لا توجد محاولات توصيل حتى الآن؛ ستظهر مع أول تصعيد لمستلم.</div>}
  </Card>

  <Modal open={rulesOpen} onClose={()=>setRulesOpen(false)} title="قواعد تصعيد تنبيهات الحضور" wide>
   <div style={{display:'grid',gap:14}}>
    <div className="success-note"><ShieldCheck size={16}/> القنوات الخارجية لها مفتاح أمان عام. حتى لو فعّلت WhatsApp داخل قاعدة معينة، لن يدخل شيء للطابور الخارجي إلا بعد تفعيل القناة والإرسال الآلي من الإعدادات أدناه.</div>
    <Card><div className="card-title"><div><h3>قنوات التوصيل الخارجية</h3><small>WhatsApp مرتبط بطابور الإشعارات المركزي. البريد يظل محجوبًا حتى يوجد عنوان للموظف ومزود Email معتمد.</small></div></div><form onSubmit={saveDeliverySettings} className="form-grid">
     <Field label="WhatsApp"><Select value={deliveryForm.whatsapp_enabled?'true':'false'} onChange={e=>setDeliveryForm(x=>({...x,whatsapp_enabled:e.target.value==='true'}))}><option value="false">موقوف</option><option value="true">مفعّل</option></Select></Field>
     <Field label="Email"><Select value={deliveryForm.email_enabled?'true':'false'} onChange={e=>setDeliveryForm(x=>({...x,email_enabled:e.target.value==='true'}))}><option value="false">موقوف</option><option value="true">مفعّل</option></Select></Field>
     <Field label="الإرسال الآلي"><Select value={deliveryForm.auto_dispatch?'true':'false'} onChange={e=>setDeliveryForm(x=>({...x,auto_dispatch:e.target.value==='true'}))}><option value="false">متوقف — تسجيل فقط</option><option value="true">مفعّل — إدراج تلقائي بالطابور</option></Select></Field>
     <Field label="مزود Email"><Input value={deliveryForm.email_provider||''} onChange={e=>setDeliveryForm(x=>({...x,email_provider:e.target.value}))} placeholder="اتركه فارغًا حتى ربط مزود بريد"/></Field>
     <div className="modal-actions"><Button variant="primary" type="submit" disabled={deliveryBusy}>{deliveryBusy?'جاري الحفظ...':'حفظ إعدادات التوصيل'}</Button></div>
    </form></Card>
    <Card><div className="card-title"><div><h3>القواعد الحالية</h3><small>القاعدة الأكثر تحديدًا للفرع/النوع/الأولوية تتغلب على القاعدة العامة.</small></div><Button onClick={()=>setRuleForm(blankRule)}>قاعدة جديدة</Button></div><Table preferenceKey="attendance-escalation-rules" defaultPageSize={25} rows={rules} columns={ruleCols}/></Card>
    <Card><div className="card-title"><h3>{ruleForm.id?'تعديل قاعدة التصعيد':'قاعدة تصعيد جديدة'}</h3></div><form onSubmit={saveRule} className="form-grid">
     <Field label="الفرع"><Select value={ruleForm.branch_id||''} onChange={e=>setRuleForm(x=>({...x,branch_id:e.target.value}))} disabled={!state.scope?.all_branches}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
     <Field label="نوع التنبيه"><Select value={ruleForm.category} onChange={e=>setRuleForm(x=>({...x,category:e.target.value}))}><option value="*">كل الأنواع</option><option value="device_health">صحة الجهاز</option><option value="predictive">استباقي</option><option value="linking">ربط الحركات</option><option value="maintenance">صيانة وقائية</option></Select></Field>
     <Field label="الأولوية"><Select value={ruleForm.severity} onChange={e=>setRuleForm(x=>({...x,severity:e.target.value}))}><option value="*">كل الأولويات</option><option value="critical">حرج</option><option value="warning">تحذير</option><option value="info">معلومة</option></Select></Field>
     <Field label="الحالة"><Select value={ruleForm.active?'true':'false'} onChange={e=>setRuleForm(x=>({...x,active:e.target.value==='true'}))}><option value="true">نشطة</option><option value="false">موقوفة</option></Select></Field>

     <Field label="المستوى 1 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level1_minutes} onChange={e=>setRuleForm(x=>({...x,level1_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 1"><Select value={ruleForm.level1_role} onChange={e=>setRuleForm(x=>({...x,level1_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <Field label="المستوى 2 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level2_minutes} onChange={e=>setRuleForm(x=>({...x,level2_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 2"><Select value={ruleForm.level2_role} onChange={e=>setRuleForm(x=>({...x,level2_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <Field label="المستوى 3 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level3_minutes} onChange={e=>setRuleForm(x=>({...x,level3_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 3"><Select value={ruleForm.level3_role} onChange={e=>setRuleForm(x=>({...x,level3_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <Field label="إرسال WhatsApp عند التصعيد"><Select value={ruleForm.whatsapp?'true':'false'} onChange={e=>setRuleForm(x=>({...x,whatsapp:e.target.value==='true'}))}><option value="false">لا</option><option value="true">نعم</option></Select></Field>
     <Field label="إرسال Email عند التصعيد"><Select value={ruleForm.email?'true':'false'} onChange={e=>setRuleForm(x=>({...x,email:e.target.value==='true'}))}><option value="false">لا</option><option value="true">نعم</option></Select></Field>
     <div className="modal-actions"><Button type="button" onClick={()=>setRuleForm(blankRule)}>تفريغ</Button><Button variant="primary" type="submit" disabled={ruleBusy}>{ruleBusy?'جاري الحفظ...':'حفظ القاعدة'}</Button></div>
    </form></Card>
   </div>
  </Modal>
 </>;
}
