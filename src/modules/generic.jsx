import React,{useEffect,useMemo,useState} from 'react';
import {RefreshCw,Plus,Pencil,Eye} from 'lucide-react';
import {api} from '../lib/api.js';
import {Card,PageHeader,Button,Loading,ErrorBox,Table,Modal,Field,Input,Textarea,Select} from '../components/UI.jsx';
import {statusLabel} from '../lib/format.js';
import {useAppData} from '../core/AppDataContext.jsx';
import SmartListFilters from '../components/SmartListFilters.jsx';
import {matchesListQuery} from '../lib/listFilters.js';

const DEFAULT_LABELS={
 id:'المعرف',name:'الاسم',phone:'الجوال',title:'العنوان',subject:'الموضوع',priority:'الأولوية',status:'الحالة',due_at:'الاستحقاق',assigned_to:'المسؤول',created_at:'تاريخ الإنشاء',updated_at:'آخر تحديث',completed_at:'تم الإنجاز',description:'الوصف',notes:'ملاحظات',amount:'المبلغ',category:'التصنيف',source:'المصدر',source_channel:'المصدر',request_type:'نوع الطلب',requested_by:'مقدم الطلب',branch_id:'الفرع',ticket_no:'رقم التذكرة',email:'البريد',nationality:'الجنسية',identity:'الهوية',identity_number:'الهوية',reference:'المرجع'
};
const VALUE_LABELS={walkin:'زيارة فرع',whatsapp:'واتساب',phone:'اتصال',website:'الموقع',referral:'ترشيح',campaign:'حملة',booking:'حجز',housing:'تسكين',transport:'نقل',payment:'دفع',complaint:'شكوى',other:'أخرى'};
const displayValue=(key,v)=>{if(v===null||v===undefined||v==='')return '—';if(typeof v==='object')return JSON.stringify(v);const s=String(v);if(key==='status'||key==='priority')return statusLabel(s);return VALUE_LABELS[s.toLowerCase()]||s};

