const LOGO_RE=/\[ALMAHER_BRANCH_LOGO:([^\]]*)\]/i;
const LICENSE_RE=/\[ALMAHER_BRANCH_LICENSE:([^\]]*)\]/i;
export function branchLogo(branch){
 const direct=String(branch?.logo_url||branch?.logoUrl||'').trim();if(direct)return direct;
 const notes=String(branch?.notes||'');const m=notes.match(LOGO_RE);return String(m?.[1]||'').trim()||'/almaher-logo.jpeg';
}
export function branchLicense(branch){
 const direct=String(branch?.license_number||branch?.license_no||branch?.travel_license_number||branch?.travel_license_no||'').trim();if(direct)return direct;
 const notes=String(branch?.notes||'');const m=notes.match(LICENSE_RE);return String(m?.[1]||'').trim();
}
export function visibleBranchNotes(notes){return String(notes||'').replace(LOGO_RE,'').replace(LICENSE_RE,'').trim()}
export function notesWithBranchLogo(notes,logoUrl){const clean=visibleBranchNotes(notes);const logo=String(logoUrl||'').trim();return [clean,logo?`[ALMAHER_BRANCH_LOGO:${logo}]`:''].filter(Boolean).join('\n')}
export function notesWithBranchMeta(notes,logoUrl,licenseNumber){const clean=visibleBranchNotes(notes);const logo=String(logoUrl||'').trim();const license=String(licenseNumber||'').trim();return [clean,logo?`[ALMAHER_BRANCH_LOGO:${logo}]`:'',license?`[ALMAHER_BRANCH_LICENSE:${license}]`:''].filter(Boolean).join('\n')}
