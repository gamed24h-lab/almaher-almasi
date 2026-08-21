const process = { env: {} };
import * as crypto from 'node:crypto';
// AL-MAHER V10.1.6 — CENTRAL BRANCH SCOPE / LIVE STAFF SESSION HARDENING
const __mods = Object.create(null);
function __localRequire(spec){
  if(spec==='crypto'||spec==='node:crypto') return crypto;
  if(spec==='./_staff-session'||spec==='./_staff-session.js') return __mods['_staff-session'];
  throw new Error('Unsupported local require: '+spec);
}
function __load__staff_session(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const crypto=require('crypto');
  function b64url(v){return Buffer.from(v).toString('base64url')}
  function issue(payload,secret,ttlSeconds=43200){
   const body={...payload,exp:Math.floor(Date.now()/1000)+ttlSeconds};
   const enc=b64url(JSON.stringify(body));
   const sig=crypto.createHmac('sha256',secret).update(enc).digest('base64url');
   return `${enc}.${sig}`;
  }
  function verify(token,secret){
   try{
    const [enc,sig]=String(token||'').split('.');if(!enc||!sig)return null;
    const expected=crypto.createHmac('sha256',secret).update(enc).digest('base64url');
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
    const body=JSON.parse(Buffer.from(enc,'base64url').toString('utf8'));
    if(!body.exp||body.exp<Math.floor(Date.now()/1000))return null;
    return body;
   }catch{return null}
  }
  module.exports={issue,verify};
  return module.exports;
}
__mods["_staff-session"]=__load__staff_session();
function __load_health(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  exports.handler=async()=>({statusCode:200,headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,service:"almaher",version:"10.0.0"})});
  return module.exports;
}
__mods["health"]=__load_health();
function __load_create_booking(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const {verify}=require("./_staff-session");
  exports.handler = async (event) => {
    const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
    if(event.httpMethod!=="POST")return{statusCode:405,headers,body:JSON.stringify({error:"Method not allowed"})};
    const supabaseUrl=(process.env.SUPABASE_URL||"").replace(/\/+$/,'');
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
    if(!supabaseUrl||!serviceKey)return{statusCode:500,headers,body:JSON.stringify({error:"Server Supabase environment variables are missing"})};
    let payload={};try{payload=JSON.parse(event.body||"{}")}catch{return{statusCode:400,headers,body:JSON.stringify({error:"Invalid JSON"})}}
    const b=payload.booking&&typeof payload.booking==='object'?{...payload.booking}:{};
    const passengers=Array.isArray(payload.passengers)?payload.passengers:[];
    if(!b.booking_number||!passengers.length)return{statusCode:400,headers,body:JSON.stringify({error:"بيانات الحجز أو المسافرين غير مكتملة"})};

    const auth=String(event.headers.authorization||'');
    const token=auth.startsWith('Bearer ')?auth.slice(7):'';
    let staff=token?verify(token,serviceKey):null;
    if(staff?.id){
      try{
        const sr=await fetch(`${supabaseUrl}/rest/v1/staff_users?id=eq.${encodeURIComponent(staff.id)}&select=id,name,role,branch_id,status,permissions&limit=1`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,Accept:'application/json'}});
        const sb=await sr.json().catch(()=>[]);const live=sr.ok&&Array.isArray(sb)?sb[0]:null;
        if(live&&String(live.status||'نشط')!=='موقوف')staff={...staff,id:live.id,name:live.name||staff.name,role:live.role||staff.role,branch_id:live.branch_id||null,permissions:live.permissions||{}};
      }catch(_e){}
    }
    const source=String(b.source||'customer');
    if(source==='branch'){
      if(!staff||!(staff.role==='مدير عام'||staff.permissions?.all||staff.permissions?.branchBooking))return{statusCode:403,headers,body:JSON.stringify({error:'إنشاء حجز فرع يتطلب جلسة موظف وصلاحية حجز'})};
      const globalOps=staff.role==='مدير عام'||staff.permissions?.all||staff.permissions?.allBranches;
      if(!globalOps&&!staff.branch_id)return{statusCode:409,headers,body:JSON.stringify({error:'حساب الموظف غير مرتبط بفرع. حدّث فرع الحساب من إدارة الموظفين ثم سجّل الدخول من جديد.',code:'BRANCH_SCOPE_MISSING'})};
      if(!globalOps&&String(b.branch_id||'')!==String(staff.branch_id))return{statusCode:403,headers,body:JSON.stringify({error:'لا يمكن إنشاء حجز باسم فرع آخر'})};
      if(Number(b.paid_amount||0)>0&&!(staff.role==='مدير عام'||staff.permissions?.all||staff.permissions?.payments))return{statusCode:403,headers,body:JSON.stringify({error:'لا توجد صلاحية تسجيل دفعة'})};
      b.created_by=staff.name||staff.id;
    }else{
      // Public customer bookings can never impersonate staff or pre-mark payments.
      b.source='customer';b.created_by='العميل';b.paid_amount=0;b.financial_status='unpaid';
      if(!b.terms_accepted)return{statusCode:400,headers,body:JSON.stringify({error:'يجب قبول الشروط قبل إنشاء الحجز'})};
    }
    try{
      const response=await fetch(`${supabaseUrl}/rest/v1/rpc/create_booking_with_passengers`,{
        method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({p_payload:{booking:b,passengers}})
      });
      const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
      if(!response.ok)return{statusCode:response.status,headers,body:JSON.stringify({error:data.message||data.details||data.hint||`Supabase ${response.status}`})};
      return{statusCode:200,headers,body:JSON.stringify(data)};
    }catch(e){return{statusCode:502,headers,body:JSON.stringify({error:e.message||'Supabase request failed'})}}
  };
  return module.exports;
}
__mods["create-booking"]=__load_create_booking();
function __load_get_booking(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  exports.handler=async(event)=>{
   const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
   let bookingNo="",verification="";
   try{
     if(event.httpMethod==="GET"){
       bookingNo=String(event.queryStringParameters?.bookingNo||"").trim();
       verification=String(event.queryStringParameters?.verification||"").trim();
     }else if(event.httpMethod==="POST"){
       const body=JSON.parse(event.body||"{}");
       bookingNo=String(body.bookingNo||body.bookingNumber||"").trim();
       verification=String(body.verification||body.phoneOrId||"").trim();
     }else{
       return{statusCode:405,headers,body:JSON.stringify({error:"Method not allowed"})};
     }
  
     if(!bookingNo||!verification)
       return{statusCode:400,headers,body:JSON.stringify({error:"أدخل رقم الحجز ورقم الجوال أو الهوية"})};
  
     const url=(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
     const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
     if(!url||!key)
       return{statusCode:500,headers,body:JSON.stringify({error:"إعدادات Supabase على الخادم غير مكتملة"})};
  
     const h={apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json"};
     const r=await fetch(`${url}/rest/v1/bookings?select=*&booking_number=eq.${encodeURIComponent(bookingNo)}&limit=1`,{headers:h});
     const rows=await r.json();
     if(!r.ok)
       return{statusCode:r.status,headers,body:JSON.stringify({error:rows?.message||"تعذر الاستعلام من Supabase"})};
     if(!rows?.length)
       return{statusCode:404,headers,body:JSON.stringify({error:"لم يتم العثور على الحجز"})};
  
     const b=rows[0];
     const clean=x=>String(x||"").replace(/\s+/g,"").replace(/^\+?966/,"0");
     const verified=clean(verification)===clean(b.customer_phone)||String(verification)===String(b.customer_identity||"");
     if(!verified)
       return{statusCode:403,headers,body:JSON.stringify({error:"بيانات التحقق غير مطابقة للحجز"})};
  
     const pr=await fetch(`${url}/rest/v1/booking_passengers?booking_id=eq.${encodeURIComponent(b.id)}&select=*&order=passenger_order.asc`,{headers:h});
     const passengers=pr.ok?await pr.json():[];
  
     const snap=b.snapshot&&typeof b.snapshot==="object"?b.snapshot:{};
     const booking={
       ...snap,
       id:snap.id||b.booking_number,
       number:b.booking_number,
       bookingNo:b.booking_number,
       tripId:b.trip_id,
       returnTripId:b.return_trip_id,
       branchId:b.branch_id,
       name:b.customer_name,
       gender:b.customer_gender,
       nationality:b.customer_nationality,
       phone:b.customer_phone,
       identity:b.customer_identity,
       travelers:b.travelers,
       journeyMode:b.journey_mode,
       accommodationType:b.accommodation_type,
       accommodationLabel:b.accommodation_label,
       privateRooms:b.private_rooms,
       privateRoomTypes:b.private_room_types||[],
       hotelName:b.hotel_name,
       hotelCity:b.hotel_city,
       paymentMethod:b.payment_method,
       originalPrice:Number(b.original_price||0),
       totalPrice:Number(b.total_price||0),
       price:Number(b.total_price||0),
       paidAmount:Number(b.paid_amount||0),
       notes:b.notes||"",
       status:b.status,
       createdAt:b.created_at,
       passengerDetails:(passengers||[]).map(p=>({
         name:p.full_name||"",
         gender:p.gender||"",
         nationality:p.nationality||"",
         identity:p.identity_number||"",
         phone:p.phone||""
       })),
       cloudSynced:true,
       cloudBookingId:b.id
     };
     const safePassengers=(passengers||[]).map(p=>({id:p.id,passenger_order:p.passenger_order,full_name:p.full_name||'',gender:p.gender||'',nationality:p.nationality||'',identity_number:p.identity_number||'',phone:p.phone||'',status:p.status||'',accommodation_status:p.accommodation_status||'',preferred_language:p.preferred_language||'ar'}));
     async function safeRow(table,id){if(!id)return null;const rr=await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:h});const aa=await rr.json().catch(()=>[]);return rr.ok&&Array.isArray(aa)?aa[0]||null:null}
     const [tripRow,returnRow,branchRow]=await Promise.all([safeRow('trips',b.trip_id),safeRow('trips',b.return_trip_id),safeRow('branches',b.branch_id)]);
     const safeTrip=t=>t?{id:t.id,trip_code:t.trip_code||t.code||'',from_city:t.from_city||t.origin||'',to_city:t.to_city||t.destination||'',departure_date:t.departure_date||null,departure_time:t.departure_time||null,return_date:t.return_date||null,return_time:t.return_time||null,status:t.status||''}:null;
     const safeBranch=branchRow?{id:branchRow.id,name:branchRow.name||'',address:branchRow.address||'',whatsapp:branchRow.whatsapp||'',phone:branchRow.phone||'',map_url:branchRow.map_url||branchRow.mapUrl||''}:null;
     return{statusCode:200,headers,body:JSON.stringify({booking,passengers:safePassengers,trip:safeTrip(tripRow),returnTrip:safeTrip(returnRow),branch:safeBranch})};
   }catch(e){
     console.error("get-booking error",e);
     return{statusCode:502,headers,body:JSON.stringify({error:e.message||"تعذر الاستعلام"})};
   }
  };
  return module.exports;
}
__mods["get-booking"]=__load_get_booking();
function __load_developer_login(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  exports.handler=async(event)=>{
   const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
   if(event.httpMethod!=="POST")return{statusCode:405,headers,body:JSON.stringify({error:"Method not allowed"})};
   let payload={};
   try{payload=JSON.parse(event.body||"{}")}catch{}
   const email=String(payload.email||"").trim().toLowerCase();
   const password=String(payload.password||"");
   if(!email||!password)return{statusCode:400,headers,body:JSON.stringify({error:"أدخل البريد وكلمة المرور"})};
  
   const url=(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
   if(!url||!key)return{statusCode:500,headers,body:JSON.stringify({error:"إعدادات Supabase على الخادم غير مكتملة"})};
  
   try{
     const login=await fetch(`${url}/auth/v1/token?grant_type=password`,{
       method:"POST",
       headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Accept:"application/json"},
       body:JSON.stringify({email,password})
     });
     const loginBody=await login.json().catch(()=>({}));
     if(!login.ok)return{statusCode:401,headers,body:JSON.stringify({error:loginBody?.msg||loginBody?.error_description||"بيانات الدخول غير صحيحة"})};
  
     const userId=loginBody?.user?.id;
     if(!userId)return{statusCode:401,headers,body:JSON.stringify({error:"تعذر التحقق من المستخدم"})};
  
     const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,phone,role,status&limit=1`,{
       headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json"}
     });
     const rows=await pr.json().catch(()=>[]);
     if(!pr.ok)return{statusCode:500,headers,body:JSON.stringify({error:rows?.message||"تعذر قراءة ملف المطور"})};
     const profile=Array.isArray(rows)?rows[0]:null;
     if(!profile)return{statusCode:403,headers,body:JSON.stringify({error:"ملف المطور غير موجود في profiles"})};
     if(profile.role!=="developer")return{statusCode:403,headers,body:JSON.stringify({error:"هذا الحساب ليس حساب مطور"})};
     if(profile.status!=="active")return{statusCode:403,headers,body:JSON.stringify({error:"حساب المطور غير نشط"})};
  
     return{
       statusCode:200,headers,
       body:JSON.stringify({
         user:{id:profile.id,name:profile.full_name||email,phone:profile.phone||""},
         access_token:loginBody.access_token||"",
         refresh_token:loginBody.refresh_token||""
       })
     };
   }catch(e){
     console.error("developer-login",e);
     return{statusCode:502,headers,body:JSON.stringify({error:e.message||"تعذر الاتصال بـ Supabase"})};
   }
  };
  return module.exports;
}
__mods["developer-login"]=__load_developer_login();
function __load_platform_data(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const {verify}=require('./_staff-session');
  function has(s,p){return s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.[p]}
  function canSeeAllOps(s){return !!(s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.allBranches)}
  function canSeeAllFinance(s){return !!(s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.allBranchesFinance)}
  async function liveStaff(url,sh,s){
    if(!s?.id)return s;
    try{const r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(s.id)}&select=id,name,role,branch_id,status,permissions&limit=1`,{headers:sh});const b=await r.json().catch(()=>[]);const u=r.ok&&Array.isArray(b)?b[0]:null;if(u&&String(u.status||'نشط')!=='موقوف')return {...s,id:u.id,name:u.name||s.name,role:u.role||s.role,branch_id:u.branch_id||null,permissions:u.permissions||{}}}catch(_e){}return s;
  }
  exports.handler=async(event)=>{
   const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
   const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
   if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
   const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';let session=verify(token,key);
   if(!session)return{statusCode:401,headers:H,body:JSON.stringify({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'})};
   const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
   session=await liveStaff(url,sh,session);
   try{
    if(event.httpMethod==='GET'){
     const resource=event.queryStringParameters?.resource||'platform';
     if(resource==='platform'){
      const [fy,ex,ar,md]=await Promise.all([
       fetch(`${url}/rest/v1/fiscal_years?select=*&order=start_date.desc`,{headers:sh}),
       fetch(`${url}/rest/v1/expenses?select=*&order=expense_date.desc,created_at.desc&limit=2000`,{headers:sh}),
       fetch(`${url}/rest/v1/automation_rules?select=*&order=created_at.desc`,{headers:sh}),
       fetch(`${url}/rest/v1/master_data?select=*&active=eq.true&order=category.asc,sort_order.asc`,{headers:sh})
      ]);
      const [FY,EX,AR,MD]=await Promise.all([fy.json().catch(()=>[]),ex.json().catch(()=>[]),ar.json().catch(()=>[]),md.json().catch(()=>[])]);
      if(!fy.ok||!ex.ok||!ar.ok||!md.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'جداول V8 غير جاهزة. شغّل Master Migration.'})};
      let expenses=Array.isArray(EX)?EX:[]; if(!canSeeAllFinance(session)){expenses=session.branch_id?expenses.filter(x=>String(x.branch_id||'')===String(session.branch_id)):[];}
      let rules=Array.isArray(AR)?AR:[]; if(!canSeeAllOps(session)){rules=session.branch_id?rules.filter(x=>!x.branch_id||String(x.branch_id)===String(session.branch_id)):rules.filter(x=>!x.branch_id);}
      return{statusCode:200,headers:H,body:JSON.stringify({fiscalYears:FY,expenses,automationRules:rules,masterData:MD})};
     }
     return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown resource'})};
    }
    if(event.httpMethod==='POST'){
     let p={};try{p=JSON.parse(event.body||'{}')}catch{}
     const action=String(p.action||'');
     if(action==='save_fiscal_year'){
      if(!has(session,'financialYears'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إدارة السنة المالية'})};
      const row=p.row||{}; if(!row.name||!row.start_date||!row.end_date)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات السنة المالية ناقصة'})};
      const r=await fetch(`${url}/rest/v1/fiscal_years?on_conflict=name`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify([{name:row.name,start_date:row.start_date,end_date:row.end_date,status:row.status||'open',updated_at:new Date().toISOString()}])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ السنة المالية'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
     }
     if(action==='close_fiscal_year'){
      if(!has(session,'closeFinancialPeriod'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الإقفال'})};
      const id=String(p.id||'');const r=await fetch(`${url}/rest/v1/fiscal_years?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify({status:'closed',closed_at:new Date().toISOString(),closed_by:session.name||session.id,updated_at:new Date().toISOString()})});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر إقفال السنة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
     }
     if(action==='add_expense'){
      if(!has(session,'expenses'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية المصروفات'})};
      const row=p.row||{};if(!canSeeAllFinance(session)&&!session.branch_id)return{statusCode:409,headers:H,body:JSON.stringify({error:'حسابك غير مرتبط بفرع، لذلك لا يمكن تسجيل حركة مالية.',code:'BRANCH_SCOPE_MISSING'})};const branch=row.branch_id||session.branch_id||null;if(!canSeeAllFinance(session)&&String(branch)!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية لهذا الفرع'})};
      const rec={expense_date:row.expense_date,branch_id:branch,trip_id:row.trip_id||null,category:row.category,amount:Number(row.amount||0),notes:row.notes||'',created_by:session.name||session.id};if(!rec.expense_date||!rec.category||rec.amount<=0)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات المصروف غير مكتملة'})};
      const r=await fetch(`${url}/rest/v1/expenses`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ المصروف'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
     }
     if(action==='save_automation'){
      if(!has(session,'automation'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الأتمتة'})};
      const row=p.row||{};if(!canSeeAllOps(session)&&!session.branch_id)return{statusCode:409,headers:H,body:JSON.stringify({error:'حسابك غير مرتبط بفرع.',code:'BRANCH_SCOPE_MISSING'})};const automationBranch=canSeeAllOps(session)?(row.branch_id||null):session.branch_id;const rec={name:row.name,branch_id:automationBranch,trigger_key:row.trigger_key,mode:row.mode||'manual',recipient_emails:row.recipient_emails||[],payload_fields:row.payload_fields||[],active:row.active!==false,config:row.config||{},created_by:session.name||session.id,updated_at:new Date().toISOString()};if(!rec.name||!rec.trigger_key)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات القاعدة ناقصة'})};
      const r=await fetch(`${url}/rest/v1/automation_rules`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ القاعدة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
     }
     if(action==='delete_automation'){
      if(!has(session,'automation'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الأتمتة'})};const id=String(p.id||'');const r=await fetch(`${url}/rest/v1/automation_rules?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{...sh,Prefer:'return=minimal'}});if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'تعذر حذف القاعدة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true})};
     }
     return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
    }
    return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
   }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Platform data error'})}}
  };
  return module.exports;
}
__mods["platform-data"]=__load_platform_data();
function __load_staff_login(){
  const module={exports:{}};const exports=module.exports;const require=__localRequire;const crypto=require('crypto');const {issue}=require('./_staff-session');
  function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(String(password),salt,64).toString('hex');return `scrypt$${salt}$${hash}`}
  function safeHexEqual(a,b){try{const A=Buffer.from(String(a||''),'hex'),B=Buffer.from(String(b||''),'hex');return A.length>0&&A.length===B.length&&crypto.timingSafeEqual(A,B)}catch{return false}}
  function verifyPassword(input,stored){
    stored=String(stored??'');const raw=String(input??'');
    if(stored.startsWith('scrypt$')){const parts=stored.split('$');if(parts.length!==3)return false;const hash=crypto.scryptSync(raw,parts[1],64).toString('hex');return safeHexEqual(hash,parts[2])}
    if(stored.startsWith('sha256$')){const expected=stored.slice(7);const hash=crypto.createHash('sha256').update(raw).digest('hex');return safeHexEqual(hash,expected)}
    if(/^[a-f0-9]{64}$/i.test(stored)){const hash=crypto.createHash('sha256').update(raw).digest('hex');return safeHexEqual(hash,stored)}
    if(stored.startsWith('plain$'))return stored.slice(6)===raw;
    return stored===raw;
  }
  function normUser(v){return String(v??'').trim().toLowerCase()}
  function normPhone(v){return String(v??'').replace(/\D/g,'').replace(/^00/,'')}
  function activeStatus(v){const x=String(v??'').trim().toLowerCase();return !x||['نشط','active','enabled','مفعل','مفعّل','1','true'].includes(x)}
  async function patchUser(url,sh,id,row){try{await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify(row)})}catch(_e){}}
  exports.handler=async(event)=>{
    const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};if(event.httpMethod!=='POST')return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
    let p={};try{p=JSON.parse(event.body||'{}')}catch{}
    const identity=String(p.identity||'').trim(),password=String(p.password||''),method=String(p.method||'username');
    if(!identity||!password)return{statusCode:400,headers:H,body:JSON.stringify({error:'أدخل بيانات الدخول'})};
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'إعدادات Supabase على الخادم غير مكتملة'})};
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
    try{
      // Load a bounded staff directory and compare normalized identities locally. This
      // keeps legacy usernames with casing/whitespace and formatted phone numbers working.
      const r=await fetch(`${url}/rest/v1/staff_users?select=id,name,username,password,phone,role,branch_id,status,permissions,failed_login_attempts,locked_until,last_login_at,force_password_reset,security_meta&limit=1000`,{headers:sh});
      const rows=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rows?.message||'تعذر قراءة المستخدم'})};
      const list=Array.isArray(rows)?rows:[];
      let u=null;
      if(method==='phone'){
        const target=normPhone(identity);u=list.find(x=>normPhone(x.phone)===target)||null;
      }else{
        const target=normUser(identity);u=list.find(x=>String(x.username??'').trim()===identity)||list.find(x=>normUser(x.username)===target)||null;
      }
      if(!u)return{statusCode:401,headers:H,body:JSON.stringify({error:'اسم المستخدم أو كلمة المرور غير صحيحة'})};
      if(u.locked_until&&new Date(u.locked_until).getTime()>Date.now())return{statusCode:429,headers:H,body:JSON.stringify({error:'تم إيقاف محاولات الدخول مؤقتاً. حاول لاحقاً.'})};
      if(!verifyPassword(password,u.password)){
        const n=Number(u.failed_login_attempts||0)+1,lock=n>=5?new Date(Date.now()+15*60*1000).toISOString():null;
        await patchUser(url,sh,u.id,{failed_login_attempts:n,locked_until:lock,security_meta:{...(u.security_meta||{}),last_failed_login_at:new Date().toISOString()}});
        return{statusCode:401,headers:H,body:JSON.stringify({error:'اسم المستخدم أو كلمة المرور غير صحيحة'})};
      }
      if(!activeStatus(u.status))return{statusCode:403,headers:H,body:JSON.stringify({error:'هذا الحساب غير نشط'})};
      const patch={failed_login_attempts:0,locked_until:null,last_login_at:new Date().toISOString(),security_meta:{...(u.security_meta||{}),last_login_ip:String(event.headers['cf-connecting-ip']||''),login_bridge_version:'9.6.0'}};
      const stored=String(u.password||'');
      const modern=stored.startsWith('scrypt$');
      if(!modern){patch.password=hashPassword(password);patch.password_changed_at=new Date().toISOString();patch.security_meta={...patch.security_meta,legacy_password_migrated_at:new Date().toISOString()}}
      // Security bookkeeping must never turn a verified password into a failed login.
      await patchUser(url,sh,u.id,patch);
      const safe={id:u.id,name:u.name,username:String(u.username||'').trim(),phone:u.phone,role:u.role,branch_id:u.branch_id,status:u.status||'نشط',permissions:u.permissions||{},force_password_reset:!!u.force_password_reset};
      const session_token=issue({id:u.id,name:u.name,role:u.role,branch_id:u.branch_id||null,permissions:u.permissions||{}},key);
      return{statusCode:200,headers:H,body:JSON.stringify({user:safe,session_token,password_migrated:!modern,login_bridge:'9.6.0'})};
    }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'تعذر تسجيل الدخول'})}}
  };return module.exports;
}
__mods["staff-login"]=__load_staff_login();
function __load_staff_admin(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const crypto=require('crypto');
  const {verify}=require('./_staff-session');
  function has(s,p){return s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.[p]}
  function canSeeAllOps(s){return !!(s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.allBranches)}
  async function liveStaff(url,sh,s){
    if(!s?.id)return s;
    try{const r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(s.id)}&select=id,name,role,branch_id,status,permissions&limit=1`,{headers:sh});const b=await r.json().catch(()=>[]);const u=r.ok&&Array.isArray(b)?b[0]:null;if(u&&String(u.status||'نشط')!=='موقوف')return {...s,id:u.id,name:u.name||s.name,role:u.role||s.role,branch_id:u.branch_id||null,permissions:u.permissions||{}}}catch(_e){}return s;
  }
  function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(String(password),salt,64).toString('hex');return `scrypt$${salt}$${hash}`}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
  function bookingStatusDb(v){const m={'جديد':'new','تحت الإجراء':'new','مؤكد':'confirmed','مدفوع':'paid','ملغي':'cancelled','مستخدم':'used','تم الاستخدام':'used','مكتمل':'completed','منتهي':'completed'};return m[v]||String(v||'new').toLowerCase()}
  function sourceDb(v){return v==='فرع'?'staff':'customer'}
  function normalizeJourneyMode(v,booking={}){
    const raw=String(v||'').trim().toLowerCase().replace(/[\s_-]+/g,'');
    const map={oneway:'oneway',onewaytrip:'oneway',one:'oneway','ذهابفقط':'oneway','ذهاب':'oneway',roundtrip:'roundtrip',round:'roundtrip','ذهابوعودة':'roundtrip','ذهاب+عودة':'roundtrip',separate:'separate',separatereturn:'separate','رحلةعودةمنفصلة':'separate','ذهابوعودةمنرحلةأخرى':'separate',returnonly:'returnonly','عودةفقط':'returnonly'};
    let mode=map[raw]||'';
    if(!mode){if(booking?.return_trip_id||booking?.returnTripId)mode='separate';else mode='oneway'}
    return ['oneway','roundtrip','separate','returnonly'].includes(mode)?mode:'oneway';
  }
  function canSeeAllFinance(s){return !!(s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.allBranchesFinance)}
  function sharedBranchIdsFromNotes(note){
    try{
      const text=String(note||''),mark='[[ALMAHER_SHARED_ROUTE_V1]]',i=text.indexOf(mark);if(i<0)return[];
      const blob=text.slice(i+mark.length).trim().split(/\s/)[0],meta=JSON.parse(decodeURIComponent(blob));
      return [...new Set([...(Array.isArray(meta.sharedBranchIds)?meta.sharedBranchIds:[]),...(Array.isArray(meta.routeStops)?meta.routeStops.map(x=>x?.branchId):[])].filter(Boolean).map(String))];
    }catch(_e){return[]}
  }
  async function canOperateTrip(url,sh,s,tripId){
    if(s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.allBranches)return true;
    if(!tripId||!s?.branch_id)return false;
    const tr=await fetch(`${url}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}&select=id,branch_id,operational_notes&limit=1`,{headers:sh});
    const tb=await tr.json().catch(()=>[]);const t=Array.isArray(tb)?tb[0]:null;
    if(!tr.ok||!t)return false;
    if(String(t.branch_id||'')===String(s.branch_id))return true;
    if(sharedBranchIdsFromNotes(t.operational_notes).includes(String(s.branch_id)))return true;
    const ar=await fetch(`${url}/rest/v1/trip_branches?trip_id=eq.${encodeURIComponent(tripId)}&branch_id=eq.${encodeURIComponent(s.branch_id)}&operations_access=eq.true&select=id&limit=1`,{headers:sh});
    const ab=await ar.json().catch(()=>[]);
    return !!(ar.ok&&Array.isArray(ab)&&ab.length);
  }
  exports.handler=async(event)=>{
   const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
   const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
   if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
   const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';let session=verify(token,key);
   if(!session)return{statusCode:401,headers:H,body:JSON.stringify({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'})};
   const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
   session=await liveStaff(url,sh,session);
   try{
    if(event.httpMethod==='GET'){
     const action=event.queryStringParameters?.action||'bootstrap';
     if(action!=='bootstrap')return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
     const unrestrictedOps=canSeeAllOps(session);
     const unrestrictedFinance=canSeeAllFinance(session);
     if(!unrestrictedOps&&!session.branch_id)return{statusCode:409,headers:H,body:JSON.stringify({error:'حساب الموظف غير مرتبط بفرع. حدّث الفرع من إدارة الموظفين ثم سجّل الدخول مرة أخرى.',code:'BRANCH_SCOPE_MISSING',scope:{role:session.role||'',branch_id:null,operational:'blocked',finance:unrestrictedFinance?'all':'blocked'}})};
     const bookingBranchFilter=unrestrictedOps?'':`&branch_id=eq.${encodeURIComponent(session.branch_id)}`;
     const canManageUsers=session.role==='مدير عام'||has(session,'manageUsers');
     const reqs={
      branches:fetch(`${url}/rest/v1/branches?select=*&order=name.asc`,{headers:sh}),
      branchContacts:fetch(`${url}/rest/v1/branch_contacts?select=*&order=sort_order.asc`,{headers:sh}),
      trips:fetch(`${url}/rest/v1/trips?select=*&order=departure_date.asc,departure_time.asc`,{headers:sh}),
      tripBranches:fetch(`${url}/rest/v1/trip_branches?select=trip_id,branch_id,is_lead,operations_access,finance_access,stop_order,boarding_time,return_drop_time,boarding_point&limit=5000`,{headers:sh}),
      bookings:fetch(`${url}/rest/v1/bookings?select=*&order=created_at.desc${bookingBranchFilter}`,{headers:sh}),
      passengers:fetch(`${url}/rest/v1/booking_passengers?select=*&order=passenger_order.asc`,{headers:sh}),
      users:canManageUsers?fetch(`${url}/rest/v1/staff_users?select=id,name,username,phone,role,branch_id,status,permissions,created_at,updated_at&order=created_at.asc`,{headers:sh}):Promise.resolve({ok:true,status:200,json:async()=>[]})
     };
     const entries=await Promise.all(Object.entries(reqs).map(async([name,promise])=>{try{const r=await promise;const b=await r.json().catch(()=>[]);return[name,r,b]}catch(e){return[name,{ok:false,status:0}, {message:String(e?.message||e)}]} }));
     const map=Object.fromEntries(entries.map(([n,r,b])=>[n,{r,b}]));
     const warnings=[];
     // trip_branches is an additive shared-route relation. If an older database does not
     // have it yet, keep the system usable and fall back to route metadata embedded in trips.
     let TB=[];
     if(map.tripBranches.r.ok)TB=Array.isArray(map.tripBranches.b)?map.tripBranches.b:[];
     else warnings.push({resource:'trip_branches',status:map.tripBranches.r.status,message:map.tripBranches.b?.message||'trip_branches unavailable; using operational route metadata fallback'});
     const hard=['branches','branchContacts','trips','bookings','passengers','users'];
     const failed=hard.filter(n=>!map[n].r.ok).map(n=>({resource:n,status:map[n].r.status,message:map[n].b?.message||map[n].b?.details||'read failed'}));
     if(failed.length)return{statusCode:500,headers:H,body:JSON.stringify({error:'تعذر تحميل بيانات التشغيل من السحابة',details:failed})};
     const BR=Array.isArray(map.branches.b)?map.branches.b:[],BC=Array.isArray(map.branchContacts.b)?map.branchContacts.b:[],TR=Array.isArray(map.trips.b)?map.trips.b:[],BK=Array.isArray(map.bookings.b)?map.bookings.b:[],BP=Array.isArray(map.passengers.b)?map.passengers.b:[],SU=Array.isArray(map.users.b)?map.users.b:[];
     const sharedTripIds=new Set(TB.filter(x=>String(x.branch_id||'')===String(session.branch_id||'')&&x.operations_access!==false).map(x=>String(x.trip_id)));
     const visibleTrips=unrestrictedOps?TR:TR.filter(x=>String(x.branch_id||'')===String(session.branch_id||'')||sharedTripIds.has(String(x.id))||sharedBranchIdsFromNotes(x.operational_notes).includes(String(session.branch_id||'')));
     const visibleTripIds=new Set(visibleTrips.map(x=>String(x.id)));
     const visibleTripBranches=TB.filter(x=>visibleTripIds.has(String(x.trip_id)));
     const allowedBookingIds=new Set(BK.map(x=>x.id));
     return{statusCode:200,headers:H,body:JSON.stringify({branches:BR,branchContacts:BC,trips:visibleTrips,tripBranches:visibleTripBranches,bookings:BK,passengers:BP.filter(x=>allowedBookingIds.has(x.booking_id)),users:SU,bootstrap_warnings:warnings,scope:{role:session.role||'',branch_id:session.branch_id||null,permissions:session.permissions||{},operational:unrestrictedOps?'all':'branch',finance:unrestrictedFinance?'all':'branch',booking_count:BK.length,trip_count:visibleTrips.length}})};
    }
    if(event.httpMethod!=='POST')return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
    let p={};try{p=JSON.parse(event.body||'{}')}catch{}
    const action=String(p.action||'');
    if(action==='sync_trips'){
     if(!has(session,'trips'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إدارة الرحلات'})};
     const rows=Array.isArray(p.rows)?p.rows:[];if(!rows.length)return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count:0})};let count=0;
     for(const r0 of rows){
      const r={...r0};
      let noteSharedIds=[],routeStops=[];
      try{
       const text=String(r.operational_notes||''),mark='[[ALMAHER_SHARED_ROUTE_V1]]',i=text.indexOf(mark);
       if(i>=0){const blob=text.slice(i+mark.length).trim().split(/\s/)[0];const meta=JSON.parse(decodeURIComponent(blob));routeStops=Array.isArray(meta.routeStops)?meta.routeStops:[];noteSharedIds=[...(Array.isArray(meta.sharedBranchIds)?meta.sharedBranchIds:[]),...routeStops.map(x=>x?.branchId)].filter(Boolean)}
      }catch(_e){}
      if(Array.isArray(r.route_stops))routeStops=r.route_stops;else if(Array.isArray(r._route_stops))routeStops=r._route_stops;
      const sharedBranchIds=[...(Array.isArray(r._shared_branch_ids)?r._shared_branch_ids:[]),...(Array.isArray(r.shared_branch_ids)?r.shared_branch_ids:[]),...noteSharedIds].filter(isUuid);
      delete r._shared_branch_ids;delete r.shared_branch_ids;delete r.route_stops;delete r._route_stops;
      if(!canSeeAllOps(session)&&!session.branch_id)return{statusCode:409,headers:H,body:JSON.stringify({error:'حسابك غير مرتبط بفرع.',code:'BRANCH_SCOPE_MISSING'})};if(!canSeeAllOps(session)&&String(r.branch_id||'')!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'إحدى الرحلات تتبع فرعًا غير مصرح به'})};
      const rr=await fetch(`${url}/rest/v1/rpc/almaher_upsert_trip_safe`,{method:'POST',headers:sh,body:JSON.stringify({p_trip:r,p_actor:{id:session.id,name:session.name,role:session.role}})});const rb=await rr.json().catch(()=>({}));if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||rb?.error||'تعذر حفظ الرحلة بأمان'})};
      const tripId=rb?.id||rb?.result?.id||null;
      if(tripId){
       const desired=[...new Set([r.branch_id,...sharedBranchIds].filter(isUuid).map(String))];
       const ex=await fetch(`${url}/rest/v1/trip_branches?trip_id=eq.${encodeURIComponent(tripId)}&select=id,branch_id`,{headers:sh});const eb=await ex.json().catch(()=>[]);
       if(ex.ok&&Array.isArray(eb)){
        for(const old of eb){if(!desired.includes(String(old.branch_id))){await fetch(`${url}/rest/v1/trip_branches?id=eq.${encodeURIComponent(old.id)}`,{method:'DELETE',headers:{...sh,Prefer:'return=minimal'}})}}
       }
       if(desired.length){
        const stopByBranch=new Map((Array.isArray(routeStops)?routeStops:[]).filter(x=>isUuid(x?.branchId)).map((x,i)=>[String(x.branchId),{...x,_i:i}]));
        const rels=desired.map((bid,i)=>{const s=stopByBranch.get(String(bid))||{};return {trip_id:tripId,branch_id:bid,is_lead:String(bid)===String(r.branch_id),operations_access:true,finance_access:false,stop_order:Number(s.order||s._i+1||i+1),boarding_time:s.outboundTime||null,return_drop_time:s.returnTime||null,boarding_point:s.city||s.branchName||null}});
        const ur=await fetch(`${url}/rest/v1/trip_branches?on_conflict=trip_id,branch_id`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rels)});
        if(!ur.ok){const ue=await ur.json().catch(()=>({}));const msg=String(ue?.message||ue?.details||'');if(!/schema cache|Could not find the table|relation .* does not exist|PGRST205/i.test(msg))return{statusCode:500,headers:H,body:JSON.stringify({error:msg||'تعذر حفظ فروع الرحلة المشتركة'})}}
       }
       // These columns are additive. Ignore older schemas here; the shared-route relation and
       // encoded operational metadata remain the source of operational visibility.
       await fetch(`${url}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}`,{method:'PATCH',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify({is_shared:desired.length>1,lead_branch_id:isUuid(r.branch_id)?r.branch_id:null})}).catch(()=>{});
      }
      count++;
     }
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count})};
    }
    if(action==='save_branch'){
     if(session.role!=='مدير عام'&&!has(session,'manageBranches'))return{statusCode:403,headers:H,body:JSON.stringify({error:'اعتماد بيانات الفروع للمدير العام فقط'})};
     const r=p.row||{};if(!r.name)return{statusCode:400,headers:H,body:JSON.stringify({error:'اسم الفرع مطلوب'})};
     const rec={name:r.name,status:r.status==='موقوف'?'inactive':'active',address:r.address||null,whatsapp:r.whatsapp||null,manager_name:r.manager||null,notes:r.notes||null,commercial_registration:r.commercialRegistration||null,tax_number:r.taxNumber||null,email:r.email||null,working_hours:r.workingHours||null,map_url:r.mapUrl||null,show_legal_on_ticket:r.showLegalOnTicket!==false};
     let rr;if(isUuid(r.id))rr=await fetch(`${url}/rest/v1/branches?id=eq.${encodeURIComponent(r.id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(rec)});else rr=await fetch(`${url}/rest/v1/branches`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});
     const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر حفظ الفرع'})};const saved=Array.isArray(rb)?rb[0]:null;
     if(saved?.id&&Array.isArray(r.contacts)){const cr=await fetch(`${url}/rest/v1/rpc/replace_branch_contacts`,{method:'POST',headers:sh,body:JSON.stringify({p_branch_id:saved.id,p_contacts:r.contacts.map((c,i)=>({label:c.label||'رقم التواصل',phone:c.phone||c.number||'',sort_order:i+1}))})});if(!cr.ok){const ce=await cr.json().catch(()=>({}));return{statusCode:500,headers:H,body:JSON.stringify({error:ce?.message||'تعذر حفظ أرقام الفرع بأمان'})}}}
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved})};
    }
    if(action==='sync_users'){
     if(session.role!=='مدير عام'&&!has(session,'manageUsers'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إدارة الموظفين'})};
     const rows=Array.isArray(p.rows)?p.rows:[];
     let count=0;
     for(const u of rows){
      if(!u.username)continue;
      const existing=await fetch(`${url}/rest/v1/staff_users?username=eq.${encodeURIComponent(u.username)}&select=id,password&limit=1`,{headers:sh});
      const er=await existing.json().catch(()=>[]);
      const old=Array.isArray(er)?er[0]:null;
      const rec={name:u.name||'',username:u.username,phone:u.phone||'',role:u.role||'موظف',branch_id:isUuid(u.branch_id)?u.branch_id:null,status:u.status||'نشط',permissions:u.permissions||{},updated_at:new Date().toISOString()};
      if(u.password)rec.password=String(u.password).startsWith('scrypt$')?u.password:hashPassword(u.password);
      if(old){
       const rr=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(old.id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify(rec)});
       if(!rr.ok){const e=await rr.json().catch(()=>({}));return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||'تعذر تحديث موظف'})};}
      }else{
       rec.id=String(u.id||`staff-${Date.now()}-${Math.random().toString(16).slice(2)}`);
       if(!rec.password)return{statusCode:400,headers:H,body:JSON.stringify({error:'كلمة مرور الموظف الجديد مطلوبة'})};
       const rr=await fetch(`${url}/rest/v1/staff_users`,{method:'POST',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify([rec])});
       if(!rr.ok){const e=await rr.json().catch(()=>({}));return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||'تعذر إنشاء موظف'})};}
      }
      count++;
     }
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count})};
    }

    if(action==='archive_trips'){
     if(!has(session,'delete'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية حذف/أرشفة الرحلات'})};
     const ids=Array.isArray(p.ids)?p.ids:[],codes=Array.isArray(p.codes)?p.codes:[];let count=0;
     for(let i=0;i<Math.max(ids.length,codes.length);i++){
      const id=ids[i],code=codes[i];let filter='';if(isUuid(id))filter=`id=eq.${encodeURIComponent(id)}`;else if(code)filter=`trip_code=eq.${encodeURIComponent(code)}`;if(!filter)continue;
      const rr=await fetch(`${url}/rest/v1/trips?${filter}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify({status:'cancelled',visibility:'hidden',lifecycle:'cancelled',updated_at:new Date().toISOString()})});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر أرشفة الرحلة'})};count+=Array.isArray(rb)?rb.length:1;
     }
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count})};
    }
    if(action==='trip_operational_data'){
     if(!has(session,'manifest')&&!has(session,'housingManifest')&&!has(session,'housing')&&!has(session,'operations')&&!has(session,'viewBookings'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية تشغيلية على كشف الرحلة'})};
     const tripId=String(p.trip_id||'');if(!isUuid(tripId))return{statusCode:400,headers:H,body:JSON.stringify({error:'معرّف الرحلة غير صالح'})};
     if(!(await canOperateTrip(url,sh,session,tripId)))return{statusCode:403,headers:H,body:JSON.stringify({error:'الرحلة ليست ضمن تشغيل فرعك'})};
     const [trq,bq]=await Promise.all([
      fetch(`${url}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}&select=*&limit=1`,{headers:sh}),
      fetch(`${url}/rest/v1/bookings?select=*&or=(trip_id.eq.${encodeURIComponent(tripId)},return_trip_id.eq.${encodeURIComponent(tripId)})&order=created_at.asc&limit=3000`,{headers:sh})
     ]);
     const [tra,ba]=await Promise.all([trq.json().catch(()=>[]),bq.json().catch(()=>[])]);
     if(!trq.ok||!bq.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'تعذر تحميل كشف التشغيل الكامل'})};
     const trip=Array.isArray(tra)?tra[0]:null;if(!trip)return{statusCode:404,headers:H,body:JSON.stringify({error:'الرحلة غير موجودة'})};
     const rows=Array.isArray(ba)?ba:[];const ids=rows.map(x=>x.id).filter(Boolean);
     let passengers=[];
     if(ids.length){
      const inFilter=ids.map(x=>String(x)).join(',');
      const pr=await fetch(`${url}/rest/v1/booking_passengers?booking_id=in.(${inFilter})&select=*&order=passenger_order.asc&limit=10000`,{headers:sh});
      const pb=await pr.json().catch(()=>[]);if(pr.ok&&Array.isArray(pb))passengers=pb;
     }
     const allFinance=canSeeAllFinance(session);
     function redactSnapshot(v){
      if(!v||typeof v!=='object'||Array.isArray(v))return v;
      const x=JSON.parse(JSON.stringify(v));
      for(const k of ['totalPrice','paidAmount','paymentMethod','financialStatus','outboundLegPrice','returnLegPrice','priceOverride','priceReason','originalPrice','finalPrice','priceSnapshot','commission','profit','cost','revenue'])delete x[k];
      return x;
     }
     const safeBookings=rows.map(b=>{
      const own=allFinance||String(b.branch_id||'')===String(session.branch_id||'');
      if(own)return{...b,financial_visible:true};
      return{...b,total_price:null,paid_amount:null,payment_method:null,financial_status:null,price_snapshot:null,snapshot:redactSnapshot(b.snapshot),financial_visible:false};
     });
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,trip,bookings:safeBookings,passengers,finance_scope:allFinance?'all':'own_branch_only',actor_branch_id:session.branch_id||null})};
    }
    if(action==='update_booking'){
     if(!has(session,'editBookings')&&!has(session,'editPassenger')&&!has(session,'confirmBookings')&&!has(session,'cancelBookings')&&!has(session,'payments')&&!has(session,'refunds')&&!has(session,'changeTrip'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية تعديل الحجز'})};
     const b=p.booking||{};const bookingNo=String(b.number||b.booking_number||'');if(!bookingNo)return{statusCode:400,headers:H,body:JSON.stringify({error:'رقم الحجز مطلوب'})};
     const existing=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=*&limit=1`,{headers:sh});const er=await existing.json().catch(()=>[]);const old=Array.isArray(er)?er[0]:null;if(!old)return{statusCode:404,headers:H,body:JSON.stringify({error:'الحجز غير موجود سحابيًا'})};
     const expectedVersion=Number(b.versionNo??b.version_no??0);if(expectedVersion&&Number(old.version_no||1)!==expectedVersion)return{statusCode:409,headers:H,body:JSON.stringify({error:'تم تعديل الحجز من مستخدم آخر. حدّث البيانات قبل الحفظ.',code:'VERSION_CONFLICT',expected_version:expectedVersion,current_version:Number(old.version_no||1),last_modified_at:old.last_modified_at,last_modified_by:old.last_modified_by})};
     if(!canSeeAllOps(session)&&!session.branch_id)return{statusCode:409,headers:H,body:JSON.stringify({error:'حسابك غير مرتبط بفرع.',code:'BRANCH_SCOPE_MISSING'})};if(!canSeeAllOps(session)&&String(old.branch_id||'')!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'الحجز خارج فرعك'})};
     const db={...old,booking_number:bookingNo};
     db.journey_mode=normalizeJourneyMode(b.journeyMode??old.journey_mode,{...old,...b});
     if(has(session,'confirmBookings')||has(session,'cancelBookings'))db.status=bookingStatusDb(b.status);
     const newPaid=Number(b.paidAmount??old.paid_amount??0);if(newPaid<Number(old.paid_amount||0)&&!has(session,'refunds'))return{statusCode:403,headers:H,body:JSON.stringify({error:'خفض المبلغ المدفوع يعتبر استردادًا ويتطلب صلاحية المرتجعات'})};
     if(has(session,'payments')||has(session,'refunds')){db.paid_amount=newPaid;db.payment_method=b.paymentMethod||b.payment_method||old.payment_method||null;db.payment_reference=b.paymentReference??b.payment_reference??old.payment_reference??null;}
     if(has(session,'editBookings'))Object.assign(db,{customer_name:b.name??old.customer_name,customer_phone:b.phone??old.customer_phone,customer_identity:b.identity??old.customer_identity,customer_gender:b.gender??old.customer_gender,customer_nationality:b.nationality??old.customer_nationality,notes:b.notes??old.notes,accommodation_type:b.accommodationType??old.accommodation_type,accommodation_label:b.accommodationLabel??old.accommodation_label,private_rooms:Number(b.privateRooms??old.private_rooms??0),private_room_types:Array.isArray(b.privateRoomTypes)?b.privateRoomTypes:(old.private_room_types||[]),total_price:Number(b.totalPrice??old.total_price??0),ticket_version:Number(b.ticketVersion??old.ticket_version??1)});
     if(has(session,'changeTrip')){db.trip_id=b.tripId||old.trip_id;db.return_trip_id=b.returnTripId||null;db.journey_mode=normalizeJourneyMode(b.journeyMode||old.journey_mode,{...old,...b});for(const tid of [db.trip_id,db.return_trip_id].filter(Boolean)){const tr=await fetch(`${url}/rest/v1/trips?id=eq.${encodeURIComponent(tid)}&select=id,branch_id&limit=1`,{headers:sh});const tb=await tr.json().catch(()=>[]);const t=Array.isArray(tb)?tb[0]:null;if(!t)return{statusCode:400,headers:H,body:JSON.stringify({error:'الرحلة الجديدة غير موجودة'})};if(!(await canOperateTrip(url,sh,session,tid)))return{statusCode:403,headers:H,body:JSON.stringify({error:'الرحلة الجديدة خارج التشغيل المصرح لفرعك'})};}}
     if(b.snapshot&&typeof b.snapshot==='object')db.snapshot=b.snapshot;else db.snapshot={...(old.snapshot||{}),...b,passengerDetails:undefined};
     const passengerRows=(has(session,'editPassenger')&&Array.isArray(b.passengerDetails))?b.passengerDetails.map((x,i)=>({id:x.id||null,passenger_order:i+1,full_name:x.name||'',gender:x.gender||null,nationality:x.nationality||null,identity_number:x.identity||'',phone:x.phone||null,status:x.status||'confirmed',accommodation_status:x.accommodationStatus||'active',preferred_language:x.preferredLanguage||'ar',assistance_flags:Array.isArray(x.assistanceFlags)?x.assistanceFlags:[],document_status:x.documentStatus||'unknown'})):null;
     const rr=await fetch(`${url}/rest/v1/rpc/almaher_update_booking_atomic`,{method:'POST',headers:sh,body:JSON.stringify({p_booking_number:bookingNo,p_booking:db,p_passengers:passengerRows,p_actor:{id:session.id,name:session.name,role:session.role}})});const rb=await rr.json().catch(()=>({}));if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||rb?.details||'تعذر تحديث الحجز بشكل ذري'})};
     return{statusCode:200,headers:H,body:JSON.stringify({ok:true,result:rb})};
    }
    if(['refund_quote','refund_request','refund_list','refund_decide','refund_complete','refund_get'].includes(action)){
     const manager=!!(session.role==='مدير عام'||session.permissions?.all||session.permissions?.allBranchesFinance);
     const canRequest=!!(manager||has(session,'refund_request')||has(session,'refunds')||has(session,'cancelBookings')||has(session,'editBookings'));
     const canApprove=!!(manager||has(session,'refund_approve')||(has(session,'refunds')&&has(session,'approvals')));
     const canComplete=!!(manager||has(session,'refund_complete')||has(session,'refunds'));
     const canView=!!(manager||has(session,'refund_view')||canRequest||canApprove||canComplete);
     const canPrint=!!(manager||has(session,'refund_print')||canView);
     const bookingNo=String(p.booking_number||p.bookingNo||'').trim();
     async function getBooking(no){const r=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(no)}&select=*&limit=1`,{headers:sh});const b=await r.json().catch(()=>[]);return r.ok&&Array.isArray(b)?b[0]:null}
     function scopeOk(row){return canSeeAllFinance(session)||String(row?.branch_id||'')===String(session.branch_id||'')}
     async function completedTotal(bookingId,excludeId=''){const q=`booking_id=eq.${encodeURIComponent(bookingId)}&status=eq.completed&select=id,amount&limit=500`;const r=await fetch(`${url}/rest/v1/booking_refunds?${q}`,{headers:sh});const a=await r.json().catch(()=>[]);return (Array.isArray(a)?a:[]).filter(x=>!excludeId||String(x.id)!==String(excludeId)).reduce((n,x)=>n+Number(x.amount||0),0)}
     if(action==='refund_quote'){
       if(!canRequest)return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية طلب استرداد'})};
       const b=await getBooking(bookingNo);if(!b)return{statusCode:404,headers:H,body:JSON.stringify({error:'الحجز غير موجود'})};if(!scopeOk(b))return{statusCode:403,headers:H,body:JSON.stringify({error:'الحجز خارج النطاق المالي لفرعك'})};
       const refunded=await completedTotal(b.id),paid=Number(b.paid_amount||0),available=Math.max(0,paid-refunded);
       return{statusCode:200,headers:H,body:JSON.stringify({ok:true,booking:{id:b.id,booking_number:b.booking_number,branch_id:b.branch_id,customer_name:b.customer_name,customer_phone:b.customer_phone,status:b.status,total_price:Number(b.total_price||0),paid_amount:paid},refunded_amount:refunded,available_refund:available,capabilities:{request:canRequest,approve:canApprove,complete:canComplete,view:canView,print:canPrint}})};
     }
     if(action==='refund_request'){
       if(!canRequest)return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية طلب استرداد'})};
       const b=await getBooking(bookingNo);if(!b)return{statusCode:404,headers:H,body:JSON.stringify({error:'الحجز غير موجود'})};if(!scopeOk(b))return{statusCode:403,headers:H,body:JSON.stringify({error:'الحجز خارج النطاق المالي لفرعك'})};
       const clientRequestId=String(p.client_request_id||'').trim().slice(0,120);
       if(clientRequestId){
         const ir=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${encodeURIComponent(b.id)}&metadata->>client_request_id=eq.${encodeURIComponent(clientRequestId)}&select=*&limit=1`,{headers:sh});
         const ia=await ir.json().catch(()=>[]),existingSame=Array.isArray(ia)?ia[0]:null;
         if(ir.ok&&existingSame)return{statusCode:200,headers:H,body:JSON.stringify({ok:true,refund:existingSame,receipt_no:existingSame.receipt_no,status:existingSame.status,idempotent:true,direct:existingSame.status==='completed'})};
       }
       const or=await fetch(`${url}/rest/v1/booking_refunds?booking_id=eq.${encodeURIComponent(b.id)}&status=in.(pending,approved)&select=id,receipt_no,status,amount&order=requested_at.desc&limit=1`,{headers:sh});
       const oa=await or.json().catch(()=>[]),openRefund=Array.isArray(oa)?oa[0]:null;
       if(or.ok&&openRefund)return{statusCode:409,headers:H,body:JSON.stringify({error:`يوجد بالفعل طلب استرداد مفتوح لهذا الحجز (${openRefund.receipt_no||''}). أكمله أو ارفضه قبل إنشاء طلب جديد.`,code:'REFUND_ALREADY_OPEN',refund:openRefund})};
       const refunded=await completedTotal(b.id),paid=Number(b.paid_amount||0),available=Math.max(0,paid-refunded),amount=Number(p.amount||0);if(!(amount>0)||amount>available+0.001)return{statusCode:400,headers:H,body:JSON.stringify({error:`مبلغ الاسترداد غير صالح. المتاح ${available.toFixed(2)} ريال`})};
       const direct=!!(p.direct_execute&&canApprove&&canComplete),inlineApprove=!!(!direct&&p.inline_approve&&canApprove);
       const receiptNo=`REF-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
       const ts=new Date().toISOString();
       const row={receipt_no:receiptNo,booking_id:b.id,booking_number:b.booking_number,branch_id:b.branch_id,customer_name:b.customer_name,customer_phone:b.customer_phone,amount,paid_amount_snapshot:paid,previous_refunded_amount:refunded,reason:String(p.reason||'').trim()||'إلغاء/تسوية الحجز',refund_method:String(p.refund_method||'cash'),customer_ack_name:String(p.customer_ack_name||b.customer_name||''),cancel_booking:!!p.cancel_booking,status:direct?'completed':inlineApprove?'approved':'pending',requested_by:String(session.name||session.id||''),requested_by_id:String(session.id||''),requested_at:ts,...((direct||inlineApprove)?{decided_by:String(session.name||session.id||''),decided_by_id:String(session.id||''),decided_at:ts,decision_notes:direct?'اعتماد وتنفيذ مباشر حسب صلاحية الموظف':'اعتماد مباشر حسب صلاحية الموظف'}:{}),...(direct?{completed_by:String(session.name||session.id||''),completed_by_id:String(session.id||''),completed_at:ts}:{}),metadata:{source:'booking_editor',client_request_id:clientRequestId||null,direct_approval:direct||inlineApprove,direct_execution:direct}};
       const rr=await fetch(`${url}/rest/v1/booking_refunds`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(row)});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر إنشاء عملية الاسترداد'})};const saved=Array.isArray(rb)?rb[0]:rb;
       if(direct){
         const totalAfter=refunded+amount,fin=totalAfter>=paid-0.001?'refunded':'partially_refunded';
         await fetch(`${url}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}`,{method:'PATCH',headers:sh,body:JSON.stringify({financial_status:fin,...(row.cancel_booking?{status:'cancelled'}:{})})});
         await fetch(`${url}/rest/v1/activity_events`,{method:'POST',headers:sh,body:JSON.stringify({actor_id:String(session.id||''),actor_name:String(session.name||''),actor_role:String(session.role||''),branch_id:b.branch_id,entity_type:'booking_refund',entity_id:String(saved?.id||''),action:'refund_completed_direct',metadata:{booking_number:b.booking_number,amount,receipt_no:receiptNo,financial_status:fin},created_at:ts})}).catch(()=>{});
         return{statusCode:200,headers:H,body:JSON.stringify({ok:true,refund:saved,receipt_no:receiptNo,status:'completed',direct:true,financial_status:fin})};
       }
       if(!inlineApprove){
         const ar=await fetch(`${url}/rest/v1/approval_requests`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify({request_type:'booking_refund',entity_type:'booking',entity_id:String(b.id),branch_id:b.branch_id,requested_by:String(session.name||session.id||''),approver_role:'manager',status:'pending',request_payload:{refund_id:saved?.id,receipt_no:receiptNo,booking_number:b.booking_number,amount,reason:row.reason,refund_method:row.refund_method}})});const ab=await ar.json().catch(()=>[]);if(ar.ok&&saved?.id&&Array.isArray(ab)&&ab[0]?.id)await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(saved.id)}`,{method:'PATCH',headers:sh,body:JSON.stringify({approval_request_id:ab[0].id})});
       }
       await fetch(`${url}/rest/v1/activity_events`,{method:'POST',headers:sh,body:JSON.stringify({actor_id:String(session.id||''),actor_name:String(session.name||''),actor_role:String(session.role||''),branch_id:b.branch_id,entity_type:'booking_refund',entity_id:String(saved?.id||''),action:inlineApprove?'refund_approved_direct':'refund_requested',metadata:{booking_number:b.booking_number,amount,receipt_no:receiptNo},created_at:ts})}).catch(()=>{});
       return{statusCode:200,headers:H,body:JSON.stringify({ok:true,refund:saved,receipt_no:receiptNo,status:inlineApprove?'approved':'pending',direct:false,inline_approved:inlineApprove})};
     }
     if(action==='refund_list'){
       if(!canView)return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية عرض الاستردادات'})};
       const filter=canSeeAllFinance(session)?'':`&branch_id=eq.${encodeURIComponent(session.branch_id||'')}`;const r=await fetch(`${url}/rest/v1/booking_refunds?select=*&order=requested_at.desc${filter}&limit=500`,{headers:sh});const rows=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rows?.message||'تعذر تحميل طلبات الاسترداد'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,rows:Array.isArray(rows)?rows:[],can_request:canRequest,can_approve:canApprove,can_complete:canComplete,can_print:canPrint})};
     }
     if(action==='refund_get'){
       if(!canView&&!canPrint)return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية عرض/طباعة سند الاسترداد'})};
       const id=String(p.id||'');const r=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:sh});const rows=await r.json().catch(()=>[]),row=Array.isArray(rows)?rows[0]:null;if(!row)return{statusCode:404,headers:H,body:JSON.stringify({error:'طلب الاسترداد غير موجود'})};if(!scopeOk(row))return{statusCode:403,headers:H,body:JSON.stringify({error:'خارج نطاق فرعك'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row})};
     }
     if(action==='refund_decide'){
       if(!canApprove)return{statusCode:403,headers:H,body:JSON.stringify({error:'اعتماد الاسترداد يتطلب صلاحية الإدارة/المرتجعات والموافقات'})};const id=String(p.id||''),decision=String(p.decision||'').toLowerCase();if(!['approved','rejected'].includes(decision))return{statusCode:400,headers:H,body:JSON.stringify({error:'قرار غير صالح'})};
       const r0=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:sh});const a0=await r0.json().catch(()=>[]),row=Array.isArray(a0)?a0[0]:null;if(!row)return{statusCode:404,headers:H,body:JSON.stringify({error:'الطلب غير موجود'})};if(!scopeOk(row))return{statusCode:403,headers:H,body:JSON.stringify({error:'خارج نطاقك المالي'})};if(row.status!=='pending')return{statusCode:409,headers:H,body:JSON.stringify({error:'تم اتخاذ قرار على الطلب سابقًا'})};
       if(decision==='approved'){const b=await getBooking(row.booking_number);const done=await completedTotal(row.booking_id,row.id),available=Math.max(0,Number(b?.paid_amount||0)-done);if(Number(row.amount||0)>available+0.001)return{statusCode:409,headers:H,body:JSON.stringify({error:`المتاح للاسترداد تغير وأصبح ${available.toFixed(2)} ريال`})}}
       const patch={status:decision,decision_notes:String(p.notes||''),decided_by:String(session.name||session.id||''),decided_by_id:String(session.id||''),decided_at:new Date().toISOString()};const rr=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(patch)});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر حفظ القرار'})};if(row.approval_request_id)await fetch(`${url}/rest/v1/approval_requests?id=eq.${encodeURIComponent(row.approval_request_id)}`,{method:'PATCH',headers:sh,body:JSON.stringify({status:decision==='approved'?'approved':'rejected',approver_id:String(session.id||''),decision_notes:String(p.notes||''),decided_at:new Date().toISOString()})}).catch(()=>{});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(rb)?rb[0]:rb})};
     }
     if(action==='refund_complete'){
       if(!canComplete)return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية تنفيذ الاسترداد'})};const id=String(p.id||'');const r0=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:sh});const a0=await r0.json().catch(()=>[]),row=Array.isArray(a0)?a0[0]:null;if(!row)return{statusCode:404,headers:H,body:JSON.stringify({error:'الطلب غير موجود'})};if(!scopeOk(row))return{statusCode:403,headers:H,body:JSON.stringify({error:'خارج نطاقك المالي'})};if(row.status!=='approved')return{statusCode:409,headers:H,body:JSON.stringify({error:'يجب اعتماد الطلب قبل تنفيذ الاسترداد'})};
       const b=await getBooking(row.booking_number),done=await completedTotal(row.booking_id,row.id),available=Math.max(0,Number(b?.paid_amount||0)-done);if(Number(row.amount||0)>available+0.001)return{statusCode:409,headers:H,body:JSON.stringify({error:`المبلغ المتاح حاليًا ${available.toFixed(2)} ريال`})};const completedAt=new Date().toISOString();const rr=await fetch(`${url}/rest/v1/booking_refunds?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify({status:'completed',completed_by:String(session.name||session.id||''),completed_by_id:String(session.id||''),completed_at:completedAt,customer_ack_name:String(p.customer_ack_name||row.customer_ack_name||row.customer_name||'')})});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر إتمام الاسترداد'})};const totalAfter=done+Number(row.amount||0),fin=totalAfter>=Number(b?.paid_amount||0)-0.001?'refunded':'partially_refunded';await fetch(`${url}/rest/v1/bookings?id=eq.${encodeURIComponent(row.booking_id)}`,{method:'PATCH',headers:sh,body:JSON.stringify({financial_status:fin,...(row.cancel_booking?{status:'cancelled'}:{})})});await fetch(`${url}/rest/v1/activity_events`,{method:'POST',headers:sh,body:JSON.stringify({actor_id:String(session.id||''),actor_name:String(session.name||''),actor_role:String(session.role||''),branch_id:row.branch_id,entity_type:'booking_refund',entity_id:id,action:'refund_completed',metadata:{booking_number:row.booking_number,amount:Number(row.amount||0),receipt_no:row.receipt_no},created_at:completedAt})}).catch(()=>{});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(rb)?rb[0]:rb,financial_status:fin})};
     }
    }
    return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
   }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Staff admin error'})}}
  };
  return module.exports;
}
__mods["staff-admin"]=__load_staff_admin();
function __load_cloud_core(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const crypto = require("crypto");
  
  function hashPassword(password){
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
  }
  function looksHashed(v){ return typeof v==="string" && v.startsWith("scrypt$"); }
  
  exports.handler = async (event) => {
    const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
    const url=(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
    if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:"Server env missing"})};
  
    const auth=String(event.headers.authorization||"");
    const token=auth.startsWith("Bearer ")?auth.slice(7):"";
    if(!token)return{statusCode:401,headers:H,body:JSON.stringify({error:"Unauthorized"})};
  
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json","Content-Type":"application/json"};
  
    try{
      const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:"application/json"}});
      const user=await ur.json().catch(()=>({}));
      if(!ur.ok||!user?.id)return{statusCode:401,headers:H,body:JSON.stringify({error:"Invalid session"})};
  
      const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`,{headers:sh});
      const profiles=await pr.json().catch(()=>[]);
      const prof=Array.isArray(profiles)?profiles[0]:null;
      if(!prof||prof.role!=="developer"||prof.status!=="active"){
        return{statusCode:403,headers:H,body:JSON.stringify({error:"Developer access required"})};
      }
  
      if(event.httpMethod==="GET"){
        const [a,b,c]=await Promise.all([
          fetch(`${url}/rest/v1/system_settings?key=eq.core&select=value&limit=1`,{headers:sh}),
          fetch(`${url}/rest/v1/staff_users?select=id,name,username,phone,role,branch_id,status,permissions,created_at,updated_at&order=created_at.asc`,{headers:sh}),
          fetch(`${url}/rest/v1/staff_notifications_cloud?select=payload&order=created_at.desc&limit=200`,{headers:sh})
        ]);
        const A=await a.json().catch(()=>[]);
        const B=await b.json().catch(()=>[]);
        const C=await c.json().catch(()=>[]);
        if(!a.ok||!b.ok||!c.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:"Cloud core tables are not ready"})};
        return{statusCode:200,headers:H,body:JSON.stringify({
          settings:(A[0]?.value||{}).settings||A[0]?.value||{},
          platform:(A[0]?.value||{}).platform||{},
          users:Array.isArray(B)?B:[],
          notifications:(Array.isArray(C)?C:[]).map(x=>x.payload)
        })};
      }
  
      if(event.httpMethod==="POST"){
        let p={}; try{p=JSON.parse(event.body||"{}")}catch{}
        if(p.action==="change_developer_password"){
          const np=String(p.new_password||"");if(np.length<10)return{statusCode:400,headers:H,body:JSON.stringify({error:"كلمة مرور المطور يجب ألا تقل عن 10 أحرف"})};
          const rr=await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,{method:"PUT",headers:sh,body:JSON.stringify({password:np})});
          const rb=await rr.json().catch(()=>({}));if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.msg||rb?.message||"تعذر تغيير كلمة مرور المطور"})};
          return{statusCode:200,headers:H,body:JSON.stringify({ok:true})};
        }
        const settings=p.settings&&typeof p.settings==="object"?{...p.settings}:{};
        delete settings.developerPassword;delete settings.serviceRoleKey;delete settings.supabaseServiceRoleKey;
        const platform=p.platform&&typeof p.platform==="object"?p.platform:{};
        const users=Array.isArray(p.users)?p.users:[];
        const notifications=Array.isArray(p.notifications)?p.notifications:[];
  
        let r=await fetch(`${url}/rest/v1/system_settings?on_conflict=key`,{
          method:"POST",
          headers:{...sh,Prefer:"resolution=merge-duplicates,return=minimal"},
          body:JSON.stringify([{key:"core",value:{settings,platform},updated_by:user.id,updated_at:new Date().toISOString()}])
        });
        if(!r.ok){
          const e=await r.json().catch(()=>({}));
          return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||"Failed settings save"})};
        }
  
        // Safe upsert: do not delete cloud users, and do not blank an existing password.
        for(const u of users){
          if(!u || !u.username) continue;
          const id=String(u.id||`staff-${Date.now()}-${Math.random().toString(16).slice(2)}`);
          const existingResp=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(id)}&select=id,password&limit=1`,{headers:sh});
          const existingRows=await existingResp.json().catch(()=>[]);
          const exists=Array.isArray(existingRows)&&existingRows.length>0;
  
          const record={
            id,
            name:u.name||"",
            username:u.username||"",
            phone:u.phone||"",
            role:u.role||"موظف",
            branch_id:u.branch_id||null,
            status:u.status||"نشط",
            permissions:u.permissions||{},
            updated_at:new Date().toISOString()
          };
  
          const incomingPassword=String(u.password||"");
          if(incomingPassword){
            record.password=looksHashed(incomingPassword)?incomingPassword:hashPassword(incomingPassword);
          }
  
          if(exists){
            r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(id)}`,{
              method:"PATCH",
              headers:{...sh,Prefer:"return=minimal"},
              body:JSON.stringify(record)
            });
          }else{
            if(!record.password)return{statusCode:400,headers:H,body:JSON.stringify({error:"كلمة مرور الموظف الجديد مطلوبة"})};
            r=await fetch(`${url}/rest/v1/staff_users`,{
              method:"POST",
              headers:{...sh,Prefer:"return=minimal"},
              body:JSON.stringify([record])
            });
          }
          if(!r.ok){
            const e=await r.json().catch(()=>({}));
            return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||`Failed saving user ${u.username}`})};
          }
        }
  
        // Notifications: replace only the operational notification list.
        await fetch(`${url}/rest/v1/staff_notifications_cloud?id=not.is.null`,{method:"DELETE",headers:sh});
        if(notifications.length){
          r=await fetch(`${url}/rest/v1/staff_notifications_cloud`,{
            method:"POST",headers:{...sh,Prefer:"return=minimal"},
            body:JSON.stringify(notifications.map(x=>({payload:x})))
          });
          if(!r.ok){
            const e=await r.json().catch(()=>({}));
            return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||"Failed notifications save"})};
          }
        }
  
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,saved_users:users.length})};
      }
  
      return{statusCode:405,headers:H,body:JSON.stringify({error:"Method not allowed"})};
    }catch(e){
      console.error("cloud-core",e);
      return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||"Cloud sync failed"})};
    }
  };
  return module.exports;
}
__mods["cloud-core"]=__load_cloud_core();

