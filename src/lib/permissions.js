export function has(user,key){if(!user)return false;if(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all)return true;return !!user.permissions?.[key]}
export function allOps(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranches))}
export function allFinance(user){return !!(user&&(user.role==='مدير عام'||user.role==='developer'||user.permissions?.all||user.permissions?.allBranchesFinance))}
