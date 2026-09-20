import React,{useEffect,useMemo,useState} from 'react';
import {ChevronLeft} from 'lucide-react';

export function useModuleTab(storageKey,tabs,defaultTab){
 const allowed=useMemo(()=>new Set((tabs||[]).map(t=>t.id)),[tabs]);
 const first=(tabs||[])[0]?.id||defaultTab||'overview';
 const read=()=>{try{const saved=localStorage.getItem(storageKey);return allowed.has(saved)?saved:(allowed.has(defaultTab)?defaultTab:first)}catch{return allowed.has(defaultTab)?defaultTab:first}};
 const [active,setActive]=useState(read);
 useEffect(()=>{if(!allowed.has(active))setActive(allowed.has(defaultTab)?defaultTab:first)},[allowed,active,defaultTab,first]);
 function change(id){if(!allowed.has(id))return;setActive(id);try{localStorage.setItem(storageKey,id)}catch{}}
 return [active,change];
}

export default function ModuleShell({title,subtitle,icon:Icon,tabs=[],activeTab,onTabChange,actions,breadcrumbs=[]}){
 return <div className="module-shell">
  <div className="module-shell-head">
   <div className="module-title-wrap">
    {!!breadcrumbs.length&&<div className="module-breadcrumbs">{breadcrumbs.map((b,i)=><React.Fragment key={b.label||i}><span>{b.label}</span>{i<breadcrumbs.length-1&&<ChevronLeft size={13}/>}</React.Fragment>)}</div>}
    <div className="module-title-line">{Icon&&<span className="module-title-icon"><Icon size={22}/></span>}<div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div></div>
   </div>
   {actions&&<div className="module-actions">{actions}</div>}
  </div>
  {!!tabs.length&&<div className="module-tabs" role="tablist" aria-label={title}>{tabs.map(t=>{const TIcon=t.icon;return <button key={t.id} type="button" role="tab" aria-selected={activeTab===t.id} className={activeTab===t.id?'active':''} onClick={()=>onTabChange?.(t.id)}>{TIcon&&<TIcon size={16}/>}<span>{t.label}</span>{t.badge!==undefined&&t.badge!==null&&<b>{t.badge}</b>}</button>})}</div>}
 </div>;
}
