import React,{useMemo,useState} from 'react';
import {AlertTriangle,Fingerprint,Link2,RefreshCw,ShieldCheck,Users} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,Table} from '../../components/UI.jsx';
import SmartListFilters from '../../components/SmartListFilters.jsx';
import {matchesListQuery} from '../../lib/listFilters.js';

function fmt(v){if(!v)return '—';try{return new Date(v).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}catch{return String(v)}}
const severityTone=s=>s==='critical'?'red':s==='warning'?'orange':s==='info'?'blue':'green';
const severityLabel=s=>s==='critical'?'حرج':s==='warning'?'يحتاج مراجعة':s==='info'?'معلومة':'سليم';
const typeLabel=t=>({
 count_gap:'فرق عدد القوالب',
 missing_employee_biometric:'موظف بدون بصمة مكتشفة',
 unlinked_device_user:'PIN غير مربوط',
 link_mismatch:'تعارض ربط البصمة',
 duplicate_pin:'PIN مرتبط بأكثر من موظف',
 baseline_missing:'لم يتم أخذ خط أساس'
}[t]||t);

export default function AttendanceBiometricReconciliation({state,onChanged,onError,onNotice,onOpenLinks,onOpenDevices}){
 const [filters,setFilters]=useState({q:'',branch:'',device:'',type:'',severity:''}),[busy,setBusy]=useState('');
 const devices=state.devices||[],branches=state.branches||[],employees=state.employees||[],deviceUsers=state.deviceUsers||[],links=(state.links||[]).filter(x=>x.active),states=(state.biometricDeviceStates||[]).filter(x=>x.status==='active');
 const deviceMap=useMemo(()=>new Map(devices.map(x=>[String(x.id),x])),[devices]);
 const branchMap=useMemo(()=>new Map(branches.map(x=>[String(x.id),x])),[branches]);
 const employeeMap=useMemo(()=>new Map(employees.map(x=>[String(x.id),x])),[employees]);

 const issues=useMemo(()=>{
  const out=[],linkByDevicePin=new Map(),linksByDeviceEmployee=new Map(),statesByDeviceEmployee=new Map(),statesByDevice=new Map(),deviceUsersByDevice=new Map();
  for(const l of links){
   const pinKey=String(l.device_id)+'|'+String(l.device_pin),arr=linkByDevicePin.get(pinKey)||[];arr.push(l);linkByDevicePin.set(pinKey,arr);
   if(l.attendance_employee_id){const k=String(l.device_id)+'|'+String(l.attendance_employee_id),a=linksByDeviceEmployee.get(k)||[];a.push(l);linksByDeviceEmployee.set(k,a)}
  }
  for(const s of states){
   const dk=String(s.device_id),da=statesByDevice.get(dk)||[];da.push(s);statesByDevice.set(dk,da);
   const ek=dk+'|'+String(s.attendance_employee_id),ea=statesByDeviceEmployee.get(ek)||[];ea.push(s);statesByDeviceEmployee.set(ek,ea);
  }
  for(const u of deviceUsers){const k=String(u.device_id),a=deviceUsersByDevice.get(k)||[];a.push(u);deviceUsersByDevice.set(k,a)}

  for(const d of devices.filter(x=>x.status==='active')){
   const did=String(d.id),deviceStates=statesByDevice.get(did)||[],fps=deviceStates.filter(x=>x.biometric_type==='finger').length,faces=deviceStates.filter(x=>x.biometric_type==='face').length;
   const linked=links.filter(x=>String(x.device_id)===did&&x.attendance_employee_id),reportedFp=Number(d.reported_fp_count),reportedFace=Number(d.reported_face_count);
   if(Number.isFinite(reportedFp)&&reportedFp>0&&deviceStates.length===0){
    out.push({id:'baseline:'+did,type:'baseline_missing',severity:'warning',device_id:d.id,branch_id:d.branch_id,title:'الجهاز لديه بصمات لكن لا يوجد خط أساس داخل النظام',detail:'الجهاز يعلن عن '+reportedFp+' قالب بصمة، ولم يتم اكتشاف أي قالب مرتبط به في طبقة المطابقة حتى الآن.',reported:reportedFp,known:fps,action:'device_scan'});
   }else if(Number.isFinite(reportedFp)&&reportedFp!==fps){
    out.push({id:'fp-gap:'+did,type:'count_gap',severity:Math.abs(reportedFp-fps)>=3?'critical':'warning',device_id:d.id,branch_id:d.branch_id,title:'فرق في عدد بصمات الأصابع',detail:'الجهاز يعلن '+reportedFp+' قالب، والمكتشف والمربوط داخل النظام '+fps+'.',reported:reportedFp,known:fps,action:'device_scan'});
   }
   if(Number.isFinite(reportedFace)&&reportedFace>0&&reportedFace!==faces){
    out.push({id:'face-gap:'+did,type:'count_gap',severity:'warning',device_id:d.id,branch_id:d.branch_id,title:'فرق في عدد بصمات الوجه',detail:'الجهاز يعلن '+reportedFace+' وجه، والمكتشف والمربوط داخل النظام '+faces+'.',reported:reportedFace,known:faces,action:'device_scan'});
   }
   for(const l of linked){
    const key=did+'|'+String(l.attendance_employee_id),bio=statesByDeviceEmployee.get(key)||[];
    if(!bio.length){
     const emp=employeeMap.get(String(l.attendance_employee_id));
     out.push({id:'missing:'+did+':'+l.attendance_employee_id,type:'missing_employee_biometric',severity:'warning',device_id:d.id,branch_id:l.branch_id||d.branch_id,attendance_employee_id:l.attendance_employee_id,device_pin:l.device_pin,title:'موظف مربوط بدون بصمة مكتشفة',detail:(emp?.name||l.display_name||'الموظف')+' مربوط على PIN '+l.device_pin+' لكن لم تُكتشف له بصمة على هذا الجهاز.',action:'employee_scan'});
    }
   }
   for(const u of deviceUsersByDevice.get(did)||[]){
    const matches=linkByDevicePin.get(did+'|'+String(u.device_pin))||[];
    if(!matches.some(x=>x.attendance_employee_id)){
     out.push({id:'unlinked:'+did+':'+u.device_pin,type:'unlinked_device_user',severity:'warning',device_id:d.id,branch_id:d.branch_id,device_pin:u.device_pin,title:'PIN موجود على الجهاز وغير مربوط بموظف حضور',detail:(u.name||('PIN '+u.device_pin))+' موجود على الجهاز ويحتاج ربطه بموظف قبل مطابقة بصماته.',action:'links'});
    }
   }
  }

  for(const [pinKey,rows] of linkByDevicePin.entries()){
   const employeeIds=[...new Set(rows.map(x=>String(x.attendance_employee_id||'')).filter(Boolean))];
   if(employeeIds.length>1){
    const first=rows[0],names=employeeIds.map(id=>employeeMap.get(id)?.name||id).join('، ');
    out.push({id:'duplicate:'+pinKey,type:'duplicate_pin',severity:'critical',device_id:first.device_id,branch_id:first.branch_id,device_pin:first.device_pin,title:'PIN مرتبط بأكثر من موظف',detail:'PIN '+first.device_pin+' مربوط بأكثر من موظف: '+names+'. يلزم تصحيح الربط قبل أي مزامنة.',action:'links'});
   }
  }

  for(const s of states){
   const key=String(s.device_id)+'|'+String(s.device_pin),pinLinks=linkByDevicePin.get(key)||[],same=pinLinks.some(l=>String(l.attendance_employee_id)===String(s.attendance_employee_id));
   if(!same){
    const emp=employeeMap.get(String(s.attendance_employee_id)),d=deviceMap.get(String(s.device_id));
    out.push({id:'mismatch:'+s.id,type:'link_mismatch',severity:'critical',device_id:s.device_id,branch_id:s.branch_id||d?.branch_id,attendance_employee_id:s.attendance_employee_id,device_pin:s.device_pin,title:'بصمة مكتشفة وربط PIN غير متطابق',detail:'البصمة تخص '+(emp?.name||'موظف')+' حسب السجل، لكن PIN '+s.device_pin+' على '+(d?.name||'الجهاز')+' لا يطابق الربط النشط.',action:'links',last_seen_at:s.last_seen_at});
   }
  }
  return out.sort((a,b)=>({critical:0,warning:1,info:2}[a.severity]??3)-({critical:0,warning:1,info:2}[b.severity]??3)||String(a.title).localeCompare(String(b.title),'ar'));
 },[devices,deviceUsers,links,states,employeeMap,deviceMap]);

 const branchOptions=useMemo(()=>branches.map(b=>({value:String(b.id),label:b.name||b.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[branches]);
 const deviceOptions=useMemo(()=>devices.map(d=>({value:String(d.id),label:d.name||d.serial_number||d.id})).sort((a,b)=>a.label.localeCompare(b.label,'ar')),[devices]);
 const typeOptions=useMemo(()=>[...new Set(issues.map(x=>x.type))].map(v=>({value:v,label:typeLabel(v)})),[issues]);
 const filtered=useMemo(()=>issues.filter(r=>
   (!filters.branch||String(r.branch_id)===String(filters.branch))&&
   (!filters.device||String(r.device_id)===String(filters.device))&&
   (!filters.type||r.type===filters.type)&&
   (!filters.severity||r.severity===filters.severity)&&
   matchesListQuery(filters.q,r.title,r.detail,r.device_pin,deviceMap.get(String(r.device_id))?.name,branchMap.get(String(r.branch_id))?.name,employeeMap.get(String(r.attendance_employee_id))?.name)
 ),[issues,filters,deviceMap,branchMap,employeeMap]);

 const deviceSummary=useMemo(()=>devices.map(d=>{
  const ds=states.filter(x=>String(x.device_id)===String(d.id)),fps=ds.filter(x=>x.biometric_type==='finger').length,faces=ds.filter(x=>x.biometric_type==='face').length,deviceIssues=issues.filter(x=>String(x.device_id)===String(d.id));
  return {...d,known_fp:fps,known_face:faces,issue_count:deviceIssues.length,critical_count:deviceIssues.filter(x=>x.severity==='critical').length};
 }),[devices,states,issues]);

 async function scan(row){
  const key=row.id;setBusy(key);onError?.('');
  try{
   const payload={action:'import_device_biometrics',device_id:row.device_id};
   if(row.action==='employee_scan'&&row.attendance_employee_id)payload.attendance_employee_id=row.attendance_employee_id;
   const out=await api.attendanceWrite(payload);
   onNotice?.(out?.message||'تم بدء إعادة فحص البصمات من الجهاز.');
   await onChanged?.();
  }catch(e){onError?.(e.message)}finally{setBusy('')}
 }

 const issueCols=[
  {key:'severity',label:'الأولوية',render:r=><Badge tone={severityTone(r.severity)}>{severityLabel(r.severity)}</Badge>},
  {key:'issue',label:'الحالة',render:r=><div><strong>{r.title}</strong><div className="muted-small">{r.detail}</div></div>},
  {key:'device',label:'الجهاز / الفرع',render:r=><div><strong>{deviceMap.get(String(r.device_id))?.name||'—'}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))?.name||'—'}</div></div>},
  {key:'employee',label:'الموظف / PIN',render:r=>r.attendance_employee_id?<div><strong>{employeeMap.get(String(r.attendance_employee_id))?.name||'—'}</strong><div className="muted-small" dir="ltr">PIN {r.device_pin||'—'}</div></div>:r.device_pin?<strong dir="ltr">PIN {r.device_pin}</strong>:'—'},
  {key:'type',label:'النوع',render:r=><Badge>{typeLabel(r.type)}</Badge>},
  {key:'action',label:'الإجراء',render:r=>r.action==='links'?<Button onClick={()=>onOpenLinks?.()}><Link2 size={14}/> فتح الربط</Button>:state.permissions?.manage_biometrics?<Button onClick={()=>scan(r)} disabled={busy===r.id}><RefreshCw size={14}/>{busy===r.id?' جاري الفحص...':r.action==='employee_scan'?' فحص الموظف':' إعادة فحص الجهاز'}</Button>:'—'}
 ];
 const deviceCols=[
  {key:'device',label:'الجهاز',render:r=><div><strong>{r.name}</strong><div className="muted-small">{branchMap.get(String(r.branch_id))?.name||'—'} · {r.serial_number}</div></div>},
  {key:'reported',label:'المعلن من الجهاز',render:r=><div><strong>{r.reported_fp_count??'—'} إصبع</strong><div className="muted-small">{r.reported_face_count??'—'} وجه</div></div>},
  {key:'known',label:'المكتشف لكل جهاز',render:r=><div><strong>{r.known_fp} إصبع</strong><div className="muted-small">{r.known_face} وجه</div></div>},
  {key:'issues',label:'المشاكل',render:r=>r.issue_count?<div><Badge tone={r.critical_count?'red':'orange'}>{r.issue_count} حالة</Badge>{r.critical_count>0&&<div className="muted-small">{r.critical_count} حرجة</div>}</div>:<Badge tone="green">متطابق</Badge>},
  {key:'sync',label:'آخر Smart Sync',render:r=><div>{fmt(r.metadata?.last_smart_sync?.requested_at)}<div className="muted-small">{r.metadata?.last_smart_sync?.batch||'—'}</div></div>},
  {key:'action',label:'',render:r=><div className="finance-actions">{state.permissions?.manage_biometrics&&<Button onClick={()=>scan({id:'device:'+r.id,device_id:r.id,action:'device_scan'})} disabled={busy==='device:'+r.id}><Fingerprint size={14}/> فحص البصمات</Button>}{state.permissions?.manage_devices&&<Button onClick={()=>onOpenDevices?.()}><Users size={14}/> الأجهزة</Button>}</div>}
 ];

 const critical=issues.filter(x=>x.severity==='critical').length,warnings=issues.filter(x=>x.severity==='warning').length,missing=issues.filter(x=>x.type==='missing_employee_biometric').length,unlinked=issues.filter(x=>x.type==='unlinked_device_user'||x.type==='duplicate_pin'||x.type==='link_mismatch').length;
 return <div style={{display:'grid',gap:14}}>
  <div className="stats-grid">
   <Card><div className="stat-card"><div><span>حالات حرجة</span><strong>{critical}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>تحتاج مراجعة</span><strong>{warnings}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>موظفون بدون بصمة مكتشفة</span><strong>{missing}</strong></div></div></Card>
   <Card><div className="stat-card"><div><span>مشاكل ربط / PIN</span><strong>{unlinked}</strong></div></div></Card>
  </div>

  <Card>
   <div className="card-title"><div><h3><Fingerprint size={19}/> Biometric Reconciliation Center</h3><small>مطابقة ما يعلنه كل جهاز مع الموظفين والـPIN وحالة كل بصمة على كل جهاز، بدون تخزين القالب البيومتري الخام.</small></div><Badge tone={critical?'red':warnings?'orange':'green'}>{issues.length?issues.length+' حالة':'متطابق'}</Badge></div>
   {!issues.length?<div className="success-note"><ShieldCheck size={16}/> لا توجد فروقات ظاهرة في البيانات التي تم اكتشافها من الأجهزة.</div>:<>
    <SmartListFilters storageKey="attendance-biometric-reconciliation-filters" search={filters.q} onSearchChange={v=>setFilters(x=>({...x,q:v}))} searchPlaceholder="ابحث بالموظف أو PIN أو الجهاز أو نوع المشكلة..." totalCount={issues.length} resultCount={filtered.length} onReset={()=>setFilters({q:'',branch:'',device:'',type:'',severity:''})} filters={[
     {key:'branch',label:'الفرع',value:filters.branch,onChange:v=>setFilters(x=>({...x,branch:v})),options:branchOptions},
     {key:'device',label:'الجهاز',value:filters.device,onChange:v=>setFilters(x=>({...x,device:v})),options:deviceOptions},
     {key:'type',label:'نوع المشكلة',value:filters.type,onChange:v=>setFilters(x=>({...x,type:v})),options:typeOptions},
     {key:'severity',label:'الأولوية',value:filters.severity,onChange:v=>setFilters(x=>({...x,severity:v})),options:[{value:'critical',label:'حرج'},{value:'warning',label:'يحتاج مراجعة'},{value:'info',label:'معلومة'}]}
    ]}/>
    <Table preferenceKey="attendance-biometric-reconciliation-issues" defaultPageSize={25} rows={filtered} columns={issueCols}/>
   </>}
  </Card>

  <Card>
   <div className="card-title"><div><h3><AlertTriangle size={18}/> مقارنة الأجهزة</h3><small>العدد المعلن من الجهاز مقابل الحالات المكتشفة والمربوطة داخل النظام لكل جهاز.</small></div><Badge>{deviceSummary.length}</Badge></div>
   <Table preferenceKey="attendance-biometric-reconciliation-devices" defaultPageSize={25} rows={deviceSummary} columns={deviceCols}/>
  </Card>
 </div>;
}
