const SENSITIVE_EXPLICIT_PERMISSIONS=new Set([
  'developer_console_access',
  'developer_backup',
  'developer_restore',
  'developer_purge',
  'developer_templates',
  'developer_labels',
  'developer_languages',
  'developer_rules',
]);

const ID_STUDIO_EXPLICIT_PERMISSIONS=new Set([
  'id_studio_access',
  'id_card_view',
  'id_card_create',
  'id_card_edit',
  'id_card_approve',
  'id_card_print',
  'id_card_export',
  'id_card_reissue',
  'id_card_revoke',
  'id_card_link_employee',
  'id_card_view_all_branches',
  'id_card_manage_templates',
  'id_card_manage_settings',
  'id_card_import',
  'id_card_audit_view',
]);

export function has(user,key){
  if(!user)return false;
  if(key==='manageBranches'){
    if(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all)return true;
    return !!(user.permissions?.manageBranches||user.permissions?.viewBranches||user.permissions?.addBranches||user.permissions?.editBranches||user.permissions?.manageCompanyProfile);
  }
  // Developer keeps sovereign access. For everyone else these permissions are
  // deliberately explicit: General Manager / `all` / staff-management access
  // must NOT silently grant ID Studio access.
  if(SENSITIVE_EXPLICIT_PERMISSIONS.has(key)||ID_STUDIO_EXPLICIT_PERMISSIONS.has(key)){
    if(user.role==='developer')return true;
    return !!user.permissions?.[key];
  }
  if(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all)return true;
  return !!user.permissions?.[key];
}

export function canAccessDeveloperConsole(user){return has(user,'developer_console_access')}
export function canAccessIDStudio(user){return has(user,'id_studio_access')}
export function allOps(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranches))}
export function allFinance(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranchesFinance))}