function __load_v9_admin_data(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const {verify}=require('./_staff-session');
  const READ_MAP={
    crm:['leads','service_tickets','tasks'],
    agents:['agents','agent_allocations'],
    suppliers:['suppliers','supplier_contracts','supplier_payables'],
    finance:['approval_requests','cash_registers','cash_shifts'],
    reports:['saved_reports','export_jobs'],
    risk:['incidents','lost_found','checklist_templates','trip_checklist_runs'],
    translation:['translation_entries'],
    backup:['backup_runs','system_snapshots','system_releases','schema_migrations'],
    scanner:['scan_events'],
    seasons:['seasons','programs','trips'],
    trips_ops:['trips','trip_branches','trip_status_events','trip_meeting_points'],
    groups:['travel_groups','booking_passengers'],
    seats:['vehicles','vehicle_seats','trip_vehicles','seat_assignments'],
    fleet:['vehicles','vehicle_seats','trip_vehicles','vehicle_maintenance'],
    housing:['hotels','trip_hotels','hotel_rooms','room_assignments'],
    return_ops:['trip_status_events','trip_meeting_points','notifications'],
    tickets:['bookings','booking_passengers','passenger_qr_tokens','ticket_templates','print_events','translation_entries','trip_vehicles','vehicles','seat_assignments','hotels','trip_hotels','hotel_rooms','room_assignments','trip_meeting_points'],
    customers:['bookings','booking_passengers','travel_groups','passenger_documents'],
    geo:['trip_meeting_points','passenger_meeting_points','trip_status_events'],
    cost_centers:['seasons','programs','trips','branches','expenses'],
    finance_full:['expenses','transactions','approval_requests','cash_registers','cash_shifts','supplier_payables'],
    executive:['bookings','expenses','cash_registers','cash_shifts','saved_reports'],
    permissions:['role_templates','staff_permission_overrides','permission_delegations','user_sessions'],
    shifts:['cash_shifts','tasks','checklist_templates','trip_checklist_runs'],
    printing:['ticket_templates','print_events','saved_reports','export_jobs'],
    system_quality:['system_health_snapshots','error_events','performance_events','feedback_reports','feature_flags'],
    operations:['trip_status_events','trip_meeting_points','passenger_meeting_points','seat_assignments','travel_groups','passenger_documents','hotels','trip_hotels','hotel_rooms','room_assignments','message_templates','notification_rules','notifications','vehicles','vehicle_seats','trip_vehicles','vehicle_maintenance','ticket_templates','print_events'],
    meeting:['trip_meeting_points','passenger_meeting_points'],
    documents:['passenger_documents'],
    notifications:['notifications','notification_rules','message_templates'],
    approvals:['approval_requests'],
    tasks:['tasks'],
    checklists:['checklist_templates','trip_checklist_runs'],
    developer:['feature_flags','system_health_snapshots','error_events','performance_events','feedback_reports','role_templates','permission_delegations','user_sessions','system_settings']
  };
  const WRITE_TABLES=new Set(['leads','service_tickets','tasks','agents','agent_allocations','supplier_contracts','supplier_payables','approval_requests','cash_registers','cash_shifts','saved_reports','export_jobs','incidents','lost_found','checklist_templates','trip_checklist_runs','translation_entries','scan_events','feedback_reports','trip_meeting_points','passenger_documents','notifications','seasons','programs','travel_groups','vehicles','vehicle_seats','trip_vehicles','seat_assignments','hotels','trip_hotels','hotel_rooms','room_assignments','trip_status_events','message_templates','notification_rules','ticket_templates','print_events','role_templates','staff_permission_overrides','permission_delegations','feature_flags','passenger_meeting_points','vehicle_maintenance','system_health_snapshots','backup_runs']);
  const FINANCE_BRANCH_TABLES=new Set(['expenses','cash_registers','supplier_payables','approval_requests','agents','saved_reports','export_jobs']);
  const FINANCE_GLOBAL_TABLES=new Set(['supplier_contracts']);
  function actorAllFinance(a){return !!(a?.role==='مدير عام'||a?.role==='developer'||a?.permissions?.all||a?.permissions?.allBranchesFinance)}
  async function applyFinanceScope(url,sh,out,actor){
    if(actorAllFinance(actor))return out;
    if(!actor?.branch_id){
      for(const t of FINANCE_BRANCH_TABLES){if(Array.isArray(out[t]))out[t]=[]}
      if(Array.isArray(out.bookings))out.bookings=[];if(Array.isArray(out.transactions))out.transactions=[];if(Array.isArray(out.cash_shifts))out.cash_shifts=[];if(Array.isArray(out.agent_allocations))out.agent_allocations=[];if(Array.isArray(out.supplier_contracts))out.supplier_contracts=[];
      return out;
    }
    const bid=String(actor.branch_id);
    for(const t of FINANCE_BRANCH_TABLES){if(Array.isArray(out[t]))out[t]=out[t].filter(x=>String(x.branch_id||'')===bid)}
    if(Array.isArray(out.bookings))out.bookings=out.bookings.filter(x=>String(x.branch_id||'')===bid);
    if(Array.isArray(out.supplier_contracts))out.supplier_contracts=[];
    let regs=Array.isArray(out.cash_registers)?out.cash_registers:null;
    if(!regs&&Array.isArray(out.cash_shifts)){
      const rr=await fetch(`${url}/rest/v1/cash_registers?select=id,branch_id&branch_id=eq.${encodeURIComponent(bid)}&limit=1000`,{headers:sh});const rb=await rr.json().catch(()=>[]);regs=rr.ok&&Array.isArray(rb)?rb:[];
    }
    const regIds=new Set((regs||[]).map(x=>String(x.id)));
    if(Array.isArray(out.cash_shifts))out.cash_shifts=out.cash_shifts.filter(x=>regIds.has(String(x.register_id)));
    const shiftIds=new Set((out.cash_shifts||[]).map(x=>String(x.id)));
    if(Array.isArray(out.transactions))out.transactions=out.transactions.filter(x=>x.branch_id?String(x.branch_id)===bid:(x.cash_shift_id?shiftIds.has(String(x.cash_shift_id)):false));
    const agentIds=new Set((out.agents||[]).map(x=>String(x.id)));
    if(Array.isArray(out.agent_allocations))out.agent_allocations=out.agent_allocations.filter(x=>agentIds.has(String(x.agent_id)));
    return out;
  }
  async function enforceFinanceWrite(url,sh,actor,table,row,id=null){
    if(actorAllFinance(actor))return {ok:true,row};
    if(!actor?.branch_id)return {ok:false,error:'حسابك غير مرتبط بفرع، ولا يمكن تنفيذ كتابة مالية أو فرعية.'};
    const bid=String(actor.branch_id);
    if(FINANCE_GLOBAL_TABLES.has(table))return {ok:false,error:'العقود المالية العامة متاحة فقط لمن لديه صلاحية مالية على كل الفروع'};
    if(FINANCE_BRANCH_TABLES.has(table)){
      if(row.branch_id&&String(row.branch_id)!==bid)return {ok:false,error:'لا يمكن الكتابة في مالية فرع آخر'};
      row.branch_id=actor.branch_id;
      if(id){
        const rr=await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,branch_id&limit=1`,{headers:sh});const rb=await rr.json().catch(()=>[]);const old=Array.isArray(rb)?rb[0]:null;
        if(!rr.ok||!old||String(old.branch_id||'')!==bid)return {ok:false,error:'السجل المالي خارج فرعك'};
      }
    }
    if(table==='cash_shifts'){
      const registerId=row.register_id||null;let rid=registerId;
      if(!rid&&id){const rr=await fetch(`${url}/rest/v1/cash_shifts?id=eq.${encodeURIComponent(id)}&select=register_id&limit=1`,{headers:sh});const rb=await rr.json().catch(()=>[]);rid=Array.isArray(rb)?rb[0]?.register_id:null}
      if(!rid)return {ok:false,error:'الخزنة مطلوبة'};
      const cr=await fetch(`${url}/rest/v1/cash_registers?id=eq.${encodeURIComponent(rid)}&select=branch_id&limit=1`,{headers:sh});const cb=await cr.json().catch(()=>[]);const reg=Array.isArray(cb)?cb[0]:null;
      if(!cr.ok||!reg||String(reg.branch_id||'')!==bid)return {ok:false,error:'الوردية مرتبطة بخزنة فرع آخر'};
    }
    if(table==='agent_allocations'){
      let aid=row.agent_id||null;
      if(!aid&&id){const rr=await fetch(`${url}/rest/v1/agent_allocations?id=eq.${encodeURIComponent(id)}&select=agent_id&limit=1`,{headers:sh});const rb=await rr.json().catch(()=>[]);aid=Array.isArray(rb)?rb[0]?.agent_id:null}
      if(aid){const ar=await fetch(`${url}/rest/v1/agents?id=eq.${encodeURIComponent(aid)}&select=branch_id&limit=1`,{headers:sh});const ab=await ar.json().catch(()=>[]);const ag=Array.isArray(ab)?ab[0]:null;if(!ar.ok||!ag||String(ag.branch_id||'')!==bid)return {ok:false,error:'الوكيل المالي تابع لفرع آخر'}}
    }
    return {ok:true,row};
  }
  async function authorize(url,key,token){
    const staff=verify(token,key);
    if(staff){
      let live=staff;
      try{const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};const sr=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(staff.id||'')}&select=id,name,role,branch_id,status,permissions&limit=1`,{headers:sh});const sb=await sr.json().catch(()=>[]);const u=sr.ok&&Array.isArray(sb)?sb[0]:null;if(u&&String(u.status||'نشط')!=='موقوف')live={...staff,id:u.id,name:u.name||staff.name,role:u.role||staff.role,branch_id:u.branch_id||null,permissions:u.permissions||{}}}catch(_e){}
      const ok=live.role==='مدير عام'||live.role==='developer'||live.permissions?.all||live.permissions?.v9Admin||live.next_bridge===true;
      if(ok)return {kind:'staff',id:live.id||'',name:live.name||live.username||'staff',role:live.role,branch_id:live.branch_id||null,permissions:live.permissions||{}};
      return null;
    }
    try{
      const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});
      const u=await ur.json().catch(()=>({}));if(!ur.ok||!u?.id)return null;
      const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
      const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=id,full_name,role,status&limit=1`,{headers:sh});
      const rows=await pr.json().catch(()=>[]);const p=Array.isArray(rows)?rows[0]:null;
      if(p&&p.role==='developer'&&p.status==='active')return {kind:'developer',id:p.id,name:p.full_name||u.email||'developer',role:p.role,branch_id:null};
    }catch{}
    return null;
  }
  async function fetchRows(url,sh,table,limit=200){
    const order=['leads','service_tickets','tasks','agents','supplier_contracts','supplier_payables','approval_requests','cash_registers','cash_shifts','saved_reports','export_jobs','incidents','lost_found','translation_entries','backup_runs','system_snapshots','system_releases'].includes(table)?'&order=created_at.desc':table==='scan_events'?'&order=scanned_at.desc':'';
    let r=await fetch(`${url}/rest/v1/${table}?select=*&limit=${limit}${order}`,{headers:sh});
    if(!r.ok&&order)r=await fetch(`${url}/rest/v1/${table}?select=*&limit=${limit}`,{headers:sh});
    const b=await r.json().catch(()=>[]);if(!r.ok)throw new Error(b?.message||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[];
  }
  async function safeFetchRows(url,sh,table,limit=200){try{return {rows:await fetchRows(url,sh,table,limit),missing:false}}catch(e){const msg=String(e?.message||e);if(/schema cache|Could not find the table|relation .* does not exist|PGRST205/i.test(msg))return {rows:[],missing:true,error:msg};return {rows:[],missing:false,error:msg}}}
  exports.handler=async(event)=>{
    const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server Supabase environment variables are missing'})};
    const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';const actor=await authorize(url,key,token);
    if(!actor)return{statusCode:403,headers:H,body:JSON.stringify({error:'مركز V9 متاح للمطور أو المدير العام فقط'})};
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
    try{
      if(event.httpMethod==='GET'){
        const resource=String(event.queryStringParameters?.resource||'overview');
        if(resource==='overview'){
          const all=['leads','service_tickets','tasks','agents','supplier_contracts','supplier_payables','incidents','lost_found'];const counts={};
          await Promise.all(all.map(async t=>{const r=await fetch(`${url}/rest/v1/${t}?select=id&limit=1000`,{headers:sh});const b=await r.json().catch(()=>[]);counts[t]=r.ok&&Array.isArray(b)?b.length:0}));
          return{statusCode:200,headers:H,body:JSON.stringify({ok:true,build:'9.6.0-cloud-shared-route-stability',actor:{name:actor.name,role:actor.role},counts})};
        }

        if(resource==='manifest'){
          return{statusCode:200,headers:H,body:JSON.stringify({
            ok:true,
            build:'9.6.0-cloud-shared-route-stability',
            resources:Object.keys(READ_MAP).sort()
          })};
        }
        const tables=READ_MAP[resource];if(!tables)return{statusCode:400,headers:H,body:JSON.stringify({error:'مورد V9 غير معروف',resource,known_resources:Object.keys(READ_MAP).sort()})};
        const out={_missing_tables:[],_errors:{}};await Promise.all(tables.map(async t=>{const x=await safeFetchRows(url,sh,t);out[t]=x.rows;if(x.missing)out._missing_tables.push(t);else if(x.error)out._errors[t]=x.error;}));
        await applyFinanceScope(url,sh,out,actor);
        return{statusCode:200,headers:H,body:JSON.stringify(out)};
      }
      if(event.httpMethod==='POST'){
        let p={};try{p=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid JSON'})}};

        if(p.action==='scan'){
          const raw=String(p.code||'').trim();const mode=String(p.scan_mode||'verify');
          const allowedModes=new Set(['outbound_boarding','outbound_arrival','housing_checkin','return_boarding','return_arrival','verify']);
          if(!raw||!allowedModes.has(mode))return{statusCode:400,headers:H,body:JSON.stringify({error:'رمز أو وضع مسح غير صالح'})};
          let bookingNo='';const m=raw.match(/BOOKING=([^|&\s]+)/i);if(m)bookingNo=decodeURIComponent(m[1]);
          if(!bookingNo&&/^\d{5,20}$/.test(raw))bookingNo=raw;
          if(!bookingNo){const m2=raw.match(/(?:booking|reservation)[=:/#-]*([A-Za-z0-9_-]{5,30})/i);if(m2)bookingNo=m2[1]}
          if(!bookingNo)return{statusCode:400,headers:H,body:JSON.stringify({error:'تعذر استخراج رقم الحجز من الرمز'})};
          const br=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=*&limit=1`,{headers:sh});const ba=await br.json().catch(()=>[]);const booking=Array.isArray(ba)?ba[0]:null;
          if(!br.ok||!booking)return{statusCode:404,headers:H,body:JSON.stringify({error:'الحجز غير موجود'})};
          if(p.trip_id&&booking.trip_id&&String(p.trip_id)!==String(booking.trip_id))return{statusCode:409,headers:H,body:JSON.stringify({error:'الحجز تابع لرحلة مختلفة'})};
          const pr=await fetch(`${url}/rest/v1/booking_passengers?booking_id=eq.${encodeURIComponent(booking.id)}&select=*&order=passenger_order.asc&limit=20`,{headers:sh});const passengers=await pr.json().catch(()=>[]);const passenger=Array.isArray(passengers)&&passengers.length===1?passengers[0]:null;
          let prev=null;
          let du=await fetch(`${url}/rest/v1/scan_events?booking_id=eq.${encodeURIComponent(booking.id)}&scan_mode=eq.${encodeURIComponent(mode)}&result=eq.success&select=id,scanned_at,scanned_by,result,metadata&order=scanned_at.desc&limit=1`,{headers:sh});
          let da=await du.json().catch(()=>[]);
          if(du.ok)prev=Array.isArray(da)?da[0]:null;
          else if(String(da?.message||'').includes("'result' column")){
            // Backward compatibility with older scan_events schema: use metadata.scan_result until SQL migration is applied.
            du=await fetch(`${url}/rest/v1/scan_events?booking_id=eq.${encodeURIComponent(booking.id)}&scan_mode=eq.${encodeURIComponent(mode)}&select=id,scanned_at,scanned_by,metadata&order=scanned_at.desc&limit=20`,{headers:sh});
            da=await du.json().catch(()=>[]);
            prev=(Array.isArray(da)?da:[]).find(x=>(x?.metadata?.scan_result||'success')==='success')||null;
          }
          async function insertScanCompat(scanResult,previousId=null,prefer='return=representation'){
            const metadata={booking_number:bookingNo,raw_code:raw.slice(0,180),device_id:String(p.device_id||''),scan_result:scanResult,scan_mode:mode,...(previousId?{previous_scan_id:previousId}:{})};
            const full={booking_id:booking.id,passenger_id:passenger?.id||null,trip_id:booking.trip_id||null,scan_mode:mode,result:scanResult,scanned_by:actor.name,metadata};
            let rr=await fetch(`${url}/rest/v1/scan_events`,{method:'POST',headers:{...sh,Prefer:prefer},body:JSON.stringify([full])});
            let rb=await rr.json().catch(()=>[]);
            if(!rr.ok&&String(rb?.message||'').includes("'result' column")){
              const legacy={...full};delete legacy.result;
              rr=await fetch(`${url}/rest/v1/scan_events`,{method:'POST',headers:{...sh,Prefer:prefer},body:JSON.stringify([legacy])});
              rb=await rr.json().catch(()=>[]);
            }
            return{response:rr,body:rb};
          }
          if(prev){
            await insertScanCompat('duplicate',prev.id,'return=minimal');
            return{statusCode:200,headers:H,body:JSON.stringify({ok:true,result:'duplicate',previous_at:prev.scanned_at,previous_by:prev.scanned_by,booking,passenger})};
          }
          const savedScan=await insertScanCompat('success',null,'return=representation');
          if(!savedScan.response.ok)return{statusCode:400,headers:H,body:JSON.stringify({error:savedScan.body?.message||'تعذر تسجيل عملية المسح'})};
          return{statusCode:200,headers:H,body:JSON.stringify({ok:true,result:'success',booking,passenger,scan:Array.isArray(savedScan.body)?savedScan.body[0]:savedScan.body})};
        }


        // ===== V9.7.0 Functional Completion =====
        async function v970EnsureBucket(bucket){
          const bh={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
          let g=await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`,{headers:bh});
          if(g.ok)return true;
          const c=await fetch(`${url}/storage/v1/bucket`,{method:'POST',headers:bh,body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:6291456})});
          if(c.ok||c.status===409)return true;
          const cb=await c.json().catch(()=>({}));throw new Error(cb?.message||'تعذر تجهيز مساحة التخزين');
        }
        function v970Bytes(base64){const clean=String(base64||'').replace(/^data:[^,]+,/, '');const bin=atob(clean);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
        async function v970Upload(bucket,path,bytes,mime){
          await v970EnsureBucket(bucket);
          const r=await fetch(`${url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':mime||'application/octet-stream','x-upsert':'true'},body:bytes});
          if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b?.message||'فشل رفع الملف')}
          return `${bucket}/${path}`;
        }
        async function v970Signed(bucket,path,expiresIn=600){
          const r=await fetch(`${url}/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn})});
          const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.message||'تعذر إنشاء رابط مؤقت');
          const signed=b.signedURL||b.signedUrl||b.signed_url||'';return signed?(signed.startsWith('http')?signed:`${url}/storage/v1${signed}`):'';
        }
        function v970Csv(rows){const a=Array.isArray(rows)?rows:[];if(!a.length)return '\ufeff';const keys=[...new Set(a.flatMap(x=>Object.keys(x||{})).filter(k=>!['password','password_hash','security_meta'].includes(k)))];const esc=v=>'"'+String(v??'').replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';return '\ufeff'+keys.map(esc).join(',')+'\n'+a.map(x=>keys.map(k=>esc(typeof x?.[k]==='object'?JSON.stringify(x[k]):x?.[k])).join(',')).join('\n')}

        if(p.action==='upload_passenger_document'){
          const passengerId=String(p.passenger_id||''),name=String(p.file_name||'document').replace(/[^A-Za-z0-9._-]/g,'_'),mime=String(p.mime_type||'application/octet-stream');
          if(!passengerId||!p.base64)return{statusCode:400,headers:H,body:JSON.stringify({error:'المسافر والملف مطلوبان'})};
          const bytes=v970Bytes(p.base64);if(bytes.length>6*1024*1024)return{statusCode:413,headers:H,body:JSON.stringify({error:'الحد الأقصى للملف 6MB'})};
          const path=`passengers/${encodeURIComponent(passengerId)}/${Date.now()}-${name}`;await v970Upload('almaher-documents',path,bytes,mime);
          const rec={passenger_id:passengerId,document_type:String(p.document_type||'other'),document_number:p.document_number||null,status:'uploaded',storage_path:path,metadata:{original_name:p.file_name||name,mime_type:mime,size:bytes.length,uploaded_by:actor.name||actor.id}};
          const rr=await fetch(`${url}/rest/v1/passenger_documents`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:400,headers:H,body:JSON.stringify({error:rb?.message||'تم رفع الملف وتعذر تسجيل بياناته'})};
          return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(rb)?rb[0]:rb})};
        }
        if(p.action==='document_signed_url'){
          const path=String(p.storage_path||'');if(!path)return{statusCode:400,headers:H,body:JSON.stringify({error:'مسار الملف مطلوب'})};
          const signed_url=await v970Signed('almaher-documents',path,Number(p.expires_in||600));return{statusCode:200,headers:H,body:JSON.stringify({ok:true,signed_url})};
        }
        if(p.action==='process_export'){
          const id=String(p.id||'');if(!id)return{statusCode:400,headers:H,body:JSON.stringify({error:'رقم طلب التصدير مطلوب'})};
          const jr=await fetch(`${url}/rest/v1/export_jobs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,{headers:sh});const jb=await jr.json().catch(()=>[]);const job=Array.isArray(jb)?jb[0]:null;if(!jr.ok||!job)return{statusCode:404,headers:H,body:JSON.stringify({error:'طلب التصدير غير موجود'})};
          if(!actorAllFinance(actor)&&actor.branch_id&&String(job.branch_id||'')!==String(actor.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'طلب التصدير خارج فرعك'})};
          const type=String(job.export_type||'bookings_csv');let table='bookings',format='csv';if(type.startsWith('finance'))table='expenses';else if(type.startsWith('passengers'))table='booking_passengers';else if(type.startsWith('operations')){table='trips';format='json'};
          let qs='select=*&limit=5000';if(!actorAllFinance(actor)&&actor.branch_id&&['bookings','expenses'].includes(table))qs+=`&branch_id=eq.${encodeURIComponent(actor.branch_id)}`;
          const dr=await fetch(`${url}/rest/v1/${table}?${qs}`,{headers:sh});const db=await dr.json().catch(()=>[]);if(!dr.ok)throw new Error(db?.message||'تعذر جمع بيانات التصدير');
          const content=format==='json'?JSON.stringify(db,null,2):v970Csv(db);const ext=format==='json'?'json':'csv',mime=format==='json'?'application/json; charset=utf-8':'text/csv; charset=utf-8';const path=`exports/${Date.now()}-${id}.${ext}`;
          await v970Upload('almaher-exports',path,new TextEncoder().encode(content),mime);
          await fetch(`${url}/rest/v1/export_jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify({status:'completed',storage_path:path,completed_at:new Date().toISOString()})});
          const signed_url=await v970Signed('almaher-exports',path,900);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,storage_path:path,signed_url,rows:Array.isArray(db)?db.length:0})};
        }
        if(p.action==='export_signed_url'){
          const path=String(p.storage_path||'');if(!path)return{statusCode:400,headers:H,body:JSON.stringify({error:'مسار التصدير مطلوب'})};const signed_url=await v970Signed('almaher-exports',path,900);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,signed_url})};
        }
        if(p.action==='run_health_check'){
          const started=Date.now();const components=[];for(const table of ['bookings','trips','staff_users','system_releases']){const r=await fetch(`${url}/rest/v1/${table}?select=id&limit=1`,{headers:sh});components.push({component:table,status:r.ok?'ok':'error',latency_ms:Date.now()-started,details:{http_status:r.status,build:'9.7.0'}})}
          await fetch(`${url}/rest/v1/system_health_snapshots`,{method:'POST',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify(components)});
          return{statusCode:200,headers:H,body:JSON.stringify({ok:components.every(x=>x.status==='ok'),components})};
        }
        if(p.action==='create_operational_snapshot'){
          if(!(actor.role==='مدير عام'||actor.role==='developer'||actor.permissions?.all))return{statusCode:403,headers:H,body:JSON.stringify({error:'اللقطة التشغيلية متاحة للمدير العام/المطور فقط'})};
          const tables=['branches','trips','trip_branches','bookings','booking_passengers','system_settings','feature_flags'];const snapshot={created_at:new Date().toISOString(),created_by:actor.name||actor.id,build:'9.7.0',tables:{}};
          for(const t of tables){const r=await fetch(`${url}/rest/v1/${t}?select=*&limit=10000`,{headers:sh});snapshot.tables[t]=r.ok?await r.json().catch(()=>[]):{error:r.status}}
          const txt=JSON.stringify(snapshot);const path=`snapshots/${new Date().toISOString().replace(/[:.]/g,'-')}.json`;await v970Upload('almaher-backups',path,new TextEncoder().encode(txt),'application/json; charset=utf-8');
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(txt));const checksum=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
          const rec={backup_type:'operational_snapshot',status:'completed',storage_path:path,checksum,restore_tested:false,initiated_by:actor.name||actor.id,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),details:{tables,records:Object.fromEntries(Object.entries(snapshot.tables).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),note:'Operational JSON snapshot; not a PostgreSQL platform backup'}};
          const rr=await fetch(`${url}/rest/v1/backup_runs`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const rb=await rr.json().catch(()=>[]);if(!rr.ok)throw new Error(rb?.message||'تعذر تسجيل اللقطة');const signed_url=await v970Signed('almaher-backups',path,900);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(rb)?rb[0]:rb,signed_url})};
        }

        if(!['insert','update'].includes(p.action))return{statusCode:400,headers:H,body:JSON.stringify({error:'Unsupported V9 action'})};
        const table=String(p.table||'');if(!WRITE_TABLES.has(table))return{statusCode:403,headers:H,body:JSON.stringify({error:'هذا الجدول غير مسموح بالكتابة عليه من مركز V9'})};
        const row=p.row&&typeof p.row==='object'&&!Array.isArray(p.row)?{...p.row}:{};
        if(p.action==='update'){const id=String(p.id||'');if(!id)return{statusCode:400,headers:H,body:JSON.stringify({error:'Missing id'})};delete row.id;delete row.created_at;const guard=await enforceFinanceWrite(url,sh,actor,table,row,id);if(!guard.ok)return{statusCode:403,headers:H,body:JSON.stringify({error:guard.error})};let ur=await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(guard.row)});let ub=await ur.json().catch(()=>[]);if(!ur.ok)return{statusCode:400,headers:H,body:JSON.stringify({error:ub?.message||`تعذر تحديث ${table}`})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(ub)?ub[0]:ub})};}
        delete row.id;delete row.created_at;delete row.updated_at;const guard=await enforceFinanceWrite(url,sh,actor,table,row,null);if(!guard.ok)return{statusCode:403,headers:H,body:JSON.stringify({error:guard.error})};
        if(['leads','agents','supplier_contracts','supplier_payables','approval_requests','cash_registers','saved_reports','export_jobs','incidents','lost_found','checklist_templates','trip_checklist_runs','translation_entries'].includes(table)&&row.created_by===undefined)row.created_by=actor.name;
        let r=await fetch(`${url}/rest/v1/${table}`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([row])});let b=await r.json().catch(()=>[]);
        if(!r.ok&&String(b?.message||'').includes('created_by')){delete row.created_by;r=await fetch(`${url}/rest/v1/${table}`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([row])});b=await r.json().catch(()=>[]);}
        if(!r.ok)return{statusCode:400,headers:H,body:JSON.stringify({error:b?.message||b?.details||`تعذر الحفظ في ${table}`})};
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(b)?b[0]:b})};
      }
      return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
    }catch(e){console.error('v9-admin-data',e);return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'V9 bridge failed'})};}
  };
  return module.exports;
}
__mods["v9-admin-data"]=__load_v9_admin_data();


function __load_legacy_state(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const {verify}=require('./_staff-session');
  const ALLOWED=new Set(['drivers','housingPlans','branchChangeRequests','termsData','logs','tripExtras']);
  async function actorFromToken(url,key,token){
    const staff=verify(token,key);if(staff)return{id:staff.id||staff.username||'staff',kind:'staff',session:staff};
    try{
      const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});const user=await ur.json().catch(()=>({}));if(!ur.ok||!user?.id)return null;
      const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}});const rows=await pr.json().catch(()=>[]);const p=Array.isArray(rows)?rows[0]:null;if(p?.role==='developer'&&p?.status==='active')return{id:user.id,kind:'developer',session:null};
    }catch{}
    return null;
  }
  function sanitize(section,value){
    if(section==='logs')return Array.isArray(value)?value.slice(-1000):[];
    if(section==='drivers'||section==='branchChangeRequests')return Array.isArray(value)?value:[];
    if(section==='housingPlans'||section==='tripExtras')return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    if(section==='termsData')return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return value;
  }
  exports.handler=async(event)=>{
    const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
    const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!token)return{statusCode:401,headers:H,body:JSON.stringify({error:'Unauthorized'})};
    const actor=await actorFromToken(url,key,token);if(!actor)return{statusCode:401,headers:H,body:JSON.stringify({error:'Invalid session'})};
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
    try{
      const read=async()=>{const r=await fetch(`${url}/rest/v1/system_settings?key=eq.legacy_ops_v928&select=value,updated_at&limit=1`,{headers:sh});const rows=await r.json().catch(()=>[]);if(!r.ok)throw new Error(rows?.message||'Legacy state read failed');const row=Array.isArray(rows)?rows[0]:null;return{state:row?.value?.state||row?.value||{},updated_at:row?.updated_at||null}};
      if(event.httpMethod==='GET'){const x=await read();return{statusCode:200,headers:H,body:JSON.stringify(x)}}
      if(event.httpMethod!=='POST')return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
      let p={};try{p=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid JSON'})}}
      const cur=await read();let state=cur.state&&typeof cur.state==='object'?cur.state:{};
      if(p.section){const section=String(p.section);if(!ALLOWED.has(section))return{statusCode:400,headers:H,body:JSON.stringify({error:'Unsupported state section'})};state={...state,[section]:sanitize(section,p.value)}}
      else if(p.state&&typeof p.state==='object'){const next={...state};for(const [section,value] of Object.entries(p.state)){if(ALLOWED.has(section))next[section]=sanitize(section,value)}state=next}
      else return{statusCode:400,headers:H,body:JSON.stringify({error:'section or state is required'})};
      const now=new Date().toISOString();const actorId=String(actor.id||'');const actorUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId)?actorId:null;const body=[{key:'legacy_ops_v928',value:{state,_meta:{updated_at:now,updated_by:actorId,actor_kind:actor.kind}},updated_by:actorUuid,updated_at:now}];
      const r=await fetch(`${url}/rest/v1/system_settings?on_conflict=key`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(body)});if(!r.ok){const e=await r.json().catch(()=>({}));return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||'Legacy state save failed'})};}
      return{statusCode:200,headers:H,body:JSON.stringify({ok:true,state,updated_at:now})};
    }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Legacy state service failed'})}}
  };
  return module.exports;
}
__mods["legacy-state"]=__load_legacy_state();

function __load_system_release(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  async function developerFromToken(url,key,token){
    if(!token)return null;
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
    const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});
    const user=await ur.json().catch(()=>({}));
    if(!ur.ok||!user?.id)return null;
    const dr=await fetch(`${url}/rest/v1/developer_users?auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,name,email&limit=1`,{headers:sh});
    const drows=await dr.json().catch(()=>[]);if(dr.ok&&Array.isArray(drows)&&drows[0])return user;
    const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status&limit=1`,{headers:sh});
    const rows=await pr.json().catch(()=>[]); const p=Array.isArray(rows)?rows[0]:null;
    return p&&p.role==='developer'&&p.status==='active'?user:null;
  }
  exports.handler=async(event)=>{
    const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
    const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
    try{
      if(event.httpMethod==='GET'){
        const channel=(event.queryStringParameters?.channel||'stable').replace(/[^a-z]/gi,'');
        const r=await fetch(`${url}/rest/v1/system_releases?channel=eq.${encodeURIComponent(channel)}&active=eq.true&select=version,channel,notes,content,created_at&order=created_at.desc&limit=1`,{headers:sh});
        const rows=await r.json().catch(()=>[]); if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rows?.message||'Release lookup failed'})};
        const row=Array.isArray(rows)?rows[0]:null; return{statusCode:200,headers:H,body:JSON.stringify(row||{})};
      }
      if(event.httpMethod==='POST'){
        const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';
        const dev=await developerFromToken(url,key,token);if(!dev)return{statusCode:403,headers:H,body:JSON.stringify({error:'Developer access required'})};
        let p={};try{p=JSON.parse(event.body||'{}')}catch{}
        const version=String(p.version||'').trim(),channel=['stable','test'].includes(p.channel)?p.channel:'test',content=String(p.content||'');
        if(!/^\d+(\.\d+){1,3}([\w.-]+)?$/.test(version))return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid version'})};
        if(content.length<5000||content.length>1500000||!content.toLowerCase().includes('<html'))return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid HTML release file'})};
        if(p.activate){await fetch(`${url}/rest/v1/system_releases?channel=eq.${encodeURIComponent(channel)}&active=eq.true`,{method:'PATCH',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify({active:false})});}
        const r=await fetch(`${url}/rest/v1/system_releases?on_conflict=version,channel`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify([{version,channel,notes:String(p.notes||''),content,active:!!p.activate,created_by:dev.id,created_at:new Date().toISOString()}])});
        const rows=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rows?.message||'Release save failed'})};
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,version,channel,active:!!p.activate})};
      }
      return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
    }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Release service failed'})};}
  };
  return module.exports;
}
__mods["system-release"]=__load_system_release();

