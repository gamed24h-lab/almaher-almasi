import baseWorker from './index.js';
import * as crypto from 'node:crypto';

const SENSITIVE_KEYS=new Set([
  'developer_console_access','developer_backup','developer_restore','developer_purge',
  'developer_templates','developer_labels','developer_languages','developer_rules',
  'all','v9Admin','next_bridge'
]);

const APPROVAL_KEYS=new Set([
  'managePermissions','manageUsers','allBranches','allBranchesFinance','addBranches',
  'manageCompanyProfile','refund_approve','refund_complete','approvals','bookingDiscount'
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
const authHeaders=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'}};
const supaUrl=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');

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
  const url=supaUrl(env);const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!url||!key||!username)return null;
  const r=await fetch(`${url}/rest/v1/staff_users?username=eq.${encodeURIComponent(String(username).trim())}&select=id,name,username,role,branch_id,permissions,status,account_mode&limit=1`,{headers:authHeaders(env)});
  const rows=await r.json().catch(()=>[]);
  return r.ok&&Array.isArray(rows)?rows[0]||null:null;
}

async function verifyCurrentPassword(env,actor,password){
  if(actor?.role==='developer')return true;
  const url=supaUrl(env);if(!url||!actor?.id||!password)return false;
  const r=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(actor.id)}&select=password&limit=1`,{headers:authHeaders(env)});
  const rows=await r.json().catch(()=>[]),stored=String(Array.isArray(rows)?rows[0]?.password||'':'');
  if(!r.ok||!stored)return false;
  if(!stored.startsWith('scrypt$'))return stored===String(password);
  try{
    const [,salt,expectedHex]=stored.split('$');
    if(!salt||!expectedHex)return false;
    const actual=crypto.scryptSync(String(password),salt,64);
    const expected=Buffer.from(expectedHex,'hex');
    return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }catch{return false}
}

async function publicSetting(env,keyName){
  const url=supaUrl(env);const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
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
function requiresApproval(old,incoming){
  if(!old)return false;
  const a=old.permissions||{},b=incoming.permissions||{};
  for(const k of APPROVAL_KEYS)if(!!a[k]!==!!b[k])return true;
  if(rankOf(incoming.role)>rankOf(old.role))return true;
  const oldMode=String(old.account_mode||a._accountMode||'training');
  const newMode=String(incoming.account_mode||b._accountMode||oldMode);
  return oldMode!=='production'&&newMode==='production';
}

async function createPermissionApproval(env,actor,old,incoming){
  const url=supaUrl(env),h=authHeaders(env);
  const pending=await fetch(`${url}/rest/v1/approval_requests?request_type=eq.staff_permission_change&entity_id=eq.${encodeURIComponent(old.id)}&status=eq.pending&select=id&limit=1`,{headers:h});
  const pendingRows=await pending.json().catch(()=>[]);
  if(pending.ok&&Array.isArray(pendingRows)&&pendingRows.length)return json({error:'يوجد بالفعل طلب تعديل صلاحيات معلق لهذا الموظف.',code:'APPROVAL_ALREADY_PENDING'},409);
  const row={
    request_type:'staff_permission_change',entity_type:'staff_user',entity_id:String(old.id),branch_id:old.branch_id||null,
    requested_by:String(actor.id||actor.name||''),approver_role:'مدير عام',status:'pending',
    request_payload:{target_username:old.username,target_name:old.name||old.username,changes:{role:incoming.role||old.role,branch_id:incoming.branch_id??old.branch_id,status:incoming.status||old.status,account_mode:incoming.account_mode||old.account_mode||'training',permissions:incoming.permissions||old.permissions||{}}}
  };
  const r=await fetch(`${url}/rest/v1/approval_requests`,{method:'POST',headers:{...h,Prefer:'return=representation'},body:JSON.stringify([row])});
  const body=await r.json().catch(()=>[]);
  if(!r.ok)return json({error:body?.message||'تعذر إنشاء طلب الموافقة'},500);
  return json({ok:true,pending_approval:true,approval:Array.isArray(body)?body[0]:body,message:'تم إرسال التغيير للموافقة الثانية ولم يتم تطبيقه بعد.'},202);
}

async function listPermissionApprovals(request,env){
  const actor=await currentActor(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!(elevated(actor)||actor.permissions?.managePermissions||actor.permissions?.approvals))return json({error:'لا توجد صلاحية مراجعة طلبات الصلاحيات.'},403);
  const url=supaUrl(env),h=authHeaders(env);
  const r=await fetch(`${url}/rest/v1/approval_requests?request_type=eq.staff_permission_change&select=*&order=requested_at.desc&limit=100`,{headers:h});
  const rows=await r.json().catch(()=>[]);if(!r.ok)return json({error:rows?.message||'تعذر قراءة طلبات الموافقة'},500);
  return json({ok:true,rows:Array.isArray(rows)?rows:[]});
}

async function decidePermissionApproval(request,env,payload){
  const actor=await currentActor(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!(elevated(actor)||actor.permissions?.managePermissions||actor.permissions?.approvals))return json({error:'لا توجد صلاحية اعتماد تغييرات الصلاحيات.'},403);
  const id=String(payload?.id||''),decision=String(payload?.decision||'');
  if(!id||!['approve','reject'].includes(decision))return json({error:'بيانات قرار الموافقة غير مكتملة.'},400);
  const url=supaUrl(env),h=authHeaders(env);
  const r=await fetch(`${url}/rest/v1/approval_requests?id=eq.${encodeURIComponent(id)}&request_type=eq.staff_permission_change&select=*&limit=1`,{headers:h});
  const rows=await r.json().catch(()=>[]),req=Array.isArray(rows)?rows[0]:null;
  if(!r.ok||!req)return json({error:'طلب الموافقة غير موجود.'},404);
  if(req.status!=='pending')return json({error:'تم اتخاذ قرار على هذا الطلب بالفعل.'},409);
  if(String(req.requested_by||'')===String(actor.id||''))return json({error:'لا يمكن لطالب التغيير اعتماد طلبه بنفسه. يلزم مستخدم مخول آخر.'},403);
  const changes=req.request_payload?.changes||{};
  if(decision==='approve'){
    const target=await existingStaff(env,req.request_payload?.target_username||'');
    if(!target)return json({error:'الموظف المستهدف لم يعد موجودًا.'},404);
    if(actor.role!=='developer'&&rankOf(target.role)>rankOf(actor.role))return json({error:'لا يمكنك اعتماد تغيير لموظف أعلى منك إداريًا.'},403);
    const patch={role:changes.role||target.role,branch_id:changes.branch_id??target.branch_id,status:changes.status||target.status,permissions:changes.permissions||target.permissions||{},account_mode:changes.account_mode||target.account_mode||'training',updated_at:new Date().toISOString()};
    let ur=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(target.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify(patch)});
    if(!ur.ok){const eb=await ur.json().catch(()=>({}));if(/account_mode/i.test(String(eb?.message||''))){delete patch.account_mode;ur=await fetch(`${url}/rest/v1/staff_users?id=eq.${encodeURIComponent(target.id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify(patch)});}if(!ur.ok)return json({error:eb?.message||'تعذر تطبيق التغيير المعتمد'},500)}
  }
  const status=decision==='approve'?'approved':'rejected';
  const ar=await fetch(`${url}/rest/v1/approval_requests?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({status,approver_id:String(actor.id||actor.name||''),decision_notes:String(payload?.notes||''),decided_at:new Date().toISOString()})});
  if(!ar.ok)return json({error:'تم تنفيذ القرار وتعذر تحديث سجل الموافقة.'},500);
  return json({ok:true,status,message:decision==='approve'?'تم اعتماد التغيير وتطبيقه.':'تم رفض التغيير ولم تُعدّل الصلاحيات.'});
}

async function permissionReview(request,env){
  const actor=await currentActor(request,env);if(!actor)return json({error:'انتهت الجلسة.'},401);
  if(!(elevated(actor)||actor.permissions?.managePermissions))return json({error:'لا توجد صلاحية مراجعة الصلاحيات.'},403);
  const url=supaUrl(env),h=authHeaders(env);
  const [ur,ar]=await Promise.all([
    fetch(`${url}/rest/v1/staff_users?select=id,name,username,role,branch_id,status,permissions,account_mode&order=name.asc`,{headers:h}),
    fetch(`${url}/rest/v1/approval_requests?request_type=eq.staff_permission_change&status=eq.pending&select=id,entity_id,requested_by,requested_at`,{headers:h})
  ]);
  const users=await ur.json().catch(()=>[]),pending=await ar.json().catch(()=>[]);
  if(!ur.ok)return json({error:users?.message||'تعذر جمع بيانات مراجعة الصلاحيات.'},500);
  const issues=[];const rows=Array.isArray(users)?users:[];
  for(const u of rows){
    const p=u.permissions||{},role=String(u.role||'موظف'),stopped=String(u.status||'نشط').includes('موق')||String(u.status||'').toLowerCase()==='inactive';
    const devKeys=truthyKeys(p).filter(k=>SENSITIVE_KEYS.has(k));
    if(role!=='developer'&&devKeys.length)issues.push({severity:'critical',user_id:u.id,user_name:u.name||u.username,title:'صلاحيات مطور على حساب غير مطور',details:devKeys.join(', ')});
    const risky=truthyKeys(p).filter(k=>APPROVAL_KEYS.has(k));
    if(stopped&&risky.length)issues.push({severity:'high',user_id:u.id,user_name:u.name||u.username,title:'حساب موقوف ما زال يحمل صلاحيات حساسة',details:risky.join(', ')});
    if(p.allBranchesFinance&&rankOf(role)<70)issues.push({severity:'high',user_id:u.id,user_name:u.name||u.username,title:'مالية كل الفروع لمستوى إداري منخفض',details:role});
    if(p.managePermissions&&!p.manageUsers&&role!=='developer'&&role!=='مدير عام')issues.push({severity:'medium',user_id:u.id,user_name:u.name||u.username,title:'إدارة صلاحيات بدون إدارة مستخدمين',details:'راجع هل الفصل مقصود لهذا الحساب.'});
    const branchOps=['branchBooking','viewBookings','operations','finance','payments','expenses'].some(k=>!!p[k]);
    if(!u.branch_id&&rankOf(role)<90&&branchOps&&!p.allBranches)issues.push({severity:'medium',user_id:u.id,user_name:u.name||u.username,title:'حساب تشغيلي غير مربوط بفرع',details:'قد يسبب رفض عمليات نطاق الفرع أو سلوكًا غير متوقع.'});
  }
  const counts={critical:issues.filter(x=>x.severity==='critical').length,high:issues.filter(x=>x.severity==='high').length,medium:issues.filter(x=>x.severity==='medium').length,pending_approvals:Array.isArray(pending)?pending.length:0,users:rows.length};
  return json({ok:true,counts,issues,checked_at:new Date().toISOString()});
}

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

    if(!old&&[...APPROVAL_KEYS].some(k=>!!newPerms[k]))return json({error:'أنشئ الموظف أولًا بصلاحيات عادية، ثم اطلب الصلاحيات الحساسة بموافقة منفصلة.'},409);
    if(old&&requiresApproval(old,incoming)){
      if(!payload?.reauth_password)return json({error:'أعد إدخال كلمة مرورك الحالية لإرسال هذا التغيير للموافقة الثانية.',code:'REAUTH_REQUIRED'},428);
      if(!(await verifyCurrentPassword(env,actor,payload.reauth_password)))return json({error:'كلمة المرور الحالية غير صحيحة.',code:'REAUTH_FAILED'},401);
      return createPermissionApproval(env,actor,old,incoming);
    }
  }
  return null;
}

export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.pathname==='/api/mega'&&url.searchParams.get('action')==='public_brand_profile'&&request.method==='GET')return json(await publicBrandPayload(env));
      if(url.pathname==='/api/admin'&&request.method==='POST'){
        let body={};try{body=await request.clone().json()}catch{}
        if(body?.action==='security_permission_approvals_list')return listPermissionApprovals(request,env);
        if(body?.action==='security_permission_approval_decide')return decidePermissionApproval(request,env,body);
        if(body?.action==='security_permission_review')return permissionReview(request,env);
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
