export const ATTENDANCE_WITH_PERMISSION='حضور + استئذان';

export function resolveAttendanceDayStatus({
  leave=false,
  off=false,
  periodsCount=0,
  punches=0,
  excusedPeriods=0,
  missedPeriods=0,
  missingPunches=0,
  shortageMinutes=0,
  partialThreshold=60,
  approvedPermissionMinutes=0
}={}){
  const periods=Math.max(0,Number(periodsCount)||0);
  const punchCount=Math.max(0,Number(punches)||0);
  const excused=Math.max(0,Number(excusedPeriods)||0);
  const missed=Math.max(0,Number(missedPeriods)||0);
  const missing=Math.max(0,Number(missingPunches)||0);
  const shortage=Math.max(0,Number(shortageMinutes)||0);
  const threshold=Math.max(0,Number(partialThreshold)||60);
  const permission=Math.max(0,Number(approvedPermissionMinutes)||0);

  if(leave)return 'إجازة';
  if(off&&punchCount===0)return 'راحة';
  if(periods>0&&punchCount===0&&excused===periods)return 'استئذان';
  if(periods>0&&punchCount===0)return 'غياب';
  if(punchCount>0&&periods>0&&(missed>0||missing>0||shortage>=threshold))return 'حضور جزئي';
  if(punchCount>0&&periods>0&&permission>0)return ATTENDANCE_WITH_PERMISSION;
  if(punchCount>0&&periods>0)return 'حضور';
  if(punchCount>0)return 'حضور خارج الجدول';
  return 'راحة';
}
