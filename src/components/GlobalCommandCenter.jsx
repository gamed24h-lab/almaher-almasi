import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Search,Command,ClipboardList,Users,BusFront,UserRoundCog,Handshake,Building2,ArrowLeft,Clock3} from 'lucide-react';
import {useAppData} from '../core/AppDataContext.jsx';
import {useAuth} from '../core/AuthContext.jsx';
import {has} from '../lib/permissions.js';
import {matchesListQuery} from '../lib/listFilters.js';
import {dateRangeForPreset} from '../lib/dateRangeFilters.js';
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
 const smartCommands=useMemo(()=>{
  const query=q.trim();if(!query)return[];
  const out=[],branches=safeArray(data.branches),enc=encodeURIComponent;
  const branch=branches.find(b=>matchesListQuery(query,b.name,b.branch_name,b.city));
  const branchName=branch?.name||branch?.branch_name||'',bid=branch?.id?enc(branch.id):'';
  const add=(key,title,sub,path,Icon=Search,filters=[])=>out.push({key:'smart-'+key,kind:'أمر ذكي',title,sub,path,Icon,filters});
  const hasWord=(...words)=>words.some(w=>matchesListQuery(query,w));
  const wantsBookings=hasWord('حجوزات','الحجوزات','حجز'),wantsTrips=hasWord('رحلات','الرحلات','رحلة'),wantsStaff=hasWord('موظفين','الموظفين','موظفي','موظف');
  const wantsUnpaid=hasWord('غير مسددة','غير مسدد','غير مدفوع','متبقي','جزئي'),wantsPaid=hasWord('مسددة','مسدد بالكامل','مدفوع بالكامل');
  const latinDigits=v=>String(v||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const numericIntent=(label)=>{const z=latinDigits(query),m=z.match(/(?:${label})[^0-9]{0,35}(اكثر من|أكثر من|فوق|اكبر من|أكبر من|اقل من|أقل من|تحت)?\s*([0-9]+(?:\.[0-9]+)?)/i)||z.match(/(اكثر من|أكثر من|فوق|اكبر من|أكبر من|اقل من|أقل من|تحت)\s*([0-9]+(?:\.[0-9]+)?)[^\n]{0,25}(?:${label})/i);if(!m)return null;const opText=m[1]||'',value=m[2];return {value,op:/اقل|أقل|تحت/.test(opText)?'lt':'gt'}};
  const remainingIntent=numericIntent('متبقي|المتبقي|عليها|عليه'),capacityIntent=numericIntent('سعة|سعتها|السعة');
  const z=query.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const between=z.match(/(?:بين|من)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:و|الى|إلى|لـ|-)\s*([0-9]+(?:\.[0-9]+)?)/);
  const top=z.match(/(?:اعلى|أعلى|اول|أول)\s*([0-9]+)/),nearest=z.match(/(?:اقرب|أقرب)\s*([0-9]+)/);
  const wantsToday=hasWord('اليوم','اليومية'),wantsTomorrow=hasWord('بكرة','غدا','غداً'),wantsLast7=hasWord('آخر 7 أيام','اخر 7 ايام','آخر سبعة أيام'),wantsThisMonth=hasWord('الشهر ده','هذا الشهر','الشهر الحالي'),wantsNextWeek=hasWord('الأسبوع الجاي','الاسبوع الجاي','الأسبوع القادم','الاسبوع القادم'),wantsActive=hasWord('النشطين','نشطين','النشطة','نشطة','نشط'),wantsPending=hasWord('معلقة','معلق','قيد المراجعة','بانتظار');
  if(wantsBookings&&(has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking'))){
   const params=[];if(branch)params.push('branch='+bid);if(wantsUnpaid)params.push('financial=unpaid');else if(wantsPaid)params.push('financial=paid');if(wantsPending)params.push('status=pending');if(remainingIntent)params.push('remainingOp='+remainingIntent.op,'remaining='+remainingIntent.value);let bookingDate='';if(wantsLast7)bookingDate='last_7_days';else if(wantsThisMonth)bookingDate='this_month';else if(wantsToday)bookingDate='today';if(bookingDate){const r=dateRangeForPreset(bookingDate);params.push('datePreset='+bookingDate,'fromDate='+r.from,'toDate='+r.to)}
   if(params.length)add('bookings-'+params.join('-'),'الحجوزات'+(branch?' · '+branchName:'')+(wantsUnpaid?' · غير مسددة':wantsPaid?' · مسددة':'')+(wantsPending?' · قيد المراجعة':''),'فتح سجل الحجوزات مع تطبيق الفلاتر المطلوبة','/bookings?'+params.join('&'),ClipboardList,[branch&&`الفرع: ${branchName}`,wantsUnpaid?'المالية: غير مسددة':wantsPaid?'المالية: مسددة':'',wantsPending?'الحالة: قيد المراجعة':'',bookingDate==='last_7_days'?'الفترة: آخر 7 أيام':bookingDate==='this_month'?'الفترة: هذا الشهر':bookingDate==='today'?'الفترة: اليوم':'',remainingIntent?`المتبقي: ${remainingIntent.op==='lt'?'أقل من':'أكثر من'} ${remainingIntent.value} ريال`:'' ].filter(Boolean));
  }
  if(wantsTrips&&(has(user,'trips')||has(user,'operations'))){
   const params=[];if(branch)params.push('branch='+bid);let tripDate='';if(wantsTomorrow)tripDate='tomorrow';else if(wantsNextWeek)tripDate='next_week';else if(wantsToday)tripDate='today';if(tripDate){const r=dateRangeForPreset(tripDate);params.push('fromDate='+r.from,'toDate='+r.to)}if(wantsActive)params.push('status=active');if(between&&hasWord('سعة','سعتها','السعة'))params.push('capacityMin='+between[1],'capacityMax='+between[2]);if(nearest)params.push('sort=nearest','limit='+nearest[1]);if(capacityIntent)params.push('capacityOp='+capacityIntent.op,'capacity='+capacityIntent.value);
   if(params.length)add('trips-'+params.join('-'),'الرحلات'+(branch?' · '+branchName:'')+(tripDate==='today'?' · اليوم':tripDate==='tomorrow'?' · بكرة':tripDate==='next_week'?' · الأسبوع الجاي':'')+(wantsActive?' · النشطة':''),'فتح الرحلات مع تطبيق الفلاتر المطلوبة','/trips?'+params.join('&'),BusFront,[branch&&`الفرع: ${branchName}`,tripDate==='today'?'التاريخ: اليوم':tripDate==='tomorrow'?'التاريخ: بكرة':tripDate==='next_week'?'الفترة: الأسبوع الجاي':'',wantsActive?'الحالة: نشطة':'',capacityIntent?`السعة: ${capacityIntent.op==='lt'?'أقل من':'أكثر من'} ${capacityIntent.value}`:'' ].filter(Boolean));
  }
  if(wantsStaff&&branch&&(has(user,'manageUsers')||has(user,'managePermissions'))){
   const params=['tab=accounts','branch='+bid];if(wantsActive)params.push('status=active');
   add('staff-'+bid+(wantsActive?'-active':''),'موظفو '+branchName+(wantsActive?' · النشطون':''),'فتح حسابات الموظفين مع تطبيق الفلاتر المطلوبة','/staff?'+params.join('&'),UserRoundCog,[`الفرع: ${branchName}`,wantsActive?'الحالة: نشط':''].filter(Boolean));
  }
  if(hasWord('بصمة','الحضور','حضور')&&(has(user,'attendance_view')||has(user,'attendance_manage_employees')))add('attendance','الحضور والبصمة','فتح مركز الحضور والبصمة','/attendance',UserRoundCog);
  return out;
 },[q,data.branches,user]);
 const suggestions=useMemo(()=>{
  const branches=safeArray(data.branches),sample=branches.slice(0,3),out=[];
  const push=(key,label)=>{if(!out.some(x=>x.label===label))out.push({key,label})};
  if(has(user,'viewBookings')||has(user,'editBookings')||has(user,'branchBooking')){
   push('unpaid','الحجوزات غير المسددة');for(const b of sample){const n=b.name||b.branch_name;if(n)push('booking-'+b.id,`حجوزات فرع ${n} غير المسددة`)}
  }
  if(has(user,'trips')||has(user,'operations')){push('today','رحلات اليوم');for(const b of sample){const n=b.name||b.branch_name;if(n)push('trip-'+b.id,`رحلات فرع ${n} اليوم`)}}
  if(has(user,'manageUsers')||has(user,'managePermissions'))for(const b of sample){const n=b.name||b.branch_name;if(n)push('staff-'+b.id,`موظفي فرع ${n} النشطين`)}
  const query=q.trim();return (query?out.filter(x=>matchesListQuery(x.label,query)||matchesListQuery(query,x.label)):out).slice(0,6);
 },[q,data.branches,user]);
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
  return [...smartCommands,...pages,...rows].slice(0,24);
 },[q,pageCommands,records,smartCommands]);
 useEffect(()=>{setActive(0)},[q]);
 if(!open)return null;
 const choose=item=>{if(!item)return;const next=[{key:item.key,title:item.title,sub:item.sub,path:item.path,kind:item.kind},...recent.filter(x=>x.key!==item.key)].slice(0,6);setRecent(next);writeRecent(next);onClose();go(item.path)};
 const shown=!q.trim()&&recent.length?recent:results;
 return <div className="command-center-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <div className="command-center" role="dialog" aria-modal="true" aria-label="البحث الشامل">
   <div className="command-center-search"><Search size={20}/><input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث في الحجوزات، المسافرين، الرحلات، الموظفين، الوكلاء..." onKeyDown={e=>{if(e.key==='Escape')onClose();else if(e.key==='ArrowDown'){e.preventDefault();setActive(x=>Math.min(x+1,shown.length-1))}else if(e.key==='ArrowUp'){e.preventDefault();setActive(x=>Math.max(0,x-1))}else if(e.key==='Enter'&&shown[active])choose(shown[active])}}/><kbd>ESC</kbd></div>
   <div className="command-center-meta"><span>{q.trim()?'نتائج البحث':'الوصول السريع'}</span><span><Command size={13}/> Ctrl / ⌘ + K</span></div>
   {suggestions.length>0&&<div className="command-suggestions"><span className="command-suggestions-label">اقتراحات</span>{suggestions.map(x=><button type="button" key={x.key} onClick={()=>setQ(x.label)}>{x.label}</button>)}</div>}
   <div className="command-center-results">{shown.length?shown.map((r,i)=>{const Icon=r.Icon||(r.kind==='حجز'?ClipboardList:r.kind==='مسافر'?Users:r.kind==='رحلة'?BusFront:r.kind==='موظف'?UserRoundCog:r.kind==='وكيل'?Handshake:r.kind==='فرع'?Building2:Clock3);return <button key={r.key} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>choose(r)}><span className="command-icon"><Icon size={18}/></span><span className="command-copy"><b>{r.title}</b><small>{r.kind}{r.sub?' · '+r.sub:''}</small>{r.filters?.length>0&&<span className="command-filter-preview">{r.filters.map(x=><em key={x}>{x}</em>)}</span>}</span><ArrowLeft size={16}/></button>}):<div className="command-center-empty">لا توجد نتائج مطابقة ضمن البيانات المصرح لك بعرضها.</div>}</div>
   <div className="command-center-footer"><span>↑ ↓ للتنقل</span><span>Enter للفتح</span><span>Esc للإغلاق</span></div>
  </div>
 </div>;
}