function __load_customer_auth(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
  const cleanEmail=v=>String(v||'').trim().toLowerCase();
  const authHeaders=key=>({apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'});
  async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return{message:t}}}
  async function userFromToken(url,key,token){
    if(!token)return null;const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});if(!r.ok)return null;const u=await r.json().catch(()=>null);return u?.id?u:null;
  }
  async function signIn(url,key,email,password){
    const r=await fetch(`${url}/auth/v1/token?grant_type=password`,{method:'POST',headers:authHeaders(key),body:JSON.stringify({email,password})});const b=await readJson(r);if(!r.ok){const e=new Error(b?.msg||b?.message||b?.error_description||'بيانات الدخول غير صحيحة');e.status=401;throw e}return b;
  }
  async function stateRead(url,key,userId){
    const sk='customer_state_'+userId;const h=authHeaders(key);const r=await fetch(`${url}/rest/v1/system_settings?key=eq.${encodeURIComponent(sk)}&select=value,updated_at&limit=1`,{headers:h});const rows=await r.json().catch(()=>[]);if(!r.ok)throw new Error(rows?.message||'تعذر تحميل بيانات العميل');const row=Array.isArray(rows)?rows[0]:null;const v=row?.value||{};return{savedTravelers:Array.isArray(v.savedTravelers)?v.savedTravelers:[],updated_at:row?.updated_at||null};
  }
  exports.handler=async(event)=>{
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'إعدادات Supabase على الخادم غير مكتملة'})};
    const action=String(event.queryStringParameters?.action||'').trim();let p={};if(event.httpMethod!=='GET'){try{p=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid JSON'})}}}
    try{
      if(event.httpMethod==='POST'&&action==='register'){
        const email=cleanEmail(p.email),password=String(p.password||'');if(!email||password.length<6)return{statusCode:400,headers:H,body:JSON.stringify({error:'البريد مطلوب وكلمة المرور 6 أحرف على الأقل'})};
        const r=await fetch(`${url}/auth/v1/admin/users`,{method:'POST',headers:authHeaders(key),body:JSON.stringify({email,password,email_confirm:true,user_metadata:{app_role:'customer'}})});const b=await readJson(r);
        if(!r.ok){const msg=String(b?.msg||b?.message||'');if(/already|registered|exists/i.test(msg))return{statusCode:409,headers:H,body:JSON.stringify({error:'الحساب موجود بالفعل. استخدم تسجيل الدخول.'})};throw new Error(msg||'تعذر إنشاء حساب العميل')}
        const session=await signIn(url,key,email,password);return{statusCode:200,headers:H,body:JSON.stringify(session)};
      }
      if(event.httpMethod==='POST'&&action==='login'){
        const email=cleanEmail(p.email),password=String(p.password||'');if(!email||!password)return{statusCode:400,headers:H,body:JSON.stringify({error:'أدخل البريد وكلمة المرور'})};const session=await signIn(url,key,email,password);return{statusCode:200,headers:H,body:JSON.stringify(session)};
      }
      if(event.httpMethod==='POST'&&action==='refresh'){
        const refresh_token=String(p.refresh_token||'');if(!refresh_token)return{statusCode:400,headers:H,body:JSON.stringify({error:'Refresh token missing'})};const r=await fetch(`${url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:authHeaders(key),body:JSON.stringify({refresh_token})});const b=await readJson(r);if(!r.ok)return{statusCode:401,headers:H,body:JSON.stringify({error:b?.msg||b?.message||'انتهت جلسة العميل'})};return{statusCode:200,headers:H,body:JSON.stringify(b)};
      }
      const auth=String(event.headers.authorization||event.headers.Authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';const user=await userFromToken(url,key,token);if(!user)return{statusCode:401,headers:H,body:JSON.stringify({error:'جلسة العميل غير صالحة'})};
      if(event.httpMethod==='GET'&&action==='state'){const st=await stateRead(url,key,user.id);return{statusCode:200,headers:H,body:JSON.stringify({...st,user:{id:user.id,email:user.email||''}})}}
      if(event.httpMethod==='POST'&&action==='state'){
        const arr=Array.isArray(p.savedTravelers)?p.savedTravelers:[];const safe=arr.slice(0,100).map(x=>({id:String(x.id||''),ownerId:String(user.id),name:String(x.name||'').slice(0,200),gender:String(x.gender||'').slice(0,30),nationality:String(x.nationality||'').slice(0,100),identity:String(x.identity||'').slice(0,120),phone:String(x.phone||'').slice(0,50),relation:String(x.relation||'').slice(0,100)}));const now=new Date().toISOString();const sk='customer_state_'+user.id;
        const r=await fetch(`${url}/rest/v1/system_settings?on_conflict=key`,{method:'POST',headers:{...authHeaders(key),Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([{key:sk,value:{savedTravelers:safe,_meta:{updated_at:now,owner_id:user.id}},updated_by:null,updated_at:now}])});if(!r.ok){const b=await readJson(r);throw new Error(b?.message||'تعذر حفظ بيانات العميل')};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,savedTravelers:safe})};
      }
      if(event.httpMethod==='POST'&&action==='claim-bookings'){
        const claims=Array.isArray(p.claims)?p.claims.slice(0,100):[];let claimed=0,skipped=0;const norm=v=>String(v||'').replace(/\s+/g,'').replace(/^\+?966/,'0');
        for(const c of claims){const no=String(c.booking_number||'').trim(),ver=String(c.verification||'').trim();if(!no||!ver){skipped++;continue}const qr=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(no)}&select=id,snapshot,customer_phone,customer_identity&limit=1`,{headers:authHeaders(key)});const rows=await qr.json().catch(()=>[]);const b=Array.isArray(rows)?rows[0]:null;if(!qr.ok||!b){skipped++;continue}const verified=(norm(ver)&&norm(ver)===norm(b.customer_phone))||String(ver)===String(b.customer_identity||'');if(!verified){skipped++;continue}const snapshot=b.snapshot&&typeof b.snapshot==='object'?{...b.snapshot}:{};snapshot.customerAccountId=String(user.id);const ur=await fetch(`${url}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}`,{method:'PATCH',headers:{...authHeaders(key),Prefer:'return=minimal'},body:JSON.stringify({snapshot})});if(ur.ok)claimed++;else skipped++}
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,claimed,skipped})};
      }
      if(event.httpMethod==='GET'&&action==='bookings'){
        const q=`${url}/rest/v1/bookings?select=*&snapshot-%3E%3EcustomerAccountId=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`;const r=await fetch(q,{headers:authHeaders(key)});const rows=await r.json().catch(()=>[]);if(!r.ok)throw new Error(rows?.message||'تعذر تحميل حجوزات العميل');const bookings=(Array.isArray(rows)?rows:[]).map(b=>{const s=b.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};return{...s,id:s.id||b.booking_number,number:b.booking_number,bookingNo:b.booking_number,tripId:b.trip_id,returnTripId:b.return_trip_id,branchId:b.branch_id,name:b.customer_name,gender:b.customer_gender,nationality:b.customer_nationality,phone:b.customer_phone,identity:b.customer_identity,travelers:b.travelers,journeyMode:b.journey_mode,accommodationType:b.accommodation_type,accommodationLabel:b.accommodation_label,totalPrice:Number(b.total_price||0),paidAmount:Number(b.paid_amount||0),status:b.status,createdAt:b.created_at,customerAccountId:user.id,cloudSynced:true,cloudBookingId:b.id}});return{statusCode:200,headers:H,body:JSON.stringify({bookings})};
      }
      return{statusCode:405,headers:H,body:JSON.stringify({error:'Method/action not allowed'})};
    }catch(e){console.error('customer-auth',e);return{statusCode:Number(e.status||502),headers:H,body:JSON.stringify({error:e.message||'Customer auth service failed'})};}
  };
  return module.exports;
}
__mods["customer-auth"]=__load_customer_auth();


