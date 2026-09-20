import React,{useMemo,useState} from 'react';
import {BellRing,CheckCheck,Eye,Link2,ServerCog,Settings2,ShieldCheck} from 'lucide-react';
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
function categoryLabel(v){return v==='predictive'?'استباقي':v==='linking'?'ربط الحركات':v==='device_health'?'صحة الجهاز':'كل الأنواع'}
function severityLabel(v){return v==='critical'?'حرج':v==='warning'?'تحذير':v==='info'?'معلومة':'كل الأولويات'}
function roleLabel(v){return v||'بدون مستلم'}
function levelLabel(v){const n=Number(v)||0;return n>=3?'المستوى 3 — مدير عام':n===2?'المستوى 2 — مدير فرع':n===1?'المستوى 1 — موارد بشرية':'لم يبدأ التصعيد'}
const blankRule={id:'',branch_id:'',category:'*',severity:'warning',active:true,level1_minutes:0,level2_minutes:120,level3_minutes:240,level1_role:'الموارد البشرية',level2_role:'مدير فرع',level3_role:'مدير عام'};

export default function AttendanceNotifications({state,onChanged,onError,onNotice,onOpenDevices,onOpenLinks}){
 const notifications=state.notifications||[],devices=state.devices||[],branches=state.branches||[],counts=state.notificationCounts||{},rules=state.escalationRules||[],events=state.escalationEvents||[];
 const [status,setStatus]=useState('open'),[severity,setSeverity]=useState('all'),[deviceId,setDeviceId]=useState('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState('');
 const [rulesOpen,setRulesOpen]=useState(false),[ruleForm,setRuleForm]=useState(blankRule),[ruleBusy,setRuleBusy]=useState(false);
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
  setRuleForm({id:r.id||'',branch_id:r.branch_id||'',category:r.category||'*',severity:r.severity||'*',active:r.active!==false,level1_minutes:r.level1_minutes??'',level2_minutes:r.level2_minutes??'',level3_minutes:r.level3_minutes??'',level1_role:r.level1_roles?.[0]||'',level2_role:r.level2_roles?.[0]||'',level3_role:r.level3_roles?.[0]||''});
 }
 async function saveRule(e){
  e.preventDefault();setRuleBusy(true);onError?.('');
  try{
   await api.attendanceWrite({action:'save_escalation_rule',id:ruleForm.id||undefined,branch_id:ruleForm.branch_id||null,category:ruleForm.category,severity:ruleForm.severity,active:ruleForm.active,level1_minutes:ruleForm.level1_minutes,level2_minutes:ruleForm.level2_minutes,level3_minutes:ruleForm.level3_minutes,level1_roles:ruleForm.level1_role?[ruleForm.level1_role]:[],level2_roles:ruleForm.level2_role?[ruleForm.level2_role]:[],level3_roles:ruleForm.level3_role?[ruleForm.level3_role]:[],channels:{in_app:true,whatsapp:false,email:false}});
   onNotice?.('تم حفظ قاعدة تصعيد التنبيهات.');setRuleForm(blankRule);await onChanged?.();
  }catch(e2){onError?.(e2.message)}finally{setRuleBusy(false)}
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
  {key:'active',label:'الحالة',render:r=><Badge tone={r.active===false?'gray':'green'}>{r.active===false?'موقوفة':'نشطة'}</Badge>},
  {key:'action',label:'',render:r=><Button onClick={()=>editRule(r)}>تعديل</Button>}
 ];

 return <>
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

  <Modal open={rulesOpen} onClose={()=>setRulesOpen(false)} title="قواعد تصعيد تنبيهات الحضور" wide>
   <div style={{display:'grid',gap:14}}>
    <div className="success-note"><ShieldCheck size={16}/> التصعيد الحالي داخل النظام بالكامل. إعدادات WhatsApp وEmail لن ترسل رسائل خارجية قبل تفعيل قناة موظفين مستقلة واعتمادها.</div>
    <Card><div className="card-title"><div><h3>القواعد الحالية</h3><small>القاعدة الأكثر تحديدًا للفرع/النوع/الأولوية تتغلب على القاعدة العامة.</small></div><Button onClick={()=>setRuleForm(blankRule)}>قاعدة جديدة</Button></div><Table preferenceKey="attendance-escalation-rules" defaultPageSize={25} rows={rules} columns={ruleCols}/></Card>
    <Card><div className="card-title"><h3>{ruleForm.id?'تعديل قاعدة التصعيد':'قاعدة تصعيد جديدة'}</h3></div><form onSubmit={saveRule} className="form-grid">
     <Field label="الفرع"><Select value={ruleForm.branch_id||''} onChange={e=>setRuleForm(x=>({...x,branch_id:e.target.value}))} disabled={!state.scope?.all_branches}><option value="">كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
     <Field label="نوع التنبيه"><Select value={ruleForm.category} onChange={e=>setRuleForm(x=>({...x,category:e.target.value}))}><option value="*">كل الأنواع</option><option value="device_health">صحة الجهاز</option><option value="predictive">استباقي</option><option value="linking">ربط الحركات</option></Select></Field>
     <Field label="الأولوية"><Select value={ruleForm.severity} onChange={e=>setRuleForm(x=>({...x,severity:e.target.value}))}><option value="*">كل الأولويات</option><option value="critical">حرج</option><option value="warning">تحذير</option><option value="info">معلومة</option></Select></Field>
     <Field label="الحالة"><Select value={ruleForm.active?'true':'false'} onChange={e=>setRuleForm(x=>({...x,active:e.target.value==='true'}))}><option value="true">نشطة</option><option value="false">موقوفة</option></Select></Field>

     <Field label="المستوى 1 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level1_minutes} onChange={e=>setRuleForm(x=>({...x,level1_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 1"><Select value={ruleForm.level1_role} onChange={e=>setRuleForm(x=>({...x,level1_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <Field label="المستوى 2 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level2_minutes} onChange={e=>setRuleForm(x=>({...x,level2_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 2"><Select value={ruleForm.level2_role} onChange={e=>setRuleForm(x=>({...x,level2_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <Field label="المستوى 3 بعد (دقيقة)"><Input type="number" min="0" max="10080" value={ruleForm.level3_minutes} onChange={e=>setRuleForm(x=>({...x,level3_minutes:e.target.value}))} placeholder="فارغ = معطل"/></Field>
     <Field label="المستلم — المستوى 3"><Select value={ruleForm.level3_role} onChange={e=>setRuleForm(x=>({...x,level3_role:e.target.value}))}><option value="">بدون مستلم</option><option value="الموارد البشرية">الموارد البشرية</option><option value="مدير فرع">مدير فرع</option><option value="مدير عام">مدير عام</option></Select></Field>
     <div className="modal-actions"><Button type="button" onClick={()=>setRuleForm(blankRule)}>تفريغ</Button><Button variant="primary" type="submit" disabled={ruleBusy}>{ruleBusy?'جاري الحفظ...':'حفظ القاعدة'}</Button></div>
    </form></Card>
   </div>
  </Modal>
 </>;
}
