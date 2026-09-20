import React,{useEffect,useMemo,useState} from 'react';
import {AlertTriangle,BusFront,CheckCircle2,ClipboardCheck,Fingerprint,RefreshCw,Search,ShieldAlert,Users,WalletCards,Wrench} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {has} from '../../lib/permissions.js';
import {bookingFinancialState} from '../../lib/bookingFinance.js';
import {Badge,Button,Card,ErrorBox,Input,Loading,Select,Table} from '../../components/UI.jsx';
import ModuleShell,{useModuleTab} from '../../components/ModuleShell.jsx';
import {money,tripDisplay} from '../../lib/format.js';

const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const inactiveBooking=b=>['cancelled','canceled','deleted','refunded'].includes(lower(b?.status));
const inactivePassenger=p=>['cancelled','canceled','deleted','refunded','removed','merged'].includes(lower(p?.status));
const severityRank={critical:0,high:1,medium:2,low:3};
const severityLabel={critical:'حرج',high:'عالي',medium:'متوسط',low:'منخفض'};
const severityTone={critical:'red',high:'orange',medium:'blue',low:'green'};
function dayDiff(date){
 if(!date)return null;
 const today=new Date();today.setHours(0,0,0,0);
 const d=new Date(String(date).slice(0,10)+'T00:00:00');if(Number.isNaN(d.getTime()))return null;
 return Math.round((d-today)/86400000);
}
function isUpcomingTrip(t){const d=dayDiff(t?.departure_date);return d!==null&&d>=0&&!['cancelled','canceled','completed','closed'].includes(lower(t?.status))}
function issue(id,category,severity,title,detail,path,extra={}){return {id,category,severity,title,detail,path,...extra}}

