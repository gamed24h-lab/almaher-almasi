const crypto = require("crypto");
const {issue}=require("./_staff-session");

function verifyPassword(input, stored){
  stored=String(stored||"");
  if(stored.startsWith("scrypt$")){
    const parts=stored.split("$");
    if(parts.length!==3)return false;
    const hash=crypto.scryptSync(String(input), parts[1], 64).toString("hex");
    try{
      return crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(parts[2],"hex"));
    }catch{return false}
  }
  return stored===String(input);
}

exports.handler=async(event)=>{
  const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
  if(event.httpMethod!=="POST")return{statusCode:405,headers:H,body:JSON.stringify({error:"Method not allowed"})};

  let p={};try{p=JSON.parse(event.body||"{}")}catch{}
  const identity=String(p.identity||"").trim();
  const password=String(p.password||"");
  const method=String(p.method||"username");
  if(!identity||!password)return{statusCode:400,headers:H,body:JSON.stringify({error:"أدخل بيانات الدخول"})};

  const url=(process.env.SUPABASE_URL||"").replace(/\/+$/,"");
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:"إعدادات Supabase على الخادم غير مكتملة"})};

  const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:"application/json"};
  try{
    const field=method==="phone"?"phone":"username";
    const r=await fetch(`${url}/rest/v1/staff_users?select=id,name,username,password,phone,role,branch_id,status,permissions&${field}=eq.${encodeURIComponent(identity)}&limit=1`,{headers:sh});
    const rows=await r.json().catch(()=>[]);
    if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:rows?.message||"تعذر قراءة المستخدم"})};

    const u=Array.isArray(rows)?rows[0]:null;
    if(!u||!verifyPassword(password,u.password)){
      return{statusCode:401,headers:H,body:JSON.stringify({error:"اسم المستخدم أو كلمة المرور غير صحيحة"})};
    }
    if(u.status&&u.status!=="نشط"){
      return{statusCode:403,headers:H,body:JSON.stringify({error:"هذا الحساب غير نشط"})};
    }

    const safe={id:u.id,name:u.name,username:u.username,phone:u.phone,role:u.role,branch_id:u.branch_id,status:u.status,permissions:u.permissions};
    const session_token=issue({id:u.id,name:u.name,role:u.role,branch_id:u.branch_id||null,permissions:u.permissions||{}},key);
    return{statusCode:200,headers:H,body:JSON.stringify({user:safe,session_token})};
  }catch(e){
    return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||"تعذر تسجيل الدخول"})};
  }
};