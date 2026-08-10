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