// ============================================================================
// AL-MAHER V9.8.0 — MEGA COMPLETION BRIDGE
// Intelligence + safety + automation + provider abstraction + presence
// ============================================================================
function __load_mega_completion(){
  const module={exports:{}}; const exports=module.exports; const require=__localRequire;
  const crypto=require('crypto'); const {verify}=require('./_staff-session');
  const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
  const authHeaders=key=>({apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'});
  const enc=v=>encodeURIComponent(String(v??''));
  const now=()=>new Date().toISOString();
  function norm(v){return String(v??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064B-\u065F\u0670]/g,'').replace(/\s+/g,' ')}
  async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {message:t}}}
  async function developer(url,key,token){
    if(!token)return null;
    const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});if(!r.ok)return null;
    const u=await r.json().catch(()=>null);if(!u?.id)return null;
    const d=await fetch(`${url}/rest/v1/developer_users?auth_user_id=eq.${enc(u.id)}&active=eq.true&select=id,name,email&limit=1`,{headers:authHeaders(key)});
    const drows=await d.json().catch(()=>[]);
    if(d.ok&&Array.isArray(drows)&&drows[0])return {...drows[0],role:'developer',branch_id:null,permissions:{all:true,allBranchesFinance:true,automation:true,notifications:true}};
    const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${enc(u.id)}&select=id,full_name,role,status&limit=1`,{headers:authHeaders(key)});
    const prows=await pr.json().catch(()=>[]);const p=Array.isArray(prows)?prows[0]:null;
    if(pr.ok&&p&&p.role==='developer'&&p.status==='active')return {id:p.id,name:p.full_name||u.email||'developer',email:u.email||'',role:'developer',branch_id:null,permissions:{all:true,allBranchesFinance:true,automation:true,notifications:true}};
    return null;
  }
  async function authorize(url,key,token){const s=verify(token,key);if(s)return s;return developer(url,key,token)}
  function isManager(a){return !!(a?.role==='مدير عام'||a?.role==='developer'||a?.permissions?.all)}
  function allFinance(a){return !!(isManager(a)||a?.permissions?.allBranchesFinance)}
  function allOps(a){return !!(isManager(a)||a?.permissions?.allBranches)}
  async function rows(url,key,table,query='select=*&limit=500'){
    try{const r=await fetch(`${url}/rest/v1/${table}?${query}`,{headers:authHeaders(key)});const b=await r.json().catch(()=>[]);if(!r.ok)return [];return Array.isArray(b)?b:[]}catch{return []}
  }
  async function upsert(url,key,table,items,onConflict=''){
    const q=onConflict?`?on_conflict=${enc(onConflict)}`:'';const r=await fetch(`${url}/rest/v1/${table}${q}`,{method:'POST',headers:{...authHeaders(key),Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(Array.isArray(items)?items:[items])});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`تعذر حفظ ${table}`);return b;
  }
  async function patch(url,key,table,filter,obj){const r=await fetch(`${url}/rest/v1/${table}?${filter}`,{method:'PATCH',headers:{...authHeaders(key),Prefer:'return=representation'},body:JSON.stringify(obj)});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`تعذر تحديث ${table}`);return b}
  async function setting(url,key,k){const a=await rows(url,key,'system_settings',`key=eq.${enc(k)}&select=value&limit=1`);return a[0]?.value??null}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
  function uuidOrNull(v){return isUuid(v)?String(v):null}
  async function saveSetting(url,key,k,value,actor){
    // system_settings.updated_by is UUID in the live schema. Legacy staff IDs such as "1"
    // must never be written into UUID columns. Actor name remains inside the value/audit payload.
    return upsert(url,key,'system_settings',{key:k,value,scope:'global',branch_id:null,updated_by:uuidOrNull(actor?.id),updated_at:now()},'key')
  }
  function branchFilter(a,row){return allFinance(a)||!a?.branch_id||!row?.branch_id||String(row.branch_id)===String(a.branch_id)}
  async function canOperateTrip(url,key,a,tripId){
    if(allOps(a))return true;
    const bid=String(a?.branch_id||''),tid=String(tripId||'');if(!bid||!tid)return false;
    const t=(await rows(url,key,'trips',`id=eq.${enc(tid)}&select=id,branch_id&limit=1`))[0];
    if(t&&String(t.branch_id||'')===bid)return true;
    const shared=await rows(url,key,'trip_branches',`trip_id=eq.${enc(tid)}&branch_id=eq.${enc(bid)}&select=id,active&limit=5`);
    return shared.some(x=>x.active!==false);
  }
  async function providerStatus(env){return {
    whatsapp:{configured:!!env.WHATSAPP_WEBHOOK_URL,secret:!!env.WHATSAPP_WEBHOOK_TOKEN},
    sms:{configured:!!env.SMS_WEBHOOK_URL,secret:!!env.SMS_WEBHOOK_TOKEN},
    email:{configured:!!env.EMAIL_WEBHOOK_URL,secret:!!env.EMAIL_WEBHOOK_TOKEN},
    payment:{configured:!!env.PAYMENT_WEBHOOK_URL,secret:!!env.PAYMENT_WEBHOOK_TOKEN},
    scheduler:{configured:!!env.CRON_SECRET},
    supabase:{configured:!!env.SUPABASE_URL&&!!env.SUPABASE_SERVICE_ROLE_KEY}
  }}
  async function ensureBucket(url,key,bucket){
    const h=authHeaders(key);let r=await fetch(`${url}/storage/v1/bucket/${enc(bucket)}`,{headers:h});if(r.ok)return true;
    r=await fetch(`${url}/storage/v1/bucket`,{method:'POST',headers:h,body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:10485760,allowed_mime_types:['application/pdf']})});
    if(!r.ok){const b=await readJson(r);if(!/already exists|duplicate/i.test(String(b?.message||'')))throw new Error(b?.message||'تعذر إنشاء حاوية PDF')}
    return true;
  }
  function b64bytes(v){const raw=String(v||'').replace(/^data:[^,]+,/,'');return Uint8Array.from(Buffer.from(raw,'base64'))}
  async function storageUploadPdf(url,key,path,bytes){const bucket='almaher-generated-documents';await ensureBucket(url,key,bucket);const r=await fetch(`${url}/storage/v1/object/${bucket}/${path.split('/').map(enc).join('/')}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/pdf','x-upsert':'true'},body:bytes});if(!r.ok){const b=await readJson(r);throw new Error(b?.message||'تعذر رفع PDF')}return {bucket,path}}
  async function storageSign(url,key,bucket,path,expiresIn=3600){const r=await fetch(`${url}/storage/v1/object/sign/${bucket}/${path.split('/').map(enc).join('/')}`,{method:'POST',headers:authHeaders(key),body:JSON.stringify({expiresIn})});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||'تعذر إنشاء رابط PDF');const s=b.signedURL||b.signedUrl||b.signed_url||'';return s?(s.startsWith('http')?s:`${url}/storage/v1${s}`):''}
  async function dispatchOne(url,key,env,n){
    const ch=String(n.channel||'internal').toLowerCase(); if(ch==='internal'){await patch(url,key,'notifications',`id=eq.${enc(n.id)}`,{status:'sent',sent_at:now(),attempts:Number(n.attempts||0)+1,provider_ref:'internal'});return {ok:true,channel:ch}}
    const prefix=ch==='whatsapp'?'WHATSAPP':ch==='sms'?'SMS':ch==='email'?'EMAIL':''; const endpoint=prefix?env[`${prefix}_WEBHOOK_URL`]:''; const token=prefix?env[`${prefix}_WEBHOOK_TOKEN`]:'';
    if(!endpoint){await patch(url,key,'notifications',`id=eq.${enc(n.id)}`,{status:'manual',attempts:Number(n.attempts||0)+1,error_text:`${ch} provider not configured`});return {ok:false,manual:true,channel:ch}}
    try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({source:'almaher',notification_id:n.id,channel:ch,recipient:n.recipient,template_key:n.template_key,language_code:n.language_code||'ar',payload:n.payload||{}})});const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`provider ${r.status}`);const ref=String(b?.id||b?.message_id||b?.reference||'bridge');await patch(url,key,'notifications',`id=eq.${enc(n.id)}`,{status:'sent',sent_at:now(),attempts:Number(n.attempts||0)+1,provider_ref:ref,error_text:null});await upsert(url,key,'provider_events',{notification_id:n.id,channel:ch,event_type:'sent',provider_ref:ref,payload:b||{},created_at:now()});return {ok:true,channel:ch,provider_ref:ref}}
    catch(e){await patch(url,key,'notifications',`id=eq.${enc(n.id)}`,{status:'failed',attempts:Number(n.attempts||0)+1,error_text:String(e.message||e)});return {ok:false,channel:ch,error:String(e.message||e)}}
  }
  async function runScheduler(url,key,env,actor){
    const due=await rows(url,key,'notifications',`status=in.(scheduled,failed)&scheduled_at=lte.${enc(now())}&order=scheduled_at.asc&limit=50`);let sent=0,failed=0,manual=0;for(const n of due){const r=await dispatchOne(url,key,env,n);if(r.ok)sent++;else if(r.manual)manual++;else failed++}
    const qs=await rows(url,key,'resource_quotas',`status=eq.active&release_at=lte.${enc(now())}&select=*&limit=200`);for(const q of qs)await patch(url,key,'resource_quotas',`id=eq.${enc(q.id)}`,{status:'released',released_at:now()});
    const maint=await rows(url,key,'vehicle_maintenance',`status=eq.planned&due_date=lte.${enc(now().slice(0,10))}&select=*&limit=200`);for(const m of maint){const existing=await rows(url,key,'tasks',`entity_type=eq.vehicle_maintenance&entity_id=eq.${enc(m.id)}&status=eq.open&select=id&limit=1`);if(!existing.length)await upsert(url,key,'tasks',{branch_id:null,assigned_to:null,entity_type:'vehicle_maintenance',entity_id:String(m.id),title:'صيانة مركبة مستحقة',description:`${m.maintenance_type||'صيانة'} — ${m.due_date||''}`,priority:'high',status:'open',due_at:m.due_date?`${m.due_date}T09:00:00Z`:null,created_by:actor?.name||'scheduler',created_at:now()})}
    await upsert(url,key,'message_dispatch_runs',{run_type:'scheduler',processed:due.length,sent,failed,manual,released_quotas:qs.length,created_by:actor?.name||'cron',created_at:now()});return{processed:due.length,sent,failed,manual,released_quotas:qs.length,maintenance_tasks_checked:maint.length}
  }
  async function health(url,key){const start=Date.now();const names=['bookings','trips','staff_users','system_releases','notifications','export_jobs'];const checks={};for(const t of names){const r=await fetch(`${url}/rest/v1/${t}?select=*&limit=1`,{headers:authHeaders(key)});checks[t]={ok:r.ok,status:r.status}}return{ok:Object.values(checks).every(x=>x.ok),latency_ms:Date.now()-start,checks}}
  exports.handler=async(event)=>{
    const env=process.env||{};const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');const key=env.SUPABASE_SERVICE_ROLE_KEY||'';if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Supabase environment missing'})};
    let p={};if(event.body){try{p=JSON.parse(event.body||'{}')}catch{p={}}} const action=String(p.action||event.queryStringParameters?.action||'status');
    // Provider callbacks can be used by an external payment bridge without staff auth.
    if(action==='payment_callback'){
      const secret=String(event.headers['x-almaher-payment-secret']||event.headers['X-Almaher-Payment-Secret']||'');if(!env.PAYMENT_CALLBACK_SECRET||secret!==String(env.PAYMENT_CALLBACK_SECRET))return{statusCode:403,headers:H,body:JSON.stringify({error:'Invalid callback secret'})};
      const ref=String(p.provider_ref||p.reference||''),status=String(p.status||'paid');if(!ref)return{statusCode:400,headers:H,body:JSON.stringify({error:'provider_ref required'})};const got=await patch(url,key,'payment_intents',`provider_ref=eq.${enc(ref)}`,{status,callback_payload:p,updated_at:now(),paid_at:status==='paid'?now():null});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,rows:got})};
    }
    if(action==='scheduler_run'&&event.httpMethod==='GET'){
      const cron=String(event.headers['x-cron-secret']||event.queryStringParameters?.secret||'');if(!env.CRON_SECRET||cron!==String(env.CRON_SECRET))return{statusCode:403,headers:H,body:JSON.stringify({error:'Cron secret required'})};const result=await runScheduler(url,key,env,{name:'cron'});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,result})};
    }
    if(action==='public_brand_profile'){const profile=await setting(url,key,'developer.profile.v1')||{};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,profile:{display_name:String(profile.display_name||''),title:String(profile.title||''),phone:String(profile.phone||'')}})}}
    const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';const actor=await authorize(url,key,token);if(!actor)return{statusCode:403,headers:H,body:JSON.stringify({error:'Staff/developer access required'})};
    if(actor.role==='developer'){try{const dp=await setting(url,key,'developer.profile.v1')||{};if(dp.display_name)actor.name=String(dp.display_name)}catch(_e){}}
    try{
      if(action==='cloud_usage'){
        if(actor.role!=='developer'&&!actor.permissions?.all&&!actor.permissions?.systemHealth)return{statusCode:403,headers:H,body:JSON.stringify({error:'صلاحية صحة النظام مطلوبة'})};
        const bucketNames=['almaher-documents','almaher-exports','almaher-backups','almaher-generated-documents'];
        const buckets=[];let storageBytes=0,filesCount=0;
        for(const bucket of bucketNames){
          try{let offset=0,bBytes=0,bCount=0;for(let page=0;page<20;page++){const r=await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`,{method:'POST',headers:authHeaders(key),body:JSON.stringify({limit:1000,offset,sortBy:{column:'created_at',order:'desc'}})});if(!r.ok)break;const a=await r.json().catch(()=>[]);if(!Array.isArray(a)||!a.length)break;for(const o of a){const z=Number(o?.metadata?.size||o?.metadata?.contentLength||0);if(Number.isFinite(z))bBytes+=z;bCount++}if(a.length<1000)break;offset+=a.length}storageBytes+=bBytes;filesCount+=bCount;buckets.push({bucket,bytes:bBytes,files:bCount})}catch(_e){buckets.push({bucket,bytes:null,files:null})}
        }
        const storageLimit=Number(env.SUPABASE_STORAGE_LIMIT_BYTES||0)||null,dbLimit=Number(env.SUPABASE_DB_LIMIT_BYTES||0)||null;
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,storage:{bytes:storageBytes,files:filesCount,buckets,limit_bytes:storageLimit,percent:storageLimit?Math.round(storageBytes/storageLimit*1000)/10:null},database:{bytes:null,limit_bytes:dbLimit,percent:null,note:'الحجم الفعلي لقاعدة البيانات غير متاح من مفاتيح التطبيق الحالية؛ لن يتم عرض رقم تقديري وهمي.'},checked_at:new Date().toISOString()})};
      }
      if(action==='status'){const emergency={maintenance:await setting(url,key,'emergency.maintenance'),read_only:await setting(url,key,'emergency.read_only'),stop_new_bookings:await setting(url,key,'emergency.stop_new_bookings')};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,build:'1.1.0',providers:await providerStatus(env),emergency,actor:{name:actor.name,role:actor.role,branch_id:uuidOrNull(actor.branch_id)}})}}
      if(action==='developer_studio_get'){
        if(actor.role!=='developer')return{statusCode:200,headers:H,body:JSON.stringify({restricted:true,labels:{},profile:{},config:{}})};
        const labels=await setting(url,key,'developer.ui_labels.v1')||{},profile=await setting(url,key,'developer.profile.v1')||{},config=await setting(url,key,'developer.ui_config.v1')||{};
        return{statusCode:200,headers:H,body:JSON.stringify({labels,profile,config})};
      }
      if(action==='developer_studio_save'){
        if(actor.role!=='developer')return{statusCode:403,headers:H,body:JSON.stringify({error:'Developer only'})};
        const old={labels:await setting(url,key,'developer.ui_labels.v1')||{},profile:await setting(url,key,'developer.profile.v1')||{},config:await setting(url,key,'developer.ui_config.v1')||{},saved_at:now()};
        const history=await setting(url,key,'developer.config_history.v1')||[];const nextHistory=[old,...(Array.isArray(history)?history:[])].slice(0,20);
        const labels=p.labels&&typeof p.labels==='object'&&!Array.isArray(p.labels)?p.labels:{},profile=p.profile&&typeof p.profile==='object'&&!Array.isArray(p.profile)?p.profile:{},config=p.config&&typeof p.config==='object'&&!Array.isArray(p.config)?p.config:{};
        await saveSetting(url,key,'developer.config_history.v1',nextHistory,actor);await saveSetting(url,key,'developer.ui_labels.v1',labels,actor);await saveSetting(url,key,'developer.profile.v1',profile,actor);await saveSetting(url,key,'developer.ui_config.v1',config,actor);
        await upsert(url,key,'activity_events',{actor_id:String(actor.id||''),actor_name:actor.name||'developer',actor_role:'developer',entity_type:'system_config',entity_id:'developer-studio',action:'developer_studio_publish',metadata:{label_count:Object.keys(labels).length},created_at:now()}).catch(()=>{});
        return{statusCode:200,headers:H,body:JSON.stringify({ok:true,labels,profile,config})};
      }
      if(action==='developer_studio_rollback'){
        if(actor.role!=='developer')return{statusCode:403,headers:H,body:JSON.stringify({error:'Developer only'})};const history=await setting(url,key,'developer.config_history.v1')||[];const first=Array.isArray(history)?history[0]:null;if(!first)return{statusCode:404,headers:H,body:JSON.stringify({error:'لا توجد نسخة إعداد سابقة'})};
        await saveSetting(url,key,'developer.ui_labels.v1',first.labels||{},actor);await saveSetting(url,key,'developer.profile.v1',first.profile||{},actor);await saveSetting(url,key,'developer.ui_config.v1',first.config||{},actor);await saveSetting(url,key,'developer.config_history.v1',history.slice(1),actor);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,labels:first.labels||{},profile:first.profile||{},config:first.config||{}})};
      }
      if(action==='generated_pdf_store'){
        const bytes=b64bytes(p.base64);if(!bytes.length)return{statusCode:400,headers:H,body:JSON.stringify({error:'ملف PDF فارغ'})};if(bytes.length>9*1024*1024)return{statusCode:413,headers:H,body:JSON.stringify({error:'حجم PDF أكبر من 9MB'})};
        const safe=String(p.file_name||`document-${Date.now()}.pdf`).replace(/[^A-Za-z0-9._-]/g,'_');const path=`generated/${new Date().toISOString().slice(0,10)}/${Date.now()}-${safe}`;const u=await storageUploadPdf(url,key,path,bytes);const signed_url=await storageSign(url,key,u.bucket,u.path,3600);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,storage_path:u.path,bucket:u.bucket,signed_url})};
      }
      if(action==='queue_message'){
        if(!actor?.permissions?.notifications&&!actor?.permissions?.automation&&!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إرسال إشعارات'})};const channel=String(p.channel||'internal').toLowerCase(),recipient=String(p.recipient||'').trim();if(!recipient)return{statusCode:400,headers:H,body:JSON.stringify({error:'المستلم مطلوب'})};
        const row={trip_id:uuidOrNull(p.trip_id),booking_id:uuidOrNull(p.booking_id),passenger_id:uuidOrNull(p.passenger_id),branch_id:uuidOrNull(p.branch_id)||uuidOrNull(actor.branch_id),channel,recipient,language_code:String(p.language_code||'ar'),template_key:p.template_key||null,payload:{message:String(p.message||''),...(p.payload&&typeof p.payload==='object'?p.payload:{})},scheduled_at:p.scheduled_at||now(),status:'scheduled',attempts:0,created_by:actor.name||'',created_at:now()};
        const saved=await upsert(url,key,'notifications',row);const n=Array.isArray(saved)?saved[0]:saved;if(p.send_now&&n?.id){const result=await dispatchOne(url,key,env,n);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,queued:true,sent:!!result.ok,result,row:n})}}return{statusCode:200,headers:H,body:JSON.stringify({ok:true,queued:true,row:n})};
      }

      if(action==='global_search'){
        const q=norm(p.q||event.queryStringParameters?.q||'');if(q.length<2)return{statusCode:200,headers:H,body:JSON.stringify({results:[]})};
        const bs=(await rows(url,key,'bookings','select=id,booking_number,customer_name,customer_phone,customer_identity,customer_nationality,branch_id,trip_id,status,total_price,paid_amount,created_at&order=created_at.desc&limit=1000')).filter(x=>branchFilter(actor,x));const bIds=new Set(bs.map(x=>String(x.id)));
        const ps=(await rows(url,key,'booking_passengers','select=id,booking_id,full_name,phone,identity_number,nationality,status&limit=1500')).filter(x=>bIds.has(String(x.booking_id)));
        const ts=await rows(url,key,'trips','select=id,code,name,from_city,to_city,departure_date,return_date,branch_id,status&order=departure_date.desc&limit=500');
        const leads=(await rows(url,key,'leads','select=id,name,phone,status,branch_id,source_channel&limit=500')).filter(x=>branchFilter(actor,x));
        const agents=(await rows(url,key,'agents','select=id,name,company_name,phone,email,status,branch_id&limit=500')).filter(x=>branchFilter(actor,x));
        const suppliers=await rows(url,key,'suppliers','select=id,name,phone,email,status,score&limit=500');
        const match=(o,fields)=>fields.some(k=>norm(o?.[k]).includes(q));const out=[];
        for(const x of bs)if(match(x,['booking_number','customer_name','customer_phone','customer_identity','customer_nationality']))out.push({type:'booking',id:x.id,title:`حجز ${x.booking_number} — ${x.customer_name||''}`,sub:`${x.customer_phone||''} | ${x.status||''}`,ref:x.booking_number});
        for(const x of ps)if(match(x,['full_name','phone','identity_number','nationality']))out.push({type:'passenger',id:x.id,title:`مسافر — ${x.full_name||''}`,sub:`${x.identity_number||''} | ${x.phone||''}`,ref:x.booking_id});
        for(const x of ts)if(match(x,['code','name','from_city','to_city']))out.push({type:'trip',id:x.id,title:`رحلة ${x.code||''} — ${x.name||''}`,sub:`${x.from_city||''} ← ${x.to_city||''} | ${x.departure_date||''}`,ref:x.id});
        for(const x of leads)if(match(x,['name','phone','source_channel']))out.push({type:'lead',id:x.id,title:`Lead — ${x.name||''}`,sub:`${x.phone||''} | ${x.status||''}`,ref:x.id});
        for(const x of agents)if(match(x,['name','company_name','phone','email']))out.push({type:'agent',id:x.id,title:`وكيل — ${x.name||x.company_name||''}`,sub:`${x.phone||''}`,ref:x.id});
        for(const x of suppliers)if(match(x,['name','phone','email']))out.push({type:'supplier',id:x.id,title:`مورد — ${x.name||''}`,sub:`${x.phone||''}`,ref:x.id});
        return{statusCode:200,headers:H,body:JSON.stringify({results:out.slice(0,80),count:out.length})};
      }
      if(action==='presence_heartbeat'){
        const entity_type=String(p.entity_type||'booking'),entity_id=String(p.entity_id||'');if(!entity_id)return{statusCode:400,headers:H,body:JSON.stringify({error:'entity_id required'})};const expires=new Date(Date.now()+45000).toISOString();
        await upsert(url,key,'presence_sessions',{entity_type,entity_id,user_id:String(actor.id||actor.name),user_name:actor.name||actor.username||'',branch_id:uuidOrNull(actor.branch_id),editing:!!p.editing,last_seen_at:now(),expires_at:expires,metadata:p.metadata||{}},'entity_type,entity_id,user_id');
        const active=await rows(url,key,'presence_sessions',`entity_type=eq.${enc(entity_type)}&entity_id=eq.${enc(entity_id)}&expires_at=gt.${enc(now())}&select=*&order=last_seen_at.desc&limit=20`);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,active})};
      }
      if(action==='presence_release'){await patch(url,key,'presence_sessions',`entity_type=eq.${enc(String(p.entity_type||'booking'))}&entity_id=eq.${enc(String(p.entity_id||''))}&user_id=eq.${enc(String(actor.id||actor.name))}`,{expires_at:now(),editing:false});return{statusCode:200,headers:H,body:JSON.stringify({ok:true})}}
      if(action==='conflict_check'){
        const no=String(p.booking_number||'');const expected=Number(p.expected_version||0);const a=await rows(url,key,'bookings',`booking_number=eq.${enc(no)}&select=id,booking_number,version_no,last_modified_at,last_modified_by&limit=1`);const b=a[0];if(!b)return{statusCode:404,headers:H,body:JSON.stringify({error:'Booking not found'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,current_version:Number(b.version_no||1),expected_version:expected,conflict:!!expected&&Number(b.version_no||1)!==expected,last_modified_at:b.last_modified_at,last_modified_by:b.last_modified_by})};
      }
      if(action==='timeline'){
        const no=String(p.booking_number||event.queryStringParameters?.booking_number||'');let b=(await rows(url,key,'bookings',`booking_number=eq.${enc(no)}&select=*&limit=1`))[0];if(!b)return{statusCode:404,headers:H,body:JSON.stringify({error:'Booking not found'})};if(!branchFilter(actor,b)&&!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Outside branch'})};const bid=String(b.id);
        const [pass,scans,acts,trans,docs,ratings]=await Promise.all([rows(url,key,'booking_passengers',`booking_id=eq.${enc(bid)}&select=*&limit=200`),rows(url,key,'scan_events',`booking_id=eq.${enc(bid)}&select=*&order=scanned_at.asc&limit=500`),rows(url,key,'activity_events',`entity_id=eq.${enc(bid)}&select=*&order=created_at.asc&limit=500`),rows(url,key,'transactions',`booking_id=eq.${enc(bid)}&select=*&order=created_at.asc&limit=500`),rows(url,key,'passenger_documents',`passenger_id=in.(${(await rows(url,key,'booking_passengers',`booking_id=eq.${enc(bid)}&select=id&limit=200`)).map(x=>x.id).join(',')||'00000000-0000-0000-0000-000000000000'})&select=*&limit=500`),rows(url,key,'post_trip_ratings',`booking_id=eq.${enc(bid)}&select=*&order=created_at.asc&limit=100`)]);
        const timeline=[{at:b.created_at,type:'booking',title:'إنشاء الحجز',data:{status:b.status}}];for(const x of scans)timeline.push({at:x.scanned_at,type:'scan',title:`QR: ${x.scan_mode}`,data:{result:x.result}});for(const x of acts)timeline.push({at:x.created_at,type:'audit',title:x.action||x.event_type||'نشاط',data:x.metadata||{}});for(const x of trans)timeline.push({at:x.created_at,type:'finance',title:'حركة مالية',data:allFinance(actor)||String(b.branch_id||'')===String(actor.branch_id||'')?{amount:x.amount,status:x.status}:{hidden:true}});for(const x of ratings)timeline.push({at:x.created_at,type:'rating',title:`تقييم ${x.overall_score}/5`,data:{comment:x.comment}});timeline.sort((a,z)=>String(a.at||'').localeCompare(String(z.at||'')));return{statusCode:200,headers:H,body:JSON.stringify({booking:b,passengers:pass,documents:docs,timeline})};
      }
      if(action==='submit_rating'){
        const score=Math.max(1,Math.min(5,Number(p.overall_score||5)));const row={booking_id:uuidOrNull(p.booking_id),trip_id:uuidOrNull(p.trip_id),branch_id:uuidOrNull(p.branch_id)||uuidOrNull(actor.branch_id),customer_name:p.customer_name||null,overall_score:score,bus_score:Number(p.bus_score||score),driver_score:Number(p.driver_score||score),supervisor_score:Number(p.supervisor_score||score),hotel_score:Number(p.hotel_score||score),organization_score:Number(p.organization_score||score),booking_score:Number(p.booking_score||score),comment:String(p.comment||''),tags:Array.isArray(p.tags)?p.tags:[],created_by:actor.name||null,created_at:now()};const saved=await upsert(url,key,'post_trip_ratings',row);if(score<=2){await upsert(url,key,'tasks',{branch_id:row.branch_id,assigned_to:null,entity_type:'post_trip_rating',entity_id:String(saved?.[0]?.id||''),title:'Service Recovery — تقييم منخفض',description:`التقييم ${score}/5 — ${row.comment}`,priority:'high',status:'open',created_by:actor.name||'',created_at:now()})}return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved?.[0]||saved,recovery_task:score<=2})};
      }
      if(action==='supplier_analytics'){
        const suppliers=await rows(url,key,'suppliers','select=*&limit=500');const contracts=await rows(url,key,'supplier_contracts','select=*&limit=1500');const pays=(await rows(url,key,'supplier_payables','select=*&limit=1500')).filter(x=>branchFilter(actor,x));const out=suppliers.map(s=>{const c=contracts.filter(x=>String(x.supplier_id)===String(s.id)),payss=pays.filter(x=>String(x.supplier_id)===String(s.id)),due=payss.reduce((a,x)=>a+Math.max(0,Number(x.amount||0)-Number(x.paid_amount||0)),0),overdue=payss.filter(x=>x.due_date&&x.due_date<now().slice(0,10)&&Number(x.amount||0)>Number(x.paid_amount||0)).length,score=Math.max(0,Math.min(100,Number(s.score||100)-overdue*7-(due>0?Math.min(20,due/10000):0)));return{id:s.id,name:s.name,contracts:c.length,outstanding:due,overdue,score:Number(score.toFixed(1))}});return{statusCode:200,headers:H,body:JSON.stringify({rows:out.sort((a,b)=>a.score-b.score)})};
      }
      if(action==='budget_analytics'){
        const budgets=(await rows(url,key,'budget_plans','select=*&limit=1000')).filter(x=>branchFilter(actor,x));const expenses=(await rows(url,key,'expenses','select=*&limit=3000')).filter(x=>branchFilter(actor,x));const dims=['season_id','program_id','trip_id','branch_id'];const groups=new Map();for(const b of budgets){const k=dims.map(d=>b[d]||'').join('|');groups.set(k,{...b,budget:Number(b.amount||0),actual:0})}for(const e of expenses){const k=dims.map(d=>e[d]||'').join('|');const g=groups.get(k)||{season_id:e.season_id||null,program_id:e.program_id||null,trip_id:e.trip_id||null,branch_id:e.branch_id||null,budget:0,actual:0};g.actual+=Number(e.amount||0);groups.set(k,g)}const list=[...groups.values()].map(x=>({...x,variance:Number(x.budget||0)-Number(x.actual||0),usage_pct:x.budget?Number(((x.actual/x.budget)*100).toFixed(1)):null}));return{statusCode:200,headers:H,body:JSON.stringify({rows:list})};
      }
      if(action==='save_budget'){if(!isManager(actor)&&!actor?.permissions?.finance)return{statusCode:403,headers:H,body:JSON.stringify({error:'Finance permission required'})};const row={id:p.id||undefined,season_id:uuidOrNull(p.season_id),program_id:uuidOrNull(p.program_id),trip_id:uuidOrNull(p.trip_id),branch_id:uuidOrNull(p.branch_id)||uuidOrNull(actor.branch_id),amount:Number(p.amount||0),notes:String(p.notes||''),updated_by:actor.name||'',updated_at:now()};const saved=await upsert(url,key,'budget_plans',row);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved?.[0]||saved})}}
      if(action==='executive_brief'){
        if(!isManager(actor)&&!actor?.permissions?.reports&&!actor?.permissions?.finance)return{statusCode:403,headers:H,body:JSON.stringify({error:'Reports permission required'})};const bs=(await rows(url,key,'bookings','select=id,branch_id,status,total_price,paid_amount,created_at,trip_id,customer_name&limit=5000')).filter(x=>allFinance(actor)||branchFilter(actor,x));const ex=(await rows(url,key,'expenses','select=id,branch_id,amount,expense_date,trip_id&limit=5000')).filter(x=>branchFilter(actor,x));const trips=await rows(url,key,'trips','select=id,code,name,departure_date,status,bus_capacity,remaining_seats,branch_id&limit=1000');const failed=await rows(url,key,'notifications','status=eq.failed&select=id,branch_id&limit=1000');const revenue=bs.reduce((a,x)=>a+Number(x.total_price||0),0),paid=bs.reduce((a,x)=>a+Number(x.paid_amount||0),0),expense=ex.reduce((a,x)=>a+Number(x.amount||0),0),today=now().slice(0,10),upcoming=trips.filter(t=>t.departure_date>=today).sort((a,b)=>String(a.departure_date).localeCompare(String(b.departure_date))).slice(0,10);const warnings=[];if(revenue-paid>0)warnings.push(`متبقي تحصيل ${(revenue-paid).toFixed(2)}`);if(failed.length)warnings.push(`${failed.length} إشعار فشل`);const brief={bookings:bs.length,revenue,paid,outstanding:revenue-paid,expenses:expense,net:paid-expense,upcoming,warnings,generated_at:now()};return{statusCode:200,headers:H,body:JSON.stringify(brief)};
      }
      if(action==='what_if'){const demand=Number(p.demand||0),capacity=Number(p.capacity||49),price=Number(p.price||0),variable_cost=Number(p.variable_cost||0),fixed_cost=Number(p.fixed_cost||0),sold=Math.min(demand,capacity),revenue=sold*price,cost=fixed_cost+sold*variable_cost;return{statusCode:200,headers:H,body:JSON.stringify({demand,capacity,sold,unsatisfied:Math.max(0,demand-capacity),load_factor:capacity?Number((sold/capacity*100).toFixed(1)):0,revenue,cost,profit:revenue-cost,break_even_seats:price>variable_cost?Math.ceil(fixed_cost/(price-variable_cost)):null})}}
      if(action==='emergency_set'){
        if(!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Manager/developer only'})};const keyName=String(p.key||'');if(!['maintenance','read_only','stop_new_bookings'].includes(keyName))return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid emergency key'})};await saveSetting(url,key,`emergency.${keyName}`,{enabled:!!p.enabled,message:String(p.message||''),updated_at:now(),updated_by:actor.name||''},actor);await upsert(url,key,'emergency_events',{event_key:keyName,enabled:!!p.enabled,message:String(p.message||''),actor_id:String(actor.id||''),actor_name:actor.name||'',created_at:now()});return{statusCode:200,headers:H,body:JSON.stringify({ok:true})};
      }
      if(action==='logout_all'){if(!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Manager/developer only'})};await patch(url,key,'user_sessions','active=eq.true',{active:false,last_seen_at:now()}).catch(()=>[]);await saveSetting(url,key,'security.logout_all_epoch',{epoch:Date.now(),updated_at:now(),updated_by:actor.name||''},actor);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,note:'جلسات user_sessions أغلقت وتم تسجيل epoch أمني'})}}
      if(action==='secrets_status'){if(!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Manager/developer only'})};const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','WHATSAPP_WEBHOOK_URL','WHATSAPP_WEBHOOK_TOKEN','SMS_WEBHOOK_URL','SMS_WEBHOOK_TOKEN','EMAIL_WEBHOOK_URL','EMAIL_WEBHOOK_TOKEN','PAYMENT_WEBHOOK_URL','PAYMENT_WEBHOOK_TOKEN','PAYMENT_CALLBACK_SECRET','CRON_SECRET'];const status={};for(const k of keys)status[k]=!!env[k];return{statusCode:200,headers:H,body:JSON.stringify({status})}}
      if(action==='data_health'){
        const bs=(await rows(url,key,'bookings','select=id,booking_number,branch_id,total_price,paid_amount,status,trip_id&limit=5000')).filter(x=>branchFilter(actor,x));const passengers=await rows(url,key,'booking_passengers','select=id,booking_id,full_name,identity_number,nationality,document_status&limit=10000');const ids=new Set(bs.map(x=>String(x.id))),bmap=new Map(bs.map(x=>[String(x.id),x]));const anomalies=[];
        for(const b of bs){if(Number(b.paid_amount||0)>Number(b.total_price||0))anomalies.push({type:'finance',booking_number:b.booking_number,ref:b.booking_number,message_ar:'المدفوع أكبر من إجمالي الحجز'});if(!b.trip_id)anomalies.push({type:'booking',booking_number:b.booking_number,ref:b.booking_number,message_ar:'الحجز غير مرتبط برحلة'})}
        for(const psg of passengers){if(!ids.has(String(psg.booking_id)))continue;const b=bmap.get(String(psg.booking_id));if(!psg.full_name)anomalies.push({type:'passenger',passenger_id:psg.id,booking_number:b?.booking_number||'',ref:psg.id,message_ar:'المسافر بدون اسم مسجل'});if(['unknown','missing','expired'].includes(String(psg.document_status||'')))anomalies.push({type:'document',passenger_id:psg.id,passenger_name:psg.full_name||'',booking_number:b?.booking_number||'',nationality:psg.nationality||'',ref:psg.id,message_ar:psg.document_status==='expired'?'المستند منتهي الصلاحية':psg.document_status==='missing'?'المستند المطلوب غير مرفوع':'حالة المستند غير محددة'})}
        return{statusCode:200,headers:H,body:JSON.stringify({ok:!anomalies.length,count:anomalies.length,anomalies:anomalies.slice(0,300)})};
      }
      if(action==='financial_health'){const bs=(await rows(url,key,'bookings','select=id,booking_number,branch_id,total_price,paid_amount,status&limit=5000')).filter(x=>branchFilter(actor,x));let shifts=await rows(url,key,'cash_shifts','select=*&limit=1000');if(!allFinance(actor)&&actor?.branch_id){const regs=await rows(url,key,'cash_registers',`branch_id=eq.${enc(actor.branch_id)}&select=id&limit=500`);const allowed=new Set(regs.map(x=>String(x.id)));shifts=shifts.filter(x=>allowed.has(String(x.register_id||'')))}const issues=[];for(const b of bs){if(Number(b.paid_amount||0)<0)issues.push({type:'negative_payment',ref:b.booking_number});if(Number(b.paid_amount||0)>Number(b.total_price||0))issues.push({type:'overpayment',ref:b.booking_number,amount:Number(b.paid_amount)-Number(b.total_price)})}for(const s of shifts)if(s.status==='closed'&&Math.abs(Number(s.variance||0))>0.01)issues.push({type:'cash_variance',ref:s.id,variance:s.variance});await upsert(url,key,'financial_health_runs',{branch_id:uuidOrNull(actor.branch_id),status:issues.length?'warning':'ok',issues,created_by:actor.name||'',created_at:now()});return{statusCode:200,headers:H,body:JSON.stringify({status:issues.length?'warning':'ok',issues})}}
      if(action==='regression_run'){
        if(!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Manager/developer only'})};const required=['branches','trips','bookings','booking_passengers','staff_users','trip_branches','scan_events','room_assignments','seat_assignments','notifications','export_jobs','system_releases','post_trip_ratings','presence_sessions'];const checks=[];for(const t of required){const r=await fetch(`${url}/rest/v1/${t}?select=*&limit=1`,{headers:authHeaders(key)});checks.push({name:`table:${t}`,ok:r.ok,status:r.status})}const h=await health(url,key);checks.push({name:'health',ok:h.ok,status:h.latency_ms});const ok=checks.every(x=>x.ok);const saved=await upsert(url,key,'regression_runs',{release_version:'1.1.0',status:ok?'pass':'fail',checks,run_by:actor.name||'',created_at:now()});return{statusCode:200,headers:H,body:JSON.stringify({ok,checks,row:saved?.[0]||saved})};
      }
      if(action==='predeploy_run'){
        if(!isManager(actor))return{statusCode:403,headers:H,body:JSON.stringify({error:'Manager/developer only'})};const h=await health(url,key),providers=await providerStatus(env),em={maintenance:await setting(url,key,'emergency.maintenance'),read_only:await setting(url,key,'emergency.read_only'),stop_new_bookings:await setting(url,key,'emergency.stop_new_bookings')};const failed=(await rows(url,key,'notifications','status=eq.failed&select=id&limit=1000')).length;const checks=[{name:'core_health',ok:h.ok,details:h},{name:'maintenance_off',ok:!em.maintenance?.enabled},{name:'read_only_off',ok:!em.read_only?.enabled},{name:'failed_notifications_under_100',ok:failed<100,details:{failed}},{name:'supabase_configured',ok:providers.supabase.configured}];const ok=checks.every(x=>x.ok);const saved=await upsert(url,key,'predeploy_runs',{release_version:String(p.release_version||'1.1.0'),status:ok?'pass':'warning',checks,run_by:actor.name||'',created_at:now()});return{statusCode:200,headers:H,body:JSON.stringify({ok,checks,row:saved?.[0]||saved})};
      }
      if(action==='scheduler_run'){if(!isManager(actor)&&!actor?.permissions?.notifications)return{statusCode:403,headers:H,body:JSON.stringify({error:'Notifications permission required'})};const result=await runScheduler(url,key,env,actor);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,result})}}
      if(action==='create_payment_intent'){
        const amount=Number(p.amount||0),booking_id=p.booking_id||null,booking_number=String(p.booking_number||'');if(amount<=0)return{statusCode:400,headers:H,body:JSON.stringify({error:'Invalid amount'})};const ref=`ALM-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;let row={booking_id,booking_number,branch_id:uuidOrNull(p.branch_id)||uuidOrNull(actor.branch_id),amount,currency:String(p.currency||'SAR'),status:'pending',provider_ref:ref,created_by:actor.name||'',created_at:now(),updated_at:now()};let payment_url=null;
        if(env.PAYMENT_WEBHOOK_URL){try{const r=await fetch(env.PAYMENT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json',...(env.PAYMENT_WEBHOOK_TOKEN?{Authorization:`Bearer ${env.PAYMENT_WEBHOOK_TOKEN}`}:{})},body:JSON.stringify({reference:ref,amount,currency:row.currency,booking_number,callback_hint:'/.netlify/functions/mega-completion action=payment_callback'})});const b=await readJson(r);if(r.ok){payment_url=b.payment_url||b.url||null;row.provider_payload=b}else row.provider_payload={error:b?.message||r.status}}catch(e){row.provider_payload={error:String(e.message||e)}}}
        const saved=await upsert(url,key,'payment_intents',row);return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved?.[0]||saved,payment_url,provider_configured:!!env.PAYMENT_WEBHOOK_URL})};
      }
      if(action==='quota_save'){const saved=await upsert(url,key,'resource_quotas',{id:p.id||undefined,resource_type:String(p.resource_type||'seat'),trip_id:uuidOrNull(p.trip_id),branch_id:uuidOrNull(p.branch_id)||uuidOrNull(actor.branch_id),agent_id:uuidOrNull(p.agent_id),quantity:Number(p.quantity||0),used_quantity:Number(p.used_quantity||0),release_at:p.release_at||null,status:String(p.status||'active'),notes:String(p.notes||''),updated_at:now(),created_by:actor.name||''});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved?.[0]||saved})}}
      if(action==='room_lock'){
        if(!isManager(actor)&&!actor?.permissions?.housing)return{statusCode:403,headers:H,body:JSON.stringify({error:'Housing permission required'})};
        const id=String(p.trip_hotel_id||''),locked=!!p.locked;
        const th=(await rows(url,key,'trip_hotels',`id=eq.${enc(id)}&select=id,trip_id&limit=1`))[0];
        if(!th)return{statusCode:404,headers:H,body:JSON.stringify({error:'Trip hotel not found'})};
        if(!await canOperateTrip(url,key,actor,th.trip_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'الرحلة خارج نطاقك التشغيلي'})};
        const got=await patch(url,key,'trip_hotels',`id=eq.${enc(id)}`,{rooming_locked:locked,rooming_locked_at:locked?now():null,rooming_locked_by:locked?(actor.name||''):null});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:got?.[0]||got})}
      }
      if(action==='bus_swap'){
        if(!isManager(actor)&&!actor?.permissions?.fleet)return{statusCode:403,headers:H,body:JSON.stringify({error:'Fleet permission required'})};
        const tripVehicleId=String(p.trip_vehicle_id||''),newVehicleId=String(p.new_vehicle_id||'');
        const tv=(await rows(url,key,'trip_vehicles',`id=eq.${enc(tripVehicleId)}&select=*&limit=1`))[0],nv=(await rows(url,key,'vehicles',`id=eq.${enc(newVehicleId)}&select=*&limit=1`))[0];
        if(!tv||!nv)return{statusCode:404,headers:H,body:JSON.stringify({error:'Vehicle assignment not found'})};
        if(!await canOperateTrip(url,key,actor,tv.trip_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'الرحلة خارج نطاقك التشغيلي'})};
        if(!allOps(actor)&&String(nv.branch_id||'')!==String(actor?.branch_id||''))return{statusCode:403,headers:H,body:JSON.stringify({error:'الباص البديل يجب أن يتبع فرعك'})};
        const seats=await rows(url,key,'seat_assignments',`trip_vehicle_id=eq.${enc(tripVehicleId)}&status=in.(assigned,blocked,hold)&select=id&limit=1000`);const cap=Number(nv.booking_capacity||nv.physical_capacity||49);if(seats.length>cap)return{statusCode:409,headers:H,body:JSON.stringify({error:'سعة الباص البديل أقل من المقاعد المستخدمة',used:seats.length,capacity:cap})};const got=await patch(url,key,'trip_vehicles',`id=eq.${enc(tripVehicleId)}`,{vehicle_id:newVehicleId,capacity:cap,booking_capacity:cap,status:'assigned',updated_at:now()});await upsert(url,key,'bus_swap_events',{trip_vehicle_id:tripVehicleId,old_vehicle_id:tv.vehicle_id||null,new_vehicle_id:newVehicleId,affected_seats:seats.length,actor_name:actor.name||'',created_at:now()});return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:got?.[0]||got,affected_seats:seats.length})};
      }
      if(action==='draft_save'){const saved=await upsert(url,key,'user_drafts',{user_id:String(actor.id||actor.name),draft_key:String(p.draft_key||'default'),branch_id:uuidOrNull(actor.branch_id),payload:p.payload||{},updated_at:now()},'user_id,draft_key');return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:saved?.[0]||saved})}}
      if(action==='draft_load'){const d=await rows(url,key,'user_drafts',`user_id=eq.${enc(String(actor.id||actor.name))}&draft_key=eq.${enc(String(p.draft_key||event.queryStringParameters?.draft_key||'default'))}&select=*&limit=1`);return{statusCode:200,headers:H,body:JSON.stringify({row:d[0]||null})}}
      if(action==='knowledge'){const a=await rows(url,key,'knowledge_articles','active=eq.true&select=*&order=sort_order.asc&limit=200'),w=await rows(url,key,'whats_new_items','active=eq.true&select=*&order=published_at.desc&limit=100');return{statusCode:200,headers:H,body:JSON.stringify({articles:a,whats_new:w})}}
      if(action==='translation_qa'){const entries=await rows(url,key,'translation_entries','select=translation_key,language_code,status&limit=10000');const langs={};for(const x of entries){langs[x.language_code]=langs[x.language_code]||{total:0,approved:0};langs[x.language_code].total++;if(x.status==='approved')langs[x.language_code].approved++}return{statusCode:200,headers:H,body:JSON.stringify({languages:langs})}}
      return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown mega action',action})};
    }catch(e){console.error('mega-completion',action,e);return{statusCode:Number(e.status||502),headers:H,body:JSON.stringify({error:e.message||'Mega completion error',action})}}
  };
  return module.exports;
}
__mods["mega-completion"]=__load_mega_completion();