export default function QualityCenter({go}){
 const {user}=useAuth();
 const {data,refresh}=useAppData();
 const canBookings=has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking');
 const canTrips=has(user,'trips')||has(user,'operations')||has(user,'manifest');
 const canSeats=has(user,'seats')||has(user,'operations');
 const canHousing=has(user,'housing')||has(user,'housingManifest')||has(user,'manageHotels');
 const canFinance=has(user,'finance')||has(user,'payments')||has(user,'expenses')||has(user,'reports');
 const canAttendance=['attendance_view','attendance_reports','attendance_manage_employees','attendance_manage_devices','attendance_manage_links','attendance_review_violations','attendance_close_month'].some(k=>has(user,k));
 const canStaff=has(user,'manageUsers')||has(user,'managePermissions');
 const canTasks=has(user,'tasks')||user?.role==='مدير عام'||user?.role==='developer'||user?.permissions?.all;

 const [refunds,setRefunds]=useState({byId:{},byNo:{}});
 const [seatData,setSeatData]=useState(null),[attendance,setAttendance]=useState(null),[taskData,setTaskData]=useState({tasks:[]});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[sourceErrors,setSourceErrors]=useState([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const [query,setQuery]=useState(''),[severity,setSeverity]=useState('all');

 async function load(){
  setLoading(true);setError('');const errors=[];
  const jobs=[refresh().catch(e=>errors.push('البيانات الأساسية: '+e.message))];
  if(canFinance)jobs.push(api.bookingRefundSummaries().then(x=>setRefunds({byId:x?.by_booking_id||{},byNo:x?.by_booking_number||{}})).catch(e=>errors.push('البيانات المالية: '+e.message)));
  if(canSeats)jobs.push(api.module('seats').then(setSeatData).catch(e=>errors.push('المقاعد: '+e.message)));
  if(canAttendance)jobs.push(api.attendance().then(setAttendance).catch(e=>errors.push('الحضور: '+e.message)));
  if(canTasks)jobs.push(api.module('tasks').then(setTaskData).catch(e=>errors.push('المهام: '+e.message)));
  await Promise.all(jobs);setSourceErrors(errors);setLoading(false);
 }
 useEffect(()=>{load()},[]);

 const refundedFor=b=>Number(refunds.byId?.[String(b?.id||'')]||refunds.byNo?.[String(b?.booking_number||'')]||0);
 const tripMap=useMemo(()=>new Map((data.trips||[]).map(t=>[String(t.id),t])),[data.trips]);
 const bookingMap=useMemo(()=>new Map((data.bookings||[]).map(b=>[String(b.id),b])),[data.bookings]);
 const branchMap=useMemo(()=>new Map((data.branches||[]).map(b=>[String(b.id),b.name||b.id])),[data.branches]);
 const activeBookings=useMemo(()=>(data.bookings||[]).filter(b=>!inactiveBooking(b)),[data.bookings]);
 const bookingIds=useMemo(()=>new Set(activeBookings.map(b=>String(b.id))),[activeBookings]);
 const activePassengers=useMemo(()=>(data.passengers||[]).filter(p=>bookingIds.has(String(p.booking_id))&&!inactivePassenger(p)),[data.passengers,bookingIds]);
 const upcomingTrips=useMemo(()=>(data.trips||[]).filter(isUpcomingTrip),[data.trips]);

 const taskKeys=useMemo(()=>new Set((taskData?.tasks||[]).filter(t=>['open','in_progress'].includes(lower(t.status))).map(t=>text(t?.metadata?.quality_key)).filter(Boolean)),[taskData]);

 const issues=useMemo(()=>{
  const out=[];

  if(canBookings){
   for(const b of activeBookings){
    const trip=tripMap.get(String(b.trip_id)),days=dayDiff(trip?.departure_date);
    const no=String(b.booking_number||b.id);
    if(!text(b.customer_name)||!text(b.customer_phone)){
      const missing=[!text(b.customer_name)?'اسم العميل':'',!text(b.customer_phone)?'الجوال':''].filter(Boolean).join(' و ');
      out.push(issue('booking-contact-'+b.id,'bookings','medium','بيانات حجز ناقصة',`${no} · ناقص ${missing}`,`/bookings/${encodeURIComponent(no)}`,{branch_id:b.branch_id,entity:no}));
    }
    const f=bookingFinancialState(b,refundedFor(b));
    if(canFinance&&f.code==='mismatch')out.push(issue('finance-mismatch-'+b.id,'finance','critical','عدم تطابق مالي في حجز',`${no} · إجمالي ${money(f.total)} · محصل ${money(f.gross)} · مسترد ${money(f.refund)}`,`/bookings/${encodeURIComponent(no)}`,{branch_id:b.branch_id,entity:no}));
    if(canFinance&&days!==null&&days>=0&&days<=3&&['unpaid','partial'].includes(f.code)&&f.remaining>0.001){
      out.push(issue('booking-due-'+b.id,'finance',days<=1?'critical':'high','تحصيل قبل رحلة قريبة',`${no} · متبقي ${money(f.remaining)} · الرحلة خلال ${days} يوم`,`/bookings/${encodeURIComponent(no)}`,{branch_id:b.branch_id,entity:no}));
    }
   }

   for(const p of activePassengers){
    const b=bookingMap.get(String(p.booking_id));if(!b)continue;
    const no=String(b.booking_number||b.id);
    if(!text(p.full_name)||!text(p.identity_number)||!text(p.nationality)){
      const missing=[!text(p.full_name)?'الاسم':'',!text(p.identity_number)?'الهوية':'',!text(p.nationality)?'الجنسية':''].filter(Boolean).join('، ');
      out.push(issue('passenger-data-'+p.id,'bookings','medium','بيانات مسافر ناقصة',`${p.full_name||'مسافر'} · حجز ${no} · ناقص: ${missing}`,`/bookings/${encodeURIComponent(no)}`,{branch_id:b.branch_id,entity:no}));
    }
   }

   const dup=new Map();
   for(const p of activePassengers){
    const id=text(p.identity_number);if(!id)continue;
    const b=bookingMap.get(String(p.booking_id));if(!b?.trip_id)continue;
    const key=String(b.trip_id)+'|'+id,arr=dup.get(key)||[];arr.push({p,b});dup.set(key,arr);
   }
   for(const [key,arr] of dup)if(arr.length>1){
    const uniqueBookings=[...new Set(arr.map(x=>String(x.b.booking_number||x.b.id)))];
    if(uniqueBookings.length>1){
      const tr=tripMap.get(String(arr[0].b.trip_id));
      out.push(issue('duplicate-'+key,'bookings','high','هوية مكررة في نفس الرحلة',`${arr[0].p.identity_number} · ${uniqueBookings.length} حجوزات · ${tripDisplay(tr||{})}`,`/bookings?q=${encodeURIComponent(arr[0].p.identity_number)}`,{branch_id:arr[0].b.branch_id,entity:arr[0].p.identity_number}));
    }
   }
  }

  if(canTrips){
   const bookingsByTrip=new Map();
   for(const b of activeBookings){for(const id of [b.trip_id,b.return_trip_id])if(id){const k=String(id),a=bookingsByTrip.get(k)||[];a.push(b);bookingsByTrip.set(k,a)}}
   for(const t of upcomingTrips){
    const days=dayDiff(t.departure_date),count=(bookingsByTrip.get(String(t.id))||[]).length;
    if(count>0&&(!text(t.from_city||t.origin)||!text(t.to_city||t.destination)||!text(t.departure_time))){
      out.push(issue('trip-core-'+t.id,'operations','high','رحلة قادمة ببيانات تشغيل ناقصة',`${tripDisplay(t)} · ${count} حجز · راجع المسار ووقت التحرك`,`/trips/${encodeURIComponent(t.id)}`,{branch_id:t.branch_id,entity:t.trip_code||t.id}));
    }
    if(canSeats&&seatData&&count>0&&days!==null&&days<=7){
      const assigned=(seatData.trip_vehicles||[]).some(x=>String(x.trip_id)===String(t.id));
      if(!assigned)out.push(issue('trip-vehicle-'+t.id,'operations',days<=2?'critical':'high','رحلة بدون باص معيّن',`${tripDisplay(t)} · ${count} حجز · موعدها خلال ${days} يوم`,`/seats?trip=${encodeURIComponent(t.id)}`,{branch_id:t.branch_id,entity:t.trip_code||t.id}));
    }
   }
  }

  if(canSeats){
   const assignedPassengerIds=new Set((seatData?.seat_assignments||[]).filter(a=>lower(a.status)==='assigned'&&a.passenger_id).map(a=>String(a.passenger_id)));
   for(const p of activePassengers){
    const b=bookingMap.get(String(p.booking_id)),t=tripMap.get(String(b?.trip_id));if(!b||!t)continue;
    const days=dayDiff(t.departure_date);if(days===null||days<0||days>3)continue;
    if(!assignedPassengerIds.has(String(p.id))&&!p.seat_id&&!text(p.seat_number)){
      out.push(issue('seat-'+p.id,'operations',days<=1?'critical':'high','مسافر بدون مقعد قبل الرحلة',`${p.full_name||'مسافر'} · حجز ${b.booking_number||''} · الرحلة خلال ${days} يوم`,`/seats?trip=${encodeURIComponent(t.id)}`,{branch_id:b.branch_id,entity:p.full_name||p.id}));
    }
   }
  }

  if(canHousing){
   for(const p of activePassengers){
    if(lower(p.accommodation_status)!=='pending')continue;
    const b=bookingMap.get(String(p.booking_id)),t=tripMap.get(String(b?.trip_id));if(!b||!t)continue;
    const days=dayDiff(t.departure_date);if(days===null||days<0||days>3)continue;
    out.push(issue('housing-'+p.id,'operations',days<=1?'critical':'high','تسكين معلق قبل الرحلة',`${p.full_name||'مسافر'} · حجز ${b.booking_number||''} · الرحلة خلال ${days} يوم`,`/housing?trip=${encodeURIComponent(t.id)}`,{branch_id:b.branch_id,entity:p.full_name||p.id}));
   }
  }

  if(canAttendance&&attendance){
   const unlinked=(attendance.logs||[]).filter(x=>!x.attendance_employee_id&&!x.staff_user_id&&!x.employee_name);
   if(unlinked.length)out.push(issue('attendance-unlinked','hr','high','بصمات غير مربوطة بموظف',`${unlinked.length} حركة مستلمة تحتاج ربط PIN بالموظف`,'/attendance?tab=links',{entity:String(unlinked.length)}));

   const periodsByEmp=new Set((attendance.shiftPeriods||[]).filter(x=>x.active!==false).map(x=>String(x.attendance_employee_id)));
   for(const e of attendance.employees||[]){
    if(lower(e.status)!=='active')continue;
    if(!periodsByEmp.has(String(e.id))&&!e.shift_start&&!e.shift_end){
      out.push(issue('attendance-schedule-'+e.id,'hr','medium','موظف حضور بدون جدول دوام',`${e.name} · ${branchMap.get(String(e.branch_id))||'بدون فرع'}`,'/attendance?tab=employees',{branch_id:e.branch_id,entity:e.name}));
    }
   }

   const now=Date.now();
   for(const d of attendance.devices||[]){
    if(lower(d.status)==='disabled')continue;
    const seen=d.last_command_poll_at||d.last_seen_at,age=seen?now-new Date(seen).getTime():Infinity;
    if(!seen||age>30*60*1000){
      const mins=Number.isFinite(age)?Math.round(age/60000):null;
      out.push(issue('attendance-device-'+d.id,'hr',age>6*3600000?'critical':'high','جهاز بصمة غير متصل حديثًا',`${d.name||d.serial_number} · ${mins===null?'لا يوجد اتصال مسجل':`آخر اتصال منذ ${mins} دقيقة`}`,'/attendance?tab=devices',{branch_id:d.branch_id,entity:d.name||d.serial_number}));
    }
   }

   for(const r of attendance.deleteRequests||[]){
    if(lower(r.status)==='failed'){
      out.push(issue('attendance-delete-'+r.id,'hr','high','فشل حذف موظف حضور',`${r.employee_name||r.employee_code||'موظف'} · ${r.result_summary||'راجع الأجهزة والطلب'}`,'/attendance?tab=employees',{branch_id:r.branch_id,entity:r.employee_name||r.employee_code}));
    }
   }
  }

  if(canStaff){
   for(const u of data.users||[]){
    if(['موقوف','inactive','disabled'].includes(lower(u.status)))continue;
    if(!u.branch_id&&!['developer','مدير عام'].includes(String(u.role||''))){
      out.push(issue('staff-branch-'+u.id,'hr','medium','حساب موظف بدون فرع',`${u.name||u.username} · الدور: ${u.role||'موظف'}`,'/staff?tab=accounts',{entity:u.name||u.username}));
    }
   }
  }

  return out.sort((a,b)=>(severityRank[a.severity]??9)-(severityRank[b.severity]??9)||a.title.localeCompare(b.title,'ar'));
 },[canBookings,canFinance,canTrips,canSeats,canHousing,canAttendance,canStaff,activeBookings,activePassengers,tripMap,bookingMap,seatData,attendance,data.users,refunds,branchMap,upcomingTrips]);

 const tabs=useMemo(()=>[
  {id:'all',label:'كل الاستثناءات',icon:ShieldAlert,badge:issues.length||null},
  ...(canBookings?[{id:'bookings',label:'الحجوزات والبيانات',icon:Users,badge:issues.filter(x=>x.category==='bookings').length||null}]:[]),
  ...(canTrips||canSeats||canHousing?[{id:'operations',label:'التشغيل',icon:BusFront,badge:issues.filter(x=>x.category==='operations').length||null}]:[]),
  ...(canFinance?[{id:'finance',label:'المالية',icon:WalletCards,badge:issues.filter(x=>x.category==='finance').length||null}]:[]),
  ...(canAttendance||canStaff?[{id:'hr',label:'HR والحضور',icon:Fingerprint,badge:issues.filter(x=>x.category==='hr').length||null}]:[])
 ],[issues,canBookings,canTrips,canSeats,canHousing,canFinance,canAttendance,canStaff]);
 const [tab,setTab]=useModuleTab('almaher:module:quality-center',tabs,'all');

 const filtered=useMemo(()=>{
  const q=lower(query);
  return issues.filter(x=>(tab==='all'||x.category===tab)&&(severity==='all'||x.severity===severity)&&(!q||[x.title,x.detail,x.entity].some(v=>lower(v).includes(q))));
 },[issues,tab,severity,query]);
 const counts=useMemo(()=>({critical:issues.filter(x=>x.severity==='critical').length,high:issues.filter(x=>x.severity==='high').length,medium:issues.filter(x=>x.severity==='medium').length}),[issues]);

 async function createTask(row){
  if(!canTasks||taskKeys.has(row.id))return;
  setBusy(row.id);setError('');
  try{
   await api.moduleWrite({action:'insert',table:'tasks',row:{
    title:'[جودة] '+row.title,
    description:row.detail,
    task_type:'data_quality',
    status:'open',
    priority:row.severity==='critical'?'urgent':row.severity==='high'?'high':'normal',
    branch_id:row.branch_id||user?.branch_id||null,
    created_by:user?.name||user?.id||null,
    metadata:{quality_key:row.id,source_path:row.path,category:row.category,severity:row.severity}
   }});
   setTaskData(await api.module('tasks'));setNotice('تم تحويل الاستثناء إلى مهمة في مركز الإجراءات.');
  }catch(e){setError(e.message)}finally{setBusy('')}
 }

 const columns=[
  {key:'severity',label:'الأولوية',render:r=><Badge tone={severityTone[r.severity]}>{severityLabel[r.severity]}</Badge>},
  {key:'category',label:'القسم',render:r=><Badge tone="blue">{r.category==='bookings'?'الحجوزات':r.category==='operations'?'التشغيل':r.category==='finance'?'المالية':'HR'}</Badge>},
  {key:'title',label:'الاستثناء',render:r=><div><strong>{r.title}</strong><div className="muted-small">{r.detail}</div></div>},
  {key:'branch',label:'الفرع',render:r=>r.branch_id?(branchMap.get(String(r.branch_id))||'—'):'—'},
  {key:'action',label:'',render:r=><div className="finance-actions"><Button variant="primary" onClick={()=>go?.(r.path)}><Wrench size={14}/> معالجة</Button>{canTasks&&(taskKeys.has(r.id)?<Badge tone="green"><CheckCircle2 size={12}/> مهمة مفتوحة</Badge>:<Button onClick={()=>createTask(r)} disabled={busy===r.id}><ClipboardCheck size={14}/> تحويل لمهمة</Button>)}</div>}
 ];

 return <>
  <ModuleShell title="مركز جودة البيانات والاستثناءات" subtitle="يجمع الأخطاء والنواقص والمخاطر التشغيلية من البيانات المسموح بها لحسابك، ويحوّلها إلى إجراءات واضحة بدون تعديل تلقائي للبيانات" icon={ShieldAlert} tabs={tabs} activeTab={tab} onTabChange={setTab} actions={<Button onClick={load} disabled={loading}><RefreshCw size={16}/> تحديث الفحص</Button>} breadcrumbs={[{label:'الإدارة والمتابعة'},{label:'جودة البيانات'}]}/>
  <ErrorBox error={error}/>
  {notice&&<div className="success-note">{notice}</div>}
  {!!sourceErrors.length&&<div className="error-box"><AlertTriangle size={16}/> الفحص جزئي: {sourceErrors.join(' · ')}</div>}
  {loading?<Loading/>:<>
   <div className="stats-grid">
    <Card><div className="stat-card"><ShieldAlert/><div><span>إجمالي الاستثناءات</span><strong>{issues.length}</strong><small>ضمن صلاحيات الحساب</small></div></div></Card>
    <Card><div className="stat-card"><AlertTriangle/><div><span>حرجة</span><strong>{counts.critical}</strong><small>تحتاج تدخل سريع</small></div></div></Card>
    <Card><div className="stat-card"><AlertTriangle/><div><span>عالية</span><strong>{counts.high}</strong><small>يفضل معالجتها قريبًا</small></div></div></Card>
    <Card><div className="stat-card"><CheckCircle2/><div><span>متوسطة</span><strong>{counts.medium}</strong><small>تحسين جودة البيانات</small></div></div></Card>
   </div>
   <Card><div className="operation-filters"><div className="filterbar"><Search size={17}/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث في الاستثناءات"/></div><Select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">كل الأولويات</option><option value="critical">حرج</option><option value="high">عالي</option><option value="medium">متوسط</option><option value="low">منخفض</option></Select><Badge>{filtered.length} نتيجة</Badge></div></Card>
   <Card><div className="card-title"><div><h3>صندوق الاستثناءات</h3><small>لا يقوم المركز بإصلاح أو حذف أي بيانات تلقائيًا؛ زر «معالجة» ينقلك إلى المصدر الأصلي.</small></div><Badge tone={filtered.length?'orange':'green'}>{filtered.length}</Badge></div>{filtered.length?<Table preferenceKey={'quality-center-'+tab} defaultPageSize={25} rows={filtered} columns={columns} getRowKey={r=>r.id}/>:<div className="success-note"><CheckCircle2 size={16}/> لا توجد استثناءات مطابقة للفلاتر الحالية.</div>}</Card>
  </>}
 </>;
}
