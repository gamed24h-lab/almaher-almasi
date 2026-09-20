import React,{useEffect,useMemo,useState} from 'react';
import {LayoutDashboard,BusFront,MapPinned,ClipboardList,Users,Hotel,Armchair,Truck,WalletCards,Receipt,ScanLine,HeartHandshake,FileText,BellRing,RotateCcw,ShieldCheck,ShieldAlert,BarChart3,Code2,LogOut,PanelRightClose,PanelRightOpen,Search,Globe2,Building2,Handshake,CheckSquare2,ChevronDown,Palette,Fingerprint,Menu,X,BriefcaseBusiness,Settings2,UserRoundCog,Layers3} from 'lucide-react';
import {useAuth} from '../core/AuthContext.jsx';
import {useAppData} from '../core/AppDataContext.jsx';
import {useLanguage} from '../core/LanguageContext.jsx';
import {useTheme} from '../core/ThemeContext.jsx';
import {useSystemBrand} from '../core/SystemBrandContext.jsx';
import {has} from '../lib/permissions.js';
import {branchLogo} from '../lib/branding.js';

const items=[
 {p:'/',key:'home',Icon:LayoutDashboard,perms:[],group:'home'},
 {p:'/trips',key:'trips',Icon:BusFront,perms:['trips','operations','viewBookings'],group:'sales'},
 {p:'/bookings',key:'bookings',Icon:ClipboardList,perms:['viewBookings','editBookings','branchBooking'],group:'sales'},
 {p:'/passengers',key:'passengers',Icon:Users,perms:['viewBookings','editPassenger'],group:'sales'},
 {p:'/crm',key:'crm',Icon:HeartHandshake,perms:['crm','customers'],group:'sales'},
 {p:'/destinations',key:'destinations',Icon:MapPinned,perms:['viewDestinations','manageDestinations','addDestinations','editDestinations','deleteDestinations','manageDestinationRoutes','trips','operations'],group:'operations'},
 {p:'/housing',key:'housing',Icon:Hotel,perms:['housing','viewHotels','addHotels','editHotels','deleteHotels','linkHotels','manageHotelRooms','manageHotels'],group:'operations'},
 {p:'/seats',key:'seats',Icon:Armchair,perms:['seats','operations'],group:'operations'},
 {p:'/fleet',key:'fleet',Icon:Truck,perms:['fleet','viewFleet','vehicles','addVehicles','editVehicles','deleteVehicles','viewDrivers','addDrivers','editDrivers','deleteDrivers','manageDrivers','assignFleet','manageMaintenance','trips'],group:'operations'},
 {p:'/operations',key:'operations',Icon:ShieldCheck,perms:['operations','manifest','housingManifest','viewBookings'],group:'operations'},
 {p:'/scanner',key:'scanner',Icon:ScanLine,perms:['scanner','qr','operations'],group:'operations'},
 {p:'/returns',key:'returns',Icon:RotateCcw,perms:['return','returns','operations'],group:'operations'},
 {p:'/finance',key:'finance',Icon:WalletCards,perms:['finance','payments','expenses','refunds'],group:'finance'},
 {p:'/refunds',key:'refunds',Icon:Receipt,perms:['refunds','refund_request','refund_approve','refund_complete'],group:'finance'},
 {p:'/wallets',key:'wallets',Icon:WalletCards,perms:['payments','refunds','viewBookings'],group:'finance'},
 {p:'/partners',key:'partners',Icon:Handshake,perms:['finance','agents','suppliers'],group:'finance'},
 {p:'/staff',key:'staff',Icon:Users,perms:['manageUsers','managePermissions'],group:'hr'},
 {p:'/attendance',key:'attendance',Icon:Fingerprint,perms:['attendance_view','attendance_manage_devices','attendance_manage_links','attendance_manage_employees','attendance_manage_schedules','attendance_manage_policies','attendance_review_violations','attendance_close_month','attendance_reopen_month','attendance_delete_employees','attendance_reports'],group:'hr'},
 {p:'/id-studio',key:'idStudio',Icon:ShieldCheck,perms:['id_studio_access'],group:'hr'},
 {p:'/branches',key:'branches',Icon:Building2,perms:['manageBranches'],group:'management'},
 {p:'/workflow',key:'workflow',Icon:CheckSquare2,perms:['operations','approvals','approval_requests','tasks','refunds','refund_view','refund_request','refund_approve','refund_complete','attendance_review_violations','attendance_close_month','attendance_reopen_month','attendance_manage_employees','managePermissions'],group:'management'},
 {p:'/quality',key:'qualityCenter',Icon:ShieldAlert,perms:['viewBookings','editBookings','branchBooking','trips','operations','manifest','seats','housing','housingManifest','finance','payments','expenses','reports','attendance_view','attendance_reports','attendance_manage_employees','attendance_manage_devices','attendance_manage_links','manageUsers','managePermissions'],group:'management'},
 {p:'/documents',key:'documents',Icon:FileText,perms:['documents','editPassenger'],group:'management'},
 {p:'/notifications',key:'notifications',Icon:BellRing,perms:['notifications','automation'],group:'management'},
 {p:'/reports',key:'reports',Icon:BarChart3,perms:['reports','printReports'],group:'management'},
 {p:'/customer',key:'customer',Icon:Globe2,perms:[],group:'services'},
 {p:'/developer',key:'developer',Icon:Code2,perms:['developer_console_access'],group:'developer'}
];
const groups=[
 {id:'sales',label:'الحجوزات والمبيعات',Icon:BriefcaseBusiness},
 {id:'operations',label:'التشغيل',Icon:Layers3},
 {id:'finance',label:'المالية',Icon:WalletCards},
 {id:'hr',label:'الموارد البشرية',Icon:UserRoundCog},
 {id:'management',label:'الإدارة والمتابعة',Icon:Settings2},
 {id:'services',label:'الخدمات',Icon:Globe2},
 {id:'developer',label:'المطور',Icon:Code2}
];
const text=v=>String(v??'').toLowerCase();

