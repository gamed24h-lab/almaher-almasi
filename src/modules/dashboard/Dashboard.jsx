import React,{useEffect,useMemo,useState} from 'react';
import {BusFront,ClipboardList,Users,WalletCards,AlertTriangle,ArrowLeft,Fingerprint,BarChart3,UserCog,Plus,ScanLine,Hotel,Armchair,ShieldCheck,ShieldAlert,LayoutDashboard,CheckSquare2} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {useLanguage} from '../../core/LanguageContext.jsx';
import {useSystemBrand} from '../../core/SystemBrandContext.jsx';
import {Card,Loading,ErrorBox,Badge,Button} from '../../components/UI.jsx';
import ModuleShell from '../../components/ModuleShell.jsx';
import {money,statusLabel,tripWeekday,tripDate} from '../../lib/format.js';
import {api} from '../../lib/api.js';
import {has} from '../../lib/permissions.js';
import {bookingFinanceNumbers} from '../../lib/bookingFinance.js';

const tripStamp=t=>{const d=String(t?.departure_date||'').slice(0,10),tm=String(t?.departure_time||'00:00:00').slice(0,8),x=new Date(`${d||'1970-01-01'}T${tm||'00:00:00'}`);return Number.isNaN(x.getTime())?0:x.getTime()};
const isUpcoming=t=>{const status=String(t?.status||'').toLowerCase();if(['cancelled','canceled','completed','closed'].includes(status))return false;const day=String(t?.departure_date||'').slice(0,10);if(!day)return false;const today=new Date();today.setHours(0,0,0,0);const dep=new Date(`${day}T00:00:00`);return !Number.isNaN(dep.getTime())&&dep>=today};
const activeBooking=b=>!['cancelled','canceled','deleted','refunded'].includes(String(b?.status||'').toLowerCase());
function roleProfile(user,labels,t){
 const role=String(user?.role||'').trim().toLowerCase();
 if(role==='developer')return {title:'لوحة المطور والإدارة',subtitle:'متابعة النظام والتشغيل والبيانات حسب صلاحيات حساب المطور'};
 if(role==='مدير عام')return {title:'لوحة الإدارة العامة',subtitle:'ملخص تنفيذي للشركة والفروع والعمليات المسموح بها'};
 if(role==='مدير فرع')return {title:'لوحة إدارة الفرع',subtitle:'متابعة الحجوزات والتشغيل والمالية الخاصة بنطاق الفرع'};
 if(role==='الموارد البشرية')return {title:'لوحة الموارد البشرية',subtitle:'وصول سريع للموظفين والحضور والمخالفات والتقارير'};
 if(role==='محاسب')return {title:'لوحة المالية',subtitle:'متابعة التحصيل والمصروفات والخزن والورديات والتقارير'};
 if(role==='مشرف تشغيل')return {title:'لوحة التشغيل',subtitle:'متابعة الرحلات والركاب والتسكين والمقاعد والصعود'};
 if(role==='موظف حجوزات')return {title:'لوحة الحجوزات',subtitle:'الحجوزات والمسافرون والرحلات والإجراءات اليومية السريعة'};
 if(role==='موظف تسكين')return {title:'لوحة التسكين',subtitle:'متابعة التسكين والفنادق وكشوف التشغيل المصرح بها'};
 if(role==='خدمة عملاء')return {title:'لوحة خدمة العملاء',subtitle:'الوصول السريع للحجوزات والعملاء والمستندات والإشعارات'};
 return {title:labels.dashboard_title||t('dashboardTitle'),subtitle:labels.dashboard_subtitle||t('dashboardSubtitle')};
}

