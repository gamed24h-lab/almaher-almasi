import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Search,Command,ClipboardList,Users,BusFront,UserRoundCog,Handshake,Building2,ArrowLeft,Clock3} from 'lucide-react';
import {useAppData} from '../core/AppDataContext.jsx';
import {useAuth} from '../core/AuthContext.jsx';
import {has} from '../lib/permissions.js';
import {matchesListQuery} from '../lib/listFilters.js';
import './global-command-center.css';

const RECENT_KEY='almaher-command-center-recent-v1';
const s=v=>String(v??'');
const safeArray=v=>Array.isArray(v)?v:[];
const readRecent=()=>{try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]')}catch{return[]}};
const writeRecent=x=>{try{localStorage.setItem(RECENT_KEY,JSON.stringify(x.slice(0,6)))}catch{}};

export default function GlobalCommandCenter({open,onClose,go,initialQuery=''}) {
 const {data}=useAppData(),{user}=useAuth();
 const [q,setQ]=useState(initialQuery),[active,setActive]=useState(0),[recent,setRecent]=useState(readRecent);
 const inputRef=useRef(null);
 useEffect(()=>{if(open){setQ(initialQuery||'');setActive(0);setTimeout(()=>inputRef.current?.focus(),0)}},[open,initialQuery]);
 const bookingMap=useMemo(()=>new Map(safeArray(data.bookings).map(x=>[s(x.id),x])),[data.bookings]);
 const pageCommands=useMemo(()=>[
  {key:'page-bookings',kind:'صفحة',title:'الحجوزات',sub:'سجل الحجوزات والبحث والتعديل',path:'/bookings',Icon:ClipboardList,show:has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking')},
  {key:'new-booking',kind:'إجراء',title:'حجز جديد',sub:'فتح شاشة إنشاء حجز',path:'/bookings/new',Icon:ClipboardList,show:has(user,'editBookings')||has(user,'branchBooking')},
  {key:'page-passengers',kind:'صفحة',title:'المسافرون',sub:'Passenger 360° وبيانات المسافرين',path:'/passengers',Icon:Users,show:has(user,'viewBookings')||has(user,'editPassenger')},
  {key:'page-trips',kind:'صفحة',title:'الرحلات',sub:'الرحلات والمسارات والتواريخ',path:'/trips',Icon:BusFront,show:has(user,'trips')||has(user,'operations')},
  {key:'page-staff',kind:'صفحة',title:'الموظفون والصلاحيات',sub:'الحسابات والصلاحيات',path:'/staff',Icon:UserRoundCog,show:has(user,'manageUsers')||has(user,'managePermissions')},
  {key:'page-attendance',kind:'صفحة',title:'الحضور والبصمة',sub:'الموظفون والأجهزة وسجلات الحضور',path:'/attendance',Icon:UserRoundCog,show:has(user,'attendance_view')||has(user,'attendance_manage_employees')},
  {key:'page-partners',kind:'صفحة',title:'الوكلاء والموردون',sub:'إدارة الشركاء والوكلاء',path:'/partners',Icon:Handshake,show:has(user,'agents')||has(user,'suppliers')||has(user,'finance')},
  {key:'page-branches',kind:'صفحة',title:'الفروع',sub:'إدارة الفروع وبياناتها',path:'/branches',Icon:Building2,show:has(user,'manageBranches')}
 ].filter(x=>x.show),[user]);
 const records=useMemo(()=>{
  const out=[];
  if(has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking'))for(const b of safeArray(data.bookings))out.push({key:'booking-'+b.id,kind:'حجز',title:b.booking_number||b.booking_no||'حجز',sub:[b.customer_name,b.customer_phone,b.status].filter(Boolean).join(' · '),search:[b.booking_number,b.booking_no,b.customer_name,b.customer_phone,b.customer_identity,b.customer_nationality,b.status],path:'/bookings/'+encodeURIComponent(b.booking_number||b.booking_no||b.id),Icon:ClipboardList});
  if(has(user,'viewBookings')||has(user,'editPassenger'))for(const p of safeArray(data.passengers)){const b=bookingMap.get(s(p.booking_id));out.push({key:'passenger-'+p.id,kind:'مسافر',title:p.full_name||'مسافر',sub:[p.identity_number,p.phone,b?.booking_number].filter(Boolean).join(' · '),search:[p.full_name,p.identity_number,p.phone,p.nationality,b?.booking_number],path:'/passengers/'+encodeURIComponent(p.id),Icon:Users})}
  if(has(user,'trips')||has(user,'operations')||has(user,'viewBookings'))for(const t of safeArray(data.trips))out.push({key:'trip-'+t.id,kind:'رحلة',title:t.trip_code||t.code||'رحلة',sub:[t.from_city||t.origin,t.to_city||t.destination,t.departure_date].filter(Boolean).join(' · '),search:[t.trip_code,t.code,t.from_city,t.origin,t.to_city,t.destination,t.departure_date,t.return_date],path:'/trips/'+encodeURIComponent(t.id),Icon:BusFront});
  if(has(user,'manageUsers')||has(user,'managePermissions')||has(user,'attendance_manage_employees'))for(const u of safeArray(data.users))out.push({key:'user-'+u.id,kind:'موظف',title:u.name||u.username||'موظف',sub:[u.username,u.phone,u.role].filter(Boolean).join(' · '),search:[u.name,u.username,u.phone,u.role,u.employee_code],path:has(user,'manageUsers')?'/staff?tab=accounts':'/attendance?tab=employees',Icon:UserRoundCog});
  if(has(user,'manageBranches'))for(const b of safeArray(data.branches))out.push({key:'branch-'+b.id,kind:'فرع',title:b.name||b.branch_name||'فرع',sub:[b.city,b.phone,b.manager_name].filter(Boolean).join(' · '),search:[b.name,b.branch_name,b.city,b.phone,b.manager_name,b.address],path:'/branches',Icon:Building2});
  const agents=safeArray(data.agents||data.umrah_agents||data.partners);
  if(has(user,'agents')||has(user,'finance'))for(const a of agents)out.push({key:'agent-'+a.id,kind:'وكيل',title:a.name||a.agent_name||a.company_name||'وكيل',sub:[a.phone,a.city,a.code].filter(Boolean).join(' · '),search:[a.name,a.agent_name,a.company_name,a.phone,a.city,a.code,a.tax_number],path:'/partners/agents/'+encodeURIComponent(a.id),Icon:Handshake});
  return out;
 },[data,user,bookingMap]);
 const results=useMemo(()=>{
  const query=q.trim();
  if(!query)return pageCommands.slice(0,8);
  const pages=pageCommands.filter(x=>matchesListQuery(query,x.title,x.sub,x.kind));
  const rows=records.filter(x=>matchesListQuery(query,x.title,x.sub,x.search,x.kind));
  return [...pages,...rows].slice(0,24);
 },[q,pageCommands,records]);
 useEffect(()=>{setActive(0)},[q]);
 if(!open)return null;
 const choose=item=>{if(!item)return;const next=[{key:item.key,title:item.title,sub:item.sub,path:item.path,kind:item.kind},...recent.filter(x=>x.key!==item.key)].slice(0,6);setRecent(next);writeRecent(next);onClose();go(item.path)};
 const shown=!q.trim()&&recent.length?recent:results;
 return <div className="command-center-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="command-center" role="dialog" aria-modal="true" aria-label="البحث الشامل">
   <div className="command-center-search"><Search size={20}/><input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث في الحجوزات، المسافرين، الرحلات، الموظفين، الوكلاء..." onKeyDown={e=>{if(e.key==='Escape')onClose();else if(e.key==='ArrowDown'){e.preventDefault();setActive(x=>Math.min(x+1,shown.length-1))}else if(e.key==='ArrowUp'){e.preventDefault();setActive(x=>Math.max(0,x-1))}else if(e.key==='Enter'&&shown[active])choose(shown[active])}}/><kbd>ESC</kbd></div>
   <div className="command-center-meta"><span>{q.trim()?'نتائج البحث':'الوصول السريع'}</span><span><Command size={13}/> Ctrl / ⌘ + K</span></div>
   <div className="command-center-results">{shown.length?shown.map((r,i)=>{const Icon=r.Icon||(r.kind==='حجز'?ClipboardList:r.kind==='مسافر'?Users:r.kind==='رحلة'?BusFront:r.kind==='موظف'?UserRoundCog:r.kind==='وكيل'?Handshake:r.kind==='فرع'?Building2:Clock3);return <button key={r.key} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>choose(r)}><span className="command-icon"><Icon size={18}/></span><span className="command-copy"><b>{r.title}</b><small>{r.kind}{r.sub?' · '+r.sub:''}</small></span><ArrowLeft size={16}/></button>}):<div className="command-center-empty">لا توجد نتائج مطابقة ضمن البيانات المصرح لك بعرضها.</div>}</div>
   <div className="command-center-footer"><span>↑ ↓ للتنقل</span><span>Enter للفتح</span><span>Esc للإغلاق</span></div>
  </div>
 </div>;
}