function __load_push_notifications(){
  const module={exports:{}};
  const exports=module.exports;
  const require=__localRequire;
  const crypto=require('crypto');
  const {verify}=require('./_staff-session');
  const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
  const b64urlToBuf=(v)=>Buffer.from(String(v||'').replace(/-/g,'+').replace(/_/g,'/'),'base64');
  const bufToB64url=(v)=>Buffer.from(v).toString('base64url');
  const hmac=(key,data)=>crypto.createHmac('sha256',key).update(data).digest();
  function hkdfExpand(prk,info,len){return hmac(prk,Buffer.concat([info,Buffer.from([1])])).subarray(0,len)}
  function vapidEnv(){
    const publicKey=String(process.env.PUSH_VAPID_PUBLIC_KEY||process.env.VAPID_PUBLIC_KEY||'').trim();
    const privateKey=String(process.env.PUSH_VAPID_PRIVATE_KEY||process.env.VAPID_PRIVATE_KEY||'').trim();
    const subject=String(process.env.PUSH_VAPID_SUBJECT||process.env.VAPID_SUBJECT||'mailto:notifications@almaher.local').trim();
    return {publicKey,privateKey,subject};
  }
  function makeVapidAuth(endpoint){
    const {publicKey,privateKey,subject}=vapidEnv();
    if(!publicKey||!privateKey)throw new Error('Push VAPID keys are not configured');
    const pub=b64urlToBuf(publicKey),priv=b64urlToBuf(privateKey);
    if(pub.length!==65||priv.length!==32)throw new Error('Invalid VAPID key length');
    const aud=new URL(endpoint).origin;
    const header=bufToB64url(Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})));
    const payload=bufToB64url(Buffer.from(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*3600,sub:subject})));
    const signingInput=Buffer.from(`${header}.${payload}`);
    const keyObj=crypto.createPrivateKey({key:{kty:'EC',crv:'P-256',x:bufToB64url(pub.subarray(1,33)),y:bufToB64url(pub.subarray(33,65)),d:bufToB64url(priv)},format:'jwk'});
    const sig=crypto.sign('sha256',signingInput,{key:keyObj,dsaEncoding:'ieee-p1363'});
    return `vapid t=${header}.${payload}.${bufToB64url(sig)}, k=${publicKey}`;
  }
  function encryptWebPush(subscription,payload){
    const uaPublic=b64urlToBuf(subscription.p256dh),authSecret=b64urlToBuf(subscription.auth);
    if(uaPublic.length!==65||authSecret.length<16)throw new Error('Invalid browser push keys');
    const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();
    const asPublic=ecdh.getPublicKey();
    const shared=ecdh.computeSecret(uaPublic);
    const prkKey=hmac(authSecret,shared);
    const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0','utf8'),uaPublic,asPublic]);
    const ikm=hkdfExpand(prkKey,keyInfo,32);
    const salt=crypto.randomBytes(16);
    const prk=hmac(salt,ikm);
    const cek=hkdfExpand(prk,Buffer.from('Content-Encoding: aes128gcm\0','utf8'),16);
    const nonce=hkdfExpand(prk,Buffer.from('Content-Encoding: nonce\0','utf8'),12);
    let plain=Buffer.from(JSON.stringify(payload||{}),'utf8');
    if(plain.length>3600)plain=Buffer.from(JSON.stringify({title:payload?.title||'الماهر الماسي',body:String(payload?.body||'لديك إشعار جديد').slice(0,2500),url:payload?.url||'/'}),'utf8');
    plain=Buffer.concat([plain,Buffer.from([2])]);
    const cipher=crypto.createCipheriv('aes-128-gcm',cek,nonce);
    const encrypted=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
    const head=Buffer.alloc(21);salt.copy(head,0);head.writeUInt32BE(4096,16);head.writeUInt8(asPublic.length,20);
    return Buffer.concat([head,asPublic,encrypted]);
  }
  async function sendOne(row,payload){
    const body=encryptWebPush({p256dh:row.p256dh,auth:row.auth},payload);
    const r=await fetch(row.endpoint,{method:'POST',headers:{TTL:'86400','Content-Encoding':'aes128gcm',Authorization:makeVapidAuth(row.endpoint),'Content-Type':'application/octet-stream'},body});
    return {ok:r.ok,status:r.status,text:await r.text().catch(()=> '')};
  }
  async function supa(){
    const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)throw new Error('Server Supabase environment variables are missing');
    return {url,key,h:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'}};
  }
  function authSession(event,key){const a=String(event.headers.authorization||event.headers.Authorization||'');return verify(a.startsWith('Bearer ')?a.slice(7):'',key)}
  async function developerSession(event,url,key){
    const a=String(event.headers.authorization||event.headers.Authorization||'');const token=a.startsWith('Bearer ')?a.slice(7):'';if(!token)return null;
    try{const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});const u=await ur.json().catch(()=>null);if(!ur.ok||!u?.id)return null;
      const h={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
      const dr=await fetch(`${url}/rest/v1/developer_users?auth_user_id=eq.${encodeURIComponent(u.id)}&active=eq.true&select=id,name,email&limit=1`,{headers:h});const ds=await dr.json().catch(()=>[]);if(dr.ok&&Array.isArray(ds)&&ds[0])return{id:u.id,name:ds[0].name||u.email||'developer',role:'developer',branch_id:null,permissions:{all:true,automation:true,notifications:true}};
      const pr=await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=role,status&limit=1`,{headers:h});const ps=await pr.json().catch(()=>[]);const p=Array.isArray(ps)?ps[0]:null;if(pr.ok&&p&&p.role==='developer'&&p.status==='active')return{id:u.id,name:u.email||'developer',role:'developer',branch_id:null,permissions:{all:true,automation:true,notifications:true}};
    }catch{}return null;
  }
  exports.handler=async(event)=>{
    try{
      if(event.httpMethod==='GET'){
        const {publicKey}=vapidEnv();
        return {statusCode:200,headers:jsonHeaders,body:JSON.stringify({supported:!!publicKey,public_key:publicKey||null})};
      }
      if(event.httpMethod!=='POST')return{statusCode:405,headers:jsonHeaders,body:JSON.stringify({error:'Method not allowed'})};
      const {url,key,h}=await supa();const session=authSession(event,key)||await developerSession(event,url,key);
      if(!session)return{statusCode:401,headers:jsonHeaders,body:JSON.stringify({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'})};
      let p={};try{p=JSON.parse(event.body||'{}')}catch{}
      const action=String(p.action||'');
      if(action==='subscribe'){
        const sub=p.subscription||{},endpoint=String(sub.endpoint||'').trim(),p256dh=String(sub.keys?.p256dh||sub.p256dh||''),auth=String(sub.keys?.auth||sub.auth||'');
        if(!endpoint||!p256dh||!auth)return{statusCode:400,headers:jsonHeaders,body:JSON.stringify({error:'بيانات اشتراك Push غير مكتملة'})};
        const row={user_id:String(session.id),user_name:session.name||null,branch_id:session.branch_id||null,endpoint,p256dh,auth,user_agent:String(p.user_agent||'').slice(0,500),enabled:true,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};
        const r=await fetch(`${url}/rest/v1/push_subscriptions?on_conflict=endpoint`,{method:'POST',headers:{...h,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify([row])});const b=await r.json().catch(()=>[]);
        if(!r.ok)return{statusCode:500,headers:jsonHeaders,body:JSON.stringify({error:b?.message||'تعذر حفظ اشتراك الإشعارات'})};
        return{statusCode:200,headers:jsonHeaders,body:JSON.stringify({ok:true,subscribed:true})};
      }
      if(action==='unsubscribe'){
        const endpoint=String(p.endpoint||'').trim();
        if(endpoint)await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${encodeURIComponent(String(session.id))}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({enabled:false,updated_at:new Date().toISOString()})});
        return{statusCode:200,headers:jsonHeaders,body:JSON.stringify({ok:true,subscribed:false})};
      }
      if(action==='test_self'){
        const q=await fetch(`${url}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(String(session.id))}&enabled=eq.true&select=*`,{headers:h});const rows=await q.json().catch(()=>[]);
        if(!q.ok)return{statusCode:500,headers:jsonHeaders,body:JSON.stringify({error:rows?.message||'تعذر قراءة أجهزة الإشعارات'})};
        if(!Array.isArray(rows)||!rows.length)return{statusCode:404,headers:jsonHeaders,body:JSON.stringify({error:'لا يوجد جهاز مشترك في Push لهذا الحساب'})};
        let sent=0,failed=0;for(const row of rows){try{const out=await sendOne(row,{title:p.title||'الماهر الماسي',body:p.body||'تم ربط الإشعارات بنجاح ✅',url:p.url||'/'});if(out.ok)sent++;else{failed++;if([404,410].includes(out.status))await fetch(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({enabled:false,last_error:`HTTP ${out.status}`,updated_at:new Date().toISOString()})})}}catch(e){failed++;}}
        return{statusCode:200,headers:jsonHeaders,body:JSON.stringify({ok:sent>0,sent,failed})};
      }
      if(action==='send_to_user'){
        const can=session.role==='مدير عام'||session.permissions?.all||session.permissions?.automation||session.permissions?.notifications;
        if(!can)return{statusCode:403,headers:jsonHeaders,body:JSON.stringify({error:'لا توجد صلاحية إرسال Push'})};
        const userId=String(p.user_id||'').trim();if(!userId)return{statusCode:400,headers:jsonHeaders,body:JSON.stringify({error:'user_id مطلوب'})};
        const q=await fetch(`${url}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true&select=*`,{headers:h});const rows=await q.json().catch(()=>[]);if(!q.ok)return{statusCode:500,headers:jsonHeaders,body:JSON.stringify({error:rows?.message||'تعذر قراءة الاشتراكات'})};
        let sent=0,failed=0;for(const row of (Array.isArray(rows)?rows:[])){try{const out=await sendOne(row,{title:p.title||'الماهر الماسي',body:p.body||'لديك إشعار جديد',url:p.url||'/'});out.ok?sent++:failed++;}catch{failed++;}}
        return{statusCode:200,headers:jsonHeaders,body:JSON.stringify({ok:sent>0,sent,failed})};
      }
      return{statusCode:400,headers:jsonHeaders,body:JSON.stringify({error:'Unknown action'})};
    }catch(e){console.error('push-notifications error',e);return{statusCode:502,headers:jsonHeaders,body:JSON.stringify({error:e.message||'Push service failed'})}}
  };
  return module.exports;
}
__mods["push-notifications"]=__load_push_notifications();


const __handlers = {
  "health": __mods["health"].handler,
  "create-booking": __mods["create-booking"].handler,
  "get-booking": __mods["get-booking"].handler,
  "developer-login": __mods["developer-login"].handler,
  "platform-data": __mods["platform-data"].handler,
  "staff-login": __mods["staff-login"].handler,
  "staff-admin": __mods["staff-admin"].handler,
  "cloud-core": __mods["cloud-core"].handler,
  "legacy-state": __mods["legacy-state"].handler,
  "customer-auth": __mods["customer-auth"].handler,
  "v9-admin-data": __mods["v9-admin-data"].handler,
  "mega-completion": __mods["mega-completion"].handler,
  "system-release": __mods["system-release"].handler,
  "push-notifications": __mods["push-notifications"].handler,
};

// ============================================================================
// AL-MAHER NEXT — MODULAR WORKER SHELL
// Keeps the proven cloud/Supabase handlers above, removes the legacy HTML shell,
// and exposes a clean /api/* contract for the React application.
// ============================================================================
function nextHeadersObject(headers){
  const out={};
  if(!headers) return out;
  try{ for(const [k,v] of headers.entries()) out[String(k).toLowerCase()]=v; }
  catch{ try{ for(const [k,v] of Object.entries(headers)) out[String(k).toLowerCase()]=v; }catch{} }
  return out;
}
function nextCookie(request,name){
  const cookie=request.headers.get('cookie')||'';
  for(const part of cookie.split(';')){
    const i=part.indexOf('='); if(i<0) continue;
    if(part.slice(0,i).trim()===name) return decodeURIComponent(part.slice(i+1).trim());
  }
  return '';
}
async function nextEvent(request, overrides={}){
  const url=new URL(request.url), query={};
  for(const [k,v] of url.searchParams.entries()) query[k]=v;
  let body='';
  if(request.method!=='GET'&&request.method!=='HEAD') body=await request.text();
  const headers=nextHeadersObject(request.headers);
  const cookieToken=nextCookie(request,'almaher_session');
  if(overrides.authToken) headers.authorization=`Bearer ${overrides.authToken}`;
  else if(cookieToken && !headers.authorization) headers.authorization=`Bearer ${cookieToken}`;
  return {
    httpMethod: overrides.method||request.method,
    headers,
    queryStringParameters:{...query,...(overrides.query||{})},
    body: overrides.body!==undefined ? (typeof overrides.body==='string'?overrides.body:JSON.stringify(overrides.body)) : body,
    path: url.pathname,
    rawUrl: request.url
  };
}
function nextResult(result={}, extraHeaders={}){
  const headers=new Headers(result.headers||{});
  headers.set('cache-control','no-store');
  for(const [k,v] of Object.entries(extraHeaders)) headers.set(k,v);
  return new Response(result.body??'',{status:Number(result.statusCode||200),headers});
}
function nextJson(data,status=200,extra={}){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}});
}
function nextSessionCookie(token,maxAge=43200){
  return `almaher_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function nextClearCookie(){return 'almaher_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}
async function nextCall(name,request,overrides={}){
  const handler=__handlers[name];
  if(!handler) return {statusCode:404,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:'API handler not found'})};
  return handler(await nextEvent(request,overrides),{});
}
async function nextMe(request,env){
  const token=nextCookie(request,'almaher_session');
  if(!token) return nextJson({authenticated:false},401);
  const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
  const payload=__mods['_staff-session'].verify(token,key);
  if(!payload) return nextJson({authenticated:false},401,{'set-cookie':nextClearCookie()});
  if(payload.role==='developer') return nextJson({authenticated:true,user:{id:payload.id,name:payload.name,role:'developer',branch_id:null,permissions:payload.permissions||{all:true}}});
  try{
    const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
    const h={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
    const r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(payload.id)}&select=id,name,username,phone,role,branch_id,status,permissions,force_password_reset&limit=1`,{headers:h});
    const rows=await r.json().catch(()=>[]), live=Array.isArray(rows)?rows[0]:null;
    if(!r.ok||!live||String(live.status||'نشط')==='موقوف'||String(live.status||'').toLowerCase()==='inactive') return nextJson({authenticated:false},401,{'set-cookie':nextClearCookie()});
    return nextJson({authenticated:true,user:live});
  }catch(e){return nextJson({error:e.message||'تعذر استعادة الجلسة'},502)}
}

function nextHas(actor,...keys){
  if(!actor)return false;
  if(actor.role==='مدير عام'||actor.role==='developer'||actor.permissions?.all)return true;
  return keys.some(k=>actor.permissions?.[k]);
}
async function nextActor(request,env){
  const token=nextCookie(request,'almaher_session');
  if(!token)return null;
  const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
  const payload=__mods['_staff-session'].verify(token,key);if(!payload)return null;
  if(payload.role==='developer')return payload;
  try{
    const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');const h={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
    const r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(payload.id||'')}&select=id,name,role,branch_id,status,permissions&limit=1`,{headers:h});
    const rows=await r.json().catch(()=>[]),u=r.ok&&Array.isArray(rows)?rows[0]:null;
    if(!u||String(u.status||'نشط')==='موقوف'||String(u.status||'').toLowerCase()==='inactive')return null;
    return {...payload,...u,permissions:u.permissions||{}};
  }catch{return payload}
}
const NEXT_RESOURCE_PERMS={
  crm:['crm','customers','viewCRM'],agents:['agents'],suppliers:['suppliers'],finance:['finance','payments','expenses','refunds'],finance_full:['finance','payments','expenses','refunds'],executive:['finance','reports'],cost_centers:['finance','trips'],reports:['reports','printReports'],printing:['printReports','reports'],risk:['operations','incidents'],translation:['translation'],scanner:['scanner','qr','operations'],seasons:['trips'],trips_ops:['trips','operations'],groups:['viewBookings','editBookings'],seats:['seats','operations'],fleet:['fleet','vehicles','trips'],housing:['housing'],return_ops:['return','returns','operations'],tickets:['viewBookings','editBookings','printTickets'],customers:['viewBookings','editBookings','crm'],geo:['operations','trips'],meeting:['operations','trips'],documents:['documents','editPassenger'],notifications:['notifications','automation'],operations:['operations','manifest','housingManifest'],approvals:['approvals'],tasks:['tasks'],checklists:['operations'],shifts:['shifts','finance'],permissions:['manageUsers'],system_quality:['developer'],backup:['developer'],developer:['developer']
};
const NEXT_TABLE_PERMS={
  leads:['crm','customers'],service_tickets:['crm','customers'],tasks:['tasks','crm'],agents:['agents'],agent_allocations:['agents'],supplier_contracts:['suppliers'],supplier_payables:['suppliers','finance'],approval_requests:['approvals','finance'],cash_registers:['finance','payments'],cash_shifts:['finance','shifts'],saved_reports:['reports'],export_jobs:['reports'],incidents:['operations','incidents'],lost_found:['operations'],checklist_templates:['operations'],trip_checklist_runs:['operations'],translation_entries:['translation'],scan_events:['scanner','qr','operations'],feedback_reports:['crm','developer'],trip_meeting_points:['operations','trips'],passenger_documents:['documents','editPassenger'],notifications:['notifications'],seasons:['trips'],programs:['trips'],travel_groups:['viewBookings','editBookings'],vehicles:['fleet','vehicles','trips'],vehicle_seats:['seats','fleet'],trip_vehicles:['fleet','trips'],seat_assignments:['seats','operations'],hotels:['housing'],trip_hotels:['housing'],hotel_rooms:['housing'],room_assignments:['housing'],trip_status_events:['operations','trips'],message_templates:['notifications'],notification_rules:['notifications','automation'],ticket_templates:['printTickets','developer'],print_events:['printTickets','reports'],role_templates:['manageUsers'],staff_permission_overrides:['manageUsers'],permission_delegations:['manageUsers'],feature_flags:['developer'],passenger_meeting_points:['operations'],vehicle_maintenance:['fleet','vehicles'],system_health_snapshots:['developer'],backup_runs:['developer']
};

