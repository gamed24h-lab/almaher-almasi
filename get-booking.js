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

   console.log("lookup request", {bookingNo, hasVerification:!!verification, method:event.httpMethod});

   if(!bookingNo||!verification)
     return{statusCode:400,headers,body:JSON.stringify({error:"أدخل رقم الحجز ورقم الجوال أو الهوية"})};

   const url=(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
   if(!url||!key)
     return{statusCode:500,headers,body:JSON.stringify({error:"إعدادات Supabase على الخادم غير مكتملة"})};

   const h={apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json"};
   const r=await fetch(`${url}/rest/v1/bookings?select=*&booking_number=eq.${encodeURIComponent(bookingNo)}&limit=1`,{headers:h});
   const rows=await r.json();
   console.log("booking query status", r.status, "rows", Array.isArray(rows)?rows.length:"n/a");

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
   return{statusCode:200,headers,body:JSON.stringify({booking})};
 }catch(e){
   console.error("get-booking error",e);
   return{statusCode:502,headers,body:JSON.stringify({error:e.message||"تعذر الاستعلام"})};
 }
};