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

export function has(user,key){
  if(!user)return false;
  if(key==='manageBranches'){
    if(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all)return true;
    return !!(user.permissions?.manageBranches||user.permissions?.viewBranches||user.permissions?.addBranches||user.permissions?.editBranches||user.permissions?.manageCompanyProfile);
  }
  if(SENSITIVE_EXPLICIT_PERMISSIONS.has(key)){
    if(user.role==='developer')return true;
    return !!user.permissions?.[key];
  }
  if(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all)return true;
  return !!user.permissions?.[key];
}

export function canAccessDeveloperConsole(user){return has(user,'developer_console_access')}
export function allOps(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranches))}
export function allFinance(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranchesFinance))}