function nextAllOps(actor){return !!(actor&&(actor.role==='مدير عام'||actor.role==='developer'||actor.permissions?.all||actor.permissions?.allBranches))}
function nextAllFinance(actor){return !!(actor&&(actor.role==='مدير عام'||actor.role==='developer'||actor.permissions?.all||actor.permissions?.allBranchesFinance))}
const NEXT_BRANCH_TABLES=new Set(['leads','service_tickets','tasks','agents','supplier_payables','approval_requests','cash_registers','saved_reports','export_jobs','incidents','notifications']);
const NEXT_TRIP_TABLES=new Set(['trip_branches','trip_status_events','trip_meeting_points','trip_vehicles','trip_hotels','trip_checklist_runs']);
async function nextRestRows(env,table,select='*',limit=10000){
  const base=String(env.SUPABASE_URL||'').replace(/\/+$/,'');const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!base||!key)return [];
  try{const r=await fetch(`${base}/rest/v1/${table}?select=${select}&limit=${limit}`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}});const b=await r.json().catch(()=>[]);return r.ok&&Array.isArray(b)?b:[]}catch{return []}
}
async function nextScopeContext(env,actor){
  const bid=String(actor?.branch_id||'');
  if(!bid)return {branchId:'',visibleTripIds:new Set(),ownBookingIds:new Set(),sharedBookingIds:new Set(),ownBookingNumbers:new Set(),sharedBookingNumbers:new Set(),ownPassengerIds:new Set(),sharedPassengerIds:new Set(),ownGroupIds:new Set(),sharedGroupIds:new Set(),visibleTripVehicleIds:new Set(),ownVehicleIds:new Set(),visibleVehicleIds:new Set(),visibleTripHotelIds:new Set(),visibleRoomIds:new Set(),visibleMeetingIds:new Set()};
  const [trips,tripBranches,bookings,passengers,tripVehicles,vehicles,tripHotels,rooms,meetings]=await Promise.all([
    nextRestRows(env,'trips','id,branch_id'),nextRestRows(env,'trip_branches','trip_id,branch_id,operations_access'),
    nextRestRows(env,'bookings','id,booking_number,branch_id,trip_id,return_trip_id,group_id'),nextRestRows(env,'booking_passengers','id,booking_id,group_id'),
    nextRestRows(env,'trip_vehicles','id,trip_id,vehicle_id'),nextRestRows(env,'vehicles','id,branch_id'),nextRestRows(env,'trip_hotels','id,trip_id'),nextRestRows(env,'hotel_rooms','id,trip_hotel_id'),nextRestRows(env,'trip_meeting_points','id,trip_id,branch_id')
  ]);
  const visibleTripIds=new Set(trips.filter(x=>String(x.branch_id||'')===bid).map(x=>String(x.id)));
  for(const x of tripBranches)if(String(x.branch_id||'')===bid&&x.operations_access!==false)visibleTripIds.add(String(x.trip_id));
  const ownBookingIds=new Set(),sharedBookingIds=new Set(),ownBookingNumbers=new Set(),sharedBookingNumbers=new Set(),ownGroupIds=new Set(),sharedGroupIds=new Set();
  for(const b of bookings){const id=String(b.id),own=String(b.branch_id||'')===bid,shared=visibleTripIds.has(String(b.trip_id||''))||visibleTripIds.has(String(b.return_trip_id||''));if(own){ownBookingIds.add(id);if(b.booking_number)ownBookingNumbers.add(String(b.booking_number));if(b.group_id)ownGroupIds.add(String(b.group_id))}if(shared){sharedBookingIds.add(id);if(b.booking_number)sharedBookingNumbers.add(String(b.booking_number));if(b.group_id)sharedGroupIds.add(String(b.group_id))}}
  const ownPassengerIds=new Set(),sharedPassengerIds=new Set();
  for(const x of passengers){const bk=String(x.booking_id||'');if(ownBookingIds.has(bk)){ownPassengerIds.add(String(x.id));if(x.group_id)ownGroupIds.add(String(x.group_id))}if(sharedBookingIds.has(bk)){sharedPassengerIds.add(String(x.id));if(x.group_id)sharedGroupIds.add(String(x.group_id))}}
  const visibleTripVehicles=tripVehicles.filter(x=>visibleTripIds.has(String(x.trip_id||'')));
  const visibleTripVehicleIds=new Set(visibleTripVehicles.map(x=>String(x.id)));
  const ownVehicleIds=new Set(vehicles.filter(x=>String(x.branch_id||'')===bid).map(x=>String(x.id)));
  const visibleVehicleIds=new Set(ownVehicleIds);
  for(const x of visibleTripVehicles)if(x.vehicle_id)visibleVehicleIds.add(String(x.vehicle_id));
  const visibleTripHotelIds=new Set(tripHotels.filter(x=>visibleTripIds.has(String(x.trip_id||''))).map(x=>String(x.id)));
  const visibleRoomIds=new Set(rooms.filter(x=>visibleTripHotelIds.has(String(x.trip_hotel_id||''))).map(x=>String(x.id)));
  const visibleMeetingIds=new Set(meetings.filter(x=>visibleTripIds.has(String(x.trip_id||''))).map(x=>String(x.id)));
  return {branchId:bid,visibleTripIds,ownBookingIds,sharedBookingIds,ownBookingNumbers,sharedBookingNumbers,ownPassengerIds,sharedPassengerIds,ownGroupIds,sharedGroupIds,visibleTripVehicleIds,ownVehicleIds,visibleVehicleIds,visibleTripHotelIds,visibleRoomIds,visibleMeetingIds};
}
function nextRedactForeignBooking(row,ctx){
  if(String(row?.branch_id||'')===ctx.branchId)return row;
  const copy={...row};
  for(const k of ['total_price','paid_amount','remaining_amount','price','price_snapshot','financial_status','payment_method','payment_reference','commission','profit','cost','refund_amount'])if(k in copy)copy[k]=null;
  return copy;
}
function nextFilterModulePayload(payload,resource,ctx){
  if(!payload||typeof payload!=='object')return payload;
  const out={...payload};
  for(const [table,value] of Object.entries(out)){
    if(!Array.isArray(value))continue;
    let rows=value;
    if(table==='trips')rows=rows.filter(x=>ctx.visibleTripIds.has(String(x.id)));
    else if(NEXT_TRIP_TABLES.has(table))rows=rows.filter(x=>ctx.visibleTripIds.has(String(x.trip_id||'')));
    else if(table==='bookings')rows=rows.filter(x=>resource==='operations'?ctx.sharedBookingIds.has(String(x.id)):ctx.ownBookingIds.has(String(x.id))).map(x=>nextRedactForeignBooking(x,ctx));
    else if(table==='booking_passengers')rows=rows.filter(x=>(resource==='operations'?ctx.sharedPassengerIds:ctx.ownPassengerIds).has(String(x.id))|| (resource==='operations'?ctx.sharedBookingIds:ctx.ownBookingIds).has(String(x.booking_id||'')));
    else if(table==='passenger_documents'||table==='passenger_qr_tokens')rows=rows.filter(x=>ctx.ownPassengerIds.has(String(x.passenger_id||''))||ctx.ownBookingIds.has(String(x.booking_id||'')));
    else if(table==='seat_assignments')rows=rows.filter(x=>ctx.visibleTripVehicleIds.has(String(x.trip_vehicle_id||'')));
    else if(table==='vehicles')rows=rows.filter(x=>ctx.visibleVehicleIds.has(String(x.id||'')));
    else if(table==='vehicle_seats'||table==='vehicle_maintenance')rows=rows.filter(x=>ctx.visibleVehicleIds.has(String(x.vehicle_id||'')));
    else if(table==='hotel_rooms')rows=rows.filter(x=>ctx.visibleTripHotelIds.has(String(x.trip_hotel_id||'')));
    else if(table==='room_assignments')rows=rows.filter(x=>ctx.visibleRoomIds.has(String(x.hotel_room_id||'')));
    else if(table==='passenger_meeting_points')rows=rows.filter(x=>ctx.visibleMeetingIds.has(String(x.meeting_point_id||'')));
    else if(table==='travel_groups')rows=rows.filter(x=>(resource==='operations'?ctx.sharedGroupIds:ctx.ownGroupIds).has(String(x.id)));
    else if(table==='scan_events')rows=rows.filter(x=>ctx.visibleTripIds.has(String(x.trip_id||''))||ctx.ownBookingIds.has(String(x.booking_id||'')));
    else if(table==='lost_found')rows=rows.filter(x=>!x.trip_id||ctx.visibleTripIds.has(String(x.trip_id)));
    else if(table==='notification_rules')rows=rows.filter(x=>(!x.branch_id||String(x.branch_id)===ctx.branchId)&&(!x.trip_id||ctx.visibleTripIds.has(String(x.trip_id))));
    else if(table==='notifications')rows=rows.filter(x=>String(x.branch_id||'')===ctx.branchId||(!x.branch_id&&ctx.ownBookingIds.has(String(x.booking_id||''))));
    else if(NEXT_BRANCH_TABLES.has(table))rows=rows.filter(x=>String(x.branch_id||'')===ctx.branchId);
    out[table]=rows;
  }
  return out;
}
async function nextGuardModuleWrite(env,actor,p,ctx){
  if(nextAllOps(actor))return {ok:true,payload:p};
  if(!ctx.branchId)return {ok:false,error:'حساب الموظف غير مرتبط بفرع'};
  const q={...p,row:p?.row&&typeof p.row==='object'&&!Array.isArray(p.row)?{...p.row}:p?.row};const table=String(q.table||''),row=q.row||{};
  if(['upload_passenger_document','document_signed_url'].includes(q.action)){
    const pid=String(q.passenger_id||'');
    if(q.action==='upload_passenger_document'&&!ctx.ownPassengerIds.has(pid))return {ok:false,error:'مستند المسافر خارج نطاق فرعك'};
    if(q.action==='document_signed_url'&&q.storage_path){
      const docs=await nextRestRows(env,'passenger_documents','passenger_id,storage_path');const d=docs.find(x=>String(x.storage_path||'')===String(q.storage_path));
      if(!d||!ctx.ownPassengerIds.has(String(d.passenger_id||'')))return {ok:false,error:'المستند خارج نطاق فرعك'};
    }
    return {ok:true,payload:q};
  }
  if(q.action==='scan'){
    if(q.trip_id&&!ctx.visibleTripIds.has(String(q.trip_id)))return {ok:false,error:'الرحلة خارج نطاق تشغيل فرعك'};
    const raw=String(q.code||'').trim();let bookingNo='';let m=raw.match(/BOOKING=([^|&\s]+)/i);if(m)bookingNo=decodeURIComponent(m[1]);if(!bookingNo&&/^\d{5,20}$/.test(raw))bookingNo=raw;if(!bookingNo){m=raw.match(/(?:booking|reservation)[=:/#-]*([A-Za-z0-9_-]{5,30})/i);if(m)bookingNo=m[1]}
    if(bookingNo&&!ctx.sharedBookingNumbers.has(String(bookingNo))&&!ctx.ownBookingNumbers.has(String(bookingNo)))return {ok:false,error:'الحجز خارج نطاق تشغيل فرعك'};
    return {ok:true,payload:q};
  }
  if(!['insert','update'].includes(q.action))return {ok:true,payload:q};
  if(NEXT_BRANCH_TABLES.has(table)){
    if(row.branch_id&&String(row.branch_id)!==ctx.branchId)return {ok:false,error:'لا يمكن الكتابة باسم فرع آخر'};
    q.row={...row,branch_id:actor.branch_id};
  }
  if(NEXT_TRIP_TABLES.has(table)&&row.trip_id&&!ctx.visibleTripIds.has(String(row.trip_id)))return {ok:false,error:'الرحلة خارج نطاق تشغيل فرعك'};
  if(table==='trip_meeting_points'&&row.branch_id&&String(row.branch_id)!==ctx.branchId)return {ok:false,error:'نقطة التجمع يجب أن تكون لفرعك'};
  if(table==='notification_rules'){if(row.branch_id&&String(row.branch_id)!==ctx.branchId)return {ok:false,error:'قاعدة الإشعار يجب أن تكون لفرعك'};q.row={...row,branch_id:actor.branch_id};if(row.trip_id&&!ctx.visibleTripIds.has(String(row.trip_id)))return {ok:false,error:'رحلة قاعدة الإشعار خارج نطاق تشغيل فرعك'};}
  if(table==='vehicles'){if(q.action==='insert')q.row={...row,branch_id:actor.branch_id};else if(q.id&&!ctx.ownVehicleIds.has(String(q.id)))return {ok:false,error:'لا يمكنك تعديل مركبة تتبع فرعًا آخر'};}
  if((table==='vehicle_seats'||table==='vehicle_maintenance')&&row.vehicle_id&&!ctx.ownVehicleIds.has(String(row.vehicle_id)))return {ok:false,error:'لا يمكنك تعديل بيانات مركبة تتبع فرعًا آخر'};
  if(table==='trip_vehicles'&&row.vehicle_id&&!ctx.ownVehicleIds.has(String(row.vehicle_id)))return {ok:false,error:'لا يمكنك تعيين مركبة تتبع فرعًا آخر'};
  if(table==='seat_assignments'&&row.trip_vehicle_id&&!ctx.visibleTripVehicleIds.has(String(row.trip_vehicle_id)))return {ok:false,error:'المركبة/الرحلة خارج نطاق تشغيل فرعك'};
  if(table==='hotel_rooms'&&row.trip_hotel_id&&!ctx.visibleTripHotelIds.has(String(row.trip_hotel_id)))return {ok:false,error:'فندق الرحلة خارج نطاق تشغيل فرعك'};
  if(table==='room_assignments'&&row.hotel_room_id&&!ctx.visibleRoomIds.has(String(row.hotel_room_id)))return {ok:false,error:'الغرفة خارج نطاق تشغيل فرعك'};
  if(table==='passenger_documents'&&row.passenger_id&&!ctx.ownPassengerIds.has(String(row.passenger_id)))return {ok:false,error:'المسافر خارج نطاق فرعك'};
  return {ok:true,payload:q};
}
async function nextModuleBridge(request,env){
  const actor=await nextActor(request,env);if(!actor)return nextJson({error:'انتهت الجلسة'},401);
  const requestUrl=new URL(request.url);let required=[],payload=null;
  const resource=String(requestUrl.searchParams.get('resource')||'');
  if(request.method==='GET') required=NEXT_RESOURCE_PERMS[resource]||['developer'];
  else{
    try{payload=JSON.parse(await request.clone().text()||'{}')}catch{payload={}}
    if(['scan','upload_passenger_document','document_signed_url','process_export','export_signed_url'].includes(payload.action)) required=payload.action==='scan'?['scanner','qr','operations']:payload.action.startsWith('upload_passenger')||payload.action.startsWith('document_')?['documents','editPassenger']:['reports'];
    else if(['run_health_check','create_operational_snapshot'].includes(payload.action)) required=['developer'];
    else required=NEXT_TABLE_PERMS[String(payload.table||'')]||['developer'];
  }
  if(!(actor.role==='مدير عام'||actor.role==='developer'||actor.permissions?.all||required.some(k=>actor.permissions?.[k])))return nextJson({error:'لا توجد صلاحية لهذا الموديول'},403);
  const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
  const bridge=__mods['_staff-session'].issue({id:actor.id,name:actor.name,role:actor.role,branch_id:actor.branch_id||null,permissions:actor.permissions||{},next_bridge:true},key,300);
  if(request.method==='GET'){
    const result=await nextCall('v9-admin-data',request,{authToken:bridge});
    if(nextAllOps(actor)||Number(result.statusCode||200)>=400)return nextResult(result);
    let body={};try{body=JSON.parse(result.body||'{}')}catch{return nextResult(result)}
    const ctx=await nextScopeContext(env,actor);return nextJson(nextFilterModulePayload(body,resource,ctx),Number(result.statusCode||200));
  }
  const ctx=nextAllOps(actor)?null:await nextScopeContext(env,actor);const guarded=ctx?await nextGuardModuleWrite(env,actor,payload||{},ctx):{ok:true,payload:payload||{}};
  if(!guarded.ok)return nextJson({error:guarded.error},403);
  const patched=new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(guarded.payload)});
  return nextResult(await nextCall('v9-admin-data',patched,{authToken:bridge}));
}
async function nextApi(request,env){
  const url=new URL(request.url), path=url.pathname;
  if(path==='/api/health') return nextJson({ok:true,service:'almaher-next',architecture:'react-vite-worker',version:'1.1.0'});
  if(path==='/api/auth/login'&&request.method==='POST'){
    const result=await nextCall('staff-login',request);
    let body={};try{body=JSON.parse(result.body||'{}')}catch{}
    if(Number(result.statusCode||200)>=400) return nextResult(result);
    const token=body.session_token||''; delete body.session_token;
    return nextJson(body,200,{'set-cookie':nextSessionCookie(token)});
  }
  if(path==='/api/auth/developer'&&request.method==='POST'){
    const result=await nextCall('developer-login',request);
    let body={};try{body=JSON.parse(result.body||'{}')}catch{}
    if(Number(result.statusCode||200)>=400) return nextResult(result);
    const key=env.SUPABASE_SERVICE_ROLE_KEY||'';
    const token=__mods['_staff-session'].issue({id:body.user?.id||'developer',name:body.user?.name||'المطور',role:'developer',branch_id:null,permissions:{all:true,allBranches:true,allBranchesFinance:true,manageUsers:true,manageBranches:true,trips:true,branchBooking:true,viewBookings:true,editBookings:true,editPassenger:true,confirmBookings:true,cancelBookings:true,payments:true,refunds:true,refund_request:true,refund_view:true,refund_approve:true,refund_complete:true,refund_print:true,changeTrip:true,manifest:true,housingManifest:true,housing:true,operations:true,finance:true,notifications:true,automation:true,printReports:true,delete:true}},key,43200);
    return nextJson({user:{...body.user,role:'developer',permissions:{all:true}}},200,{'set-cookie':nextSessionCookie(token)});
  }
  if(path==='/api/auth/logout'&&request.method==='POST') return nextJson({ok:true},200,{'set-cookie':nextClearCookie()});
  if(path==='/api/auth/me'&&request.method==='GET') return nextMe(request,env);
  if(path==='/api/bootstrap'&&request.method==='GET') return nextResult(await nextCall('staff-admin',request,{method:'GET'}));
  if(path==='/api/admin') return nextResult(await nextCall('staff-admin',request));
  if(path==='/api/platform') return nextResult(await nextCall('platform-data',request));
  if(path==='/api/module') return nextModuleBridge(request,env);
  if(path==='/api/mega') return nextResult(await nextCall('mega-completion',request));
  if(path==='/api/customer/booking') return nextResult(await nextCall('get-booking',request));
  if(path==='/api/customer/book'&&request.method==='POST') return nextResult(await nextCall('create-booking',request));
  if(path==='/api/customer/auth') return nextResult(await nextCall('customer-auth',request));
  if(path==='/api/release') return nextResult(await nextCall('system-release',request));
  if(path==='/api/push') return nextResult(await nextCall('push-notifications',request));
  return nextJson({error:'API route not found',path},404);
}

export default {
  async fetch(request,env){
    process.env=env||{};
    const url=new URL(request.url);
    try{
      if(url.pathname.startsWith('/api/')) return await nextApi(request,env||{});
      const prefix='/.netlify/functions/';
      if(url.pathname.startsWith(prefix)){
        const name=url.pathname.slice(prefix.length).replace(/\/+$/,'');
        return nextResult(await nextCall(name,request));
      }
      if(url.pathname==='/health'||url.pathname==='/healthz') return nextJson({ok:true,service:'almaher-next'});
      if(env?.ASSETS) return env.ASSETS.fetch(request);
      return new Response('AL-MAHER NEXT assets binding missing',{status:500});
    }catch(error){
      console.error('AL-MAHER NEXT worker error',error);
      return nextJson({error:error?.message||'Worker error'},500);
    }
  }
};