export default function Dashboard({go}){
 const {user}=useAuth();
 const {data,loading,error,refresh}=useAppData();
 const {t,language}=useLanguage();
 const {labels}=useSystemBrand();
 const [refunds,setRefunds]=useState({byId:{},byNo:{}});

 useEffect(()=>{if(!data.scope)refresh().catch(()=>{})},[]);
 useEffect(()=>{let alive=true;api.bookingRefundSummaries().then(x=>{if(alive)setRefunds({byId:x?.by_booking_id||{},byNo:x?.by_booking_number||{}})}).catch(()=>{});return()=>{alive=false}},[data.bookings]);

 const refundedFor=b=>Number(refunds.byId?.[String(b?.id||'')]||refunds.byNo?.[String(b?.booking_number||'')]||0);
 const upcoming=useMemo(()=>[...(data.trips||[])].filter(isUpcoming).sort((a,b)=>tripStamp(a)-tripStamp(b)),[data.trips]);
 const stats=useMemo(()=>{const active=upcoming.length,book=data.bookings.length,pax=data.passengers.filter(p=>p.status!=='cancelled').length,activeBookings=data.bookings.filter(activeBooking),dues=activeBookings.reduce((n,b)=>n+bookingFinanceNumbers(b,refundedFor(b)).remaining,0),dueBookings=activeBookings.filter(b=>bookingFinanceNumbers(b,refundedFor(b)).remaining>0.001).length;return {active,book,pax,dues,dueBookings}},[data,upcoming,refunds]);

 const canBookings=has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking');
 const canTrips=has(user,'trips')||has(user,'operations')||has(user,'manifest');
 const canFinance=has(user,'finance')||has(user,'payments')||has(user,'expenses')||has(user,'reports');
 const canAttendance=['attendance_view','attendance_reports','attendance_manage_employees','attendance_review_violations','attendance_close_month'].some(k=>has(user,k));
 const canStaff=has(user,'manageUsers')||has(user,'managePermissions');
 const canActions=['tasks','approvals','approval_requests','refunds','refund_view','refund_approve','refund_complete','attendance_review_violations','attendance_close_month','managePermissions'].some(k=>has(user,k));
 const canQuality=canBookings||canTrips||canFinance||canAttendance||canStaff||has(user,'housing')||has(user,'seats');
 const profile=roleProfile(user,labels,t);

 const quick=useMemo(()=>{
  const a=[];
  if(user?.role!=='developer')a.push({label:'بصمتي',path:'/my-attendance',Icon:Fingerprint});
  if(has(user,'branchBooking'))a.push({label:'حجز جديد',path:'/bookings/new',Icon:Plus,primary:true});
  if(canBookings)a.push({label:'الحجوزات',path:'/bookings',Icon:ClipboardList});
  if(canTrips)a.push({label:'التشغيل',path:'/operations',Icon:BusFront});
  if(has(user,'housing')||has(user,'housingManifest'))a.push({label:'التسكين',path:'/housing',Icon:Hotel});
  if(has(user,'seats'))a.push({label:'المقاعد',path:'/seats',Icon:Armchair});
  if(has(user,'scanner'))a.push({label:'QR والصعود',path:'/scanner',Icon:ScanLine});
  if(canFinance)a.push({label:'المالية',path:'/finance',Icon:WalletCards});
  if(canAttendance)a.push({label:'الحضور والبصمة',path:'/attendance',Icon:Fingerprint});
  if(canActions)a.push({label:'مركز الإجراءات',path:'/workflow',Icon:CheckSquare2});
  if(canQuality)a.push({label:'جودة البيانات',path:'/quality',Icon:ShieldAlert});
  if(canStaff)a.push({label:'الموظفون والصلاحيات',path:'/staff',Icon:UserCog});
  if(has(user,'reports'))a.push({label:'التقارير',path:'/reports',Icon:BarChart3});
  return a.slice(0,8);
 },[user,canBookings,canTrips,canFinance,canAttendance,canStaff,canActions,canQuality]);

 if(loading&&!data.scope)return <Loading/>;
 const title=language==='ar'?profile.title:(labels.dashboard_title||t('dashboardTitle'));
 const subtitle=language==='ar'?profile.subtitle:(labels.dashboard_subtitle||t('dashboardSubtitle'));
 const statCards=[
  canTrips&&{key:'trips',icon:<BusFront/>,label:t('activeTrips'),value:stats.active},
  canBookings&&{key:'bookings',icon:<ClipboardList/>,label:t('bookings'),value:stats.book},
  canBookings&&{key:'passengers',icon:<Users/>,label:t('passengers'),value:stats.pax},
  canFinance&&{key:'dues',icon:<WalletCards/>,label:t('remainingTotal'),value:money(stats.dues)},
  canStaff&&{key:'staff',icon:<UserCog/>,label:'حسابات الموظفين',value:(data.users||[]).length}
 ].filter(Boolean).slice(0,5);

 return <>
  <ModuleShell title={title} subtitle={subtitle} icon={LayoutDashboard} actions={<Button onClick={()=>refresh()}><ShieldCheck size={16}/> تحديث البيانات</Button>} breadcrumbs={[{label:'الرئيسية'},{label:profile.title}]}/>
  <ErrorBox error={error}/>
  {!!statCards.length&&<div className="stats-grid">{statCards.map(x=><Stat key={x.key} icon={x.icon} label={x.label} value={x.value}/>)}</div>}
  {!!quick.length&&<Card><div className="card-title"><div><h3>إجراءاتك السريعة</h3><small>تظهر حسب دورك وصلاحياتك فقط.</small></div></div><div className="finance-actions">{quick.map(x=><Button key={x.path} variant={x.primary?'primary':undefined} onClick={()=>go(x.path)}><x.Icon size={16}/>{x.label}</Button>)}</div></Card>}
  <div className="dashboard-grid">
   {canTrips&&<Card><div className="card-title"><h3>{t('nearestTrips')}</h3><button className="text-btn" onClick={()=>go('/trips')}>{t('viewAll')} <ArrowLeft size={16}/></button></div><div className="stack-list">{upcoming.length?upcoming.slice(0,6).map(tr=><button key={tr.id} className="list-row" onClick={()=>go('/trips/'+tr.id)}><div><strong>{tr.trip_code||t('trip')}</strong><span>{tr.from_city||tr.origin||'—'} ← {tr.to_city||tr.destination||'—'}</span></div><div><span>{tripWeekday(tr.departure_date)} — {tripDate(tr.departure_date)}{tr.departure_time?` — ${String(tr.departure_time).slice(0,5)}`:''}</span><Badge tone="blue">{statusLabel(tr.status)}</Badge></div></button>):<div className="empty-state">لا توجد رحلات قادمة حاليًا.</div>}</div></Card>}
   <Card><div className="card-title"><h3>{t('needsAction')}</h3><AlertTriangle size={20}/></div><div className="alert-list">
    {has(user,'seats')&&<Alert text={`${data.passengers.filter(x=>!x.seat_id&&!x.seat_number&&x.status!=='cancelled').length} ${t('withoutSeat')}`} onClick={()=>go('/seats')}/>}
    {(has(user,'housing')||has(user,'housingManifest'))&&<Alert text={`${data.passengers.filter(x=>String(x.accommodation_status||'').toLowerCase()==='pending').length} ${t('needsHousing')}`} onClick={()=>go('/housing')}/>}
    {canFinance&&<Alert text={`${stats.dueBookings} ${t('bookingDue')}`} onClick={()=>go('/finance')}/>}
    {canAttendance&&<Alert text="متابعة الحضور والمخالفات والإقفال الشهري" onClick={()=>go('/attendance')}/>}
    {canQuality&&<Alert text="فحص جودة البيانات والاستثناءات" onClick={()=>go('/quality')}/>} 
    {canStaff&&<Alert text="مراجعة حسابات الموظفين والصلاحيات" onClick={()=>go('/staff')}/>} 
    {!has(user,'seats')&&!has(user,'housing')&&!has(user,'housingManifest')&&!canFinance&&!canAttendance&&!canStaff&&!canQuality&&<div className="empty-state">لا توجد مهام سريعة ضمن صلاحياتك الحالية.</div>}
   </div></Card>
  </div>
 </>;
}

function Stat({icon,label,value}){return <Card className="stat-card"><div className="stat-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></Card>}
function Alert({text,onClick}){return <button className="alert-row" onClick={onClick}><span>{text}</span><ArrowLeft size={17}/></button>}