export default function GenericModule({title,subtitle,resource,tabs,defaultTable,go}){
 const {data:app}=useAppData();
 const [data,setData]=useState(null),[table,setTable]=useState(defaultTable||tabs?.[0]?.table),[error,setError]=useState(''),[open,setOpen]=useState(false),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false);
 const [listFilter,setListFilter]=useState({q:'',status:'',branch:'',priority:''});
 async function load(){setError('');setData(null);try{setData(await api.module(resource))}catch(e){setError(e.message)}}useEffect(()=>{load()},[resource]);
 const active=tabs?.find(x=>x.table===table)||tabs?.[0];const rows=data?.[table]||[];
 const preferredKeys=active?.columns||[];
 const branchMap=useMemo(()=>new Map((app.branches||[]).map(b=>[String(b.id),b.name||b.branch_name||b.id])),[app.branches]);
 const branchOptions=useMemo(()=>{const ids=[...new Set(rows.map(r=>String(r.branch_id||'')).filter(Boolean))];return ids.map(id=>({value:id,label:branchMap.get(id)||id})).sort((a,b)=>a.label.localeCompare(b.label,'ar'))},[rows,branchMap]);
 const statusOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.status||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:statusLabel(v)})),[rows]);
 const priorityOptions=useMemo(()=>[...new Set(rows.map(r=>String(r.priority||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).map(v=>({value:v,label:statusLabel(v)})),[rows]);
 const filteredRows=useMemo(()=>rows.filter(r=>{
  if(listFilter.status&&String(r.status||'')!==listFilter.status)return false;
  if(listFilter.branch&&String(r.branch_id||'')!==listFilter.branch)return false;
  if(listFilter.priority&&String(r.priority||'')!==listFilter.priority)return false;
  const values=(preferredKeys.length?preferredKeys:Object.keys(r||{})).map(k=>r?.[k]);
  return matchesListQuery(listFilter.q,...values,branchMap.get(String(r.branch_id||'')));
 }),[rows,listFilter,preferredKeys,branchMap]);
 const columns=useMemo(()=>{const preferred=active?.columns||[];const cols=preferred.map(k=>({key:k,label:active?.labels?.[k]||DEFAULT_LABELS[k]||k.replaceAll('_',' '),render:r=>displayValue(k,r[k])}));if(active?.writable||active?.detailPath)cols.push({key:'__actions',label:'',render:r=><div className="finance-actions">{active?.detailPath&&go&&<Button onClick={e=>{e.stopPropagation();const p=typeof active.detailPath==='function'?active.detailPath(r):active.detailPath;if(p)go(p)}}><Eye size={14}/> فتح 360</Button>}{active?.writable&&<Button onClick={e=>{e.stopPropagation();setEditing(r);setOpen(true)}}><Pencil size={14}/> تعديل</Button>}</div>});return cols},[active,go]);
 function add(){setEditing(null);setOpen(true);setError('')}
 async function save(e){e.preventDefault();setBusy(true);setError('');const f=Object.fromEntries(new FormData(e.currentTarget));let row={};for(const [k,v] of Object.entries(f)){if(k==='json')continue;const cfg=(active?.fields||[]).find(x=>x.name===k);if(cfg?.type==='number')row[k]=v===''?null:Number(v);else if(cfg?.type==='checkbox')row[k]=v==='on'||v==='true';else row[k]=v===''&&cfg?.nullable?null:v}if(f.json){try{row={...row,...JSON.parse(f.json)}}catch{setBusy(false);setError('JSON غير صالح');return}}try{if(editing?.id)await api.moduleWrite({action:'update',table,id:editing.id,row});else await api.moduleWrite({action:'insert',table,row});setOpen(false);setEditing(null);await load()}catch(e2){setError(e2.message)}finally{setBusy(false)}}
 return <><PageHeader title={title} subtitle={subtitle} actions={<><Button onClick={load}><RefreshCw size={16}/> تحديث</Button>{active?.writable&&<Button variant="primary" onClick={add}><Plus size={16}/> إضافة</Button>}</>}/><ErrorBox error={error}/>{tabs&&<div className="tabs">{tabs.map(t=><button key={t.table} onClick={()=>{setTable(t.table);setEditing(null);setListFilter({q:'',status:'',branch:'',priority:''})}} className={table===t.table?'active':''}>{t.label}<span>{data?.[t.table]?.length??0}</span></button>)}</div>}{!data&&!error?<Loading/>:<Card>{data?._missing_tables?.includes(table)?<div className="empty">الجدول المطلوب غير موجود في قاعدة البيانات الحالية.</div>:<><SmartListFilters storageKey={`generic-${resource}-${table}-filters`} search={listFilter.q} onSearchChange={v=>setListFilter(x=>({...x,q:v}))} searchPlaceholder="ابحث داخل القائمة..." totalCount={rows.length} resultCount={filteredRows.length} onReset={()=>setListFilter({q:'',status:'',branch:'',priority:''})} filters={[
   ...(preferredKeys.includes('status')||rows.some(r=>r.status!=null)?[{key:'status',label:'الحالة',value:listFilter.status,onChange:v=>setListFilter(x=>({...x,status:v})),options:statusOptions}]:[]),
   ...(preferredKeys.includes('branch_id')||rows.some(r=>r.branch_id!=null)?[{key:'branch',label:'الفرع',value:listFilter.branch,onChange:v=>setListFilter(x=>({...x,branch:v})),options:branchOptions}]:[]),
   ...(preferredKeys.includes('priority')||rows.some(r=>r.priority!=null)?[{key:'priority',label:'الأولوية',value:listFilter.priority,onChange:v=>setListFilter(x=>({...x,priority:v})),options:priorityOptions}]:[])
  ]}/><Table preferenceKey={`generic-${resource}-${table}`} defaultPageSize={25} rows={filteredRows} columns={columns}/></>}</Card>}
 <Modal open={open} onClose={()=>{setOpen(false);setEditing(null)}} title={`${editing?'تعديل':'إضافة'} — ${active?.label||active?.labelSingular||'السجل'}`}><form onSubmit={save} className="form-grid" key={`${table}-${editing?.id||'new'}`}>{(active?.fields||[]).map(f=><Field key={f.name} label={f.label||DEFAULT_LABELS[f.name]||f.name} hint={f.hint}>{f.type==='select'?<Select name={f.name} defaultValue={editing?.[f.name]??f.defaultValue??''} required={f.required}>{!f.required&&<option value="">—</option>}{(f.options||[]).map(o=>Array.isArray(o)?<option key={o[0]} value={o[0]}>{o[1]}</option>:<option key={o} value={o}>{o}</option>)}</Select>:f.type==='checkbox'?<input name={f.name} type="checkbox" defaultChecked={Boolean(editing?.[f.name]??f.defaultValue)}/>:<Input name={f.name} type={f.type||'text'} defaultValue={editing?.[f.name]??f.defaultValue??''} required={f.required}/>}</Field>)}<Field label="حقول إضافية JSON" hint="اختياري — للحقول المتقدمة فقط"><Textarea name="json" placeholder='{"notes":"..."}'/></Field><div className="modal-actions"><Button type="button" onClick={()=>{setOpen(false);setEditing(null)}}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ'}</Button></div></form></Modal></>;
}
