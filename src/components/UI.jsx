import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
export const Card=({children,className=''})=><section className={`card ${className}`}>{children}</section>;
export const PageHeader=({title,subtitle,actions})=><div className="page-head"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>;
export const Button=({children,variant='secondary',className='',...p})=><button className={`btn ${variant} ${className}`} {...p}>{children}</button>;
export const Badge=({children,tone='blue'})=><span className={`badge ${tone}`}>{children}</span>;
export const Empty=({title='لا توجد بيانات',text='لم يتم العثور على سجلات لعرضها.'})=><div className="empty"><div className="empty-icon">◇</div><strong>{title}</strong><span>{text}</span></div>;
export const Loading=({text='جاري التحميل...'})=><div className="loading"><span className="spinner"/>{text}</div>;
const friendlyError=(error)=>{const s=String(error||'').trim();if(!s)return '';if(/Return date cannot be before departure date/i.test(s))return 'تاريخ العودة لا يمكن أن يكون قبل تاريخ الذهاب. راجع تاريخ العودة ثم حاول الحفظ مرة أخرى.';if(/duplicate key value.*staff_users_pkey/i.test(s))return 'يوجد تعارض في رقم حساب الموظف. حدّث الصفحة ثم حاول الحفظ مرة أخرى.';if(/violates check constraint.*trips_status_check/i.test(s))return 'حالة الرحلة غير مقبولة في قاعدة البيانات. اختر حالة صحيحة ثم حاول مرة أخرى.';if(/Could not find the 'branch_id' column of 'drivers'/i.test(s))return 'جدول السائقين يحتاج تحديث بنية الفرع. شغّل تحديث قاعدة البيانات الخاص بالسائقين ثم أعد المحاولة.';return s};
function feedbackHost(){if(typeof document==='undefined')return null;let host=document.getElementById('global-error-feedback-stack');if(!host){host=document.createElement('div');host.id='global-error-feedback-stack';host.className='global-error-feedback-stack';host.setAttribute('aria-live','assertive');document.body.appendChild(host)}return host}
export const ErrorBox=({error})=>{if(!error)return null;const node=<div className="error-box global-error-feedback" role="alert">{friendlyError(error)}</div>;const host=feedbackHost();return host?createPortal(node,host):node};
export function Modal({open,onClose,title,children,wide=false}){if(!open)return null;return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}><div className={`modal ${wide?'wide':''}`}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="modal-body">{children}</div></div></div>}
export const Field=({label,children,hint})=><label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
export const Input=(p)=><input {...p}/>; export const Select=(p)=><select {...p}/>; export const Textarea=(p)=><textarea {...p}/>;
export function SearchSelect({value='',onChange,options=[],placeholder='اختر...',disabled=false,name='',className=''}){
 const ref=useRef(null),[open,setOpen]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{const close=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[]);
 const selected=options.find(x=>String(x.value)===String(value));
 const filtered=useMemo(()=>{const q=String(query||'').trim().toLowerCase();if(!q)return options;return options.filter(x=>`${x.label||''} ${x.searchText||''}`.toLowerCase().includes(q))},[options,query]);
 const choose=opt=>{if(opt?.disabled)return;onChange?.({target:{value:String(opt?.value??''),name}});setQuery('');setOpen(false)};
 return <div className={`search-select ${className}`} ref={ref}>{name&&<input type="hidden" name={name} value={value||''}/>}<button type="button" className="search-select-trigger" disabled={disabled} onClick={()=>!disabled&&setOpen(x=>!x)} aria-expanded={open}><span className={!selected?'search-select-placeholder':''}>{selected?.label||placeholder}</span><span className={`search-select-arrow ${open?'open':''}`}>⌄</span></button>{open&&!disabled&&<div className="search-select-menu"><input className="search-select-input" value={query} onChange={e=>setQuery(e.target.value)} autoFocus placeholder={`ابحث — ${placeholder}`}/><div className="search-select-options">{filtered.length?filtered.map(opt=><button type="button" key={String(opt.value)} disabled={opt.disabled} className={`search-select-option ${String(opt.value)===String(value)?'selected':''}`} onClick={()=>choose(opt)}>{opt.label}</button>):<div className="search-select-empty">لا توجد نتائج مطابقة</div>}</div></div>}</div>
}
function tablePrefsKey(key){return key?`almaher:table:${key}`:''}
function readTablePrefs(key,defaultPageSize){if(!key)return {hidden:[],pageSize:defaultPageSize};try{const x=JSON.parse(localStorage.getItem(tablePrefsKey(key))||'{}');return {hidden:Array.isArray(x.hidden)?x.hidden:[],pageSize:[10,25,50,100].includes(Number(x.pageSize))?Number(x.pageSize):defaultPageSize}}catch{return {hidden:[],pageSize:defaultPageSize}}}
export function Table({columns=[],rows=[],onRow,preferenceKey='',defaultPageSize=25,pageSizeOptions=[10,25,50,100],getRowKey}){
 const smart=!!preferenceKey,[prefs,setPrefs]=useState(()=>readTablePrefs(preferenceKey,defaultPageSize)),[page,setPage]=useState(1);
 useEffect(()=>{if(!preferenceKey)return;setPrefs(readTablePrefs(preferenceKey,defaultPageSize));setPage(1)},[preferenceKey,defaultPageSize]);
 useEffect(()=>{if(!preferenceKey)return;try{localStorage.setItem(tablePrefsKey(preferenceKey),JSON.stringify(prefs))}catch{}},[preferenceKey,prefs]);
 const validHidden=useMemo(()=>new Set((prefs.hidden||[]).filter(k=>columns.some(c=>c.key===k))),[prefs.hidden,columns]);
 const visibleColumns=useMemo(()=>{const shown=columns.filter(c=>!validHidden.has(c.key));return shown.length?shown:columns.slice(0,1)},[columns,validHidden]);
 const pageSize=smart?(pageSizeOptions.includes(Number(prefs.pageSize))?Number(prefs.pageSize):defaultPageSize):Math.max(1,rows.length||1);
 const totalPages=smart?Math.max(1,Math.ceil(rows.length/pageSize)):1;
 useEffect(()=>{if(page>totalPages)setPage(totalPages)},[page,totalPages]);
 const shownRows=smart?rows.slice((page-1)*pageSize,page*pageSize):rows;
 function toggleColumn(key){setPrefs(x=>{const hidden=new Set(x.hidden||[]);hidden.has(key)?hidden.delete(key):hidden.add(key);if(columns.length-hidden.size<1)return x;return {...x,hidden:[...hidden]}})}
 function setPageSize(v){setPrefs(x=>({...x,pageSize:Number(v)}));setPage(1)}
 return <div className={`data-table ${smart?'smart-table':''}`}>
  {smart&&<div className="table-tools">
   <div className="table-tools-summary"><strong>{rows.length}</strong><span>سجل</span>{totalPages>1&&<span>· صفحة {page} من {totalPages}</span>}</div>
   <div className="table-tools-actions">
    <label className="table-size-label"><span>الصفوف</span><select value={pageSize} onChange={e=>setPageSize(e.target.value)}>{pageSizeOptions.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
    <details className="column-picker"><summary>الأعمدة</summary><div className="column-picker-menu">{columns.map(c=><label key={c.key}><input type="checkbox" checked={!validHidden.has(c.key)} onChange={()=>toggleColumn(c.key)}/><span>{c.label||'إجراءات'}</span></label>)}<button type="button" onClick={()=>setPrefs(x=>({...x,hidden:[]}))}>إظهار الكل</button></div></details>
   </div>
  </div>}
  <div className="table-wrap"><table><thead><tr>{visibleColumns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{shownRows.map((r,i)=><tr key={getRowKey?.(r,i)||r.id||r.booking_number||r.trip_code||((page-1)*pageSize+i)} onClick={()=>onRow?.(r)} className={onRow?'clickable':''}>{visibleColumns.map(c=><td key={c.key} data-label={c.label||'إجراءات'}>{c.render?c.render(r):r[c.key]??'—'}</td>)}</tr>)}</tbody></table></div>
  {smart&&totalPages>1&&<div className="table-pagination"><button type="button" disabled={page<=1} onClick={()=>setPage(x=>Math.max(1,x-1))}>السابق</button><span>{(page-1)*pageSize+1}–{Math.min(page*pageSize,rows.length)} من {rows.length}</span><button type="button" disabled={page>=totalPages} onClick={()=>setPage(x=>Math.min(totalPages,x+1))}>التالي</button></div>}
 </div>
}

function savedViewsKey(key){return `almaher:views:${key}`}
export function SavedViews({storageKey,current,onApply}){
 const [views,setViews]=useState(()=>{try{const x=JSON.parse(localStorage.getItem(savedViewsKey(storageKey))||'[]');return Array.isArray(x)?x:[]}catch{return []}}),[selected,setSelected]=useState('');
 useEffect(()=>{try{localStorage.setItem(savedViewsKey(storageKey),JSON.stringify(views))}catch{}},[storageKey,views]);
 function save(){const name=String(window.prompt('اسم العرض المحفوظ')||'').trim();if(!name)return;const next={id:`v-${Date.now()}`,name,value:current};setViews(x=>[...x.filter(v=>v.name!==name),next]);setSelected(next.id)}
 function apply(id){setSelected(id);const v=views.find(x=>x.id===id);if(v)onApply?.(v.value)}
 function remove(){if(!selected)return;setViews(x=>x.filter(v=>v.id!==selected));setSelected('')}
 return <div className="saved-views"><select value={selected} onChange={e=>apply(e.target.value)}><option value="">العروض المحفوظة</option>{views.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select><button type="button" onClick={save}>حفظ العرض</button>{selected&&<button type="button" onClick={remove}>حذف</button>}</div>
}
