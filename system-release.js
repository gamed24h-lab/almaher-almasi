async function developerFromToken(url,key,token){
  if(!token)return null;
  const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
  const ur=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const user=await ur.json().catch(()=>({}));
  if(!ur.ok||!user?.id)return null;
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
