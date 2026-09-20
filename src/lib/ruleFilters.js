import {normalizeListText} from './listFilters.js';
import {dateKeyInTimeZone} from './dateRangeFilters.js';

export const RULE_OPERATORS=[
 {value:'eq',label:'يساوي'},
 {value:'neq',label:'لا يساوي'},
 {value:'contains',label:'يحتوي'},
 {value:'not_contains',label:'لا يحتوي'},
 {value:'gt',label:'أكبر من'},
 {value:'gte',label:'أكبر من أو يساوي'},
 {value:'lt',label:'أقل من'},
 {value:'lte',label:'أقل من أو يساوي'},
 {value:'before',label:'قبل'},
 {value:'after',label:'بعد'},
 {value:'is_empty',label:'فارغ'},
 {value:'not_empty',label:'غير فارغ'}
];

export const emptyRule=()=>({id:'r'+Date.now()+Math.random().toString(36).slice(2,7),field:'',operator:'eq',value:''});

function scalar(v){
 if(Array.isArray(v))return v.join(' ');
 if(v&&typeof v==='object')return Object.values(v).join(' ');
 return v??'';
}
function num(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:null}
function date(v){return dateKeyInTimeZone(v)||String(v??'').slice(0,10)}
export function ruleMatches(row,rule,fields=[]){
 const def=fields.find(f=>f.key===rule.field);
 if(!def||!rule.operator)return true;
 const raw=def.get?def.get(row):row?.[def.key],op=rule.operator,want=rule.value??'';
 if(op==='is_empty')return raw==null||String(scalar(raw)).trim()==='';
 if(op==='not_empty')return !(raw==null||String(scalar(raw)).trim()==='');
 if(def.type==='number'){
  const a=num(raw),b=num(want);if(a==null||b==null)return false;
  return op==='eq'?a===b:op==='neq'?a!==b:op==='gt'?a>b:op==='gte'?a>=b:op==='lt'?a<b:op==='lte'?a<=b:false;
 }
 if(def.type==='date'){
  const a=date(raw),b=date(want);if(!a||!b)return false;
  return op==='eq'?a===b:op==='neq'?a!==b:op==='before'||op==='lt'?a<b:op==='after'||op==='gt'?a>b:op==='gte'?a>=b:op==='lte'?a<=b:false;
 }
 const a=normalizeListText(scalar(raw)),b=normalizeListText(want);
 return op==='eq'?a===b:op==='neq'?a!==b:op==='contains'?a.includes(b):op==='not_contains'?!a.includes(b):op==='gt'?a>b:op==='gte'?a>=b:op==='lt'?a<b:op==='lte'?a<=b:false;
}
export function matchesRuleSet(row,rules=[],fields=[],mode='all'){
 const active=rules.filter(r=>r.field&&r.operator&&(r.value!==''||['is_empty','not_empty'].includes(r.operator)));
 if(!active.length)return true;
 return mode==='any'?active.some(r=>ruleMatches(row,r,fields)):active.every(r=>ruleMatches(row,r,fields));
}
export function operatorsForField(field){
 if(field?.operators)return field.operators;
 if(field?.type==='number')return RULE_OPERATORS.filter(x=>['eq','neq','gt','gte','lt','lte','is_empty','not_empty'].includes(x.value));
 if(field?.type==='date')return RULE_OPERATORS.filter(x=>['eq','neq','before','after','gte','lte','is_empty','not_empty'].includes(x.value));
 if(field?.options)return RULE_OPERATORS.filter(x=>['eq','neq','is_empty','not_empty'].includes(x.value));
 return RULE_OPERATORS.filter(x=>['eq','neq','contains','not_contains','is_empty','not_empty'].includes(x.value));
}
