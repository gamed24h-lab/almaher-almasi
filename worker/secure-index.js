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
  const r=await fetch(`${url}/rest/v1/staff_users?username=eq.${encodeURIComponent(String(username).trim())}&select=id,name,username,role,permissions,status,account_mode&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}});
  const rows=await r.json().catch(()=>[]);
  return r.ok&&Array.isArray(rows)?rows[0]||null:null;
}

async function publicSetting(env,keyName){
  const url=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!url||!key)return null;
  try{
    const r=await fetch(`${url}/rest/v1/system_settings?key=eq.${encodeURIComponent(keyName)}&select=value&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}});
    const rows=await r.json().catch(()=>[]);
    return r.ok&&Array.isArray(rows)?rows[0]?.value??null:null;
  }catch{return null}
}

async function publicBrandPayload(env){
  const [profile,labels,config]=await Promise.all([
    publicSetting(env,'developer.profile.v1'),
    publicSetting(env,'developer.ui_labels.v1'),
    publicSetting(env,'developer.ui_config.v1')
  ]);
  const p=profile&&typeof profile==='object'?profile:{};
  const l=labels&&typeof labels==='object'?labels:{};
  const c=config&&typeof config==='object'?config:{};
  return {
    ok:true,
    profile:{display_name:String(p.display_name||''),title:String(p.title||''),phone:String(p.phone||''),email:String(p.email||''),footer_note:String(p.footer_note||'')},
    labels:{system_name:String(l.system_name||''),system_subtitle:String(l.system_subtitle||''),dashboard_title:String(l.dashboard_title||''),dashboard_subtitle:String(l.dashboard_subtitle||''),ticket_footer:String(l.ticket_footer||''),report_footer:String(l.report_footer||'')},
    config:{show_profile_all_pages:c.show_profile_all_pages!==false,show_profile_tickets:c.show_profile_tickets!==false,show_profile_reports:c.show_profile_reports!==false,show_profile_receipts:c.show_profile_receipts!==false}
  };
}

function sameSensitive(a={},b={}){for(const k of SENSITIVE_KEYS)if(!!a?.[k]!==!!b?.[k])return false;return true}
function canonicalPermissions(obj={}){const out={};for(const k of Object.keys(obj||{}).sort())out[k]=obj[k];return JSON.stringify(out)}
function canGrant(actor,key){if(actor?.role==='developer')return true;if(SENSITIVE_KEYS.has(key))return false;if(actor?.role==='مدير عام'||actor?.permissions?.all)return true;return !!actor?.permissions?.[key]}
function elevated(actor){return !!(actor&&(actor.role==='developer'||actor.role==='مدير عام'||actor.permissions?.all))}
function canBranch(actor,key){if(elevated(actor))return true;const p=actor?.permissions||{};if(p.manageBranches)return true;return !!p[key]}

