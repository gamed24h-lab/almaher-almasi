const DEFAULT_TZ='Asia/Riyadh';

export function dateKeyInTimeZone(value,timeZone=DEFAULT_TZ){
 if(!value)return '';
 const raw=String(value);
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
 const d=value instanceof Date?value:new Date(value);
 if(Number.isNaN(d.getTime()))return '';
 try{
  const parts=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${m.year}-${m.month}-${m.day}`;
 }catch{return raw.slice(0,10)}
}

function shiftDay(key,days){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(key||'')))return '';
 const [y,m,d]=key.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 dt.setUTCDate(dt.getUTCDate()+days);
 return dt.toISOString().slice(0,10);
}

function startOfWeekSunday(key){
 const [y,m,d]=key.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 return shiftDay(key,-dt.getUTCDay());
}

function startOfMonth(key){
 return String(key||'').slice(0,7)+'-01';
}

function endOfMonth(key){
 const [y,m]=String(key||'').split('-').map(Number);
 if(!y||!m)return '';
 return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
}

export const DATE_PRESET_OPTIONS=[
 {value:'today',label:'اليوم'},
 {value:'yesterday',label:'أمس'},
 {value:'this_week',label:'هذا الأسبوع'},
 {value:'last_7_days',label:'آخر 7 أيام'},
 {value:'this_month',label:'هذا الشهر'},
 {value:'last_month',label:'الشهر السابق'},
 {value:'last_30_days',label:'آخر 30 يومًا'},
 {value:'custom',label:'فترة مخصصة'}
];

export function dateRangeForPreset(preset,now=new Date(),timeZone=DEFAULT_TZ){
 const today=dateKeyInTimeZone(now,timeZone);
 if(!today)return {from:'',to:''};
 if(preset==='today')return {from:today,to:today};
 if(preset==='yesterday'){const d=shiftDay(today,-1);return {from:d,to:d}}
 if(preset==='this_week')return {from:startOfWeekSunday(today),to:today};
 if(preset==='last_7_days')return {from:shiftDay(today,-6),to:today};
 if(preset==='this_month')return {from:startOfMonth(today),to:today};
 if(preset==='last_month'){
  const first=startOfMonth(today),lastPrev=shiftDay(first,-1);
  return {from:startOfMonth(lastPrev),to:lastPrev};
 }
 if(preset==='last_30_days')return {from:shiftDay(today,-29),to:today};
 return {from:'',to:''};
}

export function isWithinDateRange(value,from='',to='',timeZone=DEFAULT_TZ){
 if(!from&&!to)return true;
 const key=dateKeyInTimeZone(value,timeZone);
 if(!key)return false;
 if(from&&key<from)return false;
 if(to&&key>to)return false;
 return true;
}