export default function Shell({children,route,go}){
 const {user,logout}=useAuth();const {data}=useAppData();const {language,setLanguage,languages,meta,t}=useLanguage();const {theme,setTheme,themes}=useTheme();const {profile:developer,labels,config}=useSystemBrand();
 const [collapsed,setCollapsed]=useState(false),[q,setQ]=useState(''),[focus,setFocus]=useState(false),[mobileMenu,setMobileMenu]=useState(false);
 const visible=useMemo(()=>items.filter(x=>!x.perms.length||x.perms.some(k=>has(user,k))),[user]);
 const activeItem=useMemo(()=>visible.find(x=>x.p==='/'?route==='/':route===x.p||route.startsWith(x.p+'/'))||visible[0],[visible,route]);
 const [openGroups,setOpenGroups]=useState(()=>{try{return JSON.parse(localStorage.getItem('almaher-nav-groups')||'{}')}catch{return {}}});
 useEffect(()=>{if(activeItem?.group&&activeItem.group!=='home')setOpenGroups(x=>({...x,[activeItem.group]:true}))},[activeItem?.group]);
 useEffect(()=>{try{localStorage.setItem('almaher-nav-groups',JSON.stringify(openGroups))}catch{}},[openGroups]);

 const activeBranch=useMemo(()=>{const bid=user?.branch_id||user?.home_branch_id||data.scope?.branch_id;return (data.branches||[]).find(b=>String(b.id)===String(bid))||null},[user,data.branches,data.scope]);
 const accountMode=user?.permissions?._accountMode==='production'?'production':'training';
 const bookingMap=useMemo(()=>new Map((data.bookings||[]).map(b=>[String(b.id),b])),[data.bookings]);
 const searchResults=useMemo(()=>{const k=text(q).trim();if(k.length<2)return[];const out=[];for(const b of data.bookings||[]){if([b.booking_number,b.customer_name,b.customer_phone,b.customer_identity].some(v=>text(v).includes(k)))out.push({key:`b-${b.id}`,title:`${t('booking')} ${b.booking_number}`,sub:`${b.customer_name||''} · ${b.customer_phone||''}`,path:`/bookings/${encodeURIComponent(b.booking_number)}`})}for(const p of data.passengers||[]){if([p.full_name,p.identity_number,p.phone,p.nationality].some(v=>text(v).includes(k))){const b=bookingMap.get(String(p.booking_id));out.push({key:`p-${p.id}`,title:`${t('passenger')} — ${p.full_name||''}`,sub:`${p.identity_number||''}${b?.booking_number?` · ${t('booking')} ${b.booking_number}`:''}`,path:b?`/bookings/${encodeURIComponent(b.booking_number)}`:'/passengers'})}}for(const tr of data.trips||[]){if([tr.trip_code,tr.code,tr.name,tr.from_city,tr.origin,tr.to_city,tr.destination,tr.departure_date].some(v=>text(v).includes(k)))out.push({key:`t-${tr.id}`,title:`${t('trip')} ${tr.trip_code||tr.code||''}`,sub:`${tr.from_city||tr.origin||''} ← ${tr.to_city||tr.destination||''} · ${tr.departure_date||''}`,path:`/trips/${encodeURIComponent(tr.id)}`})}return out.slice(0,10)},[q,data,bookingMap,t]);

 const labelFor=x=>x.key==='destinations'?'إدارة الوجهات':x.key==='wallets'?'محافظ العملاء':x.key==='attendance'?'الحضور والبصمة':x.key==='idStudio'?'بطاقات ID':x.key==='workflow'?'مركز الإجراءات':x.key==='qualityCenter'?'جودة البيانات':t(x.key);
 const grouped=useMemo(()=>groups.map(g=>({...g,items:visible.filter(x=>x.group===g.id)})).filter(g=>g.items.length),[visible]);
 const mobilePrimary=useMemo(()=>{const priority=['/','/bookings','/operations','/attendance'];const selected=[];for(const p of priority){const x=visible.find(v=>v.p===p);if(x)selected.push(x)}for(const x of visible){if(selected.length>=4)break;if(!selected.some(a=>a.p===x.p)&&!['/developer','/customer'].includes(x.p))selected.push(x)}return selected.slice(0,4)},[visible]);

 async function signOut(){await logout();go('/login',{replace:true})}
 function navigate(path){setMobileMenu(false);go(path)}
 function choose(r){setQ('');setFocus(false);navigate(r.path)}
 function NavItem({item,mobile=false}){const active=item.p==='/'?route==='/':route===item.p||route.startsWith(item.p+'/');const Icon=item.Icon,label=labelFor(item);return <button type="button" className={active?'active':''} onClick={()=>navigate(item.p)} title={label}><Icon size={19}/><span>{label}</span></button>}
 const isDeveloper=String(user?.role||'').toLowerCase()==='developer';const displayRole=isDeveloper?t('roleDeveloper'):(user?.role||'—');const displayName=isDeveloper?(developer.display_name||user?.name||user?.username||t('user')):(user?.name||user?.username||t('user'));const avatarLetter=String(displayName||'م').trim().charAt(0);

 return <div className={`app-shell ui-v2 ${collapsed?'collapsed':''}`}>
  <aside className="sidebar desktop-sidebar">
   <div className="brand"><img className="brand-logo" src={branchLogo(activeBranch)} alt={activeBranch?.name||labels.system_name||'الماهر الماسي'}/><div className="brand-copy"><strong>{activeBranch?.name||labels.system_name||'الماهر الماسي'}</strong><span>{t('platform')}</span></div></div>
   <nav className="grouped-nav">
    {collapsed?visible.map(item=><NavItem key={item.p} item={item}/>):<>
     {visible.find(x=>x.p==='/')&&<NavItem item={visible.find(x=>x.p==='/')}/>}
     {grouped.map(g=>{const GIcon=g.Icon,open=!!openGroups[g.id],active=g.items.some(x=>x===activeItem);return <div className={`nav-group ${active?'active-group':''}`} key={g.id}><button type="button" className="nav-group-head" onClick={()=>setOpenGroups(x=>({...x,[g.id]:!x[g.id]}))}><GIcon size={17}/><span>{g.label}</span><ChevronDown size={15} className={open?'rotated':''}/></button>{open&&<div className="nav-group-items">{g.items.map(item=><NavItem key={item.p} item={item}/>)}</div>}</div>})}
    </>}
   </nav>
   <div className="side-bottom"><button onClick={()=>setCollapsed(x=>!x)}>{collapsed?<PanelRightOpen size={19}/>:<PanelRightClose size={19}/>}<span>{t('collapseMenu')}</span></button><button onClick={signOut}><LogOut size={19}/><span>{t('logout')}</span></button></div>
  </aside>

  <div className="content-shell"><header className="topbar"><div className="global-search-wrap"><div className="global-search"><Search size={18}/><input value={q} placeholder={t('search')} onChange={e=>setQ(e.target.value)} onFocus={()=>setFocus(true)} onBlur={()=>setTimeout(()=>setFocus(false),160)} onKeyDown={e=>{if(e.key==='Enter'&&searchResults[0])choose(searchResults[0]);if(e.key==='Escape'){setQ('');setFocus(false)}}}/></div>{focus&&q.trim().length>=2&&<div className="global-results">{searchResults.length?searchResults.map(r=><button key={r.key} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(r)}><b>{r.title}</b><span>{r.sub}</span></button>):<div className="global-empty">{t('noSearchResults')}</div>}</div>}</div><div className="user-chip"><details className="language-switcher" style={{position:'relative'}}><summary aria-label="لغة النظام" style={{listStyle:'none',cursor:'pointer',display:'flex',alignItems:'center',gap:7,border:'1px solid #d7dee7',borderRadius:999,padding:'7px 10px',background:'#fff',minWidth:84,justifyContent:'center',fontWeight:800}}><span style={{fontSize:14}}>{meta?.[3]||String(language).toUpperCase()}</span><span style={{fontSize:22,lineHeight:1}}>{meta?.[4]||'🌐'}</span><ChevronDown size={14}/></summary><div style={{position:'absolute',top:'calc(100% + 7px)',insetInlineStart:0,zIndex:9999,minWidth:180,background:'#fff',border:'1px solid #dfe5ec',borderRadius:14,boxShadow:'0 12px 30px rgba(15,35,60,.16)',padding:6}}>{languages.map(([code,label,,short,flag])=><button type="button" key={code} onClick={e=>{setLanguage(code);e.currentTarget.closest('details')?.removeAttribute('open')}} style={{width:'100%',border:0,background:code===language?'#eef4fb':'transparent',padding:'9px 10px',borderRadius:10,display:'flex',alignItems:'center',gap:9,cursor:'pointer',textAlign:'start'}}><span style={{fontSize:20}}>{flag}</span><b style={{minWidth:24}}>{short}</b><span>{label}</span></button>)}</div></details><details className="theme-switcher" style={{position:'relative'}}><summary title="الثيم" style={{listStyle:'none',cursor:'pointer',width:40,height:40,border:'1px solid #d7dee7',borderRadius:999,background:'#fff',display:'grid',placeItems:'center'}}><Palette size={18}/></summary><div style={{position:'absolute',top:'calc(100% + 7px)',insetInlineStart:0,zIndex:9999,minWidth:170,background:'#fff',border:'1px solid #dfe5ec',borderRadius:14,boxShadow:'0 12px 30px rgba(15,35,60,.16)',padding:6}}>{themes.map(([code,label,icon])=><button type="button" key={code} onClick={e=>{setTheme(code);e.currentTarget.closest('details')?.removeAttribute('open')}} style={{width:'100%',border:0,background:code===theme?'#eef4fb':'transparent',padding:'9px 10px',borderRadius:10,display:'flex',alignItems:'center',gap:9,cursor:'pointer',textAlign:'start'}}><span>{icon}</span><span>{label}</span></button>)}</div></details><div><strong>{displayName}</strong><span>{displayRole}{activeBranch?.name?` · ${activeBranch.name}`:''} · {accountMode==='production'?t('production'):t('training')}</span></div><div className="avatar">{avatarLetter}</div><button className="top-logout" onClick={signOut} title={t('logout')}><LogOut size={18}/></button></div></header>{accountMode==='training'&&<div className="training-banner">{t('trainingBanner')}</div>}<main>{children}</main>{config.show_profile_all_pages!==false&&<footer className="system-developer-footer"><span>{t('systemDevelopment')}</span><strong>{developer.display_name||'Mohamed Abdelrahman Hassan'}</strong>{developer.title&&<span>{developer.title==='مطور النظام'?t('systemDeveloper'):developer.title}</span>}{developer.phone&&<span dir="ltr">{developer.phone}</span>}</footer>}</div>

  <nav className="mobile-bottom-nav">{mobilePrimary.map(item=><NavItem key={item.p} item={item} mobile/>)}<button type="button" className={mobileMenu?'active':''} onClick={()=>setMobileMenu(true)}><Menu size={20}/><span>المزيد</span></button></nav>
  {mobileMenu&&<div className="mobile-menu-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setMobileMenu(false)}}><div className="mobile-menu-drawer"><div className="mobile-menu-head"><div><strong>{labels.system_name||'الماهر الماسي'}</strong><span>كل أقسام النظام</span></div><button type="button" onClick={()=>setMobileMenu(false)}><X size={21}/></button></div><div className="mobile-menu-scroll">{visible.find(x=>x.p==='/')&&<NavItem item={visible.find(x=>x.p==='/')}/>} {grouped.map(g=><section key={g.id}><h4>{g.label}</h4><div>{g.items.map(item=><NavItem key={item.p} item={item}/>)}</div></section>)}</div><button type="button" className="mobile-signout" onClick={signOut}><LogOut size={18}/> تسجيل الخروج</button></div></div>}
 </div>;
}
