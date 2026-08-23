import {mutationSuccessMessage,notifyError,notifySuccess} from './feedback.js';

export function arabicError(value,status){
  const m=String(value||'').trim();
  if(!m)return 'تعذر تنفيذ العملية. حاول مرة أخرى.';
  const rules=[
    [/Return date cannot be before departure date/i,'تاريخ العودة لا يمكن أن يكون قبل تاريخ الذهاب.'],
    [/SEAT_ALREADY_ASSIGNED|SEAT_CONCURRENCY_CONFLICT/i,'المقعد تم اختياره بالفعل من مستخدم آخر. حدّث الخريطة واختر مقعدًا آخر.'],
    [/duplicate key value.*staff_users_pkey/i,'يوجد حساب موظف بنفس المعرّف. أعد فتح شاشة إضافة الموظف وحاول مرة أخرى.'],
    [/duplicate key value/i,'يوجد سجل بنفس البيانات بالفعل. راجع البيانات ثم حاول مرة أخرى.'],
    [/violates check constraint.*trips_status_check/i,'حالة الرحلة غير مقبولة في إعدادات النظام الحالية.'],
    [/Too many subrequests|single Worker invocation|subrequest/i,'العملية كبيرة وتم تجاوز حد الطلبات الداخلية. سيحاول النظام تنفيذها على دفعات أصغر.'],
    [/Failed to fetch|NetworkError|Load failed/i,'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.'],
    [/Unauthorized|authentication required|access required/i,'انتهت الجلسة أو لا توجد صلاحية كافية. سجل الدخول مرة أخرى.'],
    [/Forbidden/i,'لا توجد لديك صلاحية لتنفيذ هذه العملية.'],
    [/not found/i,'لم يتم العثور على البيانات المطلوبة.'],
    [/timeout|timed out/i,'استغرق الخادم وقتًا أطول من المتوقع. حاول مرة أخرى.'],
    [/Invalid JSON/i,'استجابة الخادم غير صالحة. أعد المحاولة.'],
    [/Server Supabase environment variables are missing|Supabase.*missing/i,'إعدادات قاعدة البيانات على الخادم غير مكتملة.']
  ];
  for(const [rx,msg] of rules)if(rx.test(m))return msg;
  if(status===401)return 'انتهت الجلسة أو بيانات الدخول غير صحيحة.';
  if(status===403)return 'لا توجد لديك صلاحية لتنفيذ هذه العملية.';
  if(status===404)return 'لم يتم العثور على البيانات المطلوبة.';
  if(Number(status)>=500)return 'حدث خطأ بالخادم أثناء تنفيذ العملية. حاول مرة أخرى.';
  return m;
}
async function request(path,{method='GET',body,headers={},feedback=true}={}){
  let response;
  try{
    response=await fetch(path,{method,credentials:'include',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  }catch(networkError){
    const message=arabicError(networkError?.message||networkError,0);
    if(method!=='GET'&&feedback)notifyError(message);
    const e=new Error(message);e.rawMessage=networkError?.message||String(networkError);throw e;
  }
  const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
  if(!response.ok){const raw=data?.error||data?.message||`HTTP ${response.status}`;const message=arabicError(raw,response.status);if(method!=='GET'&&feedback)notifyError(message);const e=new Error(message);e.status=response.status;e.data=data;e.rawMessage=raw;throw e}
  if(method!=='GET'&&feedback){const message=mutationSuccessMessage(path,body);if(message)notifySuccess(message)}
  return data;
}
function normalizeAdminBody(body){
  if(body?.action!=='sync_trips'||!Array.isArray(body?.rows))return body;
  return {...body,rows:body.rows.map(row=>{
    const status=String(row?.status||'').toLowerCase();
    if(status==='active'||status==='scheduled')return {...row,status:'available'};
    return row;
  })};
}
function isWorkerSubrequestLimitError(err){
  const m=String(err?.rawMessage||err?.message||err||'');
  return /single Worker invocation|subrequest|too many requests/i.test(m);
}
async function adminRequest(body){
  const normalized=normalizeAdminBody(body);
  if(normalized?.action!=='sync_trips'||!Array.isArray(normalized?.rows)||normalized.rows.length<=1){
    return request('/api/admin',{method:'POST',body:normalized});
  }
  const chunkSize=3;
  const results=[];
  for(let i=0;i<normalized.rows.length;i+=chunkSize){
    const chunk=normalized.rows.slice(i,i+chunkSize);
    try{
      results.push(await request('/api/admin',{method:'POST',body:{...normalized,rows:chunk},feedback:false}));
    }catch(err){
      if(!isWorkerSubrequestLimitError(err)||chunk.length===1)throw err;
      for(const row of chunk){
        results.push(await request('/api/admin',{method:'POST',body:{...normalized,rows:[row]},feedback:false}));
      }
    }
  }
  notifySuccess('تم حفظ الرحلات بنجاح.');
  return {ok:true,batches:results.length,results};
}
export const api={
  health:()=>request('/api/health'),
  me:()=>request('/api/auth/me'),
  login:(identity,password,method='username')=>request('/api/auth/login',{method:'POST',body:{identity,password,method},feedback:false}),
  developerLogin:(email,password)=>request('/api/auth/developer',{method:'POST',body:{email,password},feedback:false}),
  logout:()=>request('/api/auth/logout',{method:'POST',feedback:false}),
  bootstrap:()=>request('/api/bootstrap'),
  admin:(body)=>adminRequest(body),
  platform:(body)=>request('/api/platform',{method:'POST',body}),
  platformGet:(resource='platform')=>request(`/api/platform?resource=${encodeURIComponent(resource)}`),
  module:(resource)=>request(`/api/module?resource=${encodeURIComponent(resource)}`),
  moduleWrite:(body)=>request('/api/module',{method:'POST',body}),
  seatAtomic:(body)=>request('/api/seats/atomic',{method:'POST',body}),
  seatAtomicSilent:(body)=>request('/api/seats/atomic',{method:'POST',body,feedback:false}),
  bookingTimeline:(bookingNo)=>request(`/api/bookings/timeline?bookingNo=${encodeURIComponent(bookingNo)}`),
  mega:(action,body={},method='POST')=>request(`/api/mega?action=${encodeURIComponent(action)}`,{method,body:method==='GET'?undefined:{action,...body}}),
  destinations:()=>request('/api/destinations'),
  destinationWrite:(body)=>request('/api/destinations',{method:'POST',body}),
  customerLookup:(bookingNo,verification)=>request(`/api/customer/booking?bookingNo=${encodeURIComponent(bookingNo)}&verification=${encodeURIComponent(verification)}`),
  customerBook:(booking,passengers)=>request('/api/customer/book',{method:'POST',body:{booking,passengers}}),
  push:(body)=>request('/api/push',{method:'POST',body})
};
