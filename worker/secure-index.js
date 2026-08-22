import baseWorker from './index.js';

const SENSITIVE_KEYS=new Set([
  'developer_console_access','developer_backup','developer_restore','developer_purge',
  'developer_templates','developer_labels','developer_languages','developer_rules',
  'all','v9Admin','next_bridge'
]);

const ROLE_RANK={
  'developer':100,
  'مدير عام':90,
  'مدير فرع':70,
  'مشرف تشغيل':60,
  'محاسب':50,
  'موظف تسكين':40,
  'موظف حجوزات':40,
  'خدمة عملاء':40,
  'موظف':30
};

const rankOf=role=>ROLE_RANK[String(role||'').trim()]||20;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const truthyKeys=obj=>Object.entries(obj&&typeof obj==='object'?obj:{}).filter(([,v])=>!!v).map(([k])=>k);

async function currentActor(request,env){
  try{
    const u=new URL('/api/auth/me',request.url);
    const r=await baseWorker.fetch(new Request(u,{method:'GET',headers:request.headers}),env);
    if(!r.ok)return null;
    const b=await r.json().catch(()=>({}));
    return b?.user||null;
  }catch{return null}
}

async function existingStaff(env,username){
  const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!url||!key||!username)return null;
  const r=await fetch(`${url}/rest/v1/staff_users?username=eq.${encodeURIComponent(String(username).trim())}&select=id,name,username,role,permissions,status&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}});
  const rows=await r.json().catch(()=>[]);
  return r.ok&&Array.isArray(rows)?rows[0]||null:null;
}

function sameSensitive(a={},b={}){
  for(const k of SENSITIVE_KEYS)if(!!a?.[k]!==!!b?.[k])return false;
  return true;
}

function canGrant(actor,key){
  if(actor?.role==='developer')return true;
  if(SENSITIVE_KEYS.has(key))return false;
  if(actor?.role==='مدير عام'||actor?.permissions?.all)return true;
  return !!actor?.permissions?.[key];
}

async function guardSyncUsers(request,env,payload){
  const actor=await currentActor(request,env);
  if(!actor)return json({error:'انتهت الجلسة. سجل الدخول من جديد.'},401);
  const isDeveloper=String(actor.role||'').toLowerCase()==='developer';
  const canManage=isDeveloper||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.manageUsers;
  if(!canManage)return json({error:'لا توجد صلاحية إدارة الموظفين.'},403);
  if(isDeveloper)return null;

  const actorRank=rankOf(actor.role);
  const rows=Array.isArray(payload?.rows)?payload.rows:[];
  for(const incoming of rows){
    if(!incoming?.username)continue;
    const old=await existingStaff(env,incoming.username);
    const oldPerms=old?.permissions||{};
    const newPerms=incoming.permissions&&typeof incoming.permissions==='object'?incoming.permissions:{};

    if(old&&String(old.id)===String(actor.id))return json({error:'لا يمكنك تعديل دورك أو صلاحياتك من حسابك الحالي. اطلب ذلك من مستوى إداري أعلى.'},403);
    if(old?.role==='developer'||truthyKeys(oldPerms).some(k=>SENSITIVE_KEYS.has(k)))return json({error:'هذا الحساب محمي ولا يمكن تعديله إلا من حساب المطور الحقيقي.'},403);
    if(String(incoming.role||'')==='developer')return json({error:'لا يمكن إنشاء أو تحويل أي موظف إلى مطور من إدارة الموظفين.'},403);
    if(old&&rankOf(old.role)>actorRank)return json({error:`لا يمكنك تعديل موظف أعلى منك في المستوى الإداري (${old.role}).`},403);
    if(rankOf(incoming.role)>actorRank)return json({error:`لا يمكنك منح دور أعلى من مستواك الإداري (${incoming.role}).`},403);
    if(!sameSensitive(oldPerms,newPerms))return json({error:'صلاحيات المطور والصلاحيات السيادية لا يمكن تعديلها من إدارة الموظفين العادية.'},403);

    for(const k of truthyKeys(newPerms)){
      if(k.startsWith('_'))continue;
      if(!canGrant(actor,k))return json({error:`لا يمكنك منح صلاحية لا تملكها: ${k}`},403);
    }
  }
  return null;
}

export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.pathname==='/api/admin'&&request.method==='POST'){
        let body={};try{body=await request.clone().json()}catch{}
        if(body?.action==='sync_users'){
          const denied=await guardSyncUsers(request,env,body);
          if(denied)return denied;
        }
      }
      return baseWorker.fetch(request,env);
    }catch(error){
      console.error('AL-MAHER security wrapper error',error);
      return json({error:error?.message||'تعذر التحقق من الصلاحيات'},500);
    }
  }
};
