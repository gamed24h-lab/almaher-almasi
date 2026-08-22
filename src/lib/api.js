async function request(path,{method='GET',body,headers={}}={}){
  const response=await fetch(path,{method,credentials:'include',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
  if(!response.ok){const e=new Error(data?.error||data?.message||`HTTP ${response.status}`);e.status=response.status;e.data=data;throw e}
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
export const api={
  health:()=>request('/api/health'),
  me:()=>request('/api/auth/me'),
  login:(identity,password,method='username')=>request('/api/auth/login',{method:'POST',body:{identity,password,method}}),
  developerLogin:(email,password)=>request('/api/auth/developer',{method:'POST',body:{email,password}}),
  logout:()=>request('/api/auth/logout',{method:'POST'}),
  bootstrap:()=>request('/api/bootstrap'),
  admin:(body)=>request('/api/admin',{method:'POST',body:normalizeAdminBody(body)}),
  platform:(body)=>request('/api/platform',{method:'POST',body}),
  platformGet:(resource='platform')=>request(`/api/platform?resource=${encodeURIComponent(resource)}`),
  module:(resource)=>request(`/api/module?resource=${encodeURIComponent(resource)}`),
  moduleWrite:(body)=>request('/api/module',{method:'POST',body}),
  mega:(action,body={},method='POST')=>request(`/api/mega?action=${encodeURIComponent(action)}`,{method,body:method==='GET'?undefined:{action,...body}}),
  customerLookup:(bookingNo,verification)=>request(`/api/customer/booking?bookingNo=${encodeURIComponent(bookingNo)}&verification=${encodeURIComponent(verification)}`),
  customerBook:(booking,passengers)=>request('/api/customer/book',{method:'POST',body:{booking,passengers}}),
  push:(body)=>request('/api/push',{method:'POST',body})
};
