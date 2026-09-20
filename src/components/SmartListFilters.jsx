import React,{useMemo,useState} from 'react';
import {RotateCcw,Search,SlidersHorizontal,X} from 'lucide-react';
import {Button,Input,SavedViews,SearchSelect} from './UI.jsx';
import './smart-list-filters.css';

export default function SmartListFilters({
 storageKey='',
 search='',
 onSearchChange,
 searchPlaceholder='ابحث في النتائج...',
 filters=[],
 totalCount=0,
 resultCount=0,
 onReset
}){
 const [open,setOpen]=useState(false);
 const activeFilters=useMemo(()=>filters.filter(f=>String(f.value??'')!==''),[filters]);
 const current=useMemo(()=>({search:String(search||''),values:Object.fromEntries(filters.map(f=>[f.key,String(f.value??'')]))}),[search,filters]);
 function clearAll(){
  if(onReset)return onReset();
  onSearchChange?.('');
  filters.forEach(f=>f.onChange?.(''));
 }
 function applyView(view){
  onSearchChange?.(String(view?.search||''));
  filters.forEach(f=>f.onChange?.(String(view?.values?.[f.key]??'')));
 }
 function optionLabel(f){
  const item=(f.options||[]).find(x=>String(x.value)===String(f.value));
  return item?.label||String(f.value||'');
 }
 const changed=String(search||'').trim()||activeFilters.length;
 return <div className={`smart-list-filters ${open?'open':''}`}>
  <div className="smart-list-primary">
   <label className="smart-list-search"><Search size={17}/><Input value={search||''} onChange={e=>onSearchChange?.(e.target.value)} placeholder={searchPlaceholder}/>{search&&<button type="button" className="smart-list-clear-search" onClick={()=>onSearchChange?.('')} title="مسح البحث"><X size={15}/></button>}</label>
   <Button type="button" className="smart-list-filter-toggle" onClick={()=>setOpen(x=>!x)}><SlidersHorizontal size={16}/> الفلاتر{activeFilters.length?` (${activeFilters.length})`:''}</Button>
   {storageKey&&<SavedViews storageKey={storageKey} current={current} onApply={applyView}/>}
   <div className="smart-list-count">عرض <strong>{Number(resultCount||0).toLocaleString('ar-SA')}</strong> من أصل <strong>{Number(totalCount||0).toLocaleString('ar-SA')}</strong> سجل</div>
  </div>
  {!!filters.length&&<div className="smart-list-filter-grid">{filters.map(f=><div className="smart-list-filter" key={f.key}><span>{f.label}</span>{f.render?f.render():<SearchSelect value={f.value??''} onChange={e=>f.onChange?.(e.target.value)} placeholder={f.placeholder||(`كل ${f.label}`)} options={[{value:'',label:f.allLabel||(`الكل — ${f.label}`)},...(f.options||[])]}/>}</div>)}</div>}
  {changed&&<div className="smart-list-active">
   {String(search||'').trim()&&<button type="button" className="smart-filter-chip" onClick={()=>onSearchChange?.('')}><span>بحث: {search}</span><X size={13}/></button>}
   {activeFilters.map(f=><button type="button" className="smart-filter-chip" key={f.key} onClick={()=>f.onChange?.('')}><span>{f.label}: {optionLabel(f)}</span><X size={13}/></button>)}
   <button type="button" className="smart-filter-reset" onClick={clearAll}><RotateCcw size={14}/> مسح الكل</button>
  </div>}
 </div>;
}
