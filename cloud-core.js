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
      const settings=p.settings&&typeof p.settings==="object"?p.settings:{};
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
          if(!record.password) record.password=hashPassword("ChangeMe123!");
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