import React from 'react';
import {Plus,Trash2} from 'lucide-react';
import {Button,Input,SearchSelect} from './UI.jsx';
import {emptyRule,operatorsForField} from '../lib/ruleFilters.js';
import './rule-filter-builder.css';

export default function RuleFilterBuilder({fields=[],rules=[],mode='all',onRulesChange,onModeChange}){
 function patch(id,key,value){onRulesChange?.(rules.map(r=>r.id===id?{...r,[key]:value,...(key==='field'?{operator:'eq',value:''}:{})}:r))}
 function remove(id){onRulesChange?.(rules.filter(r=>r.id!==id))}
 function add(){onRulesChange?.([...rules,emptyRule()])}
 return <div className="rule-filter-builder">
  <div className="rule-filter-head">
   <div><strong>الفلاتر المتقدمة</strong><small>كوّن أكثر من شرط على نفس القائمة</small></div>
   <SearchSelect value={mode} onChange={e=>onModeChange?.(e.target.value)} options={[{value:'all',label:'تطابق كل الشروط (AND)'},{value:'any',label:'تطابق أي شرط (OR)'}]}/>
  </div>
  {rules.map((r,i)=>{const field=fields.find(f=>f.key===r.field),ops=operatorsForField(field),noValue=['is_empty','not_empty'].includes(r.operator);return <div className="rule-filter-row" key={r.id}>
   <span className="rule-filter-index">{i+1}</span>
   <SearchSelect value={r.field} onChange={e=>patch(r.id,'field',e.target.value)} placeholder="اختر الحقل" options={[{value:'',label:'اختر الحقل'},...fields.map(f=>({value:f.key,label:f.label}))]}/>
   <SearchSelect value={r.operator} onChange={e=>patch(r.id,'operator',e.target.value)} options={ops}/>
   {!noValue&&(field?.options?<SearchSelect value={r.value} onChange={e=>patch(r.id,'value',e.target.value)} placeholder="اختر القيمة" options={[{value:'',label:'اختر القيمة'},...field.options]}/>:<Input type={field?.type==='date'?'date':field?.type==='number'?'number':'text'} value={r.value??''} onChange={e=>patch(r.id,'value',e.target.value)} placeholder="القيمة"/>)}
   <Button type="button" onClick={()=>remove(r.id)} title="حذف الشرط"><Trash2 size={15}/></Button>
  </div>})}
  <div className="rule-filter-actions"><Button type="button" onClick={add}><Plus size={15}/> إضافة شرط</Button>{rules.length>0&&<Button type="button" onClick={()=>onRulesChange?.([])}>مسح الشروط</Button>}</div>
 </div>;
}
