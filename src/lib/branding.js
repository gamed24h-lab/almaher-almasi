const LOGO_RE=/\[ALMAHER_BRANCH_LOGO:([^\]]*)\]/i;
export function branchLogo(branch){
 const direct=String(branch?.logo_url||branch?.logoUrl||'').trim();if(direct)return direct;
 const notes=String(branch?.notes||'');const m=notes.match(LOGO_RE);return String(m?.[1]||'').trim()||'/almaher-logo.jpeg';
}
export function visibleBranchNotes(notes){return String(notes||'').replace(LOGO_RE,'').trim()}
export function notesWithBranchLogo(notes,logoUrl){const clean=visibleBranchNotes(notes);const logo=String(logoUrl||'').trim();return [clean,logo?`[ALMAHER_BRANCH_LOGO:${logo}]`:''].filter(Boolean).join('\n')}