async function guardSyncUsers(request,env,payload){
  const actor=await currentActor(request,env);
  if(!actor)return json({error:'انتهت الجلسة. سجل الدخول من جديد.'},401);
  const isDeveloper=String(actor.role||'').toLowerCase()==='developer';
  const canManageData=isDeveloper||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.manageUsers;
  const canManagePermissions=isDeveloper||actor.role==='مدير عام'||actor.permissions?.all||actor.permissions?.managePermissions;
  if(!canManageData&&!canManagePermissions)return json({error:'لا توجد صلاحية إدارة الموظفين.'},403);
  if(isDeveloper)return null;

  const actorRank=rankOf(actor.role);
  const rows=Array.isArray(payload?.rows)?payload.rows:[];
  for(const incoming of rows){
    if(!incoming?.username)continue;
    const old=await existingStaff(env,incoming.username);
    const oldPerms=old?.permissions||{};
    const newPerms=incoming.permissions&&typeof incoming.permissions==='object'?incoming.permissions:{};
    if(old&&String(old.id)===String(actor.id))return json({error:'لا يمكنك تعديل حسابك أو صلاحياتك من حسابك الحالي. اطلب ذلك من مستوى إداري أعلى.'},403);
    if(old?.role==='developer'||truthyKeys(oldPerms).some(k=>SENSITIVE_KEYS.has(k)))return json({error:'هذا الحساب محمي ولا يمكن تعديله إلا من حساب المطور الحقيقي.'},403);
    if(String(incoming.role||'')==='developer')return json({error:'لا يمكن إنشاء أو تحويل أي موظف إلى مطور من إدارة الموظفين.'},403);
    if(old&&rankOf(old.role)>actorRank)return json({error:`لا يمكنك تعديل موظف أعلى منك في المستوى الإداري (${old.role}).`},403);

    if(!canManagePermissions){
      if(old){
        if(String(incoming.role||old.role)!==String(old.role))return json({error:'تغيير الدور يتطلب صلاحية إدارة الصلاحيات.'},403);
        if(canonicalPermissions(newPerms)!==canonicalPermissions(oldPerms))return json({error:'تغيير صلاحيات الموظف يتطلب صلاحية إدارة الصلاحيات.'},403);
        const oldMode=String(old.account_mode||oldPerms?._accountMode||'training');
        const newMode=String(incoming.account_mode||newPerms?._accountMode||oldMode);
        if(newMode!==oldMode)return json({error:'تغيير وضع الحساب بين التدريب والتشغيل الفعلي يتطلب صلاحية إدارة الصلاحيات.'},403);
      }else{
        if(String(incoming.role||'موظف')!=='موظف')return json({error:'إنشاء موظف بدور وظيفي مخصص يتطلب صلاحية إدارة الصلاحيات.'},403);
        const granted=truthyKeys(newPerms).filter(k=>!k.startsWith('_'));
        if(granted.length)return json({error:'من لديه إدارة بيانات الموظفين فقط لا يمكنه منح صلاحيات للموظف الجديد.'},403);
        if(String(incoming.account_mode||newPerms?._accountMode||'training')!=='training')return json({error:'الحساب الجديد يبدأ بوضع التدريب ما لم يملِك المنشئ صلاحية إدارة الصلاحيات.'},403);
      }
      continue;
    }

    if(rankOf(incoming.role)>actorRank)return json({error:`لا يمكنك منح دور أعلى من مستواك الإداري (${incoming.role}).`},403);
    if(!sameSensitive(oldPerms,newPerms))return json({error:'صلاحيات المطور والصلاحيات السيادية لا يمكن تعديلها من إدارة الموظفين العادية.'},403);
    for(const k of truthyKeys(newPerms)){if(k.startsWith('_'))continue;if(!canGrant(actor,k))return json({error:`لا يمكنك منح صلاحية لا تملكها: ${k}`},403)}
  }
  return null;
}

async function guardBranchAdmin(request,payload){
  const actor=await currentActor(request,request.__env);
  if(!actor)return json({error:'انتهت الجلسة. سجل الدخول من جديد.'},401);
  const action=payload?.action;
  if(action==='save_branch'){
    const editing=!!payload?.row?.id;
    const needed=editing?'editBranches':'addBranches';
    if(!canBranch(actor,needed))return json({error:editing?'لا تملك صلاحية تعديل الفروع.':'لا تملك صلاحية إضافة الفروع.'},403);
  }
  if(action==='company_settings_save'&&!canBranch(actor,'manageCompanyProfile'))return json({error:'لا تملك صلاحية تعديل بيانات الشركة العامة.'},403);
  return null;
}

export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.pathname==='/api/mega'&&url.searchParams.get('action')==='public_brand_profile'&&request.method==='GET')return json(await publicBrandPayload(env));
      if(url.pathname==='/api/admin'&&request.method==='POST'){
        let body={};try{body=await request.clone().json()}catch{}
        if(body?.action==='sync_users'){
          const denied=await guardSyncUsers(request,env,body);
          if(denied)return denied;
        }
        if(body?.action==='save_branch'||body?.action==='company_settings_save'){
          const actor=await currentActor(request,env);
          if(!actor)return json({error:'انتهت الجلسة. سجل الدخول من جديد.'},401);
          if(body.action==='save_branch'){
            const editing=!!body?.row?.id;
            if(!canBranch(actor,editing?'editBranches':'addBranches'))return json({error:editing?'لا تملك صلاحية تعديل الفروع.':'لا تملك صلاحية إضافة الفروع.'},403);
          }
          if(body.action==='company_settings_save'&&!canBranch(actor,'manageCompanyProfile'))return json({error:'لا تملك صلاحية تعديل بيانات الشركة العامة.'},403);
        }
      }
      return baseWorker.fetch(request,env);
    }catch(error){
      console.error('AL-MAHER security wrapper error',error);
      return json({error:error?.message||'تعذر التحقق من الصلاحيات'},500);
    }
  }
};
