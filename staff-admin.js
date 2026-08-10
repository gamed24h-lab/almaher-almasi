const crypto=require('crypto');
const {verify}=require('./_staff-session');
function has(s,p){return s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.[p]}
function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(String(password),salt,64).toString('hex');return `scrypt$${salt}$${hash}`}
function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''))}
function bookingStatusDb(v){const m={'جديد':'new','تحت الإجراء':'new','مؤكد':'confirmed','مدفوع':'paid','ملغي':'cancelled','مستخدم':'used','تم الاستخدام':'used','مكتمل':'completed','منتهي':'completed'};return m[v]||String(v||'new').toLowerCase()}
function sourceDb(v){return v==='فرع'?'staff':'customer'}
exports.handler=async(event)=>{
 const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
 const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';const session=verify(token,key);
 if(!session)return{statusCode:401,headers:H,body:JSON.stringify({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'})};
 const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
 try{
  if(event.httpMethod==='GET'){
   const action=event.queryStringParameters?.action||'bootstrap';
   if(action!=='bootstrap')return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
   const branchFilter=session.role==='مدير عام'||has(session,'allBranches')?'':session.branch_id?`&branch_id=eq.${encodeURIComponent(session.branch_id)}`:'&branch_id=is.null';
   const [br,bc,tr,bk,bp]=await Promise.all([
    fetch(`${url}/rest/v1/branches?select=*&order=name.asc`,{headers:sh}),
    fetch(`${url}/rest/v1/branch_contacts?select=*&order=sort_order.asc`,{headers:sh}),
    fetch(`${url}/rest/v1/trips?select=*&order=departure_date.asc,departure_time.asc${branchFilter}`,{headers:sh}),
    fetch(`${url}/rest/v1/bookings?select=*&order=created_at.desc${branchFilter}`,{headers:sh}),
    fetch(`${url}/rest/v1/booking_passengers?select=*&order=passenger_order.asc`,{headers:sh})
   ]);
   const [BR,BC,TR,BK,BP]=await Promise.all([br.json().catch(()=>[]),bc.json().catch(()=>[]),tr.json().catch(()=>[]),bk.json().catch(()=>[]),bp.json().catch(()=>[])]);
   if(!br.ok||!bc.ok||!tr.ok||!bk.ok||!bp.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'تعذر تحميل بيانات التشغيل من السحابة'})};
   const allowedBookingIds=new Set((Array.isArray(BK)?BK:[]).map(x=>x.id));
   return{statusCode:200,headers:H,body:JSON.stringify({branches:BR,branchContacts:BC,trips:TR,bookings:BK,passengers:(Array.isArray(BP)?BP:[]).filter(x=>allowedBookingIds.has(x.booking_id))})};
  }
  if(event.httpMethod!=='POST')return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
  let p={};try{p=JSON.parse(event.body||'{}')}catch{}
  const action=String(p.action||'');
  if(action==='sync_trips'){
   if(!has(session,'trips'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إدارة الرحلات'})};
   const rows=Array.isArray(p.rows)?p.rows:[];if(!rows.length)return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count:0})};
   for(const r of rows){if(session.role!=='مدير عام'&&!has(session,'allBranches')&&session.branch_id&&String(r.branch_id||'')!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'إحدى الرحلات تتبع فرعًا غير مصرح به'})};}
   const clean=rows.map(r=>({trip_code:r.trip_code,trip_name:r.trip_name,from_city:r.from_city,to_city:r.to_city,departure_date:r.departure_date||null,departure_time:r.departure_time||null,return_date:r.return_date||null,return_time:r.return_time||null,bus_type:r.bus_type||null,bus_number:r.bus_number||null,bus_plate:r.bus_plate||null,bus_capacity:Number(r.bus_capacity||0),remaining_seats:Number(r.remaining_seats||0),branch_id:isUuid(r.branch_id)?r.branch_id:null,price_one_way:Number(r.price_one_way||0),price_no_accommodation:Number(r.price_no_accommodation||0),price_shared:Number(r.price_shared||0),price_private_room:Number(r.price_private_room||0),hotel_name:r.hotel_name||null,hotel_city:r.hotel_city||null,status:r.status||'available',publish_scope:r.publish_scope||'internal',visibility:r.visibility||'visible',lifecycle:r.lifecycle||'open',operational_notes:r.operational_notes||null,updated_at:new Date().toISOString()}));
   const rr=await fetch(`${url}/rest/v1/trips?on_conflict=trip_code`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(clean)});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر حفظ الرحلات'})};
   return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count:Array.isArray(rb)?rb.length:clean.length,rows:rb})};
  }
  if(action==='save_branch'){
   if(session.role!=='مدير عام'&&!has(session,'manageBranches'))return{statusCode:403,headers:H,body:JSON.stringify({error:'اعتماد بيانات الفروع للمدير العام فقط'})};
   const r=p.row||{};if(!r.name)return{statusCode:400,headers:H,body:JSON.stringify({error:'اسم الفرع مطلوب'})};
   const rec={name:r.name,status:r.status==='موقوف'?'inactive':'active',address:r.address||null,whatsapp:r.whatsapp||null,manager_name:r.manager||null,notes:r.notes||null,commercial_registration:r.commercialRegistration||null,tax_number:r.taxNumber||null,email:r.email||null,working_hours:r.workingHours||null,map_url:r.mapUrl||null,show_legal_on_ticket:r.showLegalOnTicket!==false};
   let rr;if(isUuid(r.id))rr=await fetch(`${url}/rest/v1/branches?id=eq.${encodeURIComponent(r.id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(rec)});else rr=await fetch(`${url}/rest/v1/branches`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});
   const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر حفظ الفرع'})};const saved=Array.isArray(rb)?rb[0]:null;
   if(saved?.id&&Array.isArray(r.contacts)){await fetch(`${url}/rest/v1/branch_contacts?branch_id=eq.${encodeURIComponent(saved.id)}`,{method:'DELETE',headers:sh});if(r.contacts.length){await fetch(`${url}/rest/v1/branch_contacts`,{method:'POST',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify(r.contacts.map((c,i)=>({branch_id:saved.id,label:c.label||'رقم التواصل',phone:c.phone||c.number||'',sort_order:i+1})))})}}
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
     if(!rec.password)rec.password=hashPassword('ChangeMe123!');
     const rr=await fetch(`${url}/rest/v1/staff_users`,{method:'POST',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify([rec])});
     if(!rr.ok){const e=await rr.json().catch(()=>({}));return{statusCode:500,headers:H,body:JSON.stringify({error:e.message||'تعذر إنشاء موظف'})};}
    }
    count++;
   }
   return{statusCode:200,headers:H,body:JSON.stringify({ok:true,count})};
  }
  if(action==='update_booking'){
   if(!has(session,'editBookings')&&!has(session,'confirmBookings')&&!has(session,'payments'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية تعديل الحجز'})};
   const b=p.booking||{};const bookingNo=String(b.number||b.booking_number||'');if(!bookingNo)return{statusCode:400,headers:H,body:JSON.stringify({error:'رقم الحجز مطلوب'})};
   const existing=await fetch(`${url}/rest/v1/bookings?booking_number=eq.${encodeURIComponent(bookingNo)}&select=id,branch_id,total_price,paid_amount,status&limit=1`,{headers:sh});const er=await existing.json().catch(()=>[]);const old=Array.isArray(er)?er[0]:null;if(!old)return{statusCode:404,headers:H,body:JSON.stringify({error:'الحجز غير موجود سحابيًا'})};
   if(session.role!=='مدير عام'&&!has(session,'allBranches')&&session.branch_id&&String(old.branch_id||'')!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'الحجز خارج فرعك'})};
   const patch={updated_at:new Date().toISOString(),last_modified_by:session.name||session.id,last_modified_at:new Date().toISOString()};
   if(has(session,'confirmBookings')||has(session,'cancelBookings'))patch.status=bookingStatusDb(b.status);
   if(has(session,'payments')){patch.paid_amount=Number(b.paidAmount||0);patch.payment_method=b.paymentMethod||null;patch.financial_status=Number(b.paidAmount||0)<=0?'unpaid':Number(b.paidAmount||0)>=Number(b.totalPrice||old.total_price||0)?'paid':'partial';}
   if(has(session,'editBookings')){Object.assign(patch,{customer_name:b.name||undefined,customer_phone:b.phone||undefined,customer_identity:b.identity||undefined,customer_gender:b.gender||undefined,customer_nationality:b.nationality||undefined,notes:b.notes||undefined,accommodation_type:b.accommodationType||undefined,accommodation_label:b.accommodationLabel||undefined,private_rooms:Number(b.privateRooms||0),private_room_types:Array.isArray(b.privateRoomTypes)?b.privateRoomTypes:[],total_price:Number(b.totalPrice||old.total_price||0),ticket_version:Number(b.ticketVersion||1)});}
   Object.keys(patch).forEach(k=>patch[k]===undefined&&delete patch[k]);
   const rr=await fetch(`${url}/rest/v1/bookings?id=eq.${encodeURIComponent(old.id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify(patch)});const rb=await rr.json().catch(()=>[]);if(!rr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rb?.message||'تعذر تحديث الحجز'})};
   if(has(session,'editPassenger')&&Array.isArray(b.passengerDetails)){await fetch(`${url}/rest/v1/booking_passengers?booking_id=eq.${encodeURIComponent(old.id)}`,{method:'DELETE',headers:sh});if(b.passengerDetails.length){const prs=b.passengerDetails.map((x,i)=>({booking_id:old.id,passenger_order:i+1,full_name:x.name||'',gender:x.gender||null,nationality:x.nationality||null,identity_number:x.identity||'',phone:x.phone||null,status:x.status||'confirmed',accommodation_status:x.accommodationStatus||'active'}));const pr=await fetch(`${url}/rest/v1/booking_passengers`,{method:'POST',headers:{...sh,Prefer:'return=minimal'},body:JSON.stringify(prs)});if(!pr.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'تم تحديث الحجز لكن تعذر تحديث المسافرين'})}}}
   return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:Array.isArray(rb)?rb[0]:null})};
  }
  return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
 }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Staff admin error'})}}
};
