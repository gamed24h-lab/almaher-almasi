import appWorker from './refund-control-index.js';

const normalizeBranchBookingStatus=async request=>{
  const url=new URL(request.url);
  if(request.method!=='POST'||url.pathname!=='/api/customer/book')return request;
  let body;
  try{body=await request.clone().json()}catch{return request}
  const booking=body?.booking&&typeof body.booking==='object'?{...body.booking}:null;
  if(!booking||String(booking.source||'').trim().toLowerCase()!=='branch')return request;
  const status=String(booking.status||'').trim().toLowerCase();
  if(status&&status!=='new')return request;
  booking.status='confirmed';
  const headers=new Headers(request.headers);
  headers.set('Content-Type','application/json');
  return new Request(request,{headers,body:JSON.stringify({...body,booking})});
};

export default {
  async fetch(request,env,ctx){
    return appWorker.fetch(await normalizeBranchBookingStatus(request),env,ctx);
  }
};
