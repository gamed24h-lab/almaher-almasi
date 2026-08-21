export const money=v=>new Intl.NumberFormat('ar-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(Number(v||0));
export const date=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium'}).format(new Date(v))}catch{return String(v)}};
export const dateTime=v=>{if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch{return String(v)}};
export const statusLabel=v=>({new:'جديد',confirmed:'مؤكد',paid:'مدفوع',cancelled:'ملغي',used:'مستخدم',completed:'مكتمل',active:'نشط',inactive:'موقوف',pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض'}[String(v||'').toLowerCase()]||v||'—');
export const phoneWa=v=>{let x=String(v||'').replace(/\D/g,'');if(x.startsWith('0'))x='966'+x.slice(1);return x};
export const pick=(o,...keys)=>keys.map(k=>o?.[k]).find(v=>v!==undefined&&v!==null&&v!=='')??'';

export const journeyLabel=v=>({oneway:'ذهاب فقط',roundtrip:'ذهاب وعودة',separate:'ذهاب + عودة منفصلة',returnonly:'عودة فقط'}[String(v||'').toLowerCase()]||v||'—');
