import appWorker from './agent-collections-center-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const plain=(body='OK',status=200)=>new Response(String(body),{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const serviceKey=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:serviceKey(env),Authorization:'Bearer '+serviceKey(env),Accept:'application/json','Content-Type':'application/json'});
const txt=v=>String(v??'').trim();
const enc=v=>encodeURIComponent(String(v??''));
const lower=v=>txt(v).toLowerCase();
const isDeveloper=u=>lower(u?.role)==='developer';
const elevated=u=>!!u&&(isDeveloper(u)||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranches===true);
const canView=u=>!!u&&(elevated(u)||u.permissions?.attendance_view===true||u.permissions?.attendance_manage_devices===true||u.permissions?.attendance_manage_links===true||u.permissions?.attendance_manage_employees===true||u.permissions?.attendance_manage_biometrics===true||u.permissions?.attendance_manage_schedules===true||u.permissions?.attendance_manage_policies===true||u.permissions?.attendance_review_violations===true||u.permissions?.attendance_close_month===true||u.permissions?.attendance_reopen_month===true||u.permissions?.attendance_delete_employees===true||u.permissions?.attendance_reports===true);
const canManageDevices=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_devices===true);
const canManageLinks=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_links===true);
const canManageEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_employees===true);
const canManageBiometrics=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_biometrics===true);
const canManageSchedules=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_schedules===true);
const canManagePolicies=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_policies===true);
const canReviewViolations=u=>!!u&&(elevated(u)||u.permissions?.attendance_review_violations===true);
const canCloseMonth=u=>!!u&&(elevated(u)||u.permissions?.attendance_close_month===true);
const canReopenMonth=u=>!!u&&(elevated(u)||u.permissions?.attendance_reopen_month===true);
const canDeleteEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_delete_employees===true);
const canReports=u=>!!u&&(elevated(u)||u.permissions?.attendance_reports===true);
const actorId=u=>txt(u?.id||u?.username||u?.email||'');
const actorName=u=>txt(u?.name||u?.username||u?.email||'');
const accountMode=u=>u?.permissions?._accountMode==='production'?'production':'training';

async function readJson(response){const text=await response.text();try{return text?JSON.parse(text):{}}catch{return {error:text||('HTTP '+response.status)}}}
async function rest(env,path,{method='GET',body,prefer}={}){const h=headers(env);if(prefer)h.Prefer=prefer;const r=await fetch(base(env)+'/rest/v1/'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||('Database request failed ('+r.status+')'));e.status=r.status;throw e}return b}
async function actor(request,env,ctx){try{const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);if(!r.ok)return null;return (await readJson(r))?.user||null}catch{return null}}
function clientIp(request){return txt(request.headers.get('CF-Connecting-IP')||request.headers.get('X-Forwarded-For')||'').split(',')[0].trim()}
function serialFrom(url){return txt(url.searchParams.get('SN')||url.searchParams.get('sn')).toUpperCase()}
function safeInt(v){const n=Number.parseInt(txt(v),10);return Number.isFinite(n)?n:null}
function parseSaudiDeviceTime(raw){const value=txt(raw);if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value))return null;const d=new Date(value.replace(' ','T')+'+03:00');return Number.isNaN(d.getTime())?null:d.toISOString()}
function dedupe(deviceId,pin,time,statusCode,verifyCode,workCode){return [deviceId,pin,time,statusCode??'',verifyCode??'',workCode||''].join('|')}
function parseDeviceInfo(body){
 const out={};const parts=String(body||'').split(/[\r\n,]+/).map(x=>x.trim()).filter(Boolean);
 for(const part of parts){if(!part.includes('='))continue;const i=part.indexOf('='),key=part.slice(0,i).replace(/^~/,'').trim().toLowerCase(),value=part.slice(i+1).trim();out[key]=value}
 return out;
}
function parseFields(line){
 const out={};let clean=String(line||'').trim().replace(/^USER\s+/i,'').replace(/^USERINFO\s+/i,'');
 for(const part of clean.split('\t')){if(!part.includes('='))continue;const i=part.indexOf('='),key=part.slice(0,i).trim().toLowerCase(),value=part.slice(i+1).trim();out[key]=value}
 return out;
}
function parseUserLines(body){
 const rows=[];for(const raw of String(body||'').split(/\r?\n/)){const f=parseFields(raw);const pin=txt(f.pin||f.userid||f.uid);if(!pin)continue;if(!('name' in f)&&!('pri' in f)&&!('privilege' in f)&&!('card' in f)&&!('grp' in f)&&!('verify' in f))continue;rows.push({pin,name:txt(f.name),privilege:safeInt(f.pri??f.privilege),card:txt(f.card),group:txt(f.grp??f.group),timezone:txt(f.tz),verify:safeInt(f.verify)})}return rows;
}
async function getDevice(env,serial){if(!serial)return null;const rows=await rest(env,'attendance_devices?serial_number=eq.'+enc(serial)+'&select=*&limit=1');return rows?.[0]||null}
async function touchDevice(env,device,request,url,extra={}){
 if(!device?.id)return;
 const now=new Date().toISOString(),patch={last_seen_at:now,last_ip:clientIp(request),updated_at:now};
 if(url.pathname==='/iclock/getrequest'){
  const previous=device.last_command_poll_at||null,prevMs=previous?new Date(previous).getTime():NaN,nowMs=new Date(now).getTime(),gapSec=Number.isFinite(prevMs)?Math.round((nowMs-prevMs)/1000):0;
  patch.last_command_poll_at=now;
  if(gapSec>1800){
   const startedAt=new Date(prevMs+1800*1000).toISOString(),duration=Math.max(1,gapSec-1800);
   await recordDeviceHealthEvent(env,{event_key:'disconnect_gap:'+device.id+':'+new Date(prevMs).toISOString(),device_id:device.id,branch_id:device.branch_id,event_type:'disconnect_gap',severity:duration>=4*3600?'critical':'warning',started_at:startedAt,ended_at:now,duration_seconds:duration,summary:'انقطاع اتصال تقريبي قبل عودة الجهاز لمدة '+Math.max(1,Math.round(duration/60))+' دقيقة.',metadata:{previous_poll_at:previous,reconnected_at:now,threshold_seconds:1800}});
  }
 }
 const pv=txt(url.searchParams.get('pushver')||extra.pushversion);if(pv)patch.push_version=pv;
 const fw=txt(extra.firmware||extra.firmver||extra.fwversion);if(fw)patch.firmware=fw;
 const dn=txt(extra.devicename);if(dn)patch.device_name=dn;
 const uc=safeInt(extra.usercount),fc=safeInt(extra.fpcount),face=safeInt(extra.facecount),tc=safeInt(extra.transactioncount);
 if(uc!=null)patch.reported_user_count=uc;if(fc!=null)patch.reported_fp_count=fc;if(face!=null)patch.reported_face_count=face;if(tc!=null)patch.reported_transaction_count=tc;
 const meta={...(device.metadata||{}),last_protocol_path:url.pathname,last_user_agent:txt(request.headers.get('User-Agent')),platform:txt(extra.platform)||device.metadata?.platform||null,mac:txt(extra.mac||extra.macaddress)||device.metadata?.mac||null,ip_address:txt(extra.ipaddress)||device.metadata?.ip_address||null};
 patch.metadata=meta;
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:patch,prefer:'return=minimal'});
}
function handshake(serial,device){
 const replay=!!device?.metadata?.force_attlog_replay,attStamp=replay?'0':'9999';
 return ['GET OPTION FROM: '+serial,'Stamp='+attStamp,'OpStamp=9999','ATTLOGStamp='+attStamp,'OPERLOGStamp=9999','PhotoStamp=9999','ATTPHOTOStamp=9999','ErrorDelay=30','Delay=10','TransTimes=00:00;23:59','TransInterval=1','TransFlag=1111000000','TimeZone=3','Realtime=1','Encrypt=0',''].join('\r\n');
}
async function saveHistoryProfile(env,device,patch){
 if(!device?.id)return null;
 const now=new Date().toISOString(),meta=device.metadata&&typeof device.metadata==='object'&&!Array.isArray(device.metadata)?device.metadata:{},old=meta.history_profile&&typeof meta.history_profile==='object'&&!Array.isArray(meta.history_profile)?meta.history_profile:{};
 const profile={...old,...patch,updated_at:now},metadata={...meta,history_profile:profile};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 device.metadata=metadata;
 return profile;
}
function historyQueryCommand(strategy,start,end){
 if(strategy==='plain')return 'DATA QUERY ATTLOG';
 if(strategy==='range_iso')return 'DATA QUERY ATTLOG StartTime='+String(start).replace(' ','T')+'\tEndTime='+String(end).replace(' ','T');
 return 'DATA QUERY ATTLOG StartTime='+start+'\tEndTime='+end;
}
function ageSeconds(value){if(!value)return null;const n=(Date.now()-new Date(value).getTime())/1000;return Number.isFinite(n)?Math.max(0,Math.round(n)):null}
async function recordDeviceHealthEvent(env,event){
 if(!event?.event_key||!event?.device_id)return false;
 await rest(env,'attendance_device_health_events?on_conflict=event_key',{method:'POST',body:{event_key:event.event_key,device_id:event.device_id,branch_id:event.branch_id||null,event_type:event.event_type||'event',severity:event.severity||'warning',status:event.status||'closed',started_at:event.started_at||new Date().toISOString(),ended_at:event.ended_at||null,duration_seconds:event.duration_seconds??null,command_id:event.command_id||null,result_code:event.result_code??null,summary:txt(event.summary)||null,metadata:event.metadata&&typeof event.metadata==='object'?event.metadata:{}},prefer:'resolution=ignore-duplicates,return=minimal'}).catch(()=>{});
 return true;
}
async function reconcileAttendanceNotifications(env,devices,deviceHealth,devicePredictiveAlerts,maintenanceAlerts=[]){
 const rows=Array.isArray(devices)?devices:[],ids=rows.map(x=>x.id).filter(Boolean);
 if(!ids.length)return [];
 const now=new Date().toISOString(),deviceMap=new Map(rows.map(x=>[String(x.id),x])),desired=[];
 const add=(x)=>{if(x?.notification_key)desired.push(x)};
 for(const h of deviceHealth||[]){
  const d=deviceMap.get(String(h.device_id));if(!d)continue;
  if(h.connection==='offline')add({notification_key:'device_offline:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'device_health',severity:'critical',title:'جهاز البصمة غير متصل — '+d.name,message:'لم يصل اتصال حديث من الجهاز خلال آخر 30 دقيقة.',metadata:{type:'offline',health_score:h.score,last_seen_at:h.last_seen_at}});
  if(Number(h.stuck_commands)>0)add({notification_key:'stuck_commands:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'device_health',severity:'critical',title:'أوامر معلقة على جهاز البصمة — '+d.name,message:String(h.stuck_commands)+' أمر/أوامر معلقة لأكثر من 15 دقيقة.',metadata:{type:'stuck_commands',count:Number(h.stuck_commands),health_score:h.score}});
  if(Number(h.unlinked_count)>0)add({notification_key:'unlinked_movements:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'linking',severity:'warning',title:'حركات بصمة تحتاج ربط — '+d.name,message:String(h.unlinked_count)+(h.unlinked_truncated?'+':'')+' حركة تحتاج ربط موظف.',metadata:{type:'unlinked_movements',count:Number(h.unlinked_count),truncated:!!h.unlinked_truncated}});
  if(h.clock_confirmed&&!h.clock_verification_pending&&Math.abs(Number(h.clock_drift_seconds)||0)>120)add({notification_key:'device_clock_drift:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'device_health',severity:Math.abs(Number(h.clock_drift_seconds))>15*60?'critical':'warning',title:'ساعة جهاز البصمة غير مضبوطة — '+d.name,message:'ساعة الجهاز '+clockDriftText(h.clock_drift_seconds)+' مقارنة بوقت السيرفر.',metadata:{type:'clock_drift',drift_seconds:h.clock_drift_seconds,drift_minutes:h.clock_drift_minutes,checked_at:h.clock_checked_at}});
 }
 for(const p of devicePredictiveAlerts||[]){
  const d=deviceMap.get(String(p.device_id));if(!d)continue;
  add({notification_key:'predictive:'+d.id+':'+txt(p.primary_type||'watch'),device_id:d.id,branch_id:d.branch_id||null,category:'predictive',severity:p.level==='high'?'critical':p.level==='medium'?'warning':'info',title:'تنبيه استباقي — '+d.name,message:(p.signals||[]).slice(0,3).join(' '),metadata:{type:p.primary_type||'watch',risk_score:p.risk_score,level:p.level,confidence:p.confidence,signals:p.signals||[],recommended_action:p.recommended_action||null,recommended_label:p.recommended_label||null,metrics:p.metrics||{}}});
 }
 for(const m of maintenanceAlerts||[])add(m);
 const filter='&device_id=in.('+ids.map(enc).join(',')+')',existing=await rest(env,'attendance_notifications?select=*'+filter+'&order=last_seen_at.desc&limit=1000').catch(()=>[]);
 const existingMap=new Map((existing||[]).map(x=>[txt(x.notification_key),x])),desiredKeys=new Set(desired.map(x=>x.notification_key));
 for(const item of desired){
  const old=existingMap.get(item.notification_key),payload={branch_id:item.branch_id,device_id:item.device_id,category:item.category,severity:item.severity,title:item.title,message:item.message||null,active:true,last_seen_at:now,metadata:item.metadata||{},updated_at:now};
  if(!old){
   await rest(env,'attendance_notifications',{method:'POST',body:{...payload,notification_key:item.notification_key,status:'new',first_seen_at:now,created_at:now},prefer:'return=minimal'}).catch(()=>{});
  }else if(old.active===false){
   await rest(env,'attendance_notifications?id=eq.'+enc(old.id),{method:'PATCH',body:{...payload,status:'new',first_seen_at:now,seen_at:null,seen_by:null,resolved_at:null,resolved_by:null,resolved_reason:null},prefer:'return=minimal'}).catch(()=>{});
  }else{
   await rest(env,'attendance_notifications?id=eq.'+enc(old.id),{method:'PATCH',body:payload,prefer:'return=minimal'}).catch(()=>{});
  }
 }
 for(const old of existing||[]){
  if(old.active!==true||desiredKeys.has(txt(old.notification_key)))continue;
  await rest(env,'attendance_notifications?id=eq.'+enc(old.id),{method:'PATCH',body:{active:false,status:old.status==='resolved'?'resolved':'resolved',resolved_at:old.resolved_at||now,resolved_by:old.resolved_by||'system',resolved_reason:old.resolved_reason||'زالت الحالة تلقائيًا',updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 }
 return await rest(env,'attendance_notifications?select=*'+filter+'&order=active.desc,last_seen_at.desc&limit=500').catch(()=>[]);
}
async function updateAttendanceNotification(env,me,body){
 const id=txt(body.id),op=txt(body.notification_action);if(!id)throw Object.assign(new Error('التنبيه غير محدد.'),{status:400});
 const rows=await rest(env,'attendance_notifications?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;if(!before)throw Object.assign(new Error('التنبيه غير موجود.'),{status:404});
 if(!elevated(me)&&txt(before.branch_id)!==actorBranch(me))throw Object.assign(new Error('التنبيه خارج نطاق الفرع.'),{status:403});
 const now=new Date().toISOString(),who=actorId(me)||actorName(me)||null;let patch;
 if(op==='seen')patch={status:before.status==='resolved'?'resolved':'seen',seen_at:before.seen_at||now,seen_by:before.seen_by||who,updated_at:now};
 else if(op==='resolved'){
  if(!canManageDevices(me)&&!canManageLinks(me))throw Object.assign(new Error('لا توجد صلاحية لمعالجة هذا التنبيه.'),{status:403});
  patch={status:'resolved',resolved_at:now,resolved_by:who,resolved_reason:txt(body.reason)||'تمت المعالجة يدويًا',updated_at:now};
 }else throw Object.assign(new Error('إجراء التنبيه غير صحيح.'),{status:400});
 const after=(await rest(env,'attendance_notifications?id=eq.'+enc(id),{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0]||null;
 await audit(env,me,op==='seen'?'attendance_notification_seen':'attendance_notification_resolved','attendance_notification',id,before.branch_id,before,after,txt(body.reason)||'إدارة تنبيه الحضور');
 return {ok:true,notification:after};
}
async function markAttendanceNotificationsSeen(env,me,body){
 const branchId=requestedBranch(me,body),filter=branchId?'&branch_id=eq.'+enc(branchId):'',now=new Date().toISOString(),who=actorId(me)||actorName(me)||null;
 const rows=await rest(env,'attendance_notifications?active=eq.true&status=eq.new&select=id'+filter+'&limit=500').catch(()=>[]);
 for(const row of rows||[])await rest(env,'attendance_notifications?id=eq.'+enc(row.id),{method:'PATCH',body:{status:'seen',seen_at:now,seen_by:who,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,'attendance_notifications_seen_bulk','attendance_notification','bulk',branchId||null,null,{count:(rows||[]).length},'تحديد تنبيهات الحضور كمشاهدة');
 return {ok:true,count:(rows||[]).length};
}
function cleanEscalationRoles(v){
 const allowed=new Set(['الموارد البشرية','مدير فرع','مدير عام']);
 const arr=Array.isArray(v)?v:String(v||'').split(',');return [...new Set(arr.map(x=>txt(x)).filter(x=>allowed.has(x)))];
}
function escalationRuleScore(rule,notification){
 if(!rule?.active)return -1;
 if(rule.branch_id&&txt(rule.branch_id)!==txt(notification.branch_id))return -1;
 if(rule.category!=='*'&&txt(rule.category)!==txt(notification.category))return -1;
 if(rule.severity!=='*'&&txt(rule.severity)!==txt(notification.severity))return -1;
 return (rule.branch_id?8:0)+(rule.category==='*'?0:4)+(rule.severity==='*'?0:2);
}
function selectEscalationRule(rules,notification){
 return (rules||[]).map(r=>({r,score:escalationRuleScore(r,notification)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score||new Date(b.r.updated_at||b.r.created_at||0)-new Date(a.r.updated_at||a.r.created_at||0))[0]?.r||null;
}
async function applyAttendanceEscalation(env,notifications,rules){
 const now=new Date(),nowIso=now.toISOString(),out=[];
 for(const n0 of notifications||[]){
  const n={...n0};if(!n.active||n.status==='resolved'){n.next_escalation_at=null;out.push(n);continue}
  const rule=selectEscalationRule(rules,n);if(!rule){out.push(n);continue}
  const firstMs=new Date(n.first_seen_at||n.created_at||nowIso).getTime(),ageMin=Math.max(0,(now.getTime()-firstMs)/60000);
  const levels=[
   {level:1,minutes:rule.level1_minutes,roles:cleanEscalationRoles(rule.level1_roles)},
   {level:2,minutes:rule.level2_minutes,roles:cleanEscalationRoles(rule.level2_roles)},
   {level:3,minutes:rule.level3_minutes,roles:cleanEscalationRoles(rule.level3_roles)}
  ].filter(x=>x.minutes!=null&&Number.isFinite(Number(x.minutes))&&Number(x.minutes)>=0);
  let due=0;for(const x of levels)if(ageMin>=Number(x.minutes))due=Math.max(due,x.level);
  const cumulative=[];for(const x of levels.filter(x=>x.level<=due))for(const role of x.roles)if(!cumulative.includes(role))cumulative.push(role);
  const next=levels.filter(x=>x.level>due).sort((a,b)=>a.level-b.level)[0]||null,nextAt=next?new Date(firstMs+Number(next.minutes)*60000).toISOString():null;
  const channels=rule.channels&&typeof rule.channels==='object'&&!Array.isArray(rule.channels)?{in_app:rule.channels.in_app!==false,whatsapp:rule.channels.whatsapp===true,email:rule.channels.email===true}:{in_app:true,whatsapp:false,email:false};
  const current=Math.max(0,Number(n.escalation_level)||0);
  if(due>current){
   for(const x of levels.filter(x=>x.level>current&&x.level<=due)){
    await rest(env,'attendance_notification_escalation_events?on_conflict=event_key',{method:'POST',body:{event_key:'attendance_escalation:'+n.id+':L'+x.level,notification_id:n.id,escalation_level:x.level,target_roles:x.roles,channels,rule_id:rule.id,summary:'تم تصعيد التنبيه إلى المستوى '+x.level+' — '+(x.roles.join('، ')||'بدون مستلمين')},prefer:'resolution=ignore-duplicates,return=minimal'}).catch(()=>{});
   }
  }
  const changed=due!==current||txt(n.escalation_rule_id)!==txt(rule.id)||JSON.stringify(n.target_roles||[])!==JSON.stringify(cumulative)||JSON.stringify(n.escalation_channels||{})!==JSON.stringify(channels)||txt(n.next_escalation_at)!==txt(nextAt);
  if(changed){
   const patch={escalation_level:due,target_roles:cumulative,escalation_channels:channels,escalation_rule_id:rule.id,escalated_at:due>current?nowIso:(n.escalated_at||null),next_escalation_at:nextAt,updated_at:nowIso};
   await rest(env,'attendance_notifications?id=eq.'+enc(n.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});
   Object.assign(n,patch);
  }
  out.push(n);
 }
 return out;
}
async function attendanceDeliverySettings(env){
 const rows=await rest(env,'attendance_notification_delivery_settings?id=eq.default&select=*&limit=1').catch(()=>[]);
 return rows?.[0]||{id:'default',whatsapp_enabled:false,email_enabled:false,auto_dispatch:false,whatsapp_provider:'notification_jobs',email_provider:null};
}
function maskAttendanceDestination(channel,value){
 const v=txt(value);if(!v)return '—';
 if(channel==='email'){const i=v.indexOf('@');return i>1?v.slice(0,2)+'***'+v.slice(i):'***'}
 const digits=v.replace(/\D/g,'');return digits.length>4?'***'+digits.slice(-4):'***';
}
async function normalizeAttendancePhone(env,value){
 const v=txt(value);if(!v)return null;
 const out=await rest(env,'rpc/normalize_notification_phone',{method:'POST',body:{p_phone:v}}).catch(()=>null);
 return txt(out)||v;
}
async function resolveAttendanceEscalationRecipients(env,notification,roles){
 const wanted=cleanEscalationRoles(roles);if(!wanted.length)return [];
 const roleFilter='role=in.('+wanted.map(enc).join(',')+')';
 const rows=await rest(env,'staff_users?select=id,name,phone,role,branch_id,status,security_meta&status=neq.%D9%85%D9%88%D9%82%D9%88%D9%81&'+roleFilter+'&order=name.asc').catch(()=>[]);
 const branch=txt(notification?.branch_id),picked=[];
 for(const role of wanted){
  let candidates=(rows||[]).filter(x=>txt(x.role)===role);
  if(role==='مدير فرع'&&branch)candidates=candidates.filter(x=>txt(x.branch_id)===branch);
  else if(role==='الموارد البشرية'&&branch){
   const scoped=candidates.filter(x=>!txt(x.branch_id)||txt(x.branch_id)===branch);
   if(scoped.length)candidates=scoped;
  }
  for(const u of candidates){
   if(picked.some(x=>txt(x.id)===txt(u.id)))continue;
   picked.push({...u,email:txt(u?.security_meta?.email)||null});
  }
 }
 return picked;
}
async function insertAttendanceDelivery(env,payload){
 const rows=await rest(env,'attendance_notification_deliveries?on_conflict=delivery_key',{method:'POST',body:payload,prefer:'resolution=ignore-duplicates,return=representation'}).catch(()=>[]);
 if(rows?.[0])return rows[0];
 return (await rest(env,'attendance_notification_deliveries?delivery_key=eq.'+enc(payload.delivery_key)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
}
async function queueAttendanceWhatsappJob(env,delivery,notification,device,branch){
 if(!delivery||delivery.provider_job_id||!delivery.destination)return delivery;
 const now=new Date().toISOString(),payload={
  alert_title:notification.title||'تنبيه حضور',
  alert_message:notification.message||'',
  device_name:device?.name||'—',
  branch_name:branch?.name||'—',
  escalation_level:String(delivery.escalation_level||0),
  first_seen_at:notification.first_seen_at||notification.created_at||now,
  attendance_notification_id:notification.id,
  attendance_delivery_id:delivery.id
 };
 const jobs=await rest(env,'notification_jobs',{method:'POST',body:{branch_id:notification.branch_id||null,event_type:'attendance_escalation',template_key:'attendance_escalation_alert',language_code:'ar',channel:'whatsapp',recipient_name:delivery.recipient_name||delivery.recipient_role||'مسؤول',recipient_phone:delivery.destination,scheduled_for:now,status:'pending',automatic:true,sent_by:'attendance-escalation',payload,target_scope:'attendance_alert',target_ref:notification.id,notification_direction:'operational'},prefer:'return=representation'}).catch(()=>[]);
 const job=jobs?.[0]||null;if(!job)return delivery;
 const patch={provider:'notification_jobs',provider_job_id:job.id,status:'queued',queued_at:now,error_text:null,updated_at:now};
 await rest(env,'attendance_notification_deliveries?id=eq.'+enc(delivery.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});
 return {...delivery,...patch};
}
async function syncAttendanceDeliveryProviderState(env,deliveries){
 const ids=[...new Set((deliveries||[]).map(x=>x.provider_job_id).filter(Boolean))];if(!ids.length)return deliveries||[];
 const jobs=await rest(env,'notification_jobs?id=in.('+ids.map(enc).join(',')+')&select=id,status,attempt_count,error_text,sent_at,delivered_at,read_at,last_error_code,provider_message_id,updated_at:created_at').catch(()=>[]);
 const jobMap=new Map((jobs||[]).map(x=>[String(x.id),x])),now=new Date().toISOString(),out=[];
 for(const d of deliveries||[]){
  const j=jobMap.get(String(d.provider_job_id));if(!j){out.push(d);continue}
  let status=d.status;
  if(j.status==='delivered')status='delivered';
  else if(j.status==='sent')status='sent';
  else if(j.status==='failed')status='failed';
  else if(j.status==='cancelled')status='cancelled';
  else if(['processing','sending','claimed'].includes(j.status))status='sending';
  else if(['pending','scheduled'].includes(j.status))status='queued';
  if(j.read_at)status='read';
  const patch={status,attempt_count:Number(j.attempt_count)||0,error_text:j.error_text||j.last_error_code||null,sent_at:j.sent_at||d.sent_at||null,delivered_at:j.delivered_at||d.delivered_at||null,read_at:j.read_at||d.read_at||null,failed_at:status==='failed'?(d.failed_at||now):null,metadata:{...(d.metadata||{}),provider_message_id:j.provider_message_id||null},updated_at:now};
  if(status!==d.status||Number(patch.attempt_count)!==Number(d.attempt_count)||txt(patch.error_text)!==txt(d.error_text)||txt(patch.delivered_at)!==txt(d.delivered_at)||txt(patch.read_at)!==txt(d.read_at)){
   await rest(env,'attendance_notification_deliveries?id=eq.'+enc(d.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});
   out.push({...d,...patch});
  }else out.push(d);
 }
 return out;
}
async function syncAttendanceEscalationDeliveries(env,notifications,events,devices,branches,settings){
 const notificationMap=new Map((notifications||[]).map(x=>[String(x.id),x])),deviceMap=new Map((devices||[]).map(x=>[String(x.id),x])),branchMap=new Map((branches||[]).map(x=>[String(x.id),x]));
 const notificationIds=(notifications||[]).map(x=>x.id).filter(Boolean),existing=notificationIds.length?await rest(env,'attendance_notification_deliveries?notification_id=in.('+notificationIds.map(enc).join(',')+')&select=*&order=created_at.desc&limit=1000').catch(()=>[]):[],existingMap=new Map((existing||[]).map(x=>[txt(x.delivery_key),x]));
 const now=new Date().toISOString(),out=[...(existing||[])];
 for(const ev of events||[]){
  const n=notificationMap.get(String(ev.notification_id));if(!n||!n.active||n.status==='resolved')continue;
  const recipients=await resolveAttendanceEscalationRecipients(env,n,ev.target_roles||[]),channels=ev.channels&&typeof ev.channels==='object'?ev.channels:{in_app:true,whatsapp:false,email:false};
  for(const recipient of recipients){
   const base={notification_id:n.id,escalation_event_id:ev.id,escalation_level:Number(ev.escalation_level)||0,recipient_staff_id:recipient.id,recipient_name:recipient.name||null,recipient_role:recipient.role||null,branch_id:n.branch_id||null,metadata:{notification_title:n.title,notification_category:n.category}};
   if(channels.in_app!==false){
    const key='attendance:'+ev.id+':'+recipient.id+':in_app';
    if(!existingMap.has(key)){const row=await insertAttendanceDelivery(env,{...base,delivery_key:key,channel:'in_app',status:'delivered',provider:'attendance_center',delivered_at:now,created_at:now,updated_at:now});if(row){existingMap.set(key,row);out.unshift(row)}}
   }
   if(channels.whatsapp===true){
    const key='attendance:'+ev.id+':'+recipient.id+':whatsapp',phone=await normalizeAttendancePhone(env,recipient.phone),old=existingMap.get(key);
    let status='ready',error=null;
    if(!settings?.whatsapp_enabled){status='blocked';error='قناة WhatsApp غير مفعلة من إعدادات تصعيد الحضور.'}
    else if(!phone){status='blocked';error='لا يوجد رقم جوال للمستلم.'}
    let row=old;
    if(!row){row=await insertAttendanceDelivery(env,{...base,delivery_key:key,channel:'whatsapp',destination:phone,status,provider:settings?.whatsapp_provider||'notification_jobs',error_text:error,created_at:now,updated_at:now});if(row){existingMap.set(key,row);out.unshift(row)}}
    else if(['blocked','ready'].includes(row.status)&&(txt(row.destination)!==txt(phone)||row.status!==status||txt(row.error_text)!==txt(error))){
     const patch={destination:phone,status,error_text:error,provider:settings?.whatsapp_provider||'notification_jobs',updated_at:now};await rest(env,'attendance_notification_deliveries?id=eq.'+enc(row.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});Object.assign(row,patch);
    }
    if(row&&settings?.whatsapp_enabled&&settings?.auto_dispatch&&phone&&!row.provider_job_id&&['ready','blocked'].includes(row.status))row=await queueAttendanceWhatsappJob(env,{...row,status:'ready',destination:phone},n,deviceMap.get(String(n.device_id)),branchMap.get(String(n.branch_id)));
   }
   if(channels.email===true){
    const key='attendance:'+ev.id+':'+recipient.id+':email',email=txt(recipient.email)||null,old=existingMap.get(key);
    let status='ready',error=null;
    if(!settings?.email_enabled){status='blocked';error='قناة البريد الإلكتروني غير مفعلة من إعدادات تصعيد الحضور.'}
    else if(!email){status='blocked';error='لا يوجد بريد إلكتروني للمستلم.'}
    else if(!settings?.email_provider){status='blocked';error='مزود البريد الإلكتروني غير مضبوط بعد.'}
    if(!old){const row=await insertAttendanceDelivery(env,{...base,delivery_key:key,channel:'email',destination:email,status,provider:settings?.email_provider||null,error_text:error,created_at:now,updated_at:now});if(row){existingMap.set(key,row);out.unshift(row)}}
   }
  }
 }
 for(const n of notifications||[]){
  if(n.active&&n.status!=='resolved')continue;
  for(const d of out.filter(x=>String(x.notification_id)===String(n.id)&&!['delivered','read','sent','failed','cancelled'].includes(x.status))){
   if(d.provider_job_id)await rest(env,'notification_jobs?id=eq.'+enc(d.provider_job_id)+'&status=in.(pending,scheduled)',{method:'PATCH',body:{status:'cancelled',error_text:'تم إلغاء التنبيه قبل الإرسال'},prefer:'return=minimal'}).catch(()=>{});
   const patch={status:'cancelled',error_text:'تم حل التنبيه قبل الإرسال',updated_at:now};await rest(env,'attendance_notification_deliveries?id=eq.'+enc(d.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});Object.assign(d,patch);
  }
 }
 return syncAttendanceDeliveryProviderState(env,out);
}
async function saveAttendanceDeliverySettings(env,me,body){
 if(!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة قنوات تصعيد التنبيهات.'),{status:403});
 const before=(await rest(env,'attendance_notification_delivery_settings?id=eq.default&select=*&limit=1').catch(()=>[]))?.[0]||null;
 const patch={whatsapp_enabled:body.whatsapp_enabled===true,email_enabled:body.email_enabled===true,auto_dispatch:body.auto_dispatch===true,whatsapp_provider:txt(body.whatsapp_provider)||'notification_jobs',email_provider:txt(body.email_provider)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 const after=(await rest(env,'attendance_notification_delivery_settings?id=eq.default',{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ إعدادات قنوات التنبيه.'),{status:500});
 await audit(env,me,'attendance_delivery_settings_update','attendance_notification_delivery_settings','default',null,before,after,'إعداد قنوات تصعيد تنبيهات الحضور');
 return {ok:true,settings:after};
}
async function retryAttendanceDelivery(env,me,body){
 if(!canManagePolicies(me)&&!canManageDevices(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإعادة محاولة إرسال التنبيه.'),{status:403});
 const id=txt(body.id),rows=await rest(env,'attendance_notification_deliveries?id=eq.'+enc(id)+'&select=*&limit=1'),delivery=rows?.[0]||null;if(!delivery)throw Object.assign(new Error('محاولة الإرسال غير موجودة.'),{status:404});
 if(delivery.channel!=='whatsapp')throw Object.assign(new Error('إعادة المحاولة الآلية متاحة حاليًا لقناة WhatsApp فقط.'),{status:400});
 const settings=await attendanceDeliverySettings(env);if(!settings.whatsapp_enabled)throw Object.assign(new Error('قناة WhatsApp غير مفعلة.'),{status:409});
 if(!delivery.destination)throw Object.assign(new Error('لا يوجد رقم جوال صالح للمستلم.'),{status:409});
 const n=(await rest(env,'attendance_notifications?id=eq.'+enc(delivery.notification_id)+'&select=*&limit=1'))?.[0]||null;if(!n)throw Object.assign(new Error('التنبيه الأصلي غير موجود.'),{status:404});
 if(!n.active||n.status==='resolved')throw Object.assign(new Error('التنبيه تم حله ولا يحتاج إعادة إرسال.'),{status:409});
 if(delivery.provider_job_id)await rest(env,'notification_jobs?id=eq.'+enc(delivery.provider_job_id)+'&status=in.(pending,scheduled,failed,cancelled)',{method:'PATCH',body:{status:'cancelled',error_text:'أعيدت المحاولة من مركز تنبيهات الحضور'},prefer:'return=minimal'}).catch(()=>{});
 const cleared={provider_job_id:null,status:'ready',attempt_count:0,error_text:null,queued_at:null,sent_at:null,delivered_at:null,failed_at:null,read_at:null,updated_at:new Date().toISOString()};
 await rest(env,'attendance_notification_deliveries?id=eq.'+enc(delivery.id),{method:'PATCH',body:cleared,prefer:'return=minimal'});
 const device=(await rest(env,'attendance_devices?id=eq.'+enc(n.device_id)+'&select=*&limit=1').catch(()=>[]))?.[0]||null,branch=(await rest(env,'branches?id=eq.'+enc(n.branch_id)+'&select=id,name&limit=1').catch(()=>[]))?.[0]||null;
 const after=await queueAttendanceWhatsappJob(env,{...delivery,...cleared},n,device,branch);
 await audit(env,me,'attendance_delivery_retry','attendance_notification_delivery',delivery.id,n.branch_id,delivery,after,'إعادة محاولة إرسال تنبيه حضور');
 return {ok:true,delivery:after};
}

async function runDeviceClockSyncWatchdog(env){
 const mode=await runtimeMode(env),systemActor={id:'system:clock-watchdog',name:'Clock Sync Watchdog',role:'developer',permissions:{all:true,allBranches:true,_accountMode:mode}},devices=await rest(env,'attendance_devices?status=eq.active&select=*&order=created_at.asc').catch(()=>[]);
 let queued=0,skipped=0,errors=0,eligible=0;
 for(const device of devices||[]){
  const clock=device?.metadata?.clock_drift||{},drift=Number(clock.drift_seconds),fresh=ageSeconds(clock.checked_at),seenAge=ageSeconds(device.last_command_poll_at||device.last_seen_at);
  if(clock.confirmed!==true||!Number.isFinite(drift)||Math.abs(drift)<=120||fresh==null||fresh>6*3600||seenAge==null||seenAge>1800)continue;
  eligible+=1;
  try{const out=await queueClockSync(env,device,systemActor,{source:'auto',force:false});if(out?.queued)queued+=1;else skipped+=1}catch(e){if(Number(e?.status)===409)skipped+=1;else errors+=1}
 }
 return {ok:true,devices:(devices||[]).length,eligible,queued,skipped,errors,checked_at:new Date().toISOString()};
}
async function autoSyncDriftedDeviceClocks(env,state,systemActor){
 const devices=state?.devices||[],health=state?.deviceHealth||[],map=new Map(devices.map(x=>[String(x.id),x]));let queued=0,skipped=0,errors=0;
 for(const h of health){
  const drift=Number(h?.clock_drift_seconds),fresh=ageSeconds(h?.clock_checked_at);
  if(h?.clock_confirmed!==true||!Number.isFinite(drift)||Math.abs(drift)<=120||h.connection==='offline'||fresh==null||fresh>6*3600)continue;
  const device=map.get(String(h.device_id));if(!device||device.status!=='active')continue;
  try{const out=await queueClockSync(env,device,systemActor,{source:'auto',force:false});if(out?.queued)queued+=1;else skipped+=1}catch(e){if(Number(e?.status)===409)skipped+=1;else errors+=1}
 }
 return {queued,skipped,errors};
}
async function runAttendanceWatchdog(env,source='scheduled'){
 const startedAt=new Date(),startedIso=startedAt.toISOString(),mode=await runtimeMode(env);
 const runRows=await rest(env,'attendance_watchdog_runs',{method:'POST',body:{source,status:'running',runtime_mode:mode,started_at:startedIso,created_at:startedIso},prefer:'return=representation'}).catch(()=>[]);
 const run=runRows?.[0]||null;
 try{
  const systemActor={id:'system:attendance-watchdog',name:'Attendance Watchdog',role:'developer',permissions:{all:true,allBranches:true,_accountMode:mode}};
  const state=await attendanceState(env,systemActor,new URL('https://attendance-watchdog.internal/api/attendance'));
  const clockSync=await autoSyncDriftedDeviceClocks(env,state,systemActor);
  const completedAt=new Date(),durationMs=Math.max(0,completedAt.getTime()-startedAt.getTime()),activeNotifications=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved').length,criticalNotifications=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved'&&x.severity==='critical').length,activeEscalations=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved'&&Number(x.escalation_level)>0).length;
  const summary={ok:true,run_id:run?.id||null,source,runtime_mode:mode,devices_count:(state.devices||[]).length,active_notifications:activeNotifications,critical_notifications:criticalNotifications,escalations_count:activeEscalations,deliveries_queued:Number(state.deliveryCounts?.queued||0)+Number(state.deliveryCounts?.sending||0),deliveries_failed:Number(state.deliveryCounts?.failed||0),clock_sync_queued:Number(clockSync?.queued||0),clock_sync_skipped:Number(clockSync?.skipped||0),clock_sync_errors:Number(clockSync?.errors||0),completed_at:completedAt.toISOString(),duration_ms:durationMs};
  if(run?.id)await rest(env,'attendance_watchdog_runs?id=eq.'+enc(run.id),{method:'PATCH',body:{status:'success',completed_at:summary.completed_at,duration_ms:durationMs,devices_count:summary.devices_count,active_notifications:activeNotifications,critical_notifications:criticalNotifications,escalations_count:activeEscalations,deliveries_queued:summary.deliveries_queued,deliveries_failed:summary.deliveries_failed,metadata:{notification_new:Number(state.notificationCounts?.new||0),notification_level2:Number(state.notificationCounts?.level2||0),notification_level3:Number(state.notificationCounts?.level3||0),delivery_blocked:Number(state.deliveryCounts?.blocked||0),delivery_delivered:Number(state.deliveryCounts?.delivered||0)+Number(state.deliveryCounts?.read||0),incident_open:Number(state.incidentCounts?.open||0)+Number(state.incidentCounts?.acknowledged||0)+Number(state.incidentCounts?.investigating||0),incident_breached:Number(state.incidentCounts?.breached||0),clock_sync_queued:summary.clock_sync_queued,clock_sync_skipped:summary.clock_sync_skipped,clock_sync_errors:summary.clock_sync_errors}},prefer:'return=minimal'}).catch(()=>{});
  if(source==='scheduled'&&startedAt.getUTCMinutes()<5){const cutoff=new Date(startedAt.getTime()-30*86400000).toISOString();await rest(env,'attendance_watchdog_runs?started_at=lt.'+enc(cutoff),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{})}
  return summary;
 }catch(e){
  const completedAt=new Date(),durationMs=Math.max(0,completedAt.getTime()-startedAt.getTime()),message=txt(e?.message)||'تعذر تشغيل مراقب تنبيهات الحضور.';
  if(run?.id)await rest(env,'attendance_watchdog_runs?id=eq.'+enc(run.id),{method:'PATCH',body:{status:'failed',completed_at:completedAt.toISOString(),duration_ms:durationMs,error_text:message},prefer:'return=minimal'}).catch(()=>{});
  throw e;
 }
}
async function runAttendanceWatchdogNow(env,me){
 if(!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لتشغيل مراقب التنبيهات يدويًا.'),{status:403});
 const result=await runAttendanceWatchdog(env,'manual');
 await audit(env,me,'attendance_watchdog_manual_run','attendance_watchdog_run',result.run_id||'manual',null,null,result,'تشغيل مراقب تنبيهات الحضور يدويًا');
 return result;
}

function incidentPolicyScore(policy,notification){
 if(!policy?.active)return -1;
 if(policy.branch_id&&txt(policy.branch_id)!==txt(notification.branch_id))return -1;
 if(policy.category!=='*'&&txt(policy.category)!==txt(notification.category))return -1;
 if(policy.severity!=='*'&&txt(policy.severity)!==txt(notification.severity))return -1;
 return (policy.branch_id?8:0)+(policy.category==='*'?0:4)+(policy.severity==='*'?0:2);
}
function selectIncidentPolicy(policies,notification){
 return (policies||[]).map(p=>({p,score:incidentPolicyScore(p,notification)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score||new Date(b.p.updated_at||b.p.created_at||0)-new Date(a.p.updated_at||a.p.created_at||0))[0]?.p||null;
}
function incidentKey(notification){return 'attendance:'+txt(notification.id)+':'+txt(notification.first_seen_at||notification.created_at)}
async function addIncidentEvent(env,incident,eventType,actorIdValue,actorNameValue,note,metadata={}){
 if(!incident?.id)return null;
 const rows=await rest(env,'attendance_incident_events',{method:'POST',body:{incident_id:incident.id,event_type:eventType,actor_id:txt(actorIdValue)||null,actor_name:txt(actorNameValue)||null,note:txt(note)||null,metadata:metadata&&typeof metadata==='object'?metadata:{},created_at:new Date().toISOString()},prefer:'return=representation'}).catch(()=>[]);
 return rows?.[0]||null;
}
async function reconcileAttendanceIncidents(env,notifications,policies){
 const rows=Array.isArray(notifications)?notifications:[],ids=rows.map(x=>x.id).filter(Boolean);
 if(!ids.length)return [];
 const filter='&source_notification_id=in.('+ids.map(enc).join(',')+')',existing=await rest(env,'attendance_incidents?select=*'+filter+'&order=started_at.desc&limit=1000').catch(()=>[]);
 const byKey=new Map((existing||[]).map(x=>[txt(x.incident_key),x])),now=new Date(),nowIso=now.toISOString(),out=[...(existing||[])];
 for(const n of rows){
  const maintenanceType=txt(n?.metadata?.type),upcomingMaintenance=n.category==='maintenance'&&maintenanceType==='preventive_due'&&Number(n.metadata?.days_to_due)>=0,lifecycleAdvisory=n.category==='maintenance'&&['asset_warranty','asset_contract','asset_replacement'].includes(maintenanceType);if(upcomingMaintenance||lifecycleAdvisory)continue;
  const key=incidentKey(n),old=byKey.get(key),policy=selectIncidentPolicy(policies,n),started=n.category==='maintenance'&&n.metadata?.type==='preventive_due'&&n.metadata?.next_due_at?n.metadata.next_due_at:(n.first_seen_at||n.created_at||nowIso),startMs=new Date(started).getTime(),responseMin=Math.max(0,Number(policy?.response_minutes??60)),resolutionMin=Math.max(responseMin,Number(policy?.resolution_minutes??480)),responseDue=new Date((Number.isFinite(startMs)?startMs:now.getTime())+responseMin*60000).toISOString(),resolutionDue=new Date((Number.isFinite(startMs)?startMs:now.getTime())+resolutionMin*60000).toISOString();
  if(n.active){
   if(!old){
    const created=(await rest(env,'attendance_incidents',{method:'POST',body:{incident_key:key,source_notification_id:n.id,branch_id:n.branch_id||null,device_id:n.device_id||null,category:n.category||'device_health',severity:n.severity||'warning',title:n.title||'حادثة حضور',summary:n.message||null,status:'open',source_active:true,sla_policy_id:policy?.id||null,started_at:started,response_due_at:responseDue,resolution_due_at:resolutionDue,response_breached:now>new Date(responseDue),resolution_breached:now>new Date(resolutionDue),metadata:{notification_key:n.notification_key||null,escalation_level:n.escalation_level||0}},prefer:'return=representation'}).catch(()=>[]))?.[0]||null;
    if(created){byKey.set(key,created);out.unshift(created);await addIncidentEvent(env,created,'opened','system:attendance-watchdog','Attendance Watchdog','تم فتح الحادثة تلقائيًا من تنبيه نشط.',{source_notification_id:n.id,severity:n.severity});}
   }else{
    const ackMs=old.acknowledged_at?new Date(old.acknowledged_at).getTime():null,resolvedMs=old.resolved_at?new Date(old.resolved_at).getTime():null,dueRespMs=new Date(responseDue).getTime(),dueResMs=new Date(resolutionDue).getTime();
    const responseBreached=ackMs!=null?ackMs>dueRespMs:now.getTime()>dueRespMs,resolutionBreached=resolvedMs!=null?resolvedMs>dueResMs:now.getTime()>dueResMs;
    const patch={source_active:true,severity:n.severity||old.severity,title:n.title||old.title,summary:n.message||old.summary,sla_policy_id:policy?.id||old.sla_policy_id||null,response_due_at:responseDue,resolution_due_at:resolutionDue,response_breached:responseBreached,resolution_breached:resolutionBreached,metadata:{...(old.metadata||{}),notification_key:n.notification_key||null,escalation_level:n.escalation_level||0},updated_at:nowIso};
    await rest(env,'attendance_incidents?id=eq.'+enc(old.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});Object.assign(old,patch);
   }
  }else if(old&&old.source_active){
   const duration=Math.max(0,Math.round((now.getTime()-(Number.isFinite(startMs)?startMs:now.getTime()))/1000)),patch={source_active:false,status:['resolved','closed'].includes(old.status)?old.status:'resolved',resolved_at:old.resolved_at||nowIso,resolved_by:old.resolved_by||'system:attendance-watchdog',resolution_reason:old.resolution_reason||'زالت الحالة الأصلية تلقائيًا',resolution_seconds:old.resolution_seconds??duration,resolution_breached:old.resolution_breached||now>new Date(old.resolution_due_at||resolutionDue),updated_at:nowIso};
   await rest(env,'attendance_incidents?id=eq.'+enc(old.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});Object.assign(old,patch);await addIncidentEvent(env,old,'auto_resolved','system:attendance-watchdog','Attendance Watchdog','تم حل الحادثة تلقائيًا بعد زوال التنبيه الأصلي.',{source_notification_id:n.id});
  }
 }
 return out.sort((a,b)=>new Date(b.started_at)-new Date(a.started_at));
}
async function updateAttendanceIncident(env,me,body){
 const id=txt(body.id),op=txt(body.incident_action);if(!id)throw Object.assign(new Error('الحادثة غير محددة.'),{status:400});
 const rows=await rest(env,'attendance_incidents?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;if(!before)throw Object.assign(new Error('الحادثة غير موجودة.'),{status:404});
 if(!elevated(me)&&txt(before.branch_id)!==actorBranch(me))throw Object.assign(new Error('الحادثة خارج نطاق الفرع.'),{status:403});
 if(!canManageDevices(me)&&!canReviewViolations(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة الحادثة.'),{status:403});
 const now=new Date(),nowIso=now.toISOString(),who=actorId(me)||actorName(me)||null,name=actorName(me)||who,startedMs=new Date(before.started_at).getTime(),patch={updated_at:nowIso},note=txt(body.note);
 let eventType=op;
 if(op==='acknowledge'){
  if(!before.acknowledged_at){patch.acknowledged_at=nowIso;patch.acknowledged_by=who;patch.response_seconds=Math.max(0,Math.round((now.getTime()-startedMs)/1000));patch.response_breached=now>new Date(before.response_due_at||nowIso)}
  if(before.status==='open')patch.status='acknowledged';
  eventType='acknowledged';
 }else if(op==='assign'){
  const staffId=txt(body.owner_staff_id);if(!staffId)throw Object.assign(new Error('حدد المسؤول عن الحادثة.'),{status:400});
  const staff=(await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,role,branch_id,status&limit=1'))?.[0]||null;if(!staff||staff.status==='موقوف')throw Object.assign(new Error('المسؤول المحدد غير متاح.'),{status:400});
  if(!elevated(me)&&txt(staff.branch_id)&&txt(staff.branch_id)!==txt(before.branch_id))throw Object.assign(new Error('المسؤول خارج نطاق الفرع.'),{status:403});
  patch.owner_staff_id=staff.id;patch.owner_name=staff.name||staff.id;if(!['resolved','closed'].includes(before.status))patch.status='investigating';eventType='assigned';patch.metadata={...(before.metadata||{}),owner_role:staff.role||null};
 }else if(op==='resolve'){
  if(before.source_active)throw Object.assign(new Error('لا يمكن حل الحادثة بينما المشكلة الأصلية ما زالت نشطة. عالج السبب أولًا ثم سيغلقها المراقب تلقائيًا.'),{status:409});
  patch.status='resolved';patch.resolved_at=before.resolved_at||nowIso;patch.resolved_by=who;patch.resolution_reason=note||before.resolution_reason||'تمت المعالجة';patch.resolution_seconds=before.resolution_seconds??Math.max(0,Math.round((now.getTime()-startedMs)/1000));patch.resolution_breached=before.resolution_breached||now>new Date(before.resolution_due_at||nowIso);eventType='resolved';
 }else if(op==='close'){
  if(before.status!=='resolved')throw Object.assign(new Error('يجب حل الحادثة أولًا قبل إغلاقها.'),{status:409});
  patch.status='closed';patch.closed_at=nowIso;patch.closed_by=who;eventType='closed';
 }else if(op==='note'){
  eventType='note';
 }else throw Object.assign(new Error('إجراء الحادثة غير صحيح.'),{status:400});
 let after=before;
 if(op!=='note')after=(await rest(env,'attendance_incidents?id=eq.'+enc(id),{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0]||before;
 await addIncidentEvent(env,after,eventType,who,name,note||null,{previous_status:before.status,status:after.status||before.status,owner_staff_id:after.owner_staff_id||null});
 await audit(env,me,'attendance_incident_'+eventType,'attendance_incident',id,before.branch_id,before,after,note||'إدارة حادثة حضور');
 return {ok:true,incident:after};
}
async function saveAttendanceIncidentSlaPolicy(env,me,body){
 if(!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة سياسات SLA.'),{status:403});
 const id=txt(body.id),category=['*','device_health','predictive','linking','maintenance'].includes(txt(body.category))?txt(body.category):'*',severity=['*','critical','warning','info'].includes(txt(body.severity))?txt(body.severity):'*',branchId=elevated(me)?(txt(body.branch_id)||null):actorBranch(me)||null;
 const clamp=v=>Math.max(1,Math.min(10080,Math.round(Number(v)||1))),responseMinutes=clamp(body.response_minutes),resolutionMinutes=clamp(body.resolution_minutes);
 if(resolutionMinutes<responseMinutes)throw Object.assign(new Error('مدة الحل يجب أن تكون مساوية أو أكبر من مدة الاستجابة.'),{status:400});
 const payload={branch_id:branchId,category,severity,active:body.active!==false,response_minutes:responseMinutes,resolution_minutes:resolutionMinutes,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 let before=null,after=null;
 if(id){
  before=(await rest(env,'attendance_incident_sla_policies?id=eq.'+enc(id)+'&select=*&limit=1'))?.[0]||null;if(!before)throw Object.assign(new Error('سياسة SLA غير موجودة.'),{status:404});if(!elevated(me)&&txt(before.branch_id)!==actorBranch(me))throw Object.assign(new Error('سياسة SLA خارج نطاق الفرع.'),{status:403});
  after=(await rest(env,'attendance_incident_sla_policies?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 }else{
  const key='custom-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  after=(await rest(env,'attendance_incident_sla_policies',{method:'POST',body:{...payload,policy_key:key,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 }
 if(!after)throw Object.assign(new Error('تعذر حفظ سياسة SLA.'),{status:500});
 await audit(env,me,before?'attendance_incident_sla_update':'attendance_incident_sla_create','attendance_incident_sla_policy',after.id,branchId,before,after,'إدارة سياسة SLA للحوادث');
 return {ok:true,policy:after};
}

function maintenanceNumber(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,n):0}
function maintenanceCategory(v){const allowed=new Set(['power','network','device_hardware','device_software','configuration','data_sync','user_mapping','external','unknown','other']);return allowed.has(txt(v))?txt(v):'unknown'}
function maintenanceType(v){const allowed=new Set(['remote','onsite','replacement','network','power','configuration','software','other']);return allowed.has(txt(v))?txt(v):'other'}
function maintenanceRisk(v){return ['low','medium','high'].includes(txt(v))?txt(v):'medium'}
async function scopedIncident(env,me,id){
 const rows=await rest(env,'attendance_incidents?id=eq.'+enc(id)+'&select=*&limit=1'),incident=rows?.[0]||null;if(!incident)return null;
 if(!elevated(me)&&txt(incident.branch_id)!==actorBranch(me))return null;return incident;
}
async function recalcIncidentMaintenanceCosts(env,maintenance){
 if(!maintenance?.id)return maintenance;
 const actions=await rest(env,'attendance_incident_maintenance_actions?maintenance_id=eq.'+enc(maintenance.id)+'&select=quantity,unit_cost,labor_cost,other_cost').catch(()=>[]);
 let parts=0,labor=0,other=0;for(const a of actions||[]){parts+=maintenanceNumber(a.quantity)*maintenanceNumber(a.unit_cost);labor+=maintenanceNumber(a.labor_cost);other+=maintenanceNumber(a.other_cost)}
 const patch={parts_cost:Number(parts.toFixed(2)),labor_cost:Number(labor.toFixed(2)),other_cost:Number(other.toFixed(2)),total_cost:Number((parts+labor+other).toFixed(2)),updated_at:new Date().toISOString()};
 return (await rest(env,'attendance_incident_maintenance?id=eq.'+enc(maintenance.id),{method:'PATCH',body:patch,prefer:'return=representation'}).catch(()=>[]))?.[0]||{...maintenance,...patch};
}
async function saveAttendanceIncidentMaintenance(env,me,body){
 if(!canManageDevices(me)&&!canReviewViolations(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة صيانة الحوادث.'),{status:403});
 const incidentId=txt(body.incident_id),incident=await scopedIncident(env,me,incidentId);if(!incident)throw Object.assign(new Error('الحادثة غير موجودة أو خارج نطاق الفرع.'),{status:404});
 const existing=(await rest(env,'attendance_incident_maintenance?incident_id=eq.'+enc(incidentId)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 let technician=null;const technicianId=txt(body.technician_staff_id);
 if(technicianId){technician=(await rest(env,'staff_users?id=eq.'+enc(technicianId)+'&select=id,name,branch_id,status&limit=1').catch(()=>[]))?.[0]||null;if(!technician||technician.status==='موقوف')throw Object.assign(new Error('الفني المحدد غير متاح.'),{status:400});if(!elevated(me)&&txt(technician.branch_id)&&txt(technician.branch_id)!==txt(incident.branch_id))throw Object.assign(new Error('الفني خارج نطاق الفرع.'),{status:403})}
 const now=new Date().toISOString(),payload={incident_id:incidentId,root_cause_category:maintenanceCategory(body.root_cause_category),root_cause_text:txt(body.root_cause_text)||null,maintenance_type:maintenanceType(body.maintenance_type),action_taken:txt(body.action_taken)||null,preventive_action:txt(body.preventive_action)||null,recurrence_risk:maintenanceRisk(body.recurrence_risk),recurrence_prevented:body.recurrence_prevented===true,technician_staff_id:technician?.id||null,technician_name:technician?.name||txt(body.technician_name)||null,vendor_name:txt(body.vendor_name)||null,maintenance_started_at:body.maintenance_started_at||existing?.maintenance_started_at||now,maintenance_completed_at:body.maintenance_completed_at||null,updated_by:actorId(me)||actorName(me)||null,updated_at:now};
 let after;
 if(existing)after=(await rest(env,'attendance_incident_maintenance?id=eq.'+enc(existing.id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 else after=(await rest(env,'attendance_incident_maintenance',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null,created_at:now},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ تحليل السبب والصيانة.'),{status:500});
 await addIncidentEvent(env,incident,existing?'maintenance_updated':'maintenance_started',actorId(me),actorName(me),txt(body.note)||'تحديث بيانات السبب الجذري والصيانة.',{maintenance_id:after.id,root_cause_category:after.root_cause_category,maintenance_type:after.maintenance_type});
 await audit(env,me,existing?'attendance_incident_maintenance_update':'attendance_incident_maintenance_create','attendance_incident_maintenance',after.id,incident.branch_id,existing,after,txt(body.note)||'إدارة صيانة حادثة حضور');
 return {ok:true,maintenance:after};
}
async function addAttendanceIncidentMaintenanceAction(env,me,body){
 if(!canManageDevices(me)&&!canReviewViolations(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإضافة إجراء صيانة.'),{status:403});
 const incidentId=txt(body.incident_id),incident=await scopedIncident(env,me,incidentId);if(!incident)throw Object.assign(new Error('الحادثة غير موجودة أو خارج نطاق الفرع.'),{status:404});
 let maintenance=(await rest(env,'attendance_incident_maintenance?incident_id=eq.'+enc(incidentId)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(!maintenance){const now=new Date().toISOString();maintenance=(await rest(env,'attendance_incident_maintenance',{method:'POST',body:{incident_id:incidentId,root_cause_category:'unknown',maintenance_type:'other',recurrence_risk:'medium',maintenance_started_at:now,created_by:actorId(me)||actorName(me)||null,updated_by:actorId(me)||actorName(me)||null,created_at:now,updated_at:now},prefer:'return=representation'}))?.[0]||null}
 if(!maintenance)throw Object.assign(new Error('تعذر إنشاء سجل الصيانة.'),{status:500});
 const description=txt(body.description);if(!description)throw Object.assign(new Error('اكتب وصف إجراء الصيانة.'),{status:400});
 const allowedTypes=new Set(['inspection','repair','configuration','replacement','network','power','software','test','work']),actionType=allowedTypes.has(txt(body.action_type))?txt(body.action_type):'work',now=new Date().toISOString();
 const payload={incident_id:incidentId,maintenance_id:maintenance.id,action_type:actionType,description,part_name:txt(body.part_name)||null,quantity:body.quantity===''||body.quantity==null?null:maintenanceNumber(body.quantity),unit_cost:body.unit_cost===''||body.unit_cost==null?null:maintenanceNumber(body.unit_cost),labor_cost:maintenanceNumber(body.labor_cost),other_cost:maintenanceNumber(body.other_cost),performed_by:txt(body.performed_by)||actorName(me)||null,performed_at:body.performed_at||now,outcome:txt(body.outcome)||null,created_by:actorId(me)||actorName(me)||null,created_at:now};
 const action=(await rest(env,'attendance_incident_maintenance_actions',{method:'POST',body:payload,prefer:'return=representation'}))?.[0]||null;if(!action)throw Object.assign(new Error('تعذر إضافة إجراء الصيانة.'),{status:500});
 maintenance=await recalcIncidentMaintenanceCosts(env,maintenance);
 await addIncidentEvent(env,incident,'maintenance_action',actorId(me),actorName(me),description,{maintenance_action_id:action.id,action_type:action.action_type,part_name:action.part_name,total_cost:maintenance.total_cost});
 await audit(env,me,'attendance_incident_maintenance_action_create','attendance_incident_maintenance_action',action.id,incident.branch_id,null,action,'إضافة إجراء صيانة للحادثة');
 return {ok:true,action,maintenance};
}
async function deleteAttendanceIncidentMaintenanceAction(env,me,body){
 if(!canManageDevices(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لحذف إجراء الصيانة.'),{status:403});
 const id=txt(body.id),action=(await rest(env,'attendance_incident_maintenance_actions?id=eq.'+enc(id)+'&select=*&limit=1'))?.[0]||null;if(!action)throw Object.assign(new Error('إجراء الصيانة غير موجود.'),{status:404});
 const incident=await scopedIncident(env,me,action.incident_id);if(!incident)throw Object.assign(new Error('الحادثة خارج نطاق الفرع.'),{status:403});
 const maintenance=(await rest(env,'attendance_incident_maintenance?id=eq.'+enc(action.maintenance_id)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 await rest(env,'attendance_incident_maintenance_actions?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});const after=maintenance?await recalcIncidentMaintenanceCosts(env,maintenance):null;
 await addIncidentEvent(env,incident,'maintenance_action_deleted',actorId(me),actorName(me),txt(body.reason)||action.description,{maintenance_action_id:id,total_cost:after?.total_cost??null});
 await audit(env,me,'attendance_incident_maintenance_action_delete','attendance_incident_maintenance_action',id,incident.branch_id,action,null,txt(body.reason)||'حذف إجراء صيانة');
 return {ok:true,maintenance:after};
}
async function verifyAttendanceIncidentMaintenance(env,me,body){
 if(!canManageDevices(me)&&!canReviewViolations(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لاعتماد الصيانة.'),{status:403});
 const incidentId=txt(body.incident_id),incident=await scopedIncident(env,me,incidentId);if(!incident)throw Object.assign(new Error('الحادثة غير موجودة أو خارج نطاق الفرع.'),{status:404});
 const before=(await rest(env,'attendance_incident_maintenance?incident_id=eq.'+enc(incidentId)+'&select=*&limit=1'))?.[0]||null;if(!before)throw Object.assign(new Error('سجل الصيانة غير موجود.'),{status:404});
 if(!txt(before.root_cause_text)||!txt(before.action_taken))throw Object.assign(new Error('أكمل السبب الجذري والإجراء المتخذ قبل الاعتماد.'),{status:409});
 const now=new Date().toISOString(),patch={verified_at:now,verified_by:actorId(me)||actorName(me)||null,verification_note:txt(body.verification_note)||'تمت مراجعة الصيانة والإجراء الوقائي.',recurrence_prevented:body.recurrence_prevented===true,maintenance_completed_at:before.maintenance_completed_at||now,updated_by:actorId(me)||actorName(me)||null,updated_at:now};
 const after=(await rest(env,'attendance_incident_maintenance?id=eq.'+enc(before.id),{method:'PATCH',body:patch,prefer:'return=representation'}))?.[0]||null;
 await addIncidentEvent(env,incident,'maintenance_verified',actorId(me),actorName(me),patch.verification_note,{maintenance_id:before.id,recurrence_prevented:patch.recurrence_prevented,total_cost:before.total_cost});
 await audit(env,me,'attendance_incident_maintenance_verify','attendance_incident_maintenance',before.id,incident.branch_id,before,after,patch.verification_note);
 return {ok:true,maintenance:after};
}

function preventiveChecklist(value){
 const arr=Array.isArray(value)?value:String(value||'').split(/\r?\n/);
 return [...new Set(arr.map(x=>txt(x)).filter(Boolean))].slice(0,30).map(x=>x.slice(0,200));
}
function preventiveDueIso(value,fallbackDays=30){
 if(!value)return new Date(Date.now()+Math.max(1,Number(fallbackDays)||30)*86400000).toISOString();
 const s=txt(value),d=/^\d{4}-\d{2}-\d{2}$/.test(s)?new Date(s+'T09:00:00+03:00'):new Date(s);
 if(!Number.isFinite(d.getTime()))throw Object.assign(new Error('موعد الصيانة القادمة غير صحيح.'),{status:400});
 return d.toISOString();
}
function buildPreventiveMaintenanceAlerts(plans,devices,recentMaintenance,recentIncidentRows){
 const nowMs=Date.now(),deviceMap=new Map((devices||[]).map(x=>[String(x.id),x])),alerts=[];
 for(const p of plans||[]){
  if(p.active===false)continue;
  const dueMs=new Date(p.next_due_at).getTime();if(!Number.isFinite(dueMs))continue;
  const lead=Math.max(0,Number(p.lead_days)||0),days=(dueMs-nowMs)/86400000;if(days>lead)continue;
  const d=deviceMap.get(String(p.device_id));if(!d)continue;
  const overdueDays=Math.max(0,Math.ceil((nowMs-dueMs)/86400000)),dueDays=Math.max(0,Math.ceil((dueMs-nowMs)/86400000));
  const severity=days<-7?'critical':days<0?'warning':'info',message=days<0?'الصيانة الوقائية متأخرة '+overdueDays+' يوم.':'موعد الصيانة الوقائية خلال '+dueDays+' يوم.';
  alerts.push({notification_key:'preventive_due:'+p.id,device_id:p.device_id,branch_id:p.branch_id||d.branch_id||null,category:'maintenance',severity,title:'صيانة وقائية — '+(p.title||d.name),message,metadata:{type:'preventive_due',plan_id:p.id,next_due_at:p.next_due_at,days_to_due:Math.round(days),frequency_days:p.frequency_days}});
 }
 const incidentMap=new Map((recentIncidentRows||[]).map(x=>[String(x.id),x])),groups=new Map();
 for(const m of recentMaintenance||[]){
  const incident=incidentMap.get(String(m.incident_id)),cause=txt(m.root_cause_category);if(!incident?.device_id||!cause||cause==='unknown')continue;
  const key=String(incident.device_id)+'|'+cause,g=groups.get(key)||{device_id:incident.device_id,branch_id:incident.branch_id||null,cause,events:[]};
  g.events.push({at:m.updated_at,prevention:m.recurrence_prevented===true});groups.set(key,g);
 }
 for(const g of groups.values()){
  const plan=(plans||[]).find(p=>String(p.device_id)===String(g.device_id)&&p.active!==false),threshold=Math.max(2,Number(plan?.recurrence_threshold)||3),windowDays=Math.max(30,Number(plan?.recurrence_window_days)||90),cutoff=nowMs-windowDays*86400000;
  const events=g.events.filter(e=>{const t=new Date(e.at).getTime();return Number.isFinite(t)&&t>=cutoff}),count=events.length,prevention=events.some(e=>e.prevention===true),lastAt=events.slice().sort((a,b)=>new Date(b.at)-new Date(a.at))[0]?.at||null;
  if(count<threshold||!prevention)continue;
  const d=deviceMap.get(String(g.device_id));if(!d)continue;
  alerts.push({notification_key:'maintenance_recurrence:'+g.device_id+':'+g.cause,device_id:g.device_id,branch_id:g.branch_id||d.branch_id||null,category:'maintenance',severity:count>=threshold+1?'critical':'warning',title:'تكرار سبب عطل — '+d.name,message:'تكرر نفس السبب الجذري '+count+' مرات خلال '+windowDays+' يوم رغم تسجيل إجراء لمنع التكرار.',metadata:{type:'root_cause_recurrence',root_cause_category:g.cause,count,threshold,window_days:windowDays,last_at:lastAt,plan_id:plan?.id||null}});
 }
 return alerts;
}
async function savePreventiveMaintenancePlan(env,me,body){
 if(!canManageDevices(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة خطط الصيانة الوقائية.'),{status:403});
 const id=txt(body.id),deviceId=txt(body.device_id);if(!deviceId)throw Object.assign(new Error('حدد جهاز البصمة.'),{status:400});
 const device=(await rest(env,'attendance_devices?id=eq.'+enc(deviceId)+'&select=*&limit=1'))?.[0]||null;if(!device)throw Object.assign(new Error('الجهاز غير موجود.'),{status:404});
 if(!elevated(me)&&txt(device.branch_id)!==actorBranch(me))throw Object.assign(new Error('الجهاز خارج نطاق الفرع.'),{status:403});
 const frequency=Math.max(1,Math.min(365,Math.round(Number(body.frequency_days)||30))),lead=Math.max(0,Math.min(90,Math.round(Number(body.lead_days)||7))),threshold=Math.max(2,Math.min(10,Math.round(Number(body.recurrence_threshold)||3))),windowDays=Math.max(30,Math.min(365,Math.round(Number(body.recurrence_window_days)||90))),checklist=preventiveChecklist(body.checklist);
 const title=txt(body.title)||('صيانة دورية — '+(device.name||device.serial_number)),nextDue=preventiveDueIso(body.next_due_at,frequency),staffId=txt(body.assigned_staff_id);let staff=null;
 if(staffId){staff=(await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,branch_id,status&limit=1').catch(()=>[]))?.[0]||null;if(!staff||staff.status==='موقوف')throw Object.assign(new Error('الموظف المسؤول غير متاح.'),{status:400});if(!elevated(me)&&txt(staff.branch_id)&&txt(staff.branch_id)!==txt(device.branch_id))throw Object.assign(new Error('الموظف المسؤول خارج نطاق الفرع.'),{status:403})}
 const now=new Date().toISOString(),payload={branch_id:device.branch_id||null,device_id:device.id,title,active:body.active!==false,frequency_days:frequency,lead_days:lead,checklist,assigned_staff_id:staff?.id||null,assigned_staff_name:staff?.name||null,vendor_name:txt(body.vendor_name)||null,next_due_at:nextDue,recurrence_window_days:windowDays,recurrence_threshold:threshold,notes:txt(body.notes)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:now};
 let before=null,after=null;
 if(id){
  before=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(id)+'&select=*&limit=1'))?.[0]||null;if(!before)throw Object.assign(new Error('خطة الصيانة غير موجودة.'),{status:404});if(!elevated(me)&&txt(before.branch_id)!==actorBranch(me))throw Object.assign(new Error('خطة الصيانة خارج نطاق الفرع.'),{status:403});
  after=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 }else{
  after=(await rest(env,'attendance_preventive_maintenance_plans',{method:'POST',body:{...payload,plan_key:'pm-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),created_by:actorId(me)||actorName(me)||null,created_at:now},prefer:'return=representation'}))?.[0]||null;
 }
 if(!after)throw Object.assign(new Error('تعذر حفظ خطة الصيانة الوقائية.'),{status:500});
 await audit(env,me,before?'attendance_preventive_plan_update':'attendance_preventive_plan_create','attendance_preventive_maintenance_plan',after.id,device.branch_id,before,after,txt(body.reason)||'إدارة خطة صيانة وقائية');
 return {ok:true,plan:after};
}
async function completePreventiveMaintenance(env,me,body){
 if(!canManageDevices(me)&&!canReviewViolations(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لتنفيذ الصيانة الوقائية.'),{status:403});
 const id=txt(body.plan_id),plan=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(id)+'&select=*&limit=1'))?.[0]||null;if(!plan)throw Object.assign(new Error('خطة الصيانة غير موجودة.'),{status:404});if(!elevated(me)&&txt(plan.branch_id)!==actorBranch(me))throw Object.assign(new Error('الخطة خارج نطاق الفرع.'),{status:403});
 const checklist=preventiveChecklist(plan.checklist),results=body.checklist_results&&typeof body.checklist_results==='object'&&!Array.isArray(body.checklist_results)?body.checklist_results:{};const missing=checklist.filter(x=>results[x]!==true);
 if(missing.length)throw Object.assign(new Error('أكمل جميع بنود قائمة الفحص قبل اعتماد الصيانة.'),{status:409});
 const now=new Date(),nowIso=now.toISOString(),staffId=txt(body.performed_by_staff_id)||txt(plan.assigned_staff_id);let staff=null;if(staffId)staff=(await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,branch_id,status&limit=1').catch(()=>[]))?.[0]||null;
 const run=(await rest(env,'attendance_preventive_maintenance_runs',{method:'POST',body:{plan_id:plan.id,device_id:plan.device_id,branch_id:plan.branch_id||null,due_at:plan.next_due_at,status:'completed',started_at:body.started_at||nowIso,completed_at:nowIso,performed_by_staff_id:staff?.id||null,performed_by_name:staff?.name||actorName(me)||null,checklist_results:results,findings:txt(body.findings)||null,action_taken:txt(body.action_taken)||null,total_cost:maintenanceNumber(body.total_cost),linked_incident_id:txt(body.linked_incident_id)||null,created_by:actorId(me)||actorName(me)||null,created_at:nowIso,updated_at:nowIso},prefer:'return=representation'}))?.[0]||null;if(!run)throw Object.assign(new Error('تعذر تسجيل تنفيذ الصيانة.'),{status:500});
 const nextDue=new Date(now.getTime()+Math.max(1,Number(plan.frequency_days)||30)*86400000).toISOString(),after=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(plan.id),{method:'PATCH',body:{last_completed_at:nowIso,next_due_at:nextDue,updated_by:actorId(me)||actorName(me)||null,updated_at:nowIso},prefer:'return=representation'}))?.[0]||plan;
 await audit(env,me,'attendance_preventive_maintenance_completed','attendance_preventive_maintenance_run',run.id,plan.branch_id,null,run,'تنفيذ الصيانة الوقائية');
 return {ok:true,run,plan:after};
}
async function skipPreventiveMaintenance(env,me,body){
 if(!canManageDevices(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لتخطي دورة الصيانة.'),{status:403});
 const id=txt(body.plan_id),reason=txt(body.reason);if(!reason)throw Object.assign(new Error('اكتب سبب تخطي دورة الصيانة.'),{status:400});
 const plan=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(id)+'&select=*&limit=1'))?.[0]||null;if(!plan)throw Object.assign(new Error('خطة الصيانة غير موجودة.'),{status:404});if(!elevated(me)&&txt(plan.branch_id)!==actorBranch(me))throw Object.assign(new Error('الخطة خارج نطاق الفرع.'),{status:403});
 const now=new Date(),nowIso=now.toISOString(),run=(await rest(env,'attendance_preventive_maintenance_runs',{method:'POST',body:{plan_id:plan.id,device_id:plan.device_id,branch_id:plan.branch_id||null,due_at:plan.next_due_at,status:'skipped',skip_reason:reason,performed_by_name:actorName(me)||null,created_by:actorId(me)||actorName(me)||null,created_at:nowIso,updated_at:nowIso},prefer:'return=representation'}))?.[0]||null;
 const nextDue=new Date(now.getTime()+Math.max(1,Number(plan.frequency_days)||30)*86400000).toISOString(),after=(await rest(env,'attendance_preventive_maintenance_plans?id=eq.'+enc(plan.id),{method:'PATCH',body:{next_due_at:nextDue,updated_by:actorId(me)||actorName(me)||null,updated_at:nowIso},prefer:'return=representation'}))?.[0]||plan;
 await audit(env,me,'attendance_preventive_maintenance_skipped','attendance_preventive_maintenance_run',run?.id||plan.id,plan.branch_id,null,run||{reason},reason);
 return {ok:true,run,plan:after};
}

function assetDate(value){
 const s=txt(value);if(!s)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(new Date(s+'T00:00:00Z').getTime()))throw Object.assign(new Error('التاريخ غير صحيح.'),{status:400});return s;
}
function assetCriticality(v){return ['low','medium','high'].includes(txt(v))?txt(v):'medium'}
function assetStatus(v){return ['active','repair','storage','retired'].includes(txt(v))?txt(v):'active'}
async function addDeviceAssetEvent(env,asset,eventType,title,details,amount,actorIdValue,actorNameValue,eventDate,metadata={}){
 if(!asset?.device_id)return null;
 const rows=await rest(env,'attendance_device_asset_events',{method:'POST',body:{device_id:asset.device_id,asset_id:asset.id||null,event_type:eventType||'note',event_date:eventDate||new Date().toISOString(),title:txt(title)||'تحديث أصل جهاز',details:txt(details)||null,amount:maintenanceNumber(amount),actor_id:txt(actorIdValue)||null,actor_name:txt(actorNameValue)||null,metadata:metadata&&typeof metadata==='object'?metadata:{},created_at:new Date().toISOString()},prefer:'return=representation'}).catch(()=>[]);
 return rows?.[0]||null;
}
async function saveAttendanceDeviceAsset(env,me,body){
 if(!canManageDevices(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة بيانات أصول أجهزة البصمة.'),{status:403});
 const deviceId=txt(body.device_id);if(!deviceId)throw Object.assign(new Error('حدد جهاز البصمة.'),{status:400});
 const device=(await rest(env,'attendance_devices?id=eq.'+enc(deviceId)+'&select=*&limit=1'))?.[0]||null;if(!device)throw Object.assign(new Error('الجهاز غير موجود.'),{status:404});if(!elevated(me)&&txt(device.branch_id)!==actorBranch(me))throw Object.assign(new Error('الجهاز خارج نطاق الفرع.'),{status:403});
 const existing=(await rest(env,'attendance_device_assets?device_id=eq.'+enc(deviceId)+'&select=*&limit=1').catch(()=>[]))?.[0]||null,purchaseDate=assetDate(body.purchase_date),installationDate=assetDate(body.installation_date),warrantyStart=assetDate(body.warranty_start_date),warrantyEnd=assetDate(body.warranty_end_date),contractEnd=assetDate(body.service_contract_end_date);
 if(warrantyStart&&warrantyEnd&&new Date(warrantyEnd)<new Date(warrantyStart))throw Object.assign(new Error('نهاية الضمان يجب أن تكون بعد بدايته.'),{status:400});
 const now=new Date().toISOString(),payload={device_id:device.id,branch_id:device.branch_id||null,asset_tag:txt(body.asset_tag)||null,purchase_date:purchaseDate,installation_date:installationDate,purchase_cost:maintenanceNumber(body.purchase_cost),replacement_cost:maintenanceNumber(body.replacement_cost),expected_life_months:Math.max(1,Math.min(240,Math.round(Number(body.expected_life_months)||60))),warranty_start_date:warrantyStart,warranty_end_date:warrantyEnd,service_contract_end_date:contractEnd,vendor_name:txt(body.vendor_name)||null,vendor_contact:txt(body.vendor_contact)||null,criticality:assetCriticality(body.criticality),asset_status:assetStatus(body.asset_status),notes:txt(body.notes)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:now};
 let after;
 if(existing)after=(await rest(env,'attendance_device_assets?id=eq.'+enc(existing.id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 else after=(await rest(env,'attendance_device_assets',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null,created_at:now},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ بيانات أصل الجهاز.'),{status:500});
 await addDeviceAssetEvent(env,after,existing?'profile_updated':'profile_created',existing?'تحديث بيانات أصل الجهاز':'تسجيل أصل الجهاز',txt(body.reason)||null,0,actorId(me),actorName(me),now,{before_status:existing?.asset_status||null,status:after.asset_status});
 await audit(env,me,existing?'attendance_device_asset_update':'attendance_device_asset_create','attendance_device_asset',after.id,device.branch_id,existing,after,txt(body.reason)||'إدارة أصل جهاز البصمة');
 return {ok:true,asset:after};
}
async function addAttendanceDeviceAssetEvent(env,me,body){
 if(!canManageDevices(me)&&!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإضافة حدث دورة حياة للجهاز.'),{status:403});
 const deviceId=txt(body.device_id),device=(await rest(env,'attendance_devices?id=eq.'+enc(deviceId)+'&select=*&limit=1'))?.[0]||null;if(!device)throw Object.assign(new Error('الجهاز غير موجود.'),{status:404});if(!elevated(me)&&txt(device.branch_id)!==actorBranch(me))throw Object.assign(new Error('الجهاز خارج نطاق الفرع.'),{status:403});
 const asset=(await rest(env,'attendance_device_assets?device_id=eq.'+enc(deviceId)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;if(!asset)throw Object.assign(new Error('سجل الأصل غير موجود. احفظ بيانات الأصل أولًا.'),{status:409});
 const allowed=new Set(['purchase','installation','relocation','warranty_service','contract_service','repair','upgrade','replacement_review','retirement','reactivation','note']),eventType=allowed.has(txt(body.event_type))?txt(body.event_type):'note',title=txt(body.title);if(!title)throw Object.assign(new Error('اكتب عنوان الحدث.'),{status:400});
 const eventDate=body.event_date?new Date(body.event_date).toISOString():new Date().toISOString(),event=await addDeviceAssetEvent(env,asset,eventType,title,body.details,body.amount,actorId(me),actorName(me),eventDate,{source:'manual'});
 if(!event)throw Object.assign(new Error('تعذر إضافة حدث دورة حياة الجهاز.'),{status:500});
 await audit(env,me,'attendance_device_asset_event_create','attendance_device_asset_event',event.id,device.branch_id,null,event,title);return {ok:true,event};
}
function daysUntilDate(value,nowMs=Date.now()){if(!value)return null;const t=new Date(String(value).slice(0,10)+'T23:59:59Z').getTime();return Number.isFinite(t)?Math.ceil((t-nowMs)/86400000):null}
function buildDeviceLifecycle(devices,assets,historicalIncidents,historicalMaintenance,preventiveRuns,healthRows){
 const nowMs=Date.now(),yearCutoff=nowMs-365*86400000,quarterCutoff=nowMs-90*86400000,assetMap=new Map((assets||[]).map(x=>[String(x.device_id),x])),healthMap=new Map((healthRows||[]).map(x=>[String(x.device_id),x])),incidentMap=new Map((historicalIncidents||[]).map(x=>[String(x.id),x])),maintenanceByIncident=new Map((historicalMaintenance||[]).map(x=>[String(x.incident_id),x])),rows=[],alerts=[];
 for(const d of devices||[]){
  const a=assetMap.get(String(d.id))||null,deviceIncidents=(historicalIncidents||[]).filter(x=>String(x.device_id)===String(d.id)),incidents90=deviceIncidents.filter(x=>new Date(x.started_at).getTime()>=quarterCutoff).length,incidents365=deviceIncidents.filter(x=>new Date(x.started_at).getTime()>=yearCutoff).length;
  let correctiveCost=0,downtime=0;for(const inc of deviceIncidents){if(new Date(inc.started_at).getTime()<yearCutoff)continue;correctiveCost+=maintenanceNumber(maintenanceByIncident.get(String(inc.id))?.total_cost);downtime+=Math.max(0,Number(inc.resolution_seconds)||0)}
  const preventiveCost=(preventiveRuns||[]).filter(x=>String(x.device_id)===String(d.id)&&x.status==='completed'&&new Date(x.completed_at||x.created_at).getTime()>=yearCutoff).reduce((n,x)=>n+maintenanceNumber(x.total_cost),0),maintenance365=correctiveCost+preventiveCost,baseDate=a?.installation_date||a?.purchase_date||d.created_at||null,ageMonths=baseDate?Math.max(0,(nowMs-new Date(baseDate).getTime())/(30.4375*86400000)):null,lifeMonths=Math.max(1,Number(a?.expected_life_months)||60),lifePct=ageMonths==null?null:ageMonths/lifeMonths*100,replacementCost=maintenanceNumber(a?.replacement_cost),costRatio=replacementCost>0?maintenance365/replacementCost:null,warrantyDays=daysUntilDate(a?.warranty_end_date,nowMs),contractDays=daysUntilDate(a?.service_contract_end_date,nowMs),health=healthMap.get(String(d.id));let score=0,signals=[];
  if(lifePct!=null){if(lifePct>=100){score+=40;signals.push('تجاوز العمر التشغيلي المتوقع.')}else if(lifePct>=80){score+=25;signals.push('اقترب من نهاية العمر التشغيلي المتوقع.')}else if(lifePct>=60)score+=10}
  if(incidents90>=4){score+=28;signals.push(incidents90+' حوادث خلال 90 يوم.')}else if(incidents90>=3){score+=20;signals.push('تكرر العطل 3 مرات خلال 90 يوم.')}else if(incidents90>=2)score+=10;
  if(costRatio!=null){if(costRatio>=0.6){score+=25;signals.push('تكلفة الصيانة السنوية مرتفعة مقارنة بتكلفة الاستبدال.')}else if(costRatio>=0.35){score+=15;signals.push('تكلفة الصيانة السنوية تقترب من تكلفة الاستبدال.')}else if(costRatio>=0.2)score+=8}
  if(downtime>=72*3600){score+=15;signals.push('زمن التعطل السنوي تجاوز 72 ساعة.')}else if(downtime>=24*3600)score+=8;
  if(Number(health?.score)<70){score+=10;signals.push('درجة صحة الجهاز الحالية منخفضة.')}
  score=Math.max(0,Math.min(100,score));let recommendation=score>=70?'replace_soon':score>=50?'replacement_review':score>=30?'monitor':'normal',label=score>=70?'استبدال قريب':score>=50?'تقييم الاستبدال':score>=30?'مراقبة':'طبيعي',tone=score>=70?'red':score>=50?'orange':score>=30?'blue':'green';
  if(a?.asset_status==='retired'){recommendation='retired';label='متقاعد';tone='gray';score=0}
  const row={device_id:d.id,branch_id:d.branch_id||null,asset:a,age_months:ageMonths==null?null:Math.round(ageMonths*10)/10,life_used_pct:lifePct==null?null:Math.round(lifePct),incidents_90d:incidents90,incidents_365d:incidents365,corrective_cost_365:Number(correctiveCost.toFixed(2)),preventive_cost_365:Number(preventiveCost.toFixed(2)),maintenance_cost_365:Number(maintenance365.toFixed(2)),downtime_365_seconds:downtime,replacement_pressure_score:score,recommendation,recommendation_label:label,tone,signals,warranty_days_left:warrantyDays,contract_days_left:contractDays};rows.push(row);
  if(a?.asset_status!=='retired'&&warrantyDays!=null&&warrantyDays<=30)alerts.push({notification_key:'asset_warranty:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'maintenance',severity:warrantyDays<0?'warning':'info',title:(warrantyDays<0?'انتهاء ضمان الجهاز — ':'ضمان الجهاز يقترب من الانتهاء — ')+d.name,message:warrantyDays<0?'انتهى الضمان منذ '+Math.abs(warrantyDays)+' يوم.':'متبقي '+warrantyDays+' يوم على انتهاء الضمان.',metadata:{type:'asset_warranty',days_to_expiry:warrantyDays,asset_id:a.id,warranty_end_date:a.warranty_end_date}});
  if(a?.asset_status!=='retired'&&contractDays!=null&&contractDays<=30)alerts.push({notification_key:'asset_contract:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'maintenance',severity:contractDays<0?'warning':'info',title:(contractDays<0?'انتهاء عقد صيانة — ':'عقد الصيانة يقترب من الانتهاء — ')+d.name,message:contractDays<0?'انتهى عقد الصيانة منذ '+Math.abs(contractDays)+' يوم.':'متبقي '+contractDays+' يوم على انتهاء عقد الصيانة.',metadata:{type:'asset_contract',days_to_expiry:contractDays,asset_id:a.id,service_contract_end_date:a.service_contract_end_date}});
  if(a?.asset_status!=='retired'&&score>=50)alerts.push({notification_key:'asset_replacement:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'maintenance',severity:score>=70?'critical':'warning',title:'تقييم دورة حياة الجهاز — '+d.name,message:signals.slice(0,3).join(' ')||'مؤشرات دورة الحياة تستدعي المراجعة.',metadata:{type:'asset_replacement',score,recommendation,signals,asset_id:a?.id||null}});
 }
 return {rows,alerts};
}

async function saveAttendanceEscalationRule(env,me,body){
 if(!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة قواعد تصعيد التنبيهات.'),{status:403});
 const id=txt(body.id),category=['*','device_health','predictive','linking','maintenance'].includes(txt(body.category))?txt(body.category):'*',severity=['*','critical','warning','info'].includes(txt(body.severity))?txt(body.severity):'*';
 const branchId=elevated(me)?(txt(body.branch_id)||null):actorBranch(me)||null;
 const minute=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(10080,Math.round(n))):null};
 const l1=minute(body.level1_minutes),l2=minute(body.level2_minutes),l3=minute(body.level3_minutes);
 if(l2!=null&&l1!=null&&l2<l1)throw Object.assign(new Error('المستوى الثاني يجب أن يكون بعد المستوى الأول.'),{status:400});
 if(l3!=null&&l2!=null&&l3<l2)throw Object.assign(new Error('المستوى الثالث يجب أن يكون بعد المستوى الثاني.'),{status:400});
 const channels=body.channels&&typeof body.channels==='object'?{in_app:body.channels.in_app!==false,whatsapp:body.channels.whatsapp===true,email:body.channels.email===true}:{in_app:true,whatsapp:false,email:false};
 const payload={branch_id:branchId,category,severity,active:body.active!==false,level1_minutes:l1,level2_minutes:l2,level3_minutes:l3,level1_roles:cleanEscalationRoles(body.level1_roles),level2_roles:cleanEscalationRoles(body.level2_roles),level3_roles:cleanEscalationRoles(body.level3_roles),channels,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 let before=null,after=null;
 if(id){
  const rows=await rest(env,'attendance_notification_escalation_rules?id=eq.'+enc(id)+'&select=*&limit=1'),row=rows?.[0]||null;if(!row)throw Object.assign(new Error('قاعدة التصعيد غير موجودة.'),{status:404});if(!elevated(me)&&txt(row.branch_id)!==actorBranch(me))throw Object.assign(new Error('قاعدة التصعيد خارج نطاق الفرع.'),{status:403});before=row;
  after=(await rest(env,'attendance_notification_escalation_rules?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 }else{
  const ruleKey='custom-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
  after=(await rest(env,'attendance_notification_escalation_rules',{method:'POST',body:{...payload,rule_key:ruleKey,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 }
 if(!after)throw Object.assign(new Error('تعذر حفظ قاعدة التصعيد.'),{status:500});
 await audit(env,me,before?'attendance_escalation_rule_update':'attendance_escalation_rule_create','attendance_notification_escalation_rule',after.id,branchId,before,after,txt(body.reason)||'إدارة قواعد تصعيد تنبيهات الحضور');
 return {ok:true,rule:after};
}
function clockDriftText(seconds){
 const n=Math.round(Number(seconds)||0),abs=Math.abs(n),dir=n>0?'متقدمة':'متأخرة';
 if(abs<120)return 'مضبوطة';
 if(abs>=3600){const h=abs/3600;return dir+' '+(Math.abs(h-Math.round(h))<0.03?Math.round(h):h.toFixed(1))+' ساعة'}
 return dir+' '+Math.round(abs/60)+' دقيقة';
}
function canonicalClockDrift(seconds){
 const raw=Math.round(Number(seconds)||0),hour=Math.round(raw/3600)*3600,minute=Math.round(raw/60)*60;
 if(Math.abs(raw)>=1800&&Math.abs(raw-hour)<=120)return hour;
 if(Math.abs(raw-minute)<=5)return minute;
 return raw;
}
function zktecoOldEncodeUtc(value=new Date()){
 const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))throw new Error('وقت السيرفر غير صالح.');
 const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate(),h=d.getUTCHours(),min=d.getUTCMinutes(),sec=d.getUTCSeconds();
 return (((y-2000)*12*31+(m-1)*31+day-1)*86400)+((h*60+min)*60)+sec;
}
function zktecoClockCommand(at=new Date()){
 const encoded=zktecoOldEncodeUtc(at),serverTz='+0300';
 return {encoded,serverTz,command:'SET OPTIONS DateTime='+encoded+',ServerTZ='+serverTz,algorithm:'zkteco_old_encode_utc_v1'};
}
async function queueClockSync(env,device,me,{source='manual',force=false}={}){
 if(!device?.id)throw Object.assign(new Error('الجهاز غير موجود.'),{status:404});
 if(device.status!=='active')throw Object.assign(new Error('جهاز البصمة موقوف.'),{status:409});
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.clock_sync&status=in.(queued,sent)&select=id&order=id.desc&limit=1').catch(()=>[]);
 if(pending?.length)return {ok:true,queued:false,command_id:pending[0].id,message:'يوجد تحديث لساعة الجهاز قيد التنفيذ بالفعل.'};
 if(await hasAttendanceHistoryTransfer(env,device))throw Object.assign(new Error('يوجد نقل سجل حضور تاريخي قيد التنفيذ. انتظر اكتماله قبل تعديل ساعة الجهاز.'),{status:409});
 const previous=device?.metadata?.last_clock_sync||{},lastMs=new Date(previous.requested_at||previous.accepted_at||0).getTime();
 if(!force&&Number.isFinite(lastMs)&&Date.now()-lastMs<6*3600000)return {ok:true,queued:false,cooldown:true,command_id:previous.command_id||null,message:'تمت محاولة مزامنة الساعة خلال آخر 6 ساعات؛ لن يكررها النظام تلقائيًا الآن.'};
 const now=new Date(),requestedAt=now.toISOString(),spec=zktecoClockCommand(now),created=await queueCommands(env,device,me,[{type:'clock_sync',command:spec.command,metadata:{clock_sync:true,source,requested_at:requestedAt,encoded_time:spec.encoded,server_tz:spec.serverTz,algorithm:spec.algorithm,previous_drift_seconds:device?.metadata?.clock_drift?.drift_seconds??null}}]),cmd=created?.[0]||null;
 const meta={...(device.metadata||{}),last_clock_sync:{status:'queued',command_id:cmd?.id||null,source,requested_at:requestedAt,encoded_time:spec.encoded,server_tz:spec.serverTz,algorithm:spec.algorithm,previous_drift_seconds:device?.metadata?.clock_drift?.drift_seconds??null,awaiting_verification:true,verification_samples:0}};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:requestedAt},prefer:'return=minimal'}).catch(()=>{});device.metadata=meta;
 await audit(env,me,'attendance_device_clock_sync_requested','attendance_device',device.id,device.branch_id,null,{command_id:cmd?.id||null,source,encoded_time:spec.encoded,server_tz:spec.serverTz,algorithm:spec.algorithm},source==='auto'?'مزامنة تلقائية لساعة جهاز البصمة':'مزامنة ساعة جهاز البصمة مع وقت السيرفر');
 return {ok:true,queued:true,command_id:cmd?.id||null,encoded_time:spec.encoded,server_tz:spec.serverTz,message:'تم إرسال تحديث الساعة الفعلية للجهاز من السيرفر. سيتم التحقق من النتيجة مع أول حركة Live جديدة.'};
}
async function updateClockSyncResult(env,cmd,rc,resultBody){
 if(!cmd?.device_id||cmd.command_type!=='clock_sync')return;
 const device=(await rest(env,'attendance_devices?id=eq.'+enc(cmd.device_id)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;if(!device)return;
 const now=new Date().toISOString(),meta={...(device.metadata||{})},old=meta.last_clock_sync||{},same=!old.command_id||String(old.command_id)===String(cmd.id),sync={...(same?old:{}),command_id:cmd.id,source:cmd?.metadata?.source||old.source||'manual',requested_at:cmd?.metadata?.requested_at||old.requested_at||cmd.created_at||null,encoded_time:cmd?.metadata?.encoded_time??old.encoded_time??null,server_tz:cmd?.metadata?.server_tz||old.server_tz||'+0300',algorithm:cmd?.metadata?.algorithm||old.algorithm||'zkteco_old_encode_utc_v1',result_code:rc,result_body:txt(resultBody).slice(0,500),status:rc===0?'accepted':'failed',awaiting_verification:rc===0,accepted_at:rc===0?now:null,failed_at:rc===0?null:now,verification_samples:0};
 meta.last_clock_sync=sync;await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 if(rc===0)await recordDeviceHealthEvent(env,{event_key:'clock_sync_accepted:'+cmd.id,device_id:device.id,branch_id:device.branch_id,event_type:'clock_sync_accepted',severity:'info',status:'closed',started_at:now,ended_at:now,command_id:cmd.id,result_code:rc,summary:'استلم الجهاز أمر مزامنة الساعة من السيرفر بنجاح، وبانتظار التحقق من حركة Live.',metadata:{server_tz:sync.server_tz,encoded_time:sync.encoded_time,algorithm:sync.algorithm}});
}
async function serveDeviceClock(env,device,request,url){
 const now=new Date(),spec=zktecoClockCommand(now),servedAt=now.toISOString(),meta={...(device.metadata||{})},sync=meta.last_clock_sync||{};
 meta.last_clock_server_response={served_at:servedAt,encoded_time:spec.encoded,server_tz:spec.serverTz,algorithm:spec.algorithm,path:url.pathname,type:txt(url.searchParams.get('type'))||'time'};
 if(sync.awaiting_verification)meta.last_clock_sync={...sync,time_callback_at:servedAt,time_callback_path:url.pathname,server_time_served:spec.encoded,server_tz:spec.serverTz};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:servedAt},prefer:'return=minimal'}).catch(()=>{});
 const body='DateTime='+spec.encoded+',ServerTZ='+spec.serverTz;
 return new Response(body,{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Date':now.toUTCString()}});
}
async function hasAttendanceHistoryTransfer(env,device){
 if(device?.metadata?.force_attlog_replay)return true;
 const rows=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&status=in.(queued,sent)&command_type=in.(sync_attlog,history_attlog,history_attlog_replay)&select=id&limit=1').catch(()=>[]);
 return !!rows?.length;
}
async function normalizeClockDriftedLogs(env,device,driftSeconds,lookbackDays=2){
 const drift=Math.round(Number(driftSeconds));if(!device?.id||!Number.isFinite(drift)||Math.abs(drift)<=120)return {ok:true,corrected_count:0};
 if(await hasAttendanceHistoryTransfer(env,device))return {ok:true,corrected_count:0,skipped:'history_transfer'};
 const since=new Date(Date.now()-Math.max(1,Math.min(365,Number(lookbackDays)||2))*86400000).toISOString();
 const out=await rest(env,'rpc/attendance_correct_device_clock_logs',{method:'POST',body:{p_device_id:device.id,p_drift_seconds:drift,p_tolerance_seconds:180,p_since:since}}).catch(()=>null),result=Array.isArray(out)?out[0]:out;
 const count=Math.max(0,Number(result?.corrected_count)||0);
 if(count>0){
  const now=new Date().toISOString(),rows=await rest(env,'attendance_devices?id=eq.'+enc(device.id)+'&select=metadata&limit=1').catch(()=>[]),current=rows?.[0]?.metadata||device.metadata||{},meta={...current,last_clock_log_correction:{corrected_at:now,corrected_count:count,drift_seconds:drift,lookback_days:lookbackDays,method:'confirmed_clock_drift_rpc'}};
  await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  device.metadata=meta;
 }
 return result||{ok:true,corrected_count:count};
}
async function recordDeviceClockSample(env,device,serial,body,source='attlog_live'){
 if(!device?.id||await hasAttendanceHistoryTransfer(env,device))return null;
 const serverMs=Date.now(),samples=[];
 for(const raw of String(body||'').split(/\r?\n/)){const f=raw.trim().split('\t'),rawTime=txt(f[1]),iso=parseSaudiDeviceTime(rawTime);if(!iso)continue;const ms=new Date(iso).getTime();if(!Number.isFinite(ms))continue;const measuredDrift=Math.round((ms-serverMs)/1000);samples.push({rawTime,ms,measuredDrift,drift:canonicalClockDrift(measuredDrift)})}
 if(!samples.length)return null;
 samples.sort((a,b)=>b.ms-a.ms);const spanMs=samples[0].ms-samples[samples.length-1].ms;if(samples.length>1&&spanMs>10*60*1000)return null;
 const sample=samples[0],abs=Math.abs(sample.drift);
 if(abs>12*3600)return null;
 const now=new Date(serverMs).toISOString(),prev=device?.metadata?.clock_drift&&typeof device.metadata.clock_drift==='object'?device.metadata.clock_drift:{},prevAge=prev.checked_at?serverMs-new Date(prev.checked_at).getTime():Infinity,consistent=Number.isFinite(Number(prev.drift_seconds))&&prevAge<=24*3600*1000&&Math.abs(Number(prev.drift_seconds)-sample.drift)<=90,count=consistent?Math.max(1,Number(prev.consecutive_consistent)||1)+1:1,confirmed=abs<=120||count>=2,status=abs<=120?'ok':abs<=15*60?'warning':'critical';
 const clock={drift_seconds:sample.drift,measured_drift_seconds:sample.measuredDrift,drift_minutes:Math.round(sample.drift/60*10)/10,status,confirmed,consecutive_consistent:count,checked_at:now,source,device_time_raw:sample.rawTime,server_time:now,timezone:device.timezone||'Asia/Riyadh'};
 const effectiveClock=!confirmed&&prev.confirmed===true?prev:clock,meta={...(device.metadata||{}),clock_drift:effectiveClock},lastSync=meta.last_clock_sync&&typeof meta.last_clock_sync==='object'?meta.last_clock_sync:null;
 if(lastSync?.awaiting_verification&&confirmed){
  const acceptedMs=new Date(lastSync.accepted_at||lastSync.requested_at||0).getTime();
  if(Number.isFinite(acceptedMs)&&serverMs>=acceptedMs-5000){
   const verificationSamples=Math.max(0,Number(lastSync.verification_samples)||0)+1;
   if(abs<=120){
    meta.last_clock_sync={...lastSync,status:'verified',awaiting_verification:false,verification_samples:verificationSamples,verified_at:now,verified_drift_seconds:sample.drift,verified_device_time_raw:sample.rawTime};
   }else{
    meta.last_clock_sync={...lastSync,status:'accepted_unverified',awaiting_verification:true,verification_samples:verificationSamples,last_verification_at:now,last_verification_drift_seconds:sample.drift,last_verification_device_time_raw:sample.rawTime};
   }
  }
 }
 await Promise.all([
  rest(env,'attendance_device_clock_checks',{method:'POST',body:{device_id:device.id,branch_id:device.branch_id||null,serial_number:serial||device.serial_number||null,source,device_time_raw:sample.rawTime,server_time:now,drift_seconds:sample.drift,status,confirmed,sample_count:count,metadata:{timezone:clock.timezone,batch_lines:samples.length,measured_drift_seconds:sample.measuredDrift,canonical_drift_seconds:sample.drift}},prefer:'return=minimal'}).catch(()=>{}),
  rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{})
 ]);
 const wasBad=prev.confirmed===true&&Math.abs(Number(prev.drift_seconds)||0)>120;
 if(confirmed&&abs>120&&(!wasBad||Math.abs((Number(prev.drift_seconds)||0)-sample.drift)>90)){await normalizeClockDriftedLogs(env,device,sample.drift,180).catch(()=>null);await recordDeviceHealthEvent(env,{event_key:'clock_drift:'+device.id+':'+now.slice(0,13),device_id:device.id,branch_id:device.branch_id,event_type:'clock_drift',severity:abs>15*60?'critical':'warning',status:'open',started_at:now,summary:'ساعة الجهاز '+clockDriftText(sample.drift)+'.',metadata:clock})}
 if(confirmed&&abs<=120&&wasBad)await recordDeviceHealthEvent(env,{event_key:'clock_recovered:'+device.id+':'+now.slice(0,13),device_id:device.id,branch_id:device.branch_id,event_type:'clock_recovered',severity:'info',status:'closed',started_at:now,ended_at:now,summary:'عادت ساعة الجهاز إلى فرق مقبول عن وقت السيرفر.',metadata:{previous_drift_seconds:prev.drift_seconds,current_drift_seconds:sample.drift}});
 if(meta.last_clock_sync?.status==='verified'&&lastSync?.status!=='verified')await recordDeviceHealthEvent(env,{event_key:'clock_sync_verified:'+String(meta.last_clock_sync.command_id||now),device_id:device.id,branch_id:device.branch_id,event_type:'clock_sync_verified',severity:'info',status:'closed',started_at:now,ended_at:now,command_id:meta.last_clock_sync.command_id||null,result_code:0,summary:'تم التحقق من مزامنة ساعة الجهاز فعليًا من حركة Live جديدة.',metadata:{drift_seconds:sample.drift,device_time_raw:sample.rawTime}});
 device.metadata=meta;
 return clock;
}
async function probeDeviceClock(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لفحص ساعة جهاز البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.clock_probe&status=in.(queued,sent)&select=id&limit=1').catch(()=>[]);
 if(pending?.length)return {ok:true,queued:false,command_id:pending[0].id,message:'يوجد فحص للساعة قيد التنفيذ بالفعل.'};
 const created=await queueCommands(env,device,me,[{type:'clock_probe',command:'GET OPTIONS DateTime,ServerTZ',metadata:{clock_probe:true,requested_at:new Date().toISOString()}}]);
 await audit(env,me,'attendance_device_clock_probe','attendance_device',device.id,device.branch_id,null,{command_id:created?.[0]?.id||null},'فحص وقت الجهاز والمنطقة الزمنية');
 return {ok:true,queued:true,command_id:created?.[0]?.id||null,message:'تم إرسال طلب قراءة ساعة الجهاز والمنطقة الزمنية.'};
}
async function handleClockOptionsPayload(env,device,url,body){
 const type=lower(url.searchParams.get('type'));if(type!=='options')return false;
 const info=parseDeviceInfo(body),dateTime=txt(info.datetime),serverTz=txt(info.servertz),now=new Date().toISOString(),meta={...(device.metadata||{})},probe={checked_at:now,datetime:dateTime||null,server_tz:serverTz||null,raw:String(body||'').slice(0,2000),datetime_mode:/^\d{8,12}$/.test(dateTime)?'encoded_seconds':/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(dateTime)?'text':'unknown'};
 meta.clock_probe=probe;await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.clock_probe&status=in.(queued,sent,success)&select=id&order=id.desc&limit=1').catch(()=>[]),cmd=pending?.[0];
 if(cmd?.id)await rest(env,'attendance_device_commands?id=eq.'+enc(cmd.id),{method:'PATCH',body:{status:'success',result_code:0,result_body:String(body||'').slice(0,2000),completed_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 return true;
}
async function syncDeviceClock(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لمزامنة ساعة جهاز البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 return await queueClockSync(env,device,me,{source:'manual',force:true});
}

function deviceHealthSnapshot(device,latestLog,deviceCommands=[],unlinkedCount=0,unlinkedTruncated=false){
 const seen=device?.last_command_poll_at||device?.last_seen_at||null,seenAge=ageSeconds(seen),lastLog=latestLog?.occurred_at||null,lastReceived=latestLog?.received_at||null,logAge=ageSeconds(lastLog);
 const recent=(deviceCommands||[]).slice().sort((x,y)=>Number(y.id||0)-Number(x.id||0)),latestCommand=recent[0]||null,pendingRows=recent.filter(x=>x.status==='queued'||x.status==='sent'),pending=pendingRows.length,stuck=pendingRows.filter(x=>(ageSeconds(x.sent_at||x.updated_at||x.created_at)??0)>15*60).length;
 const profile=device?.metadata?.history_profile||{},issues=[];let severity=0,label='سليم',tone='green',connection='online',score=100;
 if(device?.status!=='active'){severity=1;label='موقوف';tone='gray';connection='disabled';score=0;issues.push('الجهاز موقوف من إعدادات النظام.')}
 else if(seenAge==null||seenAge>1800){severity=3;label='غير متصل';tone='red';connection='offline';score-=60;issues.push('لا يوجد اتصال حديث من الجهاز خلال آخر 30 دقيقة.')}
 else if(seenAge>180){severity=Math.max(severity,1);label='يحتاج متابعة';tone='orange';connection='recent';score-=15;issues.push('اتصال الجهاز ليس لحظيًا؛ آخر اتصال منذ أكثر من 3 دقائق.')}
 const latestCommandAge=latestCommand?ageSeconds(latestCommand.completed_at||latestCommand.updated_at||latestCommand.created_at):null;
 if(latestCommand?.status==='failed'&&latestCommandAge!=null&&latestCommandAge<=3600){
  severity=Math.max(severity,2);label=severity>=3?'غير متصل':'يحتاج متابعة';tone=severity>=3?'red':'orange';score-=20;issues.push('آخر أمر للجهاز فشل'+(latestCommand.result_code!=null?' (Code '+latestCommand.result_code+')':'')+'.');
 }
 if(stuck>0){severity=Math.max(severity,2);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=15;issues.push(String(stuck)+' أمر معلق منذ أكثر من 15 دقيقة.')}
 if(Number(unlinkedCount)>0){severity=Math.max(severity,1);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=10;issues.push(String(unlinkedCount)+(unlinkedTruncated?'+':'')+' حركة تحتاج ربط موظف.')}
 if(device?.metadata?.force_attlog_replay){severity=Math.max(severity,1);if(severity<3){label='جاري معالجة';tone='orange'}score-=5;issues.push('إعادة إرسال سجل الحضور التاريخي قيد التنفيذ.')}
 const clock=device?.metadata?.clock_drift||{},clockSec=Number(clock.drift_seconds),clockConfirmed=clock.confirmed===true&&Number.isFinite(clockSec),clockSync=device?.metadata?.last_clock_sync||{},clockCheckedMs=new Date(clock.checked_at||0).getTime(),clockSyncMs=new Date(clockSync.accepted_at||clockSync.time_callback_at||clockSync.requested_at||0).getTime(),clockVerificationPending=clockConfirmed&&clockSync.awaiting_verification===true&&['accepted','accepted_unverified','queued'].includes(txt(clockSync.status))&&Number.isFinite(clockSyncMs)&&(!Number.isFinite(clockCheckedMs)||clockSyncMs>clockCheckedMs),clockBad=clockConfirmed&&Math.abs(clockSec)>120&&!clockVerificationPending;
 if(clockVerificationPending){if(connection!=='offline'){label='المزامنة مستلمة';tone='green'}issues.push('تم إرسال تحديث الساعة للجهاز واستلمه بنجاح؛ بانتظار أول بصمة Live للتحقق من الوقت الفعلي.')}
 else if(clockBad){const clockSeverity=Math.abs(clockSec)>15*60?3:2;severity=Math.max(severity,clockSeverity);if(connection!=='offline'){label=clockSeverity>=3?'خلل في الساعة':'يحتاج ضبط الساعة';tone=clockSeverity>=3?'red':'orange'}score-=clockSeverity>=3?35:20;issues.push('ساعة الجهاز '+clockDriftText(clockSec)+' مقارنة بوقت السيرفر.')}
 if(!lastLog){severity=Math.max(severity,1);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=15;issues.push('لم يستقبل النظام أي حركة حضور من هذا الجهاز حتى الآن.')}
 else if(logAge!=null&&logAge>72*3600){severity=Math.max(severity,1);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=10;issues.push('لا توجد حركة حضور جديدة منذ أكثر من 72 ساعة.')}
 score=Math.max(0,Math.min(100,score));
 const compat=profile.preferred_mode==='push_replay'?'push_replay':profile.preferred_mode==='data_query'?'data_query':'auto';
 let recommended_action=null,recommended_label=null;
 if(device?.status==='active'&&connection!=='offline'){
  if(clockBad){recommended_action='clock';recommended_label='فحص / مزامنة الساعة'}
  else if(Number(unlinkedCount)>0){recommended_action='links';recommended_label='مراجعة الربط'}
  else if(latestCommand?.status==='failed'&&latestCommandAge!=null&&latestCommandAge<=3600){recommended_action='diagnose';recommended_label='إعادة التشخيص'}
  else if(!lastLog||(logAge!=null&&logAge>72*3600)){recommended_action='history';recommended_label=compat==='push_replay'?'إعادة إرسال الحركات':'استيراد الحركات القديمة'}
  else if(severity>0){recommended_action='diagnose';recommended_label='تشخيص الجهاز'}
 }
 return {device_id:device?.id||null,severity,tone,label,score,connection,connection_age_seconds:seenAge,last_seen_at:seen,last_log_at:lastLog,last_received_at:lastReceived,unlinked_count:Number(unlinkedCount)||0,unlinked_truncated:!!unlinkedTruncated,pending_commands:pending,stuck_commands:stuck,last_command_type:latestCommand?.command_type||null,last_command_status:latestCommand?.status||null,last_command_at:latestCommand?.completed_at||latestCommand?.updated_at||latestCommand?.created_at||null,last_command_code:latestCommand?.result_code??null,compatibility_mode:compat,compatibility_strategy:profile.preferred_strategy||null,clock_drift_seconds:clockConfirmed?clockSec:null,clock_drift_minutes:clockConfirmed?Math.round(clockSec/60*10)/10:null,clock_status:clockVerificationPending?'verifying':clockConfirmed?(clockBad?(Math.abs(clockSec)>15*60?'critical':'warning'):'ok'):'unknown',clock_confirmed:clockConfirmed,clock_verification_pending:clockVerificationPending,clock_checked_at:clock.checked_at||null,recommended_action,recommended_label,issues};
}
async function updateDeviceInfoFromInfoCommand(env,cmd,raw,rc){
 if(!cmd?.device_id||!['sync_info','diagnostic_info'].includes(cmd.command_type))return;
 const rows=await rest(env,'attendance_devices?id=eq.'+enc(cmd.device_id)+'&select=*&limit=1').catch(()=>[]),device=rows?.[0]||null;
 if(!device)return;
 const now=new Date().toISOString(),meta={...(device.metadata||{})},info=rc===0?parseDeviceInfo(raw):{};
 const diag={...(meta.last_diagnostic||{}),checked_at:now,status:rc===0?'success':'failed',result_code:rc,command_id:cmd.id};
 if(rc===0){diag.platform=txt(info.platform)||meta.platform||null;diag.ip_address=txt(info.ipaddress)||meta.ip_address||null;diag.mac=txt(info.mac)||meta.mac||null;diag.main_time=txt(info.maintime)||null;diag.free_flash_size=safeInt(info.freeflashsize);diag.flash_size=safeInt(info.flashsize);diag.transaction_count=safeInt(info.transactioncount);diag.user_count=safeInt(info.usercount)}
 const patch={updated_at:now,metadata:{...meta,last_diagnostic:diag}};
 if(rc===0){
  const fw=txt(info.fwversion||info.firmware),pv=txt(info.pushversion),dn=txt(info.devicename),platform=txt(info.platform),ip=txt(info.ipaddress),mac=txt(info.mac);
  if(fw)patch.firmware=fw;if(pv)patch.push_version=pv;if(dn)patch.device_name=dn;
  const uc=safeInt(info.usercount),fc=safeInt(info.fpcount),face=safeInt(info.facecount),tc=safeInt(info.transactioncount);
  if(uc!=null)patch.reported_user_count=uc;if(fc!=null)patch.reported_fp_count=fc;if(face!=null)patch.reported_face_count=face;if(tc!=null)patch.reported_transaction_count=tc;
  patch.metadata={...patch.metadata,platform:platform||meta.platform||null,ip_address:ip||meta.ip_address||null,mac:mac||meta.mac||null};
 }
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{});
}

async function upsertDeviceUsers(env,device,serial,userRows,sourceTable){
 if(!userRows?.length)return 0;
 const now=new Date().toISOString(),rows=userRows.map(u=>({device_id:device.id,serial_number:serial,device_pin:u.pin,name:u.name||null,privilege:u.privilege,card_number:u.card||null,group_no:u.group||null,timezone_raw:u.timezone||null,verify_mode:u.verify,data_environment:device.data_environment||'training',source_table:sourceTable||null,last_seen_at:now,metadata:{protocol:'zkteco_adms'}}));
 await rest(env,'attendance_device_users?on_conflict=device_id%2Cdevice_pin',{method:'POST',body:rows,prefer:'resolution=merge-duplicates,return=minimal'});
 return rows.length;
}
async function popDeviceCommands(env,device){
 const queued=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&status=eq.queued&select=id,command_text,command_type&order=id.asc&limit=3').catch(()=>[]);
 if(!queued?.length)return [];
 const now=new Date().toISOString();
 for(const cmd of queued){
  await rest(env,'attendance_device_commands?id=eq.'+enc(cmd.id),{method:'PATCH',body:{status:'sent',sent_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  if(cmd.command_type==='biometric_enroll'){
   await rest(env,'attendance_biometric_enrollment_requests?command_id=eq.'+enc(cmd.id)+'&status=eq.queued',{method:'PATCH',body:{status:'sent',started_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  }
 }
 return queued;
}
async function finalizeEmployeeDeleteGroup(env,groupId){
 if(!groupId)return;
 const req=(await rest(env,'attendance_employee_delete_requests?command_group_id=eq.'+enc(groupId)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(!req||req.status!=='pending')return;
 const commands=await rest(env,'attendance_device_commands?operation_group_id=eq.'+enc(groupId)+'&command_type=eq.delete_employee_user&select=id,device_id,status,result_code,metadata,entity_id&order=id.asc').catch(()=>[]);
 if(!commands?.length)return;
 if(commands.some(c=>c.status==='queued'||c.status==='sent'))return;
 const success=commands.filter(c=>c.status==='success'),failed=commands.filter(c=>c.status!=='success'),now=new Date().toISOString();
 for(const cmd of success){
  const pin=txt(cmd?.metadata?.pin);if(!pin)continue;
  await rest(env,'attendance_device_users?device_id=eq.'+enc(cmd.device_id)+'&device_pin=eq.'+enc(pin),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
 }
 if(failed.length){
  await rest(env,'attendance_employee_delete_requests?id=eq.'+enc(req.id),{method:'PATCH',body:{status:'failed',success_count:success.length,failed_count:failed.length,result_summary:{failed:failed.map(c=>({command_id:c.id,device_id:c.device_id,pin:txt(c?.metadata?.pin),result_code:c.result_code}))},completed_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  return;
 }
 const employeeId=txt(req.attendance_employee_id||commands[0]?.entity_id);
 if(employeeId){
  await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employeeId),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_employees?id=eq.'+enc(employeeId),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
 }
 await rest(env,'attendance_employee_delete_requests?id=eq.'+enc(req.id),{method:'PATCH',body:{status:'success',success_count:success.length,failed_count:0,result_summary:{deleted_from_devices:success.length},completed_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
}
async function queueAttendanceReplay(env,device,createdBy,sourceCommandId){
 if(!device?.id)return false;
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.history_attlog_replay&status=in.(queued,sent)&select=id&limit=1').catch(()=>[]);
 if(pending?.length)return false;
 const now=new Date().toISOString(),oldProfile=device?.metadata?.history_profile&&typeof device.metadata.history_profile==='object'?device.metadata.history_profile:{},deviceMeta={...(device.metadata||{}),force_attlog_replay:true,history_replay_requested_at:now,history_replay_source_command_id:sourceCommandId||null,history_profile:{...oldProfile,preferred_mode:'push_replay',supports_data_query:false,last_probe_code:-3,last_probe_at:now,updated_at:now}};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:deviceMeta,updated_at:now},prefer:'return=minimal'});
 device.metadata=deviceMeta;
 await rest(env,'attendance_device_commands',{method:'POST',body:{device_id:device.id,command_type:'history_attlog_replay',command_text:'CHECK',metadata:{history_strategy:'stamp_zero_check',source_command_id:sourceCommandId||null},created_by:createdBy||null},prefer:'return=minimal'});
 return true;
}
async function queueHistoricalFallback(env,cmd,rc){
 if(!cmd||cmd.command_type!=='history_attlog'||rc!==-3)return false;
 const strategy=txt(cmd?.metadata?.history_strategy)||'range_space';
 if(strategy==='plain'){
  const rows=await rest(env,'attendance_devices?id=eq.'+enc(cmd.device_id)+'&select=*&limit=1').catch(()=>[]);
  return await queueAttendanceReplay(env,rows?.[0]||null,cmd.created_by||null,cmd.id);
 }
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(cmd.device_id)+'&command_type=eq.history_attlog&status=in.(queued,sent)&select=id,metadata&order=id.desc&limit=20').catch(()=>[]);
 let nextStrategy,command;
 if(strategy==='range_space'){
  if((pending||[]).some(x=>txt(x?.metadata?.history_strategy)==='range_iso'))return false;
  const start=txt(cmd?.metadata?.requested_start)||'2000-01-01 00:00:00',end=txt(cmd?.metadata?.requested_end)||deviceLocalNow();
  nextStrategy='range_iso';
  command=historyQueryCommand('range_iso',start,end);
 }else{
  if((pending||[]).some(x=>txt(x?.metadata?.history_strategy)==='plain'))return false;
  nextStrategy='plain';
  command='DATA QUERY ATTLOG';
 }
 const metadata={...(cmd.metadata||{}),history_strategy:nextStrategy,fallback_from_command_id:cmd.id,fallback_reason:'device_return_-3'};
 await rest(env,'attendance_device_commands',{method:'POST',body:{device_id:cmd.device_id,command_type:'history_attlog',command_text:command,metadata,created_by:cmd.created_by||null},prefer:'return=minimal'});
 return true;
}
async function completeDeviceCommand(env,body){
 const raw=String(body||''),lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),groups=new Set();
 for(const line of lines){
  const params=new URLSearchParams(line),id=txt(params.get('ID')||params.get('id')),rc=safeInt(params.get('Return')||params.get('return'));
  if(!id)continue;
  const now=new Date().toISOString();
  const rows=await rest(env,'attendance_device_commands?id=eq.'+enc(id),{method:'PATCH',body:{status:rc===0?'success':'failed',result_code:rc,result_body:line.slice(0,2000),completed_at:now,updated_at:now},prefer:'return=representation'}).catch(()=>[]);
  const cmd=rows?.[0];
  if(cmd&&rc!==0)await recordDeviceHealthEvent(env,{event_key:'command_failed:'+cmd.id,device_id:cmd.device_id,branch_id:null,event_type:'command_failed',severity:['history_attlog','history_attlog_replay','sync_attlog','sync_users','diagnostic_info','clock_sync'].includes(cmd.command_type)?'warning':'info',started_at:now,ended_at:now,duration_seconds:0,command_id:cmd.id,result_code:rc,summary:'فشل أمر '+cmd.command_type+(rc!=null?' (Code '+rc+')':''),metadata:{command_type:cmd.command_type,history_strategy:cmd?.metadata?.history_strategy||null}});
  if(cmd&&['sync_info','diagnostic_info'].includes(cmd.command_type))await updateDeviceInfoFromInfoCommand(env,cmd,raw,rc).catch(()=>{});
  if(cmd?.command_type==='clock_sync')await updateClockSyncResult(env,cmd,rc,line).catch(()=>{});
  if(cmd?.command_type==='history_attlog'&&rc===0){
   const devices=await rest(env,'attendance_devices?id=eq.'+enc(cmd.device_id)+'&select=*&limit=1').catch(()=>[]);
   const device=devices?.[0]||null,strategy=txt(cmd?.metadata?.history_strategy)||'range_space';
   if(device)await saveHistoryProfile(env,device,{preferred_mode:'data_query',supports_data_query:true,preferred_strategy:strategy,last_success_at:now,last_result_code:0});
  }
  if(cmd?.command_type==='history_attlog'&&rc===-3)await queueHistoricalFallback(env,cmd,rc).catch(()=>false);
  if(cmd?.command_type==='biometric_enroll')await finalizeBiometricEnrollment(env,cmd,rc,now).catch(()=>{});
  if(cmd?.command_type==='biometric_delete')await finalizeBiometricDelete(env,cmd,rc,now).catch(()=>{});
  if(cmd?.command_type==='delete_employee_user'&&cmd.operation_group_id)groups.add(String(cmd.operation_group_id));
 }
 for(const groupId of groups)await finalizeEmployeeDeleteGroup(env,groupId);
}
async function markSyncComplete(env,device,commandType,resultBody){
 const rows=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.'+enc(commandType)+'&status=in.(queued,sent)&select=id,metadata,created_by&order=id.desc&limit=1').catch(()=>[]);
 const row=rows?.[0]||null,id=row?.id;if(!id)return null;
 const now=new Date().toISOString();
 await rest(env,'attendance_device_commands?id=eq.'+enc(id),{method:'PATCH',body:{status:'success',result_code:0,result_body:String(resultBody||'').slice(0,2000),completed_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 return row;
}
async function storeProbePayload(env,device,serial,url,body){
 const table=txt(url.searchParams.get('table')).toUpperCase();
 const allowed=new Set(['SHIFT','SCHEDULE','ATTENDRULE','USER_OF_RUN','NUM_RUN','SCHCLASS','SHIFTINFO','ATTSHIFT']);
 if(!allowed.has(table))return false;
 const params={};for(const [k,v] of url.searchParams.entries())params[k]=String(v).slice(0,300);
 const payload=String(body||'').slice(0,20000);
 await rest(env,'attendance_device_probe_payloads',{method:'POST',body:{device_id:device.id,serial_number:serial,table_name:table,query_params:params,payload,payload_bytes:new TextEncoder().encode(payload).length},prefer:'return=minimal'}).catch(()=>{});
 return true;
}
async function storeAttendanceLogs(env,device,serial,request,body){
 const links=await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=device_pin,attendance_employee_id,staff_user_id,branch_id,display_name').catch(()=>[]);
 const linkMap=new Map((links||[]).map(x=>[txt(x.device_pin),x])),rows=[];
 for(const raw of String(body||'').split(/\r?\n/)){
   const line=raw.trim();if(!line)continue;const f=line.split('\t'),pin=txt(f[0]),rawTime=txt(f[1]),occurred=parseSaudiDeviceTime(rawTime);if(!pin||!occurred)continue;
   const statusCode=safeInt(f[2]),verifyCode=safeInt(f[3]),workCode=txt(f[4]),link=linkMap.get(pin)||null,branchId=link?.branch_id||device.branch_id||null;
   rows.push({device_id:device.id,serial_number:serial,branch_id:branchId,device_pin:pin,attendance_employee_id:link?.attendance_employee_id||null,staff_user_id:link?.staff_user_id||null,employee_name:txt(link?.display_name)||null,occurred_at:occurred,device_time_raw:rawTime,status_code:statusCode,verify_code:verifyCode,work_code:workCode||null,source_ip:clientIp(request)||null,raw_line:line.slice(0,700),data_environment:device.data_environment||'training',dedupe_key:dedupe(device.id,pin,rawTime,statusCode,verifyCode,workCode),metadata:{protocol:'zkteco_adms',table:'ATTLOG'}});
 }
 if(rows.length)await rest(env,'attendance_raw_logs?on_conflict=dedupe_key',{method:'POST',body:rows,prefer:'resolution=ignore-duplicates,return=minimal'});
 return rows.length;
}
async function admsRequest(request,env){
 if(!base(env)||!serviceKey(env))return plain('ERROR: SERVER_CONFIG',503);
 const url=new URL(request.url),serial=serialFrom(url);
 if(url.pathname==='/iclock/health')return plain('OK');
 if(!serial)return plain('ERROR: SN_REQUIRED',200);
 const device=await getDevice(env,serial).catch(()=>null);
 if(!device||device.status!=='active')return plain('ERROR: DEVICE_NOT_REGISTERED',200);

 if(request.method==='GET'&&url.pathname==='/iclock/rtdata'&&lower(url.searchParams.get('type'))==='time'){
   await touchDevice(env,device,request,url).catch(()=>{});
   return await serveDeviceClock(env,device,request,url);
 }
 if(request.method==='GET'&&url.pathname==='/iclock/cdata'){
   await touchDevice(env,device,request,url).catch(()=>{});
   return plain(handshake(serial,device));
 }
 if(request.method==='GET'&&url.pathname==='/iclock/getrequest'){
   await touchDevice(env,device,request,url).catch(()=>{});
   const commands=await popDeviceCommands(env,device);
   if(!commands.length)return plain('OK');
   return plain(commands.map(c=>'C:'+c.id+':'+c.command_text).join('\r\n')+'\r\n');
 }
 if((request.method==='GET'||request.method==='POST')&&url.pathname==='/iclock/registry'){
   const body=request.method==='POST'?await request.text():'',info=parseDeviceInfo(body);
   await touchDevice(env,device,request,url,info).catch(()=>{});
   return plain(request.method==='GET'?handshake(serial,device):'OK');
 }
 if(request.method==='POST'&&url.pathname==='/iclock/devicecmd'){
   const body=await request.text();
   await touchDevice(env,device,request,url).catch(()=>{});
   await completeDeviceCommand(env,body);
   return plain('OK');
 }
 if(request.method==='POST'&&url.pathname==='/iclock/querydata'){
   const body=await request.text();
   await touchDevice(env,device,request,url).catch(()=>{});
   if(await handleClockOptionsPayload(env,device,url,body))return plain('OK');
   return plain('OK');
 }
 if(request.method==='POST'&&url.pathname==='/iclock/cdata'){
   const body=await request.text(),table=txt(url.searchParams.get('table')).toUpperCase(),info=parseDeviceInfo(body);
   await touchDevice(env,device,request,url,info).catch(()=>{});
   if(table==='ATTLOG'){
    const clockSample=await recordDeviceClockSample(env,device,serial,body,'attlog_live').catch(()=>null);
    const n=await storeAttendanceLogs(env,device,serial,request,body);
    const liveDrift=Number(clockSample?.drift_seconds);
    if(n&&clockSample?.confirmed===true&&Number.isFinite(liveDrift)&&Math.abs(liveDrift)>120)await normalizeClockDriftedLogs(env,device,liveDrift,2).catch(()=>null);
    if(n){
     await markSyncComplete(env,device,'sync_attlog','ATTLOG received: '+n+' records in this batch');
     await markSyncComplete(env,device,'history_attlog','Historical ATTLOG received: '+n+' records in this batch');
     await markSyncComplete(env,device,'history_attlog_replay','Historical ATTLOG replay received: '+n+' records in this batch');
     if(device?.metadata?.force_attlog_replay){
      const now=new Date().toISOString(),oldProfile=device?.metadata?.history_profile&&typeof device.metadata.history_profile==='object'?device.metadata.history_profile:{},meta={...(device.metadata||{}),force_attlog_replay:false,history_replay_completed_at:now,history_replay_last_batch:n,history_profile:{...oldProfile,preferred_mode:'push_replay',supports_data_query:false,last_success_at:now,last_received_batch:n,updated_at:now}};
      await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
      device.metadata=meta;
     }
    }
    return plain('OK');
   }
   if(table==='USERINFO'||table==='OPERLOG'){
     if(table==='OPERLOG')await storeBiometricDiscovery(env,device,serial,body,table).catch(()=>({records:0}));
     const users=parseUserLines(body),n=await upsertDeviceUsers(env,device,serial,users,table);
     if(n){
      const syncCmd=await markSyncComplete(env,device,'sync_users','USERINFO received: '+n+' users');
      await markSyncComplete(env,device,'verify_user','USERINFO verified: '+n+' users');
      if(syncCmd?.metadata?.biometric_inventory_after_users===true)await queueLegacyInventoryAfterUsers(env,device,syncCmd.metadata,syncCmd.created_by).catch(()=>({queued:0}));
     }
     return plain('OK')
   }
   if(table==='FINGERTMP'||table==='BIODATA'||table==='FP'||table==='FACE'){
     await storeBiometricDiscovery(env,device,serial,body,table).catch(()=>({records:0}));
     return plain('OK');
   }
   if(await storeProbePayload(env,device,serial,url,body))return plain('OK');
   const users=parseUserLines(body);
   if(users.length){const n=await upsertDeviceUsers(env,device,serial,users,table||'UNKNOWN');if(n){await markSyncComplete(env,device,'sync_users','USERINFO received: '+n+' users');await markSyncComplete(env,device,'verify_user','USERINFO verified: '+n+' users')}return plain('OK')}
   return plain('OK');
 }
 return plain('OK');
}

async function audit(env,me,action,entityType,entityId,branchId,beforeData,afterData,reason){try{await rest(env,'audit_events',{method:'POST',body:{actor_id:actorId(me)||null,actor_name:actorName(me)||null,actor_role:txt(me?.role)||null,action,entity_type:entityType,entity_id:txt(entityId)||null,branch_id:branchId||null,before_data:beforeData||null,after_data:afterData||null,reason:txt(reason)||null},prefer:'return=minimal'});return true}catch{return false}}
function actorBranch(me){return txt(me?.branch_id||me?.home_branch_id)}
function requestedBranch(me,body,url){if(!elevated(me))return actorBranch(me);return txt(body?.branch_id||url?.searchParams?.get('branch_id'))}
async function scopedDevice(env,me,id){const rows=await rest(env,'attendance_devices?id=eq.'+enc(id)+'&select=*&limit=1'),row=rows?.[0]||null;if(!row)return null;if(!elevated(me)&&txt(row.branch_id)!==actorBranch(me))return null;return row}
async function scopedEmployee(env,me,id){const rows=await rest(env,'attendance_employees?id=eq.'+enc(id)+'&select=*&limit=1'),row=rows?.[0]||null;if(!row)return null;if(!elevated(me)&&txt(row.branch_id)!==actorBranch(me))return null;return row}
async function runtimeMode(env){try{const rows=await rest(env,'system_runtime_state?id=eq.main&select=runtime_mode&limit=1');return txt(rows?.[0]?.runtime_mode)||'training'}catch{return 'training'}}
function dateStart(value){const v=txt(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const d=new Date(v+'T00:00:00+03:00');return Number.isNaN(d.getTime())?null:d}
function dateEndExclusive(value){const d=dateStart(value);if(!d)return null;d.setUTCDate(d.getUTCDate()+1);return d}
function cleanTime(v){const s=txt(v);return /^\d{2}:\d{2}(:\d{2})?$/.test(s)?s.slice(0,5):null}
function cleanOffDays(v){if(!Array.isArray(v))return [];return [...new Set(v.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))].sort()}
function cleanWeekdays(v){const days=cleanOffDays(v);return days.length?days:[0,1,2,3,4,5,6]}
function cleanShiftPeriods(v){
 if(!Array.isArray(v))return [];
 const rows=[];
 for(let i=0;i<v.length;i++){
  const p=v[i]||{},start=cleanTime(p.start_time),end=cleanTime(p.end_time);
  if(!start||!end)continue;
  const templateId=txt(p.device_shift_template_id);
  rows.push({
   sequence_no:i+1,
   label:txt(p.label)||('الفترة '+String(i+1)),
   start_time:start,
   end_time:end,
   grace_minutes:Math.max(0,Math.min(240,Number(p.grace_minutes??10))),
   device_shift_template_id:templateId||null,
   source_type:templateId?'device_template':'custom',
   weekdays:cleanWeekdays(p.weekdays)
  });
 }
 return rows.slice(0,12);
}
function scheduleSignature(periods,offDays){
 const clean=(periods||[]).map((p,i)=>({
  sequence_no:Number(p.sequence_no||i+1),label:txt(p.label),start_time:cleanTime(p.start_time),end_time:cleanTime(p.end_time),
  grace_minutes:Math.max(0,Math.min(240,Number(p.grace_minutes??10))),device_shift_template_id:txt(p.device_shift_template_id)||null,
  weekdays:cleanWeekdays(p.weekdays)
 })).sort((a,b)=>a.sequence_no-b.sequence_no);
 return JSON.stringify({periods:clean,weekly_off_days:cleanOffDays(offDays)});
}
function safeDeviceText(v,max=40){return txt(v).replace(/[\t\r\n]/g,' ').replace(/[=]/g,'-').slice(0,max)}
async function replaceShiftPeriods(env,me,employeeId,periods){
 await rest(env,'attendance_employee_shift_periods?attendance_employee_id=eq.'+enc(employeeId),{method:'DELETE',prefer:'return=minimal'});
 if(!periods.length)return [];
 const now=new Date().toISOString(),rows=periods.map(p=>({attendance_employee_id:employeeId,sequence_no:p.sequence_no,label:p.label,start_time:p.start_time,end_time:p.end_time,grace_minutes:p.grace_minutes,device_shift_template_id:p.device_shift_template_id||null,source_type:p.device_shift_template_id?'device_template':'custom',weekdays:cleanWeekdays(p.weekdays),active:true,created_by:actorId(me)||actorName(me)||null,updated_by:actorId(me)||actorName(me)||null,created_at:now,updated_at:now}));
 return await rest(env,'attendance_employee_shift_periods',{method:'POST',body:rows,prefer:'return=representation'});
}
function deviceLocalNow(){try{return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace('T',' ')}catch{return new Date().toISOString().slice(0,19).replace('T',' ')}}
async function queueDeviceSync(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لسحب بيانات جهاز البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const existing=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&status=in.(queued,sent)&select=id,command_type,status,metadata&limit=100').catch(()=>[]);
 if(existing?.some(x=>x.command_type==='sync_users'||x.command_type==='sync_attlog'||x?.metadata?.smart_sync===true))return {ok:true,queued:false,message:'يوجد Smart Sync قيد التنفيذ بالفعل على هذا الجهاز.'};
 const now=deviceLocalNow(),requestedAt=new Date().toISOString(),batch='smart-sync-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),allowBiometrics=canManageBiometrics(me),modern=protocolAtLeast(device.push_version,2,2,14);
 const baseMeta={smart_sync:true,smart_sync_batch:batch,requested_at:requestedAt};
 const candidates=allowBiometrics?await biometricImportCandidates(env,device,null):[];
 const linkedPinCount=candidates.filter(x=>x.attendance_employee_id).length,knownPinCount=candidates.length,biometricStrategy=allowBiometrics?(modern?'biodata':'legacy_fingertmp'):null;
 const commands=[
  {type:'sync_info',command:'INFO',metadata:{...baseMeta,stage:'device_info'}},
  {type:'sync_users',command:'DATA QUERY USERINFO',metadata:{...baseMeta,stage:'users',biometric_inventory_after_users:allowBiometrics&&!modern}},
  {type:'sync_attlog',command:'DATA QUERY ATTLOG StartTime=2000-01-01 00:00:00\tEndTime='+now,metadata:{...baseMeta,stage:'attendance'}}
 ];
 let biometricCommandCount=0;
 if(allowBiometrics){
  if(modern){
   commands.push(
    {type:'biometric_import_fingerprint',command:'DATA QUERY BIODATA Type=1',metadata:{...baseMeta,stage:'biometrics',biometric_type:'finger',strategy:'biodata_all'}},
    {type:'biometric_import_face',command:'DATA QUERY BIODATA Type=2',metadata:{...baseMeta,stage:'biometrics',biometric_type:'face',strategy:'biodata_all'}},
    {type:'biometric_import_face',command:'DATA QUERY BIODATA Type=9',metadata:{...baseMeta,stage:'biometrics',biometric_type:'visible_face',strategy:'biodata_all'}}
   );
   biometricCommandCount=3;
  }else{
   for(const row of candidates){
    const pin=safeDeviceText(row.device_pin,24);
    commands.push({type:'biometric_import_fingerprint',command:'DATA QUERY FINGERTMP PIN='+pin,entity_type:row.attendance_employee_id?'attendance_employee':'attendance_device_pin',entity_id:row.attendance_employee_id||pin,metadata:{...baseMeta,stage:'biometrics',pin,attendance_employee_id:row.attendance_employee_id||null,biometric_type:'finger',strategy:'legacy_fingertmp',inventory_only:!row.attendance_employee_id}});
   }
   biometricCommandCount=candidates.length;
  }
 }
 const created=await queueCommands(env,device,me,commands);
 const meta={...(device.metadata||{}),last_smart_sync:{batch,requested_at:requestedAt,requested_by:actorId(me)||actorName(me)||null,total_commands:commands.length,biometric_commands:biometricCommandCount,linked_pins:linkedPinCount,known_pins_before_sync:knownPinCount,biometric_strategy:biometricStrategy,biometrics_included:allowBiometrics,inventory_after_users:allowBiometrics&&!modern,raw_biometric_templates_stored:false}};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:requestedAt},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,'attendance_device_smart_sync_requested','attendance_device',device.id,device.branch_id,null,{batch,commands:commands.map(x=>x.type),total_commands:commands.length,biometrics_included:allowBiometrics,biometric_commands:biometricCommandCount,linked_pins:linkedPinCount,known_pins_before_sync:knownPinCount,biometric_strategy:biometricStrategy,inventory_after_users:allowBiometrics&&!modern},'Smart Sync: معلومات الجهاز والموظفين والحركات وجرد البصمات');
 return {ok:true,queued:true,batch,commands:created?.map(x=>({id:x.id,type:x.command_type,status:x.status}))||[],biometrics_included:allowBiometrics,biometric_commands:biometricCommandCount,linked_pins:linkedPinCount,known_pins:knownPinCount,message:allowBiometrics?'بدأ Smart Sync: الجهاز + الموظفون + الحركات + جرد البصمات.':'بدأ Smart Sync للجهاز والموظفين والحركات. البصمات لم تُدرج لأن المستخدم لا يملك صلاحية إدارتها.'};
}
async function diagnoseDevice(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لتشخيص أجهزة البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const [latestLogs,commands,unlinkedRows,pending]=await Promise.all([
  rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&select=occurred_at,received_at&order=occurred_at.desc&limit=1').catch(()=>[]),
  rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&select=id,command_type,status,result_code,created_at,updated_at,completed_at&order=id.desc&limit=20').catch(()=>[]),
  rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&attendance_employee_id=is.null&staff_user_id=is.null&employee_name=is.null&select=id&limit=5001').catch(()=>[]),
  rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.diagnostic_info&status=in.(queued,sent)&select=id&limit=1').catch(()=>[])
 ]);
 const unlinkedCount=Math.min((unlinkedRows||[]).length,5000),unlinkedTruncated=(unlinkedRows||[]).length>5000;
 const before=deviceHealthSnapshot(device,latestLogs?.[0]||null,commands||[],unlinkedCount,unlinkedTruncated);
 let queued=false,created=[];
 if(!pending?.length){
  created=await queueCommands(env,device,me,[{type:'diagnostic_info',command:'INFO',metadata:{diagnostic:true,requested_at:new Date().toISOString()}}]);
  queued=true;
 }
 await audit(env,me,'attendance_device_diagnostic_requested','attendance_device',device.id,device.branch_id,null,{queued,health:before},'تشخيص صحة جهاز البصمة');
 return {ok:true,queued,health:before,command_id:created?.[0]?.id||pending?.[0]?.id||null,message:queued?'تم بدء تشخيص الجهاز واختبار اتصال INFO. ستتحدث النتيجة تلقائيًا.':'يوجد تشخيص للجهاز قيد التنفيذ بالفعل.'};
}

async function diagnoseAllDevices(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لتشخيص أجهزة البصمة.'),{status:403});
 const branchId=requestedBranch(me,body),filter=branchId?'&branch_id=eq.'+enc(branchId):'';
 const devices=await rest(env,'attendance_devices?status=eq.active&select=*'+filter+'&order=created_at.asc').catch(()=>[]);
 let queued=0,skipped=0;
 for(const device of devices||[]){
  const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.diagnostic_info&status=in.(queued,sent)&select=id&limit=1').catch(()=>[]);
  if(pending?.length){skipped+=1;continue}
  await queueCommands(env,device,me,[{type:'diagnostic_info',command:'INFO',metadata:{diagnostic:true,bulk:true,requested_at:new Date().toISOString()}}]);
  queued+=1;
 }
 await audit(env,me,'attendance_devices_diagnostic_requested','attendance_device',null,branchId||null,null,{queued,skipped,total:(devices||[]).length},'تشخيص شامل لأجهزة البصمة');
 return {ok:true,queued,skipped,total:(devices||[]).length,message:queued?'تم بدء التشخيص الشامل لـ '+queued+' جهاز/أجهزة. ستتحدث النتائج تلقائيًا.':'لا توجد أجهزة جديدة تحتاج بدء تشخيص الآن.'};
}

function userUpdateCommand(pin,data){
 const p=safeDeviceText(pin,24),name=safeDeviceText(data?.name,40),pri=Math.max(0,Math.min(14,safeInt(data?.privilege)??0)),card=safeDeviceText(data?.card_number,32),grp=safeDeviceText(data?.group_no||'1',8),tz=safeDeviceText(data?.timezone_raw||'0000000100000000',32),verify=Math.max(0,Math.min(15,safeInt(data?.verify_mode)??0));
 if(!p)throw Object.assign(new Error('PIN الموظف داخل الجهاز مطلوب.'),{status:400});
 return 'DATA UPDATE USERINFO PIN='+p+'\tName='+name+'\tPri='+pri+'\tPasswd=\tCard='+card+'\tGrp='+grp+'\tTZ='+tz+'\tVerify='+verify+'\tViceCard=';
}
async function queueCommands(env,device,me,commands){
 const rows=commands.map(c=>({
  device_id:device.id,
  command_type:c.type,
  command_text:c.command,
  operation_group_id:c.operation_group_id||null,
  entity_type:c.entity_type||null,
  entity_id:c.entity_id||null,
  metadata:c.metadata||{},
  created_by:actorId(me)||actorName(me)||null
 }));
 return await rest(env,'attendance_device_commands',{method:'POST',body:rows,prefer:'return=representation'});
}
async function pushDeviceUser(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لرفع بيانات الموظفين إلى الجهاز.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const pin=safeDeviceText(body.device_pin,24);if(!pin)throw Object.assign(new Error('PIN الموظف مطلوب.'),{status:400});
 const command=userUpdateCommand(pin,body);
 const created=await queueCommands(env,device,me,[{type:'push_user',command},{type:'verify_user',command:'DATA QUERY USERINFO PIN='+pin}]);
 await audit(env,me,'attendance_device_user_push','attendance_device_user',pin,device.branch_id,null,{device_id:device.id,pin,name:safeDeviceText(body.name,40)},'تعديل ورفع بيانات موظف إلى جهاز البصمة');
 return {ok:true,queued:true,commands:created?.map(x=>({id:x.id,type:x.command_type,status:x.status}))||[]};
}
async function pushEmployeeToDevices(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لرفع بيانات الموظفين إلى الأجهزة.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 let path='attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id)+'&active=eq.true&select=*';
 if(txt(body.device_id))path+='&device_id=eq.'+enc(body.device_id);
 const links=await rest(env,path);if(!links?.length)throw Object.assign(new Error('الموظف غير مربوط بأي جهاز بصمة.'),{status:400});
 const queued=[];
 for(const link of links){
  const device=await scopedDevice(env,me,link.device_id);if(!device)continue;
  const snap=(await rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(link.device_pin)+'&select=*&limit=1').catch(()=>[]))?.[0]||{};
  const command=userUpdateCommand(link.device_pin,{...snap,name:employee.name});
  const rows=await queueCommands(env,device,me,[{type:'push_user',command},{type:'verify_user',command:'DATA QUERY USERINFO PIN='+safeDeviceText(link.device_pin,24)}]);
  queued.push(...(rows||[]));
 }
 if(!queued.length)throw Object.assign(new Error('لم يتم العثور على جهاز متاح لرفع الموظف.'),{status:400});
 await audit(env,me,'attendance_employee_push_to_devices','attendance_employee',employee.id,employee.branch_id,null,{devices:links.map(x=>x.device_id)},'رفع بيانات موظف الحضور إلى أجهزة البصمة');
 return {ok:true,queued:true,count:queued.length};
}
async function versionEmployeesAfterShiftTemplateChange(env,me,templateId,effectiveFrom,reason){
 const linked=await rest(env,'attendance_employee_shift_periods?device_shift_template_id=eq.'+enc(templateId)+'&select=attendance_employee_id&limit=2000').catch(()=>[]),ids=[...new Set((linked||[]).map(x=>txt(x.attendance_employee_id)).filter(Boolean))],updated=[];
 for(const employeeId of ids){
  const employee=(await rest(env,'attendance_employees?id=eq.'+enc(employeeId)+'&select=id,branch_id,weekly_off_days,data_environment,name,status&limit=1').catch(()=>[]))?.[0]||null;if(!employee)continue;
  const mode=employee.data_environment==='production'?'production':'training';
  await assertAttendanceMonthOpen(env,employee.branch_id,effectiveFrom,effectiveFrom,mode);
  const periodRows=await rest(env,'attendance_employee_shift_periods?attendance_employee_id=eq.'+enc(employee.id)+'&active=eq.true&select=*&order=sequence_no.asc').catch(()=>[]),periods=cleanShiftPeriods(periodRows);
  await rest(env,'rpc/attendance_set_employee_schedule_version',{method:'POST',body:{
   p_employee_id:employee.id,p_branch_id:employee.branch_id||null,p_effective_from:effectiveFrom,
   p_shift_periods:periods,p_weekly_off_days:cleanOffDays(employee.weekly_off_days),p_environment:mode,
   p_reason:reason||('تعديل فترة جهاز مرتبطة بالموظف ساري من '+effectiveFrom),
   p_actor:actorId(me)||actorName(me)||null
  }});
  updated.push(employee.id);
 }
 return updated;
}
async function saveDeviceShiftTemplate(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة فترات دوام الجهاز.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const id=txt(body.id),name=txt(body.name),start=cleanTime(body.start_time),end=cleanTime(body.end_time),grace=Math.max(0,Math.min(240,Number(body.grace_minutes??10)));
 if(!name||!start||!end)throw Object.assign(new Error('اسم الفترة ووقت البداية والنهاية مطلوبة.'),{status:400});
 let before=null;
 if(id){
  const rows=await rest(env,'attendance_device_shift_templates?id=eq.'+enc(id)+'&device_id=eq.'+enc(device.id)+'&select=*&limit=1');before=rows?.[0]||null;
  if(!before)throw Object.assign(new Error('فترة الجهاز غير موجودة.'),{status:404});
 }
 const payload={device_id:device.id,name,start_time:start,end_time:end,grace_minutes:grace,sequence_no:Math.max(1,Number(body.sequence_no||1)),active:body.active!==false,notes:txt(body.notes)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 const scheduleFieldsChanged=!before||['name','start_time','end_time','grace_minutes','sequence_no','active'].some(k=>String(before?.[k]??'')!==String(payload[k]??'')),effectiveFrom=txt(body.schedule_effective_from)||saudiTodayKey();
 if(scheduleFieldsChanged&&!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))throw Object.assign(new Error('حدد تاريخ سريان صحيح لتعديل فترة الدوام.'),{status:400});
 let after;
 if(id)after=(await rest(env,'attendance_device_shift_templates?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 else after=(await rest(env,'attendance_device_shift_templates',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ فترة الجهاز.'),{status:500});
 await rest(env,'attendance_employee_shift_periods?device_shift_template_id=eq.'+enc(after.id),{method:'PATCH',body:{label:after.name,start_time:after.start_time,end_time:after.end_time,grace_minutes:after.grace_minutes,sequence_no:after.sequence_no,active:after.active,source_type:'device_template',updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()},prefer:'return=minimal'}).catch(()=>{});
 const scheduleEmployees=scheduleFieldsChanged?await versionEmployeesAfterShiftTemplateChange(env,me,after.id,effectiveFrom,txt(body.reason)||('تعديل فترة جهاز «'+after.name+'» ساري من '+effectiveFrom)):[];
 await audit(env,me,id?'attendance_device_shift_update':'attendance_device_shift_create','attendance_device_shift_template',after.id,device.branch_id,before,{...after,schedule_effective_from:scheduleFieldsChanged?effectiveFrom:null,schedule_employees:scheduleEmployees},'إدارة فترات دوام الجهاز');
 return {ok:true,template:after,schedule_effective_from:scheduleFieldsChanged?effectiveFrom:null,schedule_employees:scheduleEmployees};
}
async function deleteDeviceShiftTemplate(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة فترات دوام الجهاز.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const id=txt(body.id),rows=await rest(env,'attendance_device_shift_templates?id=eq.'+enc(id)+'&device_id=eq.'+enc(device.id)+'&select=*&limit=1'),before=rows?.[0]||null;
 if(!before)throw Object.assign(new Error('فترة الجهاز غير موجودة.'),{status:404});
 await rest(env,'attendance_employee_shift_periods?device_shift_template_id=eq.'+enc(id),{method:'PATCH',body:{device_shift_template_id:null,source_type:'custom',updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()},prefer:'return=minimal'}).catch(()=>{});
 await rest(env,'attendance_device_shift_templates?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});
 await audit(env,me,'attendance_device_shift_delete','attendance_device_shift_template',id,device.branch_id,before,null,'حذف فترة دوام من إعدادات الجهاز');
 return {ok:true};
}
async function queueEmployeeAutoPush(env,me,employee){
 const links=await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id)+'&active=eq.true&select=*').catch(()=>[]);
 let devicesQueued=0;
 for(const link of links||[]){
  const device=await scopedDevice(env,me,link.device_id);if(!device)continue;
  const snap=(await rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(link.device_pin)+'&select=*&limit=1').catch(()=>[]))?.[0]||{};
  const command=userUpdateCommand(link.device_pin,{...snap,name:employee.name});
  await queueCommands(env,device,me,[{type:'push_user',command},{type:'verify_user',command:'DATA QUERY USERINFO PIN='+safeDeviceText(link.device_pin,24)}]);
  devicesQueued+=1;
 }
 return devicesQueued;
}

async function deleteAttendanceEmployee(env,me,body){
 if(!canDeleteEmployees(me))throw Object.assign(new Error('لا توجد صلاحية مستقلة لحذف موظفي الحضور.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const pending=(await rest(env,'attendance_employee_delete_requests?attendance_employee_id=eq.'+enc(employee.id)+'&status=eq.pending&select=*&order=created_at.desc&limit=1').catch(()=>[]))?.[0]||null;
 if(pending)return {ok:true,pending:true,request_id:pending.id,message:'يوجد طلب حذف لهذا الموظف قيد التنفيذ بالفعل.'};
 const links=await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id)+'&active=eq.true&select=*').catch(()=>[]);
 if(links.length&&!canManageDevices(me))throw Object.assign(new Error('حذف الموظف من الجهاز يحتاج صلاحية إدارة أجهزة البصمة.'),{status:403});
 const priorSuccess=await rest(env,'attendance_device_commands?entity_type=eq.attendance_employee&entity_id=eq.'+enc(employee.id)+'&command_type=eq.delete_employee_user&status=eq.success&select=device_id,metadata').catch(()=>[]);
 const done=new Set((priorSuccess||[]).map(c=>String(c.device_id)+'|'+txt(c?.metadata?.pin)));
 const remaining=[];
 for(const link of links){
  const key=String(link.device_id)+'|'+txt(link.device_pin);if(done.has(key))continue;
  const device=await scopedDevice(env,me,link.device_id);if(!device)throw Object.assign(new Error('أحد الأجهزة المرتبطة بالموظف غير متاح ضمن صلاحياتك.'),{status:403});
  remaining.push({link,device});
 }
 const groupId=crypto.randomUUID(),now=new Date().toISOString(),requestRows=await rest(env,'attendance_employee_delete_requests',{method:'POST',body:{
  attendance_employee_id:employee.id,
  command_group_id:groupId,
  employee_code:employee.employee_code,
  employee_name:employee.name,
  branch_id:employee.branch_id||null,
  status:'pending',
  device_count:remaining.length,
  employee_snapshot:employee,
  requested_by:actorId(me)||actorName(me)||null,
  reason:txt(body.reason)||'حذف موظف الحضور من النظام والجهاز',
  created_at:now,
  updated_at:now
 },prefer:'return=representation'}),requestRow=requestRows?.[0]||null;
 if(!requestRow)throw Object.assign(new Error('تعذر إنشاء طلب حذف الموظف.'),{status:500});
 await audit(env,me,'attendance_employee_delete_requested','attendance_employee',employee.id,employee.branch_id,employee,{devices:remaining.map(x=>({device_id:x.device.id,pin:x.link.device_pin}))},txt(body.reason)||'حذف موظف الحضور من النظام والجهاز');
 if(!remaining.length){
  for(const link of links||[])await rest(env,'attendance_device_users?device_id=eq.'+enc(link.device_id)+'&device_pin=eq.'+enc(link.device_pin),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_employees?id=eq.'+enc(employee.id),{method:'DELETE',prefer:'return=minimal'});
  await rest(env,'attendance_employee_delete_requests?id=eq.'+enc(requestRow.id),{method:'PATCH',body:{status:'success',success_count:0,failed_count:0,result_summary:{deleted_from_devices:done.size,local_only:links.length===0},completed_at:new Date().toISOString(),updated_at:new Date().toISOString()},prefer:'return=minimal'});
  return {ok:true,pending:false,deleted:true,devices:done.size,message:links.length?'تم حذف الموظف من النظام، وكانت الأجهزة المرتبطة قد أكدت حذفه مسبقًا.':'تم حذف الموظف من النظام. لا توجد أجهزة مرتبطة به.'};
 }
 const commandRows=remaining.map(({link,device})=>({
  device_id:device.id,
  command_type:'delete_employee_user',
  command_text:'DATA DELETE USERINFO PIN='+safeDeviceText(link.device_pin,24),
  operation_group_id:groupId,
  entity_type:'attendance_employee',
  entity_id:employee.id,
  metadata:{pin:txt(link.device_pin),employee_name:employee.name,request_id:requestRow.id},
  created_by:actorId(me)||actorName(me)||null
 }));
 try{
  await rest(env,'attendance_device_commands',{method:'POST',body:commandRows,prefer:'return=representation'});
 }catch(e){
  await rest(env,'attendance_employee_delete_requests?id=eq.'+enc(requestRow.id),{method:'PATCH',body:{status:'failed',failed_count:remaining.length,result_summary:{error:e.message||'queue_failed'},completed_at:new Date().toISOString(),updated_at:new Date().toISOString()},prefer:'return=minimal'}).catch(()=>{});
  throw e;
 }
 return {ok:true,pending:true,request_id:requestRow.id,devices:remaining.length,message:'تم إرسال طلب حذف الموظف إلى '+remaining.length+' جهاز/أجهزة. سيُحذف من النظام تلقائيًا بعد تأكيد الأجهزة.'};
}

function matchNameKey(value){
 return txt(value).toLowerCase()
  .normalize('NFKC')
  .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
  .replace(/ـ/g,'')
  .replace(/[أإآٱ]/g,'ا')
  .replace(/ى/g,'ي')
  .replace(/ؤ/g,'و')
  .replace(/ئ/g,'ي')
  .replace(/ة/g,'ه')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .trim().replace(/\s+/g,' ');
}
function matchNameTokens(value){return [...new Set(matchNameKey(value).split(' ').filter(x=>x.length>1))]}
function deviceEmployeeMatch(deviceUser,employee){
 const userName=matchNameKey(deviceUser?.name),employeeName=matchNameKey(employee?.name),pin=txt(deviceUser?.device_pin),code=txt(employee?.employee_code);
 let score=0;const reasons=[];
 if(userName&&employeeName){
  if(userName===employeeName){score+=78;reasons.push('الاسم مطابق تمامًا')}
  else{
   const a=matchNameTokens(userName),b=matchNameTokens(employeeName),setB=new Set(b),common=a.filter(x=>setB.has(x)).length,union=new Set([...a,...b]).size,ratio=union?common/union:0;
   if(ratio>=0.8){score+=68;reasons.push('تشابه الاسم مرتفع')}
   else if(ratio>=0.6){score+=56;reasons.push('تشابه الاسم جيد')}
   else if((userName.length>=4&&employeeName.includes(userName))||(employeeName.length>=4&&userName.includes(employeeName))){score+=50;reasons.push('أحد الاسمين يحتوي الآخر')}
  }
 }
 if(code&&pin&&code===pin){score+=30;reasons.push('كود الموظف يطابق PIN الجهاز')}
 if(txt(employee?.status)==='active')score+=2;
 score=Math.min(100,score);
 return {score,reasons,confidence:score>=88?'high':score>=68?'medium':score>=48?'low':'none'};
}
async function deviceUserMatchPreview(env,me,body){
 if(!canManageEmployees(me)||!canManageLinks(me))throw Object.assign(new Error('تحتاج صلاحية إدارة موظفي الحضور وربط البصمة للمطابقة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(!device.branch_id)throw Object.assign(new Error('اربط الجهاز بفرع أولًا قبل مطابقة الموظفين.'),{status:400});
 const mode=device.data_environment||accountMode(me);
 const [deviceUsers,links,employees,inventory,branchLinks]=await Promise.all([
  rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&select=*&order=device_pin.asc').catch(()=>[]),
  rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=*').catch(()=>[]),
  rest(env,'attendance_employees?branch_id=eq.'+enc(device.branch_id)+'&data_environment=eq.'+enc(mode)+'&status=eq.active&select=id,name,employee_code,department,job_title,status,branch_id,data_environment&order=name.asc').catch(()=>[]),
  rest(env,'attendance_biometric_inventory?device_id=eq.'+enc(device.id)+'&data_environment=eq.'+enc(mode)+'&status=eq.active&select=device_pin,biometric_type,biometric_key').catch(()=>[]),
  rest(env,'attendance_employee_links?branch_id=eq.'+enc(device.branch_id)+'&active=eq.true&attendance_employee_id=not.is.null&select=device_id,device_pin,attendance_employee_id').catch(()=>[])
 ]);
 if(!deviceUsers?.length)throw Object.assign(new Error('لا توجد بيانات موظفين مسحوبة من الجهاز حتى الآن.'),{status:400});
 const linkMap=new Map((links||[]).map(x=>[txt(x.device_pin),x])),inventoryCount=new Map(),sameDeviceEmployee=new Map(),linkCount=new Map();
 for(const inv of inventory||[]){const p=txt(inv.device_pin);inventoryCount.set(p,(inventoryCount.get(p)||0)+1)}
 for(const l of links||[]){if(l.attendance_employee_id)sameDeviceEmployee.set(txt(l.attendance_employee_id),txt(l.device_pin))}
 for(const l of branchLinks||[]){const id=txt(l.attendance_employee_id);if(id)linkCount.set(id,(linkCount.get(id)||0)+1)}
 const pending=(deviceUsers||[]).filter(u=>!linkMap.get(txt(u.device_pin))?.attendance_employee_id);
 const rows=pending.map(u=>{
  const pin=txt(u.device_pin),suggestions=[];
  for(const employee of employees||[]){
   const existingPin=sameDeviceEmployee.get(txt(employee.id));if(existingPin&&existingPin!==pin)continue;
   const match=deviceEmployeeMatch(u,employee);if(match.score<48)continue;
   suggestions.push({id:employee.id,name:employee.name,employee_code:employee.employee_code||null,department:employee.department||null,job_title:employee.job_title||null,score:match.score,confidence:match.confidence,reasons:match.reasons,linked_devices:linkCount.get(txt(employee.id))||0});
  }
  suggestions.sort((a,b)=>b.score-a.score||String(a.name).localeCompare(String(b.name),'ar'));
  const top=suggestions[0]||null,second=suggestions[1]||null,strong=!!top&&top.score>=88&&(!second||top.score-second.score>=10);
  return {device_pin:pin,name:txt(u.name)||('PIN '+pin),card_number:txt(u.card_number)||null,privilege:u.privilege??0,biometric_count:inventoryCount.get(pin)||0,suggestions:suggestions.slice(0,5),recommended_action:strong?'link_existing':suggestions.length?'review':'create_new',recommended_employee_id:strong?top.id:null,strong_match:strong};
 });
 return {ok:true,device:{id:device.id,name:device.name,branch_id:device.branch_id,data_environment:mode},total_device_users:deviceUsers.length,already_linked:deviceUsers.length-pending.length,pending:rows.length,employees:(employees||[]).map(x=>({id:x.id,name:x.name,employee_code:x.employee_code||null,department:x.department||null,job_title:x.job_title||null})),rows};
}
async function applyDeviceUserMatches(env,me,body){
 if(!canManageEmployees(me)||!canManageLinks(me))throw Object.assign(new Error('تحتاج صلاحية إدارة موظفي الحضور وربط البصمة لتنفيذ المطابقة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(!device.branch_id)throw Object.assign(new Error('اربط الجهاز بفرع أولًا قبل استيراد الموظفين.'),{status:400});
 const decisions=Array.isArray(body.decisions)?body.decisions.slice(0,500):[];
 if(!decisions.length)throw Object.assign(new Error('لا توجد قرارات مطابقة للتنفيذ.'),{status:400});
 const [deviceUsers,links,employees]=await Promise.all([
  rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&select=*').catch(()=>[]),
  rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=*').catch(()=>[]),
  rest(env,'attendance_employees?branch_id=eq.'+enc(device.branch_id)+'&data_environment=eq.'+enc(device.data_environment||accountMode(me))+'&status=eq.active&select=*').catch(()=>[])
 ]);
 const userMap=new Map((deviceUsers||[]).map(x=>[txt(x.device_pin),x])),linkMap=new Map((links||[]).map(x=>[txt(x.device_pin),x])),employeeMap=new Map((employees||[]).map(x=>[txt(x.id),x])),seen=new Set(),results=[];
 let linkedExisting=0,createdNew=0,skipped=0,failed=0,biometricsAttached=0;
 const actorValue=actorId(me)||actorName(me)||null,now=new Date().toISOString();
 for(const decision of decisions){
  const pin=txt(decision?.device_pin),action=txt(decision?.action);
  if(!pin||seen.has(pin))continue;seen.add(pin);
  const user=userMap.get(pin);
  if(!user){results.push({device_pin:pin,status:'failed',message:'PIN غير موجود ضمن الموظفين المسحوبين من الجهاز.'});failed+=1;continue}
  if(linkMap.get(pin)?.attendance_employee_id){results.push({device_pin:pin,status:'skipped',message:'PIN مربوط بالفعل.'});skipped+=1;continue}
  if(action==='skip'||!action){results.push({device_pin:pin,status:'skipped',message:'تم ترك السجل بدون تغيير.'});skipped+=1;continue}
  let employee=null,created=false;
  try{
   if(action==='link_existing'){
    employee=employeeMap.get(txt(decision?.attendance_employee_id))||null;
    if(!employee)throw new Error('الموظف المختار غير موجود أو خارج نفس الفرع.');
   }else if(action==='create_new'){
    let strong=null;
    for(const candidate of employees||[]){const m=deviceEmployeeMatch(user,candidate);if(m.score>=88){strong={employee:candidate,match:m};break}}
    if(strong&&!decision?.confirm_duplicate)throw new Error('يوجد تطابق قوي مع موظف موجود ('+strong.employee.name+'). اربطه بالموجود أو فعّل تأكيد إنشاء سجل جديد بعد المراجعة.');
    const createdRows=await rest(env,'attendance_employees',{method:'POST',body:{name:txt(user.name)||('PIN '+pin),branch_id:device.branch_id,status:'active',data_environment:device.data_environment||'training',notes:'مستورد بعد Smart Employee Matching من جهاز '+device.name+' / PIN '+pin,created_by:actorValue,updated_by:actorValue,created_at:now,updated_at:now},prefer:'return=representation'});
    employee=createdRows?.[0]||null;created=true;
    if(!employee)throw new Error('تعذر إنشاء موظف الحضور الجديد.');
   }else throw new Error('قرار المطابقة غير صحيح.');
   const linked=await saveLink(env,me,{device_id:device.id,device_pin:pin,attendance_employee_id:employee.id,display_name:employee.name});
   biometricsAttached+=Number(linked?.biometrics_attached||0);
   if(created)createdNew+=1;else linkedExisting+=1;
   results.push({device_pin:pin,status:'success',action,attendance_employee_id:employee.id,employee_name:employee.name,created,biometrics_attached:Number(linked?.biometrics_attached||0)});
  }catch(e){
   if(created&&employee?.id){
    const linkedNow=await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id)+'&select=id&limit=1').catch(()=>[]);
    if(!linkedNow?.length)await rest(env,'attendance_employees?id=eq.'+enc(employee.id),{method:'DELETE',prefer:'return=minimal'}).catch(()=>{});
   }
   failed+=1;results.push({device_pin:pin,status:'failed',action,message:e.message||'تعذر تنفيذ المطابقة.'})
  }
 }
 const summary={linked_existing:linkedExisting,created_new:createdNew,skipped,failed,biometrics_attached:biometricsAttached,total:results.length};
 await audit(env,me,'attendance_device_user_matching_apply','attendance_device',device.id,device.branch_id,null,{summary,results:results.map(x=>({device_pin:x.device_pin,status:x.status,action:x.action||null,attendance_employee_id:x.attendance_employee_id||null,created:!!x.created,biometrics_attached:x.biometrics_attached||0,message:x.message||null}))},'تطبيق Smart Employee Matching');
 return {ok:true,...summary,results,message:failed?('تم تنفيذ المطابقة مع '+failed+' حالة تحتاج مراجعة.'):('تم تنفيذ المطابقة: '+linkedExisting+' ربط موجود، '+createdNew+' إنشاء جديد، '+skipped+' متخطى.')};
}
async function importDeviceUsers(env,me,body){
 const preview=await deviceUserMatchPreview(env,me,body);
 return {...preview,requires_review:true,message:preview.pending?'تم تجهيز معاينة Smart Employee Matching. راجع الربط قبل إنشاء أي موظف جديد.':'كل موظفي الجهاز مربوطون بالفعل.'};
}


async function relinkDeviceHistory(env,device){
 const links=await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&attendance_employee_id=not.is.null&select=device_pin,attendance_employee_id,staff_user_id,branch_id,display_name&order=device_pin.asc');
 let linkedPins=0;
 for(const link of links||[]){
  await rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(link.device_pin),{method:'PATCH',body:{attendance_employee_id:link.attendance_employee_id,staff_user_id:link.staff_user_id||null,employee_name:link.display_name||null,branch_id:link.branch_id||device.branch_id||null},prefer:'return=minimal'});
  linkedPins+=1;
 }
 return linkedPins;
}
async function importHistoricalAttendance(env,me,body){
 if(!canManageDevices(me)||!canManageLinks(me))throw Object.assign(new Error('تحتاج صلاحية إدارة الأجهزة وربط البصمة لاستيراد الحركات القديمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const linkedPins=await relinkDeviceHistory(env,device);
 const existing=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=in.(history_attlog,history_attlog_replay)&status=in.(queued,sent)&select=id,command_type&limit=1').catch(()=>[]);
 const failedPlain=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.history_attlog&status=eq.failed&result_code=eq.-3&select=id,metadata,created_at&order=id.desc&limit=12').catch(()=>[]);
 const profile=device?.metadata?.history_profile&&typeof device.metadata.history_profile==='object'?device.metadata.history_profile:{},pushOnly=profile.preferred_mode==='push_replay'||(failedPlain||[]).some(x=>txt(x?.metadata?.history_strategy)==='plain');
 let queued=false,replay=false,strategy=txt(profile.preferred_strategy)||'range_space';
 if(!['range_space','range_iso','plain'].includes(strategy))strategy='range_space';
 if(!existing?.length){
  if(pushOnly){
   const sourceId=failedPlain.find(x=>txt(x?.metadata?.history_strategy)==='plain')?.id||null;
   queued=await queueAttendanceReplay(env,device,actorId(me)||actorName(me)||null,sourceId);
   replay=queued;
  }else{
   const now=deviceLocalNow(),start='2000-01-01 00:00:00';
   await queueCommands(env,device,me,[{type:'history_attlog',command:historyQueryCommand(strategy,start,now),metadata:{history_strategy:strategy,requested_start:start,requested_end:now,profile_reused:profile.preferred_mode==='data_query'}}]);
   queued=true;
  }
 }
 await audit(env,me,'attendance_history_import_requested','attendance_device',device.id,device.branch_id,null,{linked_pins:linkedPins,queued,replay,push_only:pushOnly,preferred_mode:profile.preferred_mode||null,preferred_strategy:strategy},'استيراد وربط كامل الحركات القديمة من جهاز البصمة');
 return {ok:true,queued,replay,push_only:pushOnly,preferred_mode:profile.preferred_mode||null,preferred_strategy:strategy,linked_pins:linkedPins,message:queued?(replay?'تم استخدام ملف توافق الجهاز: إعادة إرسال السجل عبر Push بدون إعادة تجربة أوامر غير مدعومة.':'تم استخدام طريقة السحب المتوافقة مع الجهاز لطلب الحركات القديمة.'):'تم ربط الحركات الموجودة، ويوجد طلب استيراد تاريخي قيد التنفيذ بالفعل.'};
}

async function saveEmployeeCalendarRule(env,me,body){
 if(!canManageSchedules(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة جداول الدوام والإجازات والاستئذانات.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const id=txt(body.id),type=txt(body.rule_type),allowed=new Set(['leave','permission','overtime','work_override','off','attendance_exempt','location_exempt','late_exempt','checkout_exempt','attendance_mode_override']);
 if(!allowed.has(type))throw Object.assign(new Error('نوع الاستثناء غير صحيح.'),{status:400});
 const startDate=txt(body.start_date),endDate=txt(body.end_date||body.start_date);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||endDate<startDate)throw Object.assign(new Error('حدد تاريخ بداية ونهاية صحيحين.'),{status:400});
 await assertAttendanceMonthOpen(env,employee.branch_id,startDate,endDate,employee.data_environment==='production'?'production':'training');
 const startTime=cleanTime(body.start_time),endTime=cleanTime(body.end_time);
 if(['permission','overtime','work_override'].includes(type)&&(!startTime||!endTime))throw Object.assign(new Error('وقت البداية والنهاية مطلوب لهذا النوع.'),{status:400});
 let before=null;
 if(id){
  const rows=await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id)+'&attendance_employee_id=eq.'+enc(employee.id)+'&select=*&limit=1');
  before=rows?.[0]||null;if(!before)throw Object.assign(new Error('الاستثناء غير موجود.'),{status:404});
 }
 const policyPayload=body.policy_payload&&typeof body.policy_payload==='object'&&!Array.isArray(body.policy_payload)?body.policy_payload:{};
 if(type==='attendance_mode_override'&&!['biometric','mobile','hybrid'].includes(txt(policyPayload.attendance_mode)))throw Object.assign(new Error('حدد طريقة حضور صحيحة للاستثناء: بصمة أو جوال أو مختلط.'),{status:400});
 const now=new Date().toISOString(),payload={
  attendance_employee_id:employee.id,
  branch_id:employee.branch_id||null,
  rule_type:type,
  label:txt(body.label)||null,
  start_date:startDate,
  end_date:endDate,
  start_time:startTime,
  end_time:endTime,
  grace_minutes:type==='work_override'?Math.max(0,Math.min(240,Number(body.grace_minutes??employee.grace_minutes??10))):null,
  status:'active',
  data_environment:employee.data_environment||'training',
  notes:txt(body.notes)||null,
  policy_payload:policyPayload,
  updated_by:actorId(me)||actorName(me)||null,
  updated_at:now
 };
 let after;
 if(id)after=(await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 else after=(await rest(env,'attendance_employee_calendar_rules',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null,created_at:now},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ الاستثناء.'),{status:500});
 await audit(env,me,id?'attendance_calendar_rule_update':'attendance_calendar_rule_create','attendance_employee_calendar_rule',after.id,employee.branch_id,before,after,txt(body.reason)||'إدارة جدول حضور الموظف');
 return {ok:true,rule:after};
}
async function deleteEmployeeCalendarRule(env,me,body){
 if(!canManageSchedules(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة جداول الدوام والإجازات والاستئذانات.'),{status:403});
 const id=txt(body.id),rows=await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;
 if(!before)throw Object.assign(new Error('الاستثناء غير موجود.'),{status:404});
 const employee=await scopedEmployee(env,me,before.attendance_employee_id);if(!employee)throw Object.assign(new Error('الاستثناء خارج نطاق الفرع.'),{status:403});
 await assertAttendanceMonthOpen(env,employee.branch_id,before.start_date,before.end_date,employee.data_environment==='production'?'production':'training');
 await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});
 await audit(env,me,'attendance_calendar_rule_delete','attendance_employee_calendar_rule',id,employee.branch_id,before,null,txt(body.reason)||'حذف استثناء جدول حضور');
 return {ok:true};
}

function monthStartKey(dateText){
 const v=txt(dateText);if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;return v.slice(0,7)+'-01';
}
function monthEndKey(monthStart){
 if(!/^\d{4}-\d{2}-01$/.test(txt(monthStart)))return null;
 const [y,m]=monthStart.split('-').map(Number),d=new Date(Date.UTC(y,m,0));return d.toISOString().slice(0,10);
}
function saudiTodayKey(){
 try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day}catch{return new Date().toISOString().slice(0,10)}
}
async function closedMonthsBetween(env,branchId,startDate,endDate,mode){
 if(!branchId)return [];
 const a=monthStartKey(startDate),b=monthStartKey(endDate);if(!a||!b)return [];
 return await rest(env,'attendance_month_closures?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&status=eq.closed&period_month=gte.'+enc(a)+'&period_month=lte.'+enc(b)+'&select=id,period_month,status,closure_version,closed_by,closed_at&order=period_month.asc').catch(()=>[]);
}
async function assertAttendanceMonthOpen(env,branchId,startDate,endDate,mode){
 const rows=await closedMonthsBetween(env,branchId,startDate,endDate,mode);
 if(rows?.length){const months=rows.map(x=>String(x.period_month).slice(0,7)).join('، ');throw Object.assign(new Error('الفترة تقع داخل شهر حضور مقفل: '+months+'. يلزم إعادة فتح الشهر أولًا.'),{status:409})}
}
async function closeAttendanceMonth(env,me,body){
 if(!canCloseMonth(me))throw Object.assign(new Error('لا توجد صلاحية لإقفال شهر الحضور.'),{status:403});
 const branchId=requestedBranch(me,body),mode=accountMode(me),period=txt(body.period_month);
 if(!branchId)throw Object.assign(new Error('اختر فرعًا محددًا قبل إقفال الشهر.'),{status:400});
 if(!/^\d{4}-\d{2}-01$/.test(period))throw Object.assign(new Error('شهر الإقفال غير صحيح.'),{status:400});
 const end=monthEndKey(period),today=saudiTodayKey();if(!end||end>=today)throw Object.assign(new Error('لا يمكن إقفال الشهر قبل انتهائه بالكامل.'),{status:409});
 const snapshot=body.snapshot&&typeof body.snapshot==='object'&&!Array.isArray(body.snapshot)?body.snapshot:{},daily=Array.isArray(snapshot.daily)?snapshot.daily:[],monthly=Array.isArray(snapshot.monthly)?snapshot.monthly:[],filters=snapshot.filters&&typeof snapshot.filters==='object'?snapshot.filters:{};
 if(!daily.length||!monthly.length)throw Object.assign(new Error('اعرض التقرير الشهري الكامل أولًا قبل الإقفال.'),{status:400});
 if(daily.length>10000||monthly.length>2000)throw Object.assign(new Error('حجم لقطة الإقفال أكبر من الحد المسموح.'),{status:413});
 if(txt(filters.from_date)!==period||txt(filters.to_date)!==end||txt(filters.branch_id)!==branchId||txt(filters.attendance_employee_id)||txt(filters.device_id))throw Object.assign(new Error('إقفال الشهر يتطلب كشف الشهر كاملًا لفرع واحد بدون فلترة موظف أو جهاز.'),{status:400});
 const pending=daily.filter(r=>r&&r.employee_id&&(r.status==='غياب'||r.status==='حضور جزئي'||Number(r.late_minutes)>0||Number(r.early_leave_minutes)>0||Number(r.missing_punches)>0||Number(r.shortage_minutes)>0)&&r.review_status==='pending');
 if(pending.length)throw Object.assign(new Error('يوجد '+pending.length+' مخالفة ما زالت بانتظار مراجعة HR. راجعها قبل إقفال الشهر.'),{status:409});
 const before=(await rest(env,'attendance_month_closures?branch_id=eq.'+enc(branchId)+'&period_month=eq.'+enc(period)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(before?.status==='closed')return {ok:true,closure:before,already_closed:true,message:'الشهر مقفل بالفعل.'};
 const branch=(await rest(env,'branches?id=eq.'+enc(branchId)+'&select=id,name&limit=1'))?.[0]||null;if(!branch)throw Object.assign(new Error('الفرع غير موجود.'),{status:404});
 const now=new Date().toISOString(),closureSnapshot={daily,monthly,filters:snapshot.filters||{},generated_at:now},totals=body.totals&&typeof body.totals==='object'&&!Array.isArray(body.totals)?body.totals:{},reason=txt(body.reason)||'إقفال شهر الحضور';
 const atomic=await rest(env,'rpc/attendance_set_month_closure_atomic',{method:'POST',body:{
  p_branch_id:branchId,p_period_month:period,p_environment:mode,p_action:'close',
  p_snapshot:closureSnapshot,p_totals:totals,p_actor:actorName(me)||actorId(me)||null,p_reason:reason
 }}).catch(e=>{throw Object.assign(new Error(e?.message||'تعذر إقفال شهر الحضور.'),{status:409})});
 const after=atomic?.closure||null;
 if(atomic?.already_closed&&after)return {ok:true,closure:after,already_closed:true,message:'الشهر مقفل بالفعل.'};
 if(!after)throw Object.assign(new Error('تعذر إقفال شهر الحضور.'),{status:500});
 await audit(env,me,before?'attendance_month_reclose':'attendance_month_close','attendance_month_closure',after.id,branchId,before,after,reason);
 return {ok:true,closure:after,message:'تم إقفال شهر '+period.slice(0,7)+' للفرع '+(branch.name||'')+' وتجميد نتائجه.'};
}
async function reopenAttendanceMonth(env,me,body){
 if(!canReopenMonth(me))throw Object.assign(new Error('لا توجد صلاحية خاصة لإعادة فتح شهر الحضور.'),{status:403});
 const branchId=requestedBranch(me,body),mode=accountMode(me),period=txt(body.period_month),reason=txt(body.reason);
 if(!branchId)throw Object.assign(new Error('اختر فرعًا محددًا.'),{status:400});
 if(!/^\d{4}-\d{2}-01$/.test(period))throw Object.assign(new Error('شهر الإقفال غير صحيح.'),{status:400});
 if(reason.length<5)throw Object.assign(new Error('سبب إعادة فتح الشهر مطلوب.'),{status:400});
 const before=(await rest(env,'attendance_month_closures?branch_id=eq.'+enc(branchId)+'&period_month=eq.'+enc(period)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1'))?.[0]||null;
 if(!before||before.status!=='closed')throw Object.assign(new Error('هذا الشهر غير مقفل حاليًا.'),{status:409});
 const atomic=await rest(env,'rpc/attendance_set_month_closure_atomic',{method:'POST',body:{
  p_branch_id:branchId,p_period_month:period,p_environment:mode,p_action:'reopen',
  p_snapshot:{},p_totals:{},p_actor:actorName(me)||actorId(me)||null,p_reason:reason
 }}).catch(e=>{
  const msg=String(e?.message||'');
  if(msg.includes('attendance_month_not_closed'))throw Object.assign(new Error('هذا الشهر لم يعد مقفلًا حاليًا.'),{status:409});
  throw Object.assign(new Error(msg||'تعذر إعادة فتح شهر الحضور.'),{status:409});
 });
 const after=atomic?.closure||null;if(!after)throw Object.assign(new Error('تعذر إعادة فتح شهر الحضور.'),{status:500});
 await audit(env,me,'attendance_month_reopen','attendance_month_closure',before.id,branchId,before,after,reason);
 return {ok:true,closure:after,message:'تمت إعادة فتح شهر '+period.slice(0,7)+' للتعديل والمراجعة.'};
}

async function saveAttendancePolicy(env,me,body){
 if(!canManagePolicies(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة سياسات الحضور والمخالفات.'),{status:403});
 const branchId=elevated(me)?txt(body.branch_id):actorBranch(me),mode=body.data_environment==='production'?'production':'training';
 if(!branchId)throw Object.assign(new Error('اختر الفرع أولًا.'),{status:400});
 const branch=(await rest(env,'branches?id=eq.'+enc(branchId)+'&select=id,name&limit=1'))?.[0]||null;
 if(!branch)throw Object.assign(new Error('الفرع غير موجود.'),{status:404});
 const effectiveFrom=txt(body.policy_effective_from)||saudiTodayKey();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))throw Object.assign(new Error('حدد تاريخ سريان صحيح لسياسة الحضور.'),{status:400});
 await assertAttendanceMonthOpen(env,branchId,effectiveFrom,effectiveFrom,mode);
 const clamp=(v,min,max,def)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):def};
 const attendanceMode=['biometric','mobile','hybrid'].includes(txt(body.attendance_mode))?txt(body.attendance_mode):'biometric';
 const lat=body.mobile_location_lat===''||body.mobile_location_lat==null?null:Number(body.mobile_location_lat);
 const lng=body.mobile_location_lng===''||body.mobile_location_lng==null?null:Number(body.mobile_location_lng);
 if(lat!=null&&(!Number.isFinite(lat)||lat<-90||lat>90))throw Object.assign(new Error('خط العرض لموقع الفرع غير صحيح.'),{status:400});
 if(lng!=null&&(!Number.isFinite(lng)||lng<-180||lng>180))throw Object.assign(new Error('خط الطول لموقع الفرع غير صحيح.'),{status:400});
 const geofenceEnabled=body.mobile_geofence_enabled!==false;
 if(attendanceMode!=='biometric'&&geofenceEnabled&&(lat==null||lng==null))throw Object.assign(new Error('حدد موقع الفرع قبل تفعيل الحضور بالجوال مع النطاق الجغرافي.'),{status:400});
 const actorValue=actorId(me)||actorName(me)||null,now=new Date().toISOString();
 const payload={
  branch_id:branchId,
  data_environment:mode,
  attendance_mode:attendanceMode,
  mobile_geofence_enabled:geofenceEnabled,
  mobile_geofence_radius_m:clamp(body.mobile_geofence_radius_m,20,5000,100),
  mobile_location_lat:lat,
  mobile_location_lng:lng,
  mobile_require_trusted_device:body.mobile_require_trusted_device!==false,
  mobile_require_selfie:body.mobile_require_selfie===true,
  mobile_require_dynamic_qr:body.mobile_require_dynamic_qr===true,
  policy_effective_from:effectiveFrom,
  early_leave_grace_minutes:clamp(body.early_leave_grace_minutes,0,240,10),
  shortage_grace_minutes:clamp(body.shortage_grace_minutes,0,480,15),
  partial_absence_threshold_minutes:clamp(body.partial_absence_threshold_minutes,1,720,60),
  late_penalty_minutes:clamp(body.late_penalty_minutes,0,1440,0),
  early_leave_penalty_minutes:clamp(body.early_leave_penalty_minutes,0,1440,0),
  missing_punch_penalty_minutes:clamp(body.missing_punch_penalty_minutes,0,1440,0),
  partial_absence_penalty_minutes:clamp(body.partial_absence_penalty_minutes,0,1440,0),
  absence_penalty_minutes:clamp(body.absence_penalty_minutes,0,1440,0),
  notes:txt(body.notes)||null,
  updated_by:actorValue,
  updated_at:now
 };
 const before=(await rest(env,'attendance_branch_policies?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1'))?.[0]||null;
 const rows=await rest(env,'attendance_branch_policies?on_conflict=branch_id%2Cdata_environment',{method:'POST',body:{...payload,created_by:before?.created_by||actorValue},prefer:'resolution=merge-duplicates,return=representation'});
 const after=rows?.[0]||null;if(!after)throw Object.assign(new Error('تعذر حفظ سياسة الحضور.'),{status:500});

 const versions=await rest(env,'attendance_branch_policy_versions?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&select=*&order=effective_from.asc&limit=1000').catch(()=>[]);
 const shiftDate=(dateText,days)=>{const d=new Date(String(dateText)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
 const exact=(versions||[]).find(v=>String(v.effective_from)===effectiveFrom)||null;
 const previous=[...(versions||[])].filter(v=>String(v.effective_from)<effectiveFrom).sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)))[0]||null;
 const next=[...(versions||[])].filter(v=>String(v.effective_from)>effectiveFrom).sort((a,b)=>String(a.effective_from).localeCompare(String(b.effective_from)))[0]||null;
 const versionEnd=next?shiftDate(next.effective_from,-1):null,reason=txt(body.reason)||'إدارة سياسة الحضور والمخالفات';
 if(previous&&String(previous.effective_to||'')!==shiftDate(effectiveFrom,-1)){
  await rest(env,'attendance_branch_policy_versions?id=eq.'+enc(previous.id),{method:'PATCH',body:{effective_to:shiftDate(effectiveFrom,-1),updated_by:actorValue,updated_at:now},prefer:'return=minimal'});
 }
 let policyVersion=null;
 const versionPayload={branch_id:branchId,data_environment:mode,effective_from:effectiveFrom,effective_to:versionEnd,policy_snapshot:after,reason,updated_by:actorValue,updated_at:now};
 if(exact)policyVersion=(await rest(env,'attendance_branch_policy_versions?id=eq.'+enc(exact.id),{method:'PATCH',body:versionPayload,prefer:'return=representation'}))?.[0]||null;
 else policyVersion=(await rest(env,'attendance_branch_policy_versions',{method:'POST',body:{...versionPayload,created_by:actorValue,created_at:now},prefer:'return=representation'}))?.[0]||null;
 await audit(env,me,before?'attendance_policy_update':'attendance_policy_create','attendance_branch_policy',after.id,branchId,before,{...after,policy_version_id:policyVersion?.id||null},reason);
 return {ok:true,policy:after,policy_version:policyVersion};
}

async function saveAttendanceViolationDecision(env,me,body){
 if(!canReviewViolations(me))throw Object.assign(new Error('لا توجد صلاحية لاعتماد أو تسوية مخالفات الحضور.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));
 if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const workDate=txt(body.work_date),status=txt(body.decision_status);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(workDate))throw Object.assign(new Error('تاريخ المخالفة غير صحيح.'),{status:400});
 if(!['approved','waived','adjusted'].includes(status))throw Object.assign(new Error('قرار المخالفة غير صحيح.'),{status:400});
 const clamp=v=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(10080,Math.round(n))):0};
 const systemPenalty=clamp(body.system_penalty_minutes);
 const approvedPenalty=status==='waived'?0:status==='approved'?systemPenalty:clamp(body.approved_penalty_minutes);
 const mode=employee.data_environment==='production'?'production':'training';
 await assertAttendanceMonthOpen(env,employee.branch_id,workDate,workDate,mode);
 const before=(await rest(env,'attendance_violation_decisions?attendance_employee_id=eq.'+enc(employee.id)+'&work_date=eq.'+enc(workDate)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 const snapshot=body.violation_snapshot&&typeof body.violation_snapshot==='object'&&!Array.isArray(body.violation_snapshot)?body.violation_snapshot:{};
 const now=new Date().toISOString(),payload={
  attendance_employee_id:employee.id,
  branch_id:employee.branch_id||null,
  work_date:workDate,
  decision_status:status,
  system_penalty_minutes:systemPenalty,
  approved_penalty_minutes:approvedPenalty,
  violation_snapshot:snapshot,
  manager_note:txt(body.manager_note)||null,
  data_environment:mode,
  reviewed_by:actorName(me)||actorId(me)||null,
  reviewed_at:now,
  updated_at:now
 };
 const rows=await rest(env,'attendance_violation_decisions?on_conflict=attendance_employee_id%2Cwork_date%2Cdata_environment',{method:'POST',body:{...payload,created_at:before?.created_at||now},prefer:'resolution=merge-duplicates,return=representation'});
 const after=rows?.[0]||null;if(!after)throw Object.assign(new Error('تعذر حفظ قرار المخالفة.'),{status:500});
 await audit(env,me,before?'attendance_violation_decision_update':'attendance_violation_decision_create','attendance_violation_decision',after.id,employee.branch_id,before,after,txt(body.reason)||'مراجعة مخالفة حضور');
 return {ok:true,decision:after};
}
async function resetAttendanceViolationDecision(env,me,body){
 if(!canReviewViolations(me))throw Object.assign(new Error('لا توجد صلاحية لإعادة المخالفة للمراجعة.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));
 if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const workDate=txt(body.work_date),mode=employee.data_environment==='production'?'production':'training';
 await assertAttendanceMonthOpen(env,employee.branch_id,workDate,workDate,mode);
 const rows=await rest(env,'attendance_violation_decisions?attendance_employee_id=eq.'+enc(employee.id)+'&work_date=eq.'+enc(workDate)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1'),before=rows?.[0]||null;
 if(!before)return {ok:true,deleted:false};
 await rest(env,'attendance_violation_decisions?id=eq.'+enc(before.id),{method:'DELETE',prefer:'return=minimal'});
 await audit(env,me,'attendance_violation_decision_reset','attendance_violation_decision',before.id,employee.branch_id,before,null,txt(body.reason)||'إعادة مخالفة حضور للمراجعة');
 return {ok:true,deleted:true};
}

async function attendanceState(env,me,url){
 const branchId=requestedBranch(me,{},url),mode=accountMode(me),dFilter=branchId?'&branch_id=eq.'+enc(branchId):'',lFilter=branchId?'&branch_id=eq.'+enc(branchId):'',logFilter=branchId?'&branch_id=eq.'+enc(branchId):'',empFilter=branchId?'&branch_id=eq.'+enc(branchId):'',userFilter=branchId?'&branch_id=eq.'+enc(branchId):'',deleteFilter=branchId?'&branch_id=eq.'+enc(branchId):'',calendarFilter=branchId?'&branch_id=eq.'+enc(branchId):'',policyFilter=branchId?'&branch_id=eq.'+enc(branchId):'',policyVersionFilter=branchId?'&branch_id=eq.'+enc(branchId):'',mobileDeviceFilter=branchId?'&branch_id=eq.'+enc(branchId):'',branchFilter=branchId?'?id=eq.'+enc(branchId)+'&select=id,name,status,address':'?select=id,name,status,address&order=name.asc';
 const [devices,links,logs,unlinkedRows,employees,users,branches,shiftPeriods,scheduleVersions,deleteRequests,calendarRules,policies,policyVersions,mobileDevices]=await Promise.all([
  rest(env,'attendance_devices?select=*&order=created_at.asc'+dFilter),
  rest(env,'attendance_employee_links?select=*&order=created_at.desc'+lFilter),
  rest(env,'attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at&data_environment=eq.'+enc(mode)+logFilter+'&order=occurred_at.desc&limit=500'),
  rest(env,'attendance_raw_logs?select=device_id,serial_number,branch_id,device_pin,occurred_at,received_at&data_environment=eq.'+enc(mode)+logFilter+'&attendance_employee_id=is.null&staff_user_id=is.null&employee_name=is.null&order=occurred_at.desc&limit=5000'),
  rest(env,'attendance_employees?select=*&data_environment=eq.'+enc(mode)+empFilter+'&order=name.asc'),
  rest(env,'staff_users?select=id,name,username,role,branch_id,status&status=neq.%D9%85%D9%88%D9%82%D9%88%D9%81'+userFilter+'&order=name.asc'),
  rest(env,'branches'+branchFilter),
  rest(env,'attendance_employee_shift_periods?select=*&active=eq.true&order=attendance_employee_id.asc,sequence_no.asc'),
  rest(env,'attendance_employee_schedule_versions?select=*&data_environment=eq.'+enc(mode)+empFilter+'&order=attendance_employee_id.asc,effective_from.desc&limit=5000').catch(()=>[]),
  rest(env,'attendance_employee_delete_requests?select=*&order=created_at.desc&limit=100'+deleteFilter),
  rest(env,'attendance_employee_calendar_rules?select=*&status=eq.active&data_environment=eq.'+enc(mode)+calendarFilter+'&order=start_date.desc,created_at.desc&limit=2000'),
  rest(env,'attendance_branch_policies?select=*&data_environment=eq.'+enc(mode)+policyFilter+'&order=branch_id.asc'),
  rest(env,'attendance_branch_policy_versions?select=*&data_environment=eq.'+enc(mode)+policyVersionFilter+'&order=branch_id.asc,effective_from.asc&limit=5000').catch(()=>[]),
  rest(env,'attendance_mobile_devices?select=id,attendance_employee_id,staff_user_id,branch_id,device_label,status,data_environment,first_seen_at,last_seen_at,approved_at,approved_by,revoked_at,revoked_by,review_note,created_at,updated_at&data_environment=eq.'+enc(mode)+mobileDeviceFilter+'&order=updated_at.desc&limit=5000').catch(()=>[])
 ]);
 const deviceIds=(devices||[]).map(d=>d.id).filter(Boolean),inFilter=deviceIds.length?'&device_id=in.('+deviceIds.map(enc).join(',')+')':'';
 const historySince=new Date(Date.now()-90*86400000).toISOString();
 const [deviceUsers,commands,deviceShiftTemplates,healthEvents,clockChecks]=deviceIds.length?await Promise.all([
   rest(env,'attendance_device_users?select=id,device_id,serial_number,device_pin,name,privilege,card_number,group_no,timezone_raw,verify_mode,data_environment,source_table,first_seen_at,last_seen_at'+inFilter+'&order=device_pin.asc'),
   rest(env,'attendance_device_commands?select=id,device_id,command_type,status,result_code,result_body,command_text,metadata,created_at,sent_at,completed_at,updated_at'+inFilter+'&order=id.desc&limit=100'),
   rest(env,'attendance_device_shift_templates?select=*&active=eq.true'+inFilter+'&order=device_id.asc,sequence_no.asc,name.asc'),
   rest(env,'attendance_device_health_events?select=id,event_key,device_id,branch_id,event_type,severity,status,started_at,ended_at,duration_seconds,command_id,result_code,summary,metadata,created_at'+inFilter+'&started_at=gte.'+enc(historySince)+'&order=started_at.desc&limit=1000').catch(()=>[]),
   rest(env,'attendance_device_clock_checks?select=id,device_id,branch_id,serial_number,source,device_time_raw,server_time,drift_seconds,status,confirmed,sample_count,metadata,created_at'+inFilter+'&order=created_at.desc&limit=500').catch(()=>[])
 ]):[[],[],[],[],[]];
 const latestDeviceLogs=deviceIds.length?await Promise.all(deviceIds.map(async id=>({device_id:id,row:(await rest(env,'attendance_raw_logs?device_id=eq.'+enc(id)+'&select=occurred_at,received_at&order=occurred_at.desc&limit=1').catch(()=>[]))?.[0]||null}))):[];
 const employeeIds=new Set((employees||[]).map(x=>String(x.id))),scopedShiftPeriods=(shiftPeriods||[]).filter(x=>employeeIds.has(String(x.attendance_employee_id))),scopedScheduleVersions=(scheduleVersions||[]).filter(x=>employeeIds.has(String(x.attendance_employee_id)));
 const unlinkedMap=new Map();
 for(const row of unlinkedRows||[]){
  const key=String(row.device_id||'')+'|'+txt(row.device_pin),old=unlinkedMap.get(key);
  if(!old)unlinkedMap.set(key,{key,device_id:row.device_id,serial_number:row.serial_number,branch_id:row.branch_id,device_pin:txt(row.device_pin),count:1,oldest_at:row.occurred_at,newest_at:row.occurred_at,last_received_at:row.received_at||null});
  else{old.count+=1;if(row.occurred_at&&(!old.oldest_at||new Date(row.occurred_at)<new Date(old.oldest_at)))old.oldest_at=row.occurred_at;if(row.occurred_at&&(!old.newest_at||new Date(row.occurred_at)>new Date(old.newest_at)))old.newest_at=row.occurred_at;if(row.received_at&&(!old.last_received_at||new Date(row.received_at)>new Date(old.last_received_at)))old.last_received_at=row.received_at}
 }
 const unlinkedGroups=[...unlinkedMap.values()].sort((x,y)=>Number(y.count||0)-Number(x.count||0)||String(x.device_pin).localeCompare(String(y.device_pin))),unlinkedTotal=unlinkedGroups.reduce((n,x)=>n+Number(x.count||0),0);
 const latestLogMap=new Map((latestDeviceLogs||[]).map(x=>[String(x.device_id),x.row])),commandMap=new Map(),unlinkedByDevice=new Map();
 for(const c of commands||[]){const k=String(c.device_id),arr=commandMap.get(k)||[];arr.push(c);commandMap.set(k,arr)}
 for(const x of unlinkedGroups){const k=String(x.device_id);unlinkedByDevice.set(k,(unlinkedByDevice.get(k)||0)+Number(x.count||0))}
 const deviceHealth=(devices||[]).map(device=>deviceHealthSnapshot(device,latestLogMap.get(String(device.id))||null,commandMap.get(String(device.id))||[],unlinkedByDevice.get(String(device.id))||0,(unlinkedRows||[]).length>=5000));
 const healthMap=new Map(deviceHealth.map(x=>[String(x.device_id),x])),eventsMap=new Map();
 for(const ev of healthEvents||[]){const k=String(ev.device_id),arr=eventsMap.get(k)||[];arr.push(ev);eventsMap.set(k,arr)}
 const nowMs=Date.now(),monthAgoMs=nowMs-30*86400000;
 const deviceHealthHistory=(devices||[]).map(device=>{
  const createdMs=new Date(device.created_at||0).getTime(),periodStart=Math.max(Number.isFinite(createdMs)?createdMs:monthAgoMs,monthAgoMs),periodSeconds=Math.max(1,Math.round((nowMs-periodStart)/1000));
  const events=eventsMap.get(String(device.id))||[];let downtime=0,outages=0,failures=0;
  for(const ev of events){
   const startMs=new Date(ev.started_at).getTime();if(!Number.isFinite(startMs)||startMs<monthAgoMs)continue;
   if(ev.event_type==='command_failed')failures+=1;
   if(ev.event_type==='disconnect_gap'){
    outages+=1;const endMs=new Date(ev.ended_at||ev.started_at).getTime(),a=Math.max(periodStart,startMs),b=Math.min(nowMs,Number.isFinite(endMs)?endMs:startMs);if(b>a)downtime+=Math.round((b-a)/1000);
   }
  }
  const health=healthMap.get(String(device.id));
  let currentOutageSeconds=0;
  if(device.status==='active'&&health?.connection==='offline'&&health?.last_seen_at){
   const startMs=new Date(health.last_seen_at).getTime()+1800*1000;
   if(Number.isFinite(startMs)&&startMs<nowMs){currentOutageSeconds=Math.round((nowMs-Math.max(periodStart,startMs))/1000);if(currentOutageSeconds>0){downtime+=currentOutageSeconds;outages+=1}}
  }
  downtime=Math.min(periodSeconds,Math.max(0,downtime));
  const availability=Math.max(0,Math.min(100,((periodSeconds-downtime)/periodSeconds)*100));
  return {device_id:device.id,period_days:Math.max(1,Math.ceil(periodSeconds/86400)),availability_pct:Number(availability.toFixed(2)),outage_count:outages,downtime_seconds:downtime,current_outage_seconds:currentOutageSeconds,command_failures:failures,last_event_at:events?.[0]?.started_at||null};
 });
 const historySummaryMap=new Map(deviceHealthHistory.map(x=>[String(x.device_id),x])),dayMs=86400000,devicePredictiveAlerts=[];
 for(const device of devices||[]){
  if(device.status!=='active')continue;
  const id=String(device.id),health=healthMap.get(id)||{},hist=historySummaryMap.get(id)||{},events=eventsMap.get(id)||[],profile=device?.metadata?.history_profile||{},pushReplayKnown=profile.preferred_mode==='push_replay'||!!device?.metadata?.history_replay_completed_at;
  const deviceCommands=commandMap.get(id)||[],expectedCompatibilityFailure=ev=>ev.event_type==='command_failed'&&Number(ev.result_code)===-3&&pushReplayKnown&&['history_attlog','sync_attlog'].includes(txt(ev?.metadata?.command_type)),recoveredFailure=ev=>{const type=txt(ev?.metadata?.command_type),failedAt=new Date(ev.started_at||0).getTime();if(!type||!Number.isFinite(failedAt))return false;return deviceCommands.some(cmd=>txt(cmd.command_type)===type&&cmd.status==='success'&&new Date(cmd.completed_at||cmd.updated_at||cmd.created_at||0).getTime()>failedAt)};
  const operationalFailures=events.filter(ev=>ev.event_type==='command_failed'&&!expectedCompatibilityFailure(ev)&&!recoveredFailure(ev));
  const gaps=events.filter(ev=>ev.event_type==='disconnect_gap');
  const inWindow=(ev,from,to=nowMs)=>{const t=new Date(ev.started_at).getTime();return Number.isFinite(t)&&t>=from&&t<to};
  const fail24=operationalFailures.filter(ev=>inWindow(ev,nowMs-dayMs)).length;
  const fail7=operationalFailures.filter(ev=>inWindow(ev,nowMs-7*dayMs)).length;
  const failPrev7=operationalFailures.filter(ev=>inWindow(ev,nowMs-14*dayMs,nowMs-7*dayMs)).length;
  const outage7=gaps.filter(ev=>inWindow(ev,nowMs-7*dayMs)).length;
  const outagePrev7=gaps.filter(ev=>inWindow(ev,nowMs-14*dayMs,nowMs-7*dayMs)).length;
  const downtime7=gaps.filter(ev=>inWindow(ev,nowMs-7*dayMs)).reduce((n,ev)=>n+Math.max(0,Number(ev.duration_seconds)||0),0);
  const logAge=ageSeconds(health.last_log_at),createdAge=ageSeconds(device.created_at),signals=[];let risk=0,primary='watch',recommendedAction='diagnose',recommendedLabel='تشخيص الآن';
  if(Number(health.stuck_commands)>0){risk+=40;primary='stuck_commands';signals.push(String(health.stuck_commands)+' أمر معلق لأكثر من 15 دقيقة.')}
  if(fail24>=3){risk+=45;primary='repeated_failures';signals.push(fail24+' أوامر تشغيلية فشلت خلال آخر 24 ساعة.')}
  else if(fail24>=2){risk+=28;primary='repeated_failures';signals.push('تكرر فشل الأوامر مرتين خلال آخر 24 ساعة.')}
  else if(fail7>=3){risk+=20;signals.push(fail7+' حالات فشل تشغيلية خلال آخر 7 أيام.')}
  if(fail7>=2&&fail7>failPrev7){risk+=10;signals.push('معدل فشل الأوامر أعلى من الأسبوع السابق.')}
  if(outage7>=3){risk+=38;if(primary==='watch')primary='connection_flapping';recommendedAction='health_log';recommendedLabel='عرض سجل الاتصال';signals.push(outage7+' انقطاعات اتصال خلال آخر 7 أيام.')}
  else if(outage7>=2){risk+=22;if(primary==='watch')primary='connection_flapping';recommendedAction='health_log';recommendedLabel='عرض سجل الاتصال';signals.push('اتصال الجهاز تذبذب أكثر من مرة خلال الأسبوع.')}
  if(outage7>=2&&outage7>outagePrev7){risk+=10;signals.push('عدد الانقطاعات ارتفع مقارنة بالأسبوع السابق.')}
  if(downtime7>=2*3600){risk+=15;signals.push('إجمالي الانقطاع خلال 7 أيام تجاوز ساعتين.')}
  if(health.connection==='online'&&health.last_log_at&&logAge!=null&&logAge>72*3600){risk+=35;primary='stalled_attlog';recommendedAction='diagnose';recommendedLabel='فحص تدفق البصمات';signals.push('الجهاز Online لكن لا توجد بصمات جديدة منذ أكثر من 72 ساعة.')}
  else if(health.connection==='online'&&health.last_log_at&&logAge!=null&&logAge>36*3600){risk+=18;if(primary==='watch')primary='stalled_attlog';recommendedAction='diagnose';recommendedLabel='فحص تدفق البصمات';signals.push('تدفق البصمات هادئ لأكثر من 36 ساعة رغم اتصال الجهاز.')}
  else if(health.connection==='online'&&!health.last_log_at&&createdAge!=null&&createdAge>24*3600){risk+=25;primary='no_attlog';recommendedAction='diagnose';recommendedLabel='فحص استقبال البصمات';signals.push('الجهاز متصل منذ أكثر من يوم ولم تصل منه أي حركة حضور.')}
  if(Number(hist.availability_pct)<99){risk+=25;signals.push('اعتمادية الاتصال خلال 30 يوم أقل من 99%.')}
  else if(Number(hist.availability_pct)<99.8){risk+=10;signals.push('اعتمادية الاتصال خلال 30 يوم بدأت تنخفض عن المستوى المعتاد.')}
  if(Number(health.score)<70){risk+=20;signals.push('درجة صحة الجهاز الحالية منخفضة.')}
  else if(Number(health.score)<85){risk+=8}
  risk=Math.max(0,Math.min(100,risk));
  if(risk<20)continue;
  const level=risk>=60?'high':risk>=35?'medium':'watch',tone=level==='high'?'red':level==='medium'?'orange':'blue',label=level==='high'?'خطر مرتفع':level==='medium'?'يحتاج متابعة مبكرة':'مراقبة مبكرة',confidence=(fail24>=2||outage7>=2||Number(health.stuck_commands)>0)?'high':'medium';
  devicePredictiveAlerts.push({device_id:device.id,risk_score:risk,level,tone,label,confidence,primary_type:primary,signals,recommended_action:recommendedAction,recommended_label:recommendedLabel,metrics:{failures_24h:fail24,failures_7d:fail7,failures_previous_7d:failPrev7,outages_7d:outage7,outages_previous_7d:outagePrev7,downtime_7d_seconds:downtime7,availability_30d:hist.availability_pct??null,last_log_age_seconds:logAge},evaluated_at:new Date(nowMs).toISOString()});
 }
 devicePredictiveAlerts.sort((x,y)=>Number(y.risk_score)-Number(x.risk_score)||String(x.device_id).localeCompare(String(y.device_id)));
 const pmDeviceIds=(devices||[]).map(x=>x.id).filter(Boolean),pmDeviceFilter=pmDeviceIds.length?'&device_id=in.('+pmDeviceIds.map(enc).join(',')+')':'';
 const preventiveMaintenancePlans=pmDeviceIds.length?await rest(env,'attendance_preventive_maintenance_plans?select=*'+pmDeviceFilter+'&order=next_due_at.asc&limit=1000').catch(()=>[]):[],pmPlanIds=preventiveMaintenancePlans.map(x=>x.id).filter(Boolean);
 const preventiveMaintenanceRuns=pmPlanIds.length?await rest(env,'attendance_preventive_maintenance_runs?plan_id=in.('+pmPlanIds.map(enc).join(',')+')&select=*&order=created_at.desc&limit=2000').catch(()=>[]):[];
 const recurrenceCutoff=new Date(Date.now()-365*86400000).toISOString(),recentMaintenanceForRecurrence=await rest(env,'attendance_incident_maintenance?select=id,incident_id,root_cause_category,recurrence_prevented,updated_at&updated_at=gte.'+enc(recurrenceCutoff)+'&order=updated_at.desc&limit=3000').catch(()=>[]),recurrenceIncidentIds=[...new Set((recentMaintenanceForRecurrence||[]).map(x=>x.incident_id).filter(Boolean))];
 const recentIncidentRows=recurrenceIncidentIds.length?await rest(env,'attendance_incidents?id=in.('+recurrenceIncidentIds.map(enc).join(',')+')&select=id,device_id,branch_id,started_at&limit=3000').catch(()=>[]):[];
 const scopedRecentIncidents=(recentIncidentRows||[]).filter(x=>!branchId||txt(x.branch_id)===txt(branchId)),scopedIncidentIds=new Set(scopedRecentIncidents.map(x=>String(x.id))),scopedRecentMaintenance=(recentMaintenanceForRecurrence||[]).filter(x=>scopedIncidentIds.has(String(x.incident_id)));
 const preventiveMaintenanceAlerts=buildPreventiveMaintenanceAlerts(preventiveMaintenancePlans,devices,scopedRecentMaintenance,scopedRecentIncidents);
 const lifecycleCutoff=new Date(Date.now()-365*86400000).toISOString(),deviceAssets=pmDeviceIds.length?await rest(env,'attendance_device_assets?device_id=in.('+pmDeviceIds.map(enc).join(',')+')&select=*&order=updated_at.desc&limit=1000').catch(()=>[]):[],historicalIncidents=pmDeviceIds.length?await rest(env,'attendance_incidents?device_id=in.('+pmDeviceIds.map(enc).join(',')+')&started_at=gte.'+enc(lifecycleCutoff)+'&select=id,device_id,branch_id,started_at,resolution_seconds,status&order=started_at.desc&limit=3000').catch(()=>[]):[],historicalIncidentIds=historicalIncidents.map(x=>x.id).filter(Boolean),historicalMaintenance=historicalIncidentIds.length?await rest(env,'attendance_incident_maintenance?incident_id=in.('+historicalIncidentIds.map(enc).join(',')+')&select=incident_id,total_cost,updated_at&limit=3000').catch(()=>[]):[];
 const lifecycleBuilt=buildDeviceLifecycle(devices,deviceAssets,historicalIncidents,historicalMaintenance,preventiveMaintenanceRuns,deviceHealth),deviceLifecycle=lifecycleBuilt.rows,deviceLifecycleAlerts=lifecycleBuilt.alerts,combinedMaintenanceAlerts=[...preventiveMaintenanceAlerts,...deviceLifecycleAlerts];
 const rawNotifications=await reconcileAttendanceNotifications(env,devices,deviceHealth,devicePredictiveAlerts,combinedMaintenanceAlerts);
 const allEscalationRules=await rest(env,'attendance_notification_escalation_rules?select=*&order=created_at.asc').catch(()=>[]);
 const escalationRules=(allEscalationRules||[]).filter(r=>!r.branch_id||!branchId||txt(r.branch_id)===txt(branchId));
 const notifications=await applyAttendanceEscalation(env,rawNotifications,escalationRules),notificationCounts={new:0,seen:0,resolved:0,active:0,critical:0,level1:0,level2:0,level3:0};
 for(const n of notifications||[]){if(n.status==='new')notificationCounts.new+=1;else if(n.status==='seen')notificationCounts.seen+=1;else if(n.status==='resolved')notificationCounts.resolved+=1;if(n.active){notificationCounts.active+=1;if(n.severity==='critical')notificationCounts.critical+=1;if(Number(n.escalation_level)>=1)notificationCounts.level1+=1;if(Number(n.escalation_level)>=2)notificationCounts.level2+=1;if(Number(n.escalation_level)>=3)notificationCounts.level3+=1}}
 const notificationIds=(notifications||[]).map(x=>x.id).filter(Boolean),escalationEvents=notificationIds.length?await rest(env,'attendance_notification_escalation_events?notification_id=in.('+notificationIds.map(enc).join(',')+')&select=*&order=created_at.desc&limit=500').catch(()=>[]):[];
 const deliverySettings=await attendanceDeliverySettings(env),deliveries=await syncAttendanceEscalationDeliveries(env,notifications,escalationEvents,devices,branches,deliverySettings),deliveryCounts={ready:0,queued:0,sending:0,sent:0,delivered:0,read:0,failed:0,blocked:0,cancelled:0};
 for(const x of deliveries||[]){if(Object.prototype.hasOwnProperty.call(deliveryCounts,x.status))deliveryCounts[x.status]+=1}
 const sanitizedDeliveries=(deliveries||[]).map(x=>({...x,destination_masked:maskAttendanceDestination(x.channel,x.destination),destination:undefined}));
 const allIncidentPolicies=await rest(env,'attendance_incident_sla_policies?select=*&order=created_at.asc').catch(()=>[]),incidentPolicies=(allIncidentPolicies||[]).filter(p=>!p.branch_id||!branchId||txt(p.branch_id)===txt(branchId));
 const incidents=await reconcileAttendanceIncidents(env,notifications,incidentPolicies),incidentIds=incidents.map(x=>x.id).filter(Boolean),incidentEvents=incidentIds.length?await rest(env,'attendance_incident_events?incident_id=in.('+incidentIds.map(enc).join(',')+')&select=*&order=created_at.desc&limit=1000').catch(()=>[]):[];
 const incidentCounts={open:0,acknowledged:0,investigating:0,resolved:0,closed:0,breached:0,critical:0,unassigned:0};
 let responseSum=0,responseN=0,resolutionSum=0,resolutionN=0;const monthCutoff=Date.now()-30*86400000,deviceIncidentMap=new Map(),branchIncidentMap=new Map();
 for(const x of incidents||[]){
  if(Object.prototype.hasOwnProperty.call(incidentCounts,x.status))incidentCounts[x.status]+=1;
  const active=!['resolved','closed'].includes(x.status);if(active&&(x.response_breached||x.resolution_breached))incidentCounts.breached+=1;if(active&&x.severity==='critical')incidentCounts.critical+=1;if(active&&!x.owner_staff_id)incidentCounts.unassigned+=1;
  if(Number.isFinite(Number(x.response_seconds))){responseSum+=Number(x.response_seconds);responseN+=1}if(Number.isFinite(Number(x.resolution_seconds))){resolutionSum+=Number(x.resolution_seconds);resolutionN+=1}
  if(new Date(x.started_at).getTime()>=monthCutoff){if(x.device_id)deviceIncidentMap.set(String(x.device_id),(deviceIncidentMap.get(String(x.device_id))||0)+1);if(x.branch_id)branchIncidentMap.set(String(x.branch_id),(branchIncidentMap.get(String(x.branch_id))||0)+1)}
 }
 const incidentAnalytics={avg_response_seconds:responseN?Math.round(responseSum/responseN):null,avg_resolution_seconds:resolutionN?Math.round(resolutionSum/resolutionN):null,top_devices:[...deviceIncidentMap.entries()].map(([device_id,count])=>({device_id,count})).sort((a,b)=>b.count-a.count).slice(0,5),top_branches:[...branchIncidentMap.entries()].map(([branch_id,count])=>({branch_id,count})).sort((a,b)=>b.count-a.count).slice(0,5)};
 const incidentMaintenance=incidentIds.length?await rest(env,'attendance_incident_maintenance?incident_id=in.('+incidentIds.map(enc).join(',')+')&select=*&order=updated_at.desc&limit=1000').catch(()=>[]):[],maintenanceIds=incidentMaintenance.map(x=>x.id).filter(Boolean),maintenanceActions=maintenanceIds.length?await rest(env,'attendance_incident_maintenance_actions?maintenance_id=in.('+maintenanceIds.map(enc).join(',')+')&select=*&order=performed_at.desc&limit=2000').catch(()=>[]):[];
 const causeMap=new Map(),maintenanceDeviceCost=new Map();let maintenanceCost30d=0,maintenanceCount30d=0,maintenanceVerified=0,preventionCount=0;
 for(const m of incidentMaintenance||[]){const incident=incidents.find(x=>String(x.id)===String(m.incident_id)),updatedMs=new Date(m.updated_at||m.created_at||0).getTime(),cost=maintenanceNumber(m.total_cost);if(m.verified_at)maintenanceVerified+=1;if(m.recurrence_prevented)preventionCount+=1;if(updatedMs>=monthCutoff){maintenanceCost30d+=cost;maintenanceCount30d+=1;const key=txt(m.root_cause_category)||'unknown';causeMap.set(key,(causeMap.get(key)||0)+1);if(incident?.device_id)maintenanceDeviceCost.set(String(incident.device_id),(maintenanceDeviceCost.get(String(incident.device_id))||0)+cost)}}
 const maintenanceAnalytics={total_cost_30d:Number(maintenanceCost30d.toFixed(2)),maintenance_count_30d:maintenanceCount30d,verified_count:maintenanceVerified,prevention_count:preventionCount,top_causes:[...causeMap.entries()].map(([root_cause_category,count])=>({root_cause_category,count})).sort((a,b)=>b.count-a.count).slice(0,5),top_cost_devices:[...maintenanceDeviceCost.entries()].map(([device_id,total_cost])=>({device_id,total_cost:Number(total_cost.toFixed(2))})).sort((a,b)=>b.total_cost-a.total_cost).slice(0,5)};
 const pmNow=Date.now(),pmMonthCutoff=pmNow-30*86400000,preventiveMaintenanceAnalytics={active_plans:0,due_soon:0,overdue:0,completed_30d:0,skipped_30d:0,total_cost_30d:0,recurrence_alerts:preventiveMaintenanceAlerts.filter(x=>x.metadata?.type==='root_cause_recurrence').length};
 for(const p of preventiveMaintenancePlans||[]){if(p.active===false)continue;preventiveMaintenanceAnalytics.active_plans+=1;const due=new Date(p.next_due_at).getTime();if(Number.isFinite(due)){if(due<pmNow)preventiveMaintenanceAnalytics.overdue+=1;else if(due<=pmNow+Math.max(0,Number(p.lead_days)||0)*86400000)preventiveMaintenanceAnalytics.due_soon+=1}}
 for(const r of preventiveMaintenanceRuns||[]){const t=new Date(r.completed_at||r.created_at||0).getTime();if(t<pmMonthCutoff)continue;if(r.status==='completed'){preventiveMaintenanceAnalytics.completed_30d+=1;preventiveMaintenanceAnalytics.total_cost_30d+=maintenanceNumber(r.total_cost)}else if(r.status==='skipped')preventiveMaintenanceAnalytics.skipped_30d+=1}
 preventiveMaintenanceAnalytics.total_cost_30d=Number(preventiveMaintenanceAnalytics.total_cost_30d.toFixed(2));
 const assetIds=deviceAssets.map(x=>x.id).filter(Boolean),deviceAssetEvents=assetIds.length?await rest(env,'attendance_device_asset_events?asset_id=in.('+assetIds.map(enc).join(',')+')&select=*&order=event_date.desc&limit=2000').catch(()=>[]):[],deviceLifecycleAnalytics={registered_assets:deviceAssets.length,unregistered_devices:Math.max(0,(devices||[]).length-deviceAssets.length),warranty_expiring:0,warranty_expired:0,contract_expiring:0,replacement_review:0,replace_soon:0,total_purchase_value:0,total_replacement_value:0,maintenance_cost_365:0};
 for(const x of deviceLifecycle||[]){if(x.asset){deviceLifecycleAnalytics.total_purchase_value+=maintenanceNumber(x.asset.purchase_cost);deviceLifecycleAnalytics.total_replacement_value+=maintenanceNumber(x.asset.replacement_cost)}deviceLifecycleAnalytics.maintenance_cost_365+=maintenanceNumber(x.maintenance_cost_365);if(x.warranty_days_left!=null){if(x.warranty_days_left<0)deviceLifecycleAnalytics.warranty_expired+=1;else if(x.warranty_days_left<=30)deviceLifecycleAnalytics.warranty_expiring+=1}if(x.contract_days_left!=null&&x.contract_days_left>=0&&x.contract_days_left<=30)deviceLifecycleAnalytics.contract_expiring+=1;if(x.recommendation==='replacement_review')deviceLifecycleAnalytics.replacement_review+=1;if(x.recommendation==='replace_soon')deviceLifecycleAnalytics.replace_soon+=1}
 for(const key of ['total_purchase_value','total_replacement_value','maintenance_cost_365'])deviceLifecycleAnalytics[key]=Number(deviceLifecycleAnalytics[key].toFixed(2));
 const watchdog=(await rest(env,'attendance_watchdog_runs?select=*&order=started_at.desc&limit=1').catch(()=>[]))?.[0]||null;
 const biometricScope=branchId?'&branch_id=eq.'+enc(branchId):'';
 const biometricProfiles=await rest(env,'attendance_biometric_profiles?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=updated_at.desc&limit=2000').catch(()=>[]);
 const biometricDeviceStates=await rest(env,'attendance_biometric_device_states?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=updated_at.desc&limit=5000').catch(()=>[]);
 const biometricInventory=await rest(env,'attendance_biometric_inventory?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=updated_at.desc&limit=5000').catch(()=>[]);
 const pendingBiometricCommands=deviceIds.length?await rest(env,'attendance_device_commands?select=id,device_id,command_type,status,metadata,created_at'+inFilter+'&status=in.(queued,sent)&order=id.desc&limit=5000').catch(()=>[]):[];
 const inventoryCounts=new Map();
 for(const row of biometricInventory||[]){
  if(row.status!=='active')continue;
  const k=String(row.device_id),old=inventoryCounts.get(k)||{finger:0,face:0,total:0};
  if(row.biometric_type==='finger')old.finger+=1;else if(row.biometric_type==='face')old.face+=1;
  old.total+=1;inventoryCounts.set(k,old);
 }
 const pendingBiometricDeviceIds=new Set();
 for(const cmd of pendingBiometricCommands||[]){
  if(cmd?.metadata?.smart_sync===true||String(cmd.command_type||'').startsWith('biometric_import_'))pendingBiometricDeviceIds.add(String(cmd.device_id));
 }
 const biometricSyncNow=Date.now(),biometricSyncGraceMs=8*60*1000;
 const biometricSyncStates=(devices||[]).map(device=>{
  const did=String(device.id),meta=device.metadata||{},smart=meta.last_smart_sync||{},counts=inventoryCounts.get(did)||{finger:0,face:0,total:0};
  const smartReqMs=Date.parse(smart.requested_at||''),directReqMs=Date.parse(meta.last_biometric_import_requested_at||''),reqs=[smartReqMs,directReqMs].filter(Number.isFinite),latestRequestMs=reqs.length?Math.max(...reqs):null;
  const receivedMs=Date.parse(meta.last_biometric_import_received_at||''),reportedFp=Math.max(0,Number(device.reported_fp_count)||0),reportedFace=Math.max(0,Number(device.reported_face_count)||0),expectedTotal=reportedFp+reportedFace;
  const biometricsRequested=(smart.biometrics_included===true&&Number.isFinite(smartReqMs))||Number.isFinite(directReqMs),pending=pendingBiometricDeviceIds.has(did);
  const awaitingInventory=biometricsRequested&&expectedTotal>0&&Number.isFinite(latestRequestMs)&&(!Number.isFinite(receivedMs)||receivedMs<latestRequestMs),withinGrace=Number.isFinite(latestRequestMs)&&(biometricSyncNow-latestRequestMs)<=biometricSyncGraceMs;
  const syncing=pending||(awaitingInventory&&withinGrace),timedOut=awaitingInventory&&!pending&&!withinGrace,countsMatch=reportedFp===counts.finger&&reportedFace===counts.face;
  const status=syncing?'syncing':timedOut?'timeout':countsMatch?'complete':biometricsRequested?'incomplete':'idle';
  return {device_id:device.id,status,syncing,timed_out:timedOut,awaiting_inventory:awaitingInventory,pending,requested_at:Number.isFinite(latestRequestMs)?new Date(latestRequestMs).toISOString():null,received_at:Number.isFinite(receivedMs)?new Date(receivedMs).toISOString():null,reported_fp:reportedFp,reported_face:reportedFace,inventory_fp:counts.finger,inventory_face:counts.face,counts_match:countsMatch};
 });
 const biometricEnrollmentRequests=await rest(env,'attendance_biometric_enrollment_requests?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=requested_at.desc&limit=500').catch(()=>[]);
 const linkIdentityReviews=await rest(env,'attendance_link_identity_reviews?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=reviewed_at.desc&limit=2000').catch(()=>[]);
 const selfServiceBiometricRequests=await rest(env,'attendance_self_service_biometric_requests?select=*&data_environment=eq.'+enc(mode)+biometricScope+'&order=requested_at.desc&limit=2000').catch(()=>[]);
 const todayPolicyKey=saudiTodayKey();
 const effectivePolicies=(policies||[]).map(basePolicy=>{
  const active=[...(policyVersions||[])].filter(v=>String(v.branch_id)===String(basePolicy.branch_id)&&String(v.data_environment)===String(basePolicy.data_environment)&&String(v.effective_from)<=todayPolicyKey&&(!v.effective_to||String(v.effective_to)>=todayPolicyKey)).sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)))[0]||null;
  const snap=active?.policy_snapshot&&typeof active.policy_snapshot==='object'&&!Array.isArray(active.policy_snapshot)?active.policy_snapshot:null;
  return snap?{...basePolicy,...snap,id:basePolicy.id,branch_id:basePolicy.branch_id,data_environment:basePolicy.data_environment,policy_version_id:active.id,policy_effective_from:active.effective_from,policy_effective_to:active.effective_to||null}:basePolicy;
 });
 return {ok:true,devices,biometricProfiles,biometricDeviceStates,biometricInventory,biometricSyncStates,biometricEnrollmentRequests,linkIdentityReviews,selfServiceBiometricRequests,deviceHealth,deviceHealthHistory,devicePredictiveAlerts,healthEvents,clockChecks,notifications,notificationCounts,escalationRules,escalationEvents,deliverySettings,deliveries:sanitizedDeliveries,deliveryCounts,incidents,incidentCounts,incidentAnalytics,incidentPolicies,incidentEvents,incidentMaintenance,maintenanceActions,maintenanceAnalytics,preventiveMaintenancePlans,preventiveMaintenanceRuns,preventiveMaintenanceAlerts,preventiveMaintenanceAnalytics,deviceAssets,deviceAssetEvents,deviceLifecycle,deviceLifecycleAlerts,deviceLifecycleAnalytics,watchdog,deviceUsers,commands,deviceShiftTemplates,deleteRequests,calendarRules,policies:effectivePolicies,policyVersions,mobileDevices,links,logs,unlinkedGroups,unlinkedTotal,unlinkedTruncated:(unlinkedRows||[]).length>=5000,employees,shiftPeriods:scopedShiftPeriods,scheduleVersions:scopedScheduleVersions,users,branches,scope:{branch_id:branchId||null,all_branches:elevated(me),environment:mode},permissions:{view:true,manage_devices:canManageDevices(me),manage_links:canManageLinks(me),manage_employees:canManageEmployees(me),manage_biometrics:canManageBiometrics(me),manage_schedules:canManageSchedules(me),manage_policies:canManagePolicies(me),review_violations:canReviewViolations(me),close_month:canCloseMonth(me),reopen_month:canReopenMonth(me),delete_employees:canDeleteEmployees(me),reports:canReports(me)},adms:{host:'system.almaheralmasi.sa',port:443,https:true,domain:true,proxy:false,path:'/iclock'}};
}

async function attendanceReport(env,me,body){
 if(!canReports(me))throw Object.assign(new Error('لا توجد صلاحية لطباعة وعرض كشوف الحضور.'),{status:403});
 const branchId=requestedBranch(me,body),mode=accountMode(me),from=dateStart(body.from_date),to=dateEndExclusive(body.to_date||body.from_date);
 if(!from||!to)throw Object.assign(new Error('حدد تاريخ بداية ونهاية صحيحين.'),{status:400});
 const maxDays=93;if((to-from)/86400000>maxDays)throw Object.assign(new Error('الفترة القصوى للكشف الواحد 93 يومًا.'),{status:400});
 const queryFrom=new Date(from.getTime()-12*3600000),queryTo=new Date(to.getTime()+12*3600000);
 let path='attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at';
 path+='&data_environment=eq.'+enc(mode)+'&occurred_at=gte.'+enc(queryFrom.toISOString())+'&occurred_at=lt.'+enc(queryTo.toISOString());
 if(branchId)path+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))path+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 if(txt(body.device_id))path+='&device_id=eq.'+enc(body.device_id);
 path+='&order=occurred_at.asc&limit=10000';
 const rawLogs=await rest(env,path),reportDeviceIds=[...new Set((rawLogs||[]).map(x=>x.device_id).filter(Boolean))],reportDevices=reportDeviceIds.length?await rest(env,'attendance_devices?id=in.('+reportDeviceIds.map(enc).join(',')+')&select=id,metadata,timezone').catch(()=>[]):[],reportDeviceMap=new Map((reportDevices||[]).map(x=>[String(x.id),x])),clockCheckFrom=new Date(queryFrom.getTime()-86400000).toISOString(),clockCheckTo=new Date(queryTo.getTime()+86400000).toISOString(),reportClockChecks=reportDeviceIds.length?await rest(env,'attendance_device_clock_checks?device_id=in.('+reportDeviceIds.map(enc).join(',')+')&confirmed=eq.true&server_time=gte.'+enc(clockCheckFrom)+'&server_time=lte.'+enc(clockCheckTo)+'&select=device_id,server_time,drift_seconds,status,confirmed,source&order=server_time.asc&limit=5000').catch(()=>[]):[],clockCheckMap=new Map(),correctedDeviceIds=new Set();let clockCorrectedCount=0;
 for(const check of reportClockChecks||[]){const k=String(check.device_id),arr=clockCheckMap.get(k)||[];arr.push(check);clockCheckMap.set(k,arr)}
 const biometricLogs=(rawLogs||[]).map(row=>{
  const d=reportDeviceMap.get(String(row.device_id)),occurredMs=new Date(row.occurred_at).getTime(),receivedMs=new Date(row.received_at).getTime();if(!Number.isFinite(occurredMs)||!Number.isFinite(receivedMs))return row;
  const observed=Math.round((occurredMs-receivedMs)/1000),checks=clockCheckMap.get(String(row.device_id))||[],matched=checks.map(x=>({x,t:new Date(x.server_time).getTime(),drift:Number(x.drift_seconds)})).filter(y=>Number.isFinite(y.t)&&Number.isFinite(y.drift)&&Math.abs(receivedMs-y.t)<=86400000&&Math.abs(observed-y.drift)<=180).sort((a,b)=>Math.abs(receivedMs-a.t)-Math.abs(receivedMs-b.t))[0];
  let drift=matched?.drift;
  if(!Number.isFinite(drift)){const clock=d?.metadata?.clock_drift||{},current=Number(clock.drift_seconds),checkedMs=new Date(clock.checked_at||0).getTime();if(clock.confirmed===true&&Number.isFinite(current)&&Number.isFinite(checkedMs)&&Math.abs(receivedMs-checkedMs)<=86400000&&Math.abs(observed-current)<=180)drift=current}
  if(!Number.isFinite(drift)||Math.abs(drift)<=120)return row;
  const corrected=new Date(occurredMs-drift*1000).toISOString();clockCorrectedCount+=1;correctedDeviceIds.add(String(row.device_id));return {...row,original_occurred_at:row.occurred_at,occurred_at:corrected,clock_corrected:true,clock_drift_seconds_applied:drift,clock_correction_source:matched?'clock_check_history':'current_confirmed_drift'};
 }).filter(row=>{const t=new Date(row.occurred_at).getTime();return Number.isFinite(t)&&t>=from.getTime()&&t<to.getTime()});
 let mobilePath='attendance_mobile_events?select=id,attendance_employee_id,staff_user_id,branch_id,event_type,occurred_at,accuracy_m,distance_from_site_m,inside_geofence,source,metadata,data_environment&data_environment=eq.'+enc(mode)+'&occurred_at=gte.'+enc(from.toISOString())+'&occurred_at=lt.'+enc(to.toISOString());
 if(branchId)mobilePath+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))mobilePath+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 mobilePath+='&order=occurred_at.asc&limit=10000';
 const mobileRows=txt(body.device_id)?[]:await rest(env,mobilePath).catch(()=>[]);
 const employeeIds=[...new Set((mobileRows||[]).map(x=>x.attendance_employee_id).filter(Boolean))],mobileEmployees=employeeIds.length?await rest(env,'attendance_employees?id=in.('+employeeIds.map(enc).join(',')+')&select=id,name,employee_code').catch(()=>[]):[],mobileEmployeeMap=new Map((mobileEmployees||[]).map(x=>[String(x.id),x]));
 const mobileLogs=(mobileRows||[]).map(row=>({id:'mobile:'+row.id,device_id:null,serial_number:'MOBILE',branch_id:row.branch_id,device_pin:'MOBILE',attendance_employee_id:row.attendance_employee_id,staff_user_id:row.staff_user_id,employee_name:mobileEmployeeMap.get(String(row.attendance_employee_id))?.name||null,occurred_at:row.occurred_at,device_time_raw:row.occurred_at,status_code:row.event_type==='check_in'?0:1,verify_code:null,work_code:'mobile:'+row.event_type,data_environment:row.data_environment,received_at:row.occurred_at,attendance_source:'mobile',mobile_event_type:row.event_type,metadata:{...(row.metadata||{}),accuracy_m:row.accuracy_m,distance_from_site_m:row.distance_from_site_m,inside_geofence:row.inside_geofence}}));
 const logs=[...biometricLogs,...mobileLogs].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
 let rulePath='attendance_employee_calendar_rules?select=*&status=eq.active&data_environment=eq.'+enc(mode)+'&start_date=lte.'+enc(txt(body.to_date||body.from_date))+'&end_date=gte.'+enc(txt(body.from_date));
 if(branchId)rulePath+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))rulePath+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 rulePath+='&order=start_date.asc,created_at.asc&limit=5000';
 const calendarRules=await rest(env,rulePath);
 let decisionPath='attendance_violation_decisions?select=*&data_environment=eq.'+enc(mode)+'&work_date=gte.'+enc(txt(body.from_date))+'&work_date=lte.'+enc(txt(body.to_date||body.from_date));
 if(branchId)decisionPath+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))decisionPath+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 decisionPath+='&order=work_date.asc,updated_at.asc&limit=5000';
 const violationDecisions=await rest(env,decisionPath);
 let schedulePath='attendance_employee_schedule_versions?select=*&data_environment=eq.'+enc(mode)+'&effective_from=lte.'+enc(txt(body.to_date||body.from_date));
 if(branchId)schedulePath+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))schedulePath+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 schedulePath+='&order=attendance_employee_id.asc,effective_from.asc&limit=5000';
 const scheduleVersions=(await rest(env,schedulePath).catch(()=>[])).filter(v=>!v.effective_to||String(v.effective_to)>=txt(body.from_date));
 let monthClosure=null;
 const fromKey=txt(body.from_date),toKey=txt(body.to_date||body.from_date),period=monthStartKey(fromKey);
 if(branchId&&period&&fromKey===period&&toKey===monthEndKey(period)){
  monthClosure=(await rest(env,'attendance_month_closures?branch_id=eq.'+enc(branchId)+'&period_month=eq.'+enc(period)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 }
 return {ok:true,logs,calendar_rules:calendarRules,violation_decisions:violationDecisions,schedule_versions:scheduleVersions,month_closure:monthClosure,from_date:fromKey,to_date:toKey,environment:mode,branch_id:branchId||null,truncated:(Array.isArray(rawLogs)&&rawLogs.length>=10000)||(Array.isArray(mobileRows)&&mobileRows.length>=10000),clock_correction:{corrected_logs:clockCorrectedCount,device_ids:[...correctedDeviceIds],method:'confirmed_clock_history_matching_observed_drift'}};
}

async function saveDevice(env,me,body){
 if(!canManageDevices(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة أجهزة البصمة.'),{status:403});
 const id=txt(body.id),serial=txt(body.serial_number).toUpperCase(),name=txt(body.name),model=txt(body.model),branchId=elevated(me)?txt(body.branch_id):actorBranch(me),status=body.status==='disabled'?'disabled':'active',connection=['adms','agent','sdk','api'].includes(body.connection_mode)?body.connection_mode:'adms',requestedEnv=body.data_environment==='production'?'production':'training',systemMode=await runtimeMode(env);
 if(!serial||!name)throw Object.assign(new Error('اسم الجهاز والرقم التسلسلي مطلوبان.'),{status:400});if(requestedEnv==='production'&&systemMode!=='production')throw Object.assign(new Error('لا يمكن تحويل جهاز البصمة إلى Production بينما النظام في وضع التدريب.'),{status:409});
 let before=null;if(id){before=await scopedDevice(env,me,id);if(!before)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404})}
 const payload={serial_number:serial,name,model:model||null,branch_id:branchId||null,connection_mode:connection,status,data_environment:requestedEnv,timezone:'Asia/Riyadh',updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 let after;if(id)after=(await rest(env,'attendance_devices?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;else after=(await rest(env,'attendance_devices',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ جهاز البصمة.'),{status:500});await audit(env,me,id?'attendance_device_update':'attendance_device_create','attendance_device',after.id,after.branch_id,before,after,txt(body.reason)||'إدارة جهاز بصمة');return {ok:true,device:after};
}


const FINGER_SLOTS=Object.freeze({
 left_little:0,left_ring:1,left_middle:2,left_index:3,left_thumb:4,
 right_thumb:5,right_index:6,right_middle:7,right_ring:8,right_little:9
});
const SLOT_FINGERS=Object.freeze(Object.fromEntries(Object.entries(FINGER_SLOTS).map(([finger,slot])=>[String(slot),finger])));

function parseProtocolVersion(value){
 const m=txt(value).match(/(\d+)\.(\d+)\.(\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])]:null;
}
function protocolAtLeast(value,major,minor,patch){
 const v=parseProtocolVersion(value);if(!v)return false;
 return v[0]>major||(v[0]===major&&(v[1]>minor||(v[1]===minor&&v[2]>=patch)));
}
function templateFields(line,prefix){
 const raw=String(line||'').trim(),p=String(prefix||'').trim();
 if(!raw.toUpperCase().startsWith(p.toUpperCase()))return null;
 const rest=raw.slice(p.length).trim(),out={};
 for(const part of rest.split('\t')){
  const i=part.indexOf('=');if(i<=0)continue;
  const k=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim();
  if(k==='tmp'||k==='template'||k==='content'||k==='photo')continue;
  out[k]=v;
 }
 return out;
}
function parseBiometricTemplateLines(body,tableName){
 const table=txt(tableName).toUpperCase(),out=[];
 for(const raw of String(body||'').split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;
  let fields=null,type=null,slot=null;
  if(/^FP\s/i.test(line)){fields=templateFields(line,'FP');type='finger';slot=safeInt(fields?.fid??fields?.fingerid)}
  else if(/^FACE\s/i.test(line)){fields=templateFields(line,'FACE');type='face';slot=null}
  else if(/^BIODATA\s/i.test(line)){
   fields=templateFields(line,'BIODATA');const bioType=safeInt(fields?.type);
   if(bioType===1){type='finger';slot=safeInt(fields?.no)}
   else if(bioType===2||bioType===9){type='face';slot=null}
   else continue;
  }else if(table==='FINGERTMP'||table==='FP'){
   fields=templateFields('FP '+line,'FP');type='finger';slot=safeInt(fields?.fid??fields?.fingerid)
  }else if(table==='BIODATA'){
   fields=templateFields('BIODATA '+line,'BIODATA');const bioType=safeInt(fields?.type);
   if(bioType===1){type='finger';slot=safeInt(fields?.no)}
   else if(bioType===2||bioType===9){type='face';slot=null}
   else continue;
  }else continue;
  const pin=txt(fields?.pin),valid=safeInt(fields?.valid);
  if(!pin||valid===0)continue;
  if(type==='finger'&&(slot==null||slot<0||slot>9))continue;
  out.push({pin,biometric_type:type,slot_no:type==='finger'?slot:null,finger_code:type==='finger'?SLOT_FINGERS[String(slot)]||null:null,valid:valid??1,index_no:safeInt(fields?.index),major_ver:safeInt(fields?.majorver),minor_ver:safeInt(fields?.minorver),format:safeInt(fields?.format),source_table:table||(/^BIODATA\s/i.test(line)?'BIODATA':'OPERLOG')});
 }
 return out;
}
async function storeBiometricDiscovery(env,device,serial,body,tableName){
 const records=parseBiometricTemplateLines(body,tableName);if(!records.length)return {records:0,matched:0,unmatched:0};
 const links=await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=device_pin,attendance_employee_id,branch_id').catch(()=>[]);
 const linkGroups=new Map();
 for(const link of links||[]){const pin=txt(link.device_pin),a=linkGroups.get(pin)||[];a.push(link);linkGroups.set(pin,a)}
 const linkMap=new Map();
 for(const [pin,a] of linkGroups.entries()){
  const ids=[...new Set(a.map(x=>txt(x.attendance_employee_id)).filter(Boolean))];
  if(ids.length===1)linkMap.set(pin,a.find(x=>txt(x.attendance_employee_id)===ids[0])||a[0]);
 }
 const employeeIds=[...new Set(records.map(r=>linkMap.get(r.pin)?.attendance_employee_id).filter(Boolean))];
 const existing=employeeIds.length?await rest(env,'attendance_biometric_profiles?attendance_employee_id=in.('+employeeIds.map(enc).join(',')+')&data_environment=eq.'+enc(device.data_environment||'training')+'&select=*').catch(()=>[]):[];
 const existingMap=new Map((existing||[]).map(x=>[String(x.attendance_employee_id)+'|'+txt(x.biometric_key),x]));
 const now=new Date().toISOString(),rows=[],deviceRows=[],inventoryRows=[],seen=new Set(),inventorySeen=new Set();let matched=0,unmatched=0;
 for(const r of records){
  const key=r.biometric_type==='face'?'face':'finger:'+r.finger_code;
  if(!key||key==='finger:null'||!txt(r.pin))continue;
  const link=linkMap.get(r.pin)||null,inventoryKey=txt(r.pin)+'|'+key;
  if(!inventorySeen.has(inventoryKey)){
   inventorySeen.add(inventoryKey);
   inventoryRows.push({
    device_id:device.id,branch_id:link?.branch_id||device.branch_id||null,device_pin:r.pin,attendance_employee_id:link?.attendance_employee_id||null,
    biometric_type:r.biometric_type,biometric_key:key,finger_code:r.finger_code||null,slot_no:r.slot_no??null,status:'active',
    last_seen_at:now,last_result_code:0,data_environment:device.data_environment||'training',
    metadata:{source:'device_inventory',source_table:r.source_table||txt(tableName).toUpperCase()||null,template_valid:r.valid??1,template_index:r.index_no??null,major_ver:r.major_ver??null,minor_ver:r.minor_ver??null,format:r.format??null,raw_template_stored:false},
    created_at:now,updated_at:now
   });
  }
  if(!link?.attendance_employee_id){unmatched+=1;continue}
  const dedupe=String(link.attendance_employee_id)+'|'+key;if(seen.has(dedupe))continue;seen.add(dedupe);
  const old=existingMap.get(dedupe)||null;
  const metadata={...(old?.metadata||{}),source:'device_import',device_imported_at:now,source_table:r.source_table||txt(tableName).toUpperCase()||null,template_valid:r.valid??1,template_index:r.index_no??null,major_ver:r.major_ver??null,minor_ver:r.minor_ver??null,format:r.format??null,raw_template_stored:false};
  rows.push({
   attendance_employee_id:link.attendance_employee_id,branch_id:link.branch_id||device.branch_id||null,source_device_id:device.id,device_pin:r.pin,
   biometric_type:r.biometric_type,biometric_key:key,finger_code:r.finger_code||null,slot_no:r.slot_no??null,status:'active',
   version:Math.max(1,Number(old?.version||1)),last_enrolled_at:old?.last_enrolled_at||null,last_sync_at:now,last_result_code:0,
   data_environment:device.data_environment||'training',metadata,
   created_by:old?.created_by||'device_import',updated_by:'device:'+String(device.serial_number||device.id),created_at:old?.created_at||now,updated_at:now
  });
  deviceRows.push({
   device_id:device.id,attendance_employee_id:link.attendance_employee_id,branch_id:link.branch_id||device.branch_id||null,device_pin:r.pin,
   biometric_type:r.biometric_type,biometric_key:key,finger_code:r.finger_code||null,slot_no:r.slot_no??null,status:'active',
   last_seen_at:now,last_result_code:0,data_environment:device.data_environment||'training',
   metadata:{source:'device_import',source_table:r.source_table||txt(tableName).toUpperCase()||null,template_valid:r.valid??1,template_index:r.index_no??null,major_ver:r.major_ver??null,minor_ver:r.minor_ver??null,format:r.format??null,raw_template_stored:false},
   created_at:now,updated_at:now
  });
  matched+=1;
 }
 if(inventoryRows.length)await rest(env,'attendance_biometric_inventory?on_conflict=device_id%2Cdevice_pin%2Cbiometric_key%2Cdata_environment',{method:'POST',body:inventoryRows,prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
 if(rows.length)await rest(env,'attendance_biometric_profiles?on_conflict=attendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:rows,prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
 if(deviceRows.length)await rest(env,'attendance_biometric_device_states?on_conflict=device_id%2Cattendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:deviceRows,prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
 const meta={...(device.metadata||{}),last_biometric_import_received_at:now,last_biometric_import_records:records.length,last_biometric_inventory_count:inventoryRows.length,last_biometric_import_matched:matched,last_biometric_import_unmatched:unmatched,raw_biometric_templates_stored:false};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});device.metadata=meta;
 const systemActor={id:'device:'+String(device.id),name:'جهاز البصمة',role:'system',permissions:{}};
 await audit(env,systemActor,'attendance_biometrics_discovered','attendance_device',device.id,device.branch_id,null,{serial_number:serial,records:records.length,inventory:inventoryRows.length,matched,unmatched,source_table:txt(tableName).toUpperCase(),raw_template_stored:false},'استيراد جرد البصمات الموجودة على الجهاز').catch(()=>{});
 return {records:records.length,inventory:inventoryRows.length,matched,unmatched};
}

async function pendingBiometricImports(env,deviceId){
 return await rest(env,'attendance_device_commands?device_id=eq.'+enc(deviceId)+'&command_type=in.(biometric_import_fingerprint,biometric_import_face)&status=in.(queued,sent)&select=id,entity_id,metadata,status&limit=500').catch(()=>[]);
}
function pendingBiometricCovers(pending,employeeId,pin){
 const eid=txt(employeeId),p=txt(pin);
 return (pending||[]).some(cmd=>{
  const meta=cmd?.metadata||{},strategy=txt(meta.strategy);
  if(strategy==='biodata_all')return true;
  if(eid&&(txt(cmd.entity_id)===eid||txt(meta.attendance_employee_id)===eid))return true;
  if(p&&txt(meta.pin)===p)return true;
  return false;
 });
}
async function biometricImportCandidates(env,device,employeeId){
 let linkPath='attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=device_pin,attendance_employee_id,branch_id';
 if(txt(employeeId))linkPath+='&attendance_employee_id=eq.'+enc(employeeId);
 const links=await rest(env,linkPath).catch(()=>[]);
 if(txt(employeeId))return [...new Map((links||[]).filter(x=>txt(x.device_pin)&&x.attendance_employee_id).map(x=>[txt(x.device_pin),x])).values()];
 const users=await rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&select=device_pin,name&limit=5000').catch(()=>[]);
 const byPin=new Map((users||[]).filter(x=>txt(x.device_pin)).map(x=>[txt(x.device_pin),{device_pin:txt(x.device_pin),attendance_employee_id:null,branch_id:device.branch_id||null,device_user_name:txt(x.name)||null}]));
 for(const link of links||[]){if(txt(link.device_pin))byPin.set(txt(link.device_pin),{...byPin.get(txt(link.device_pin)),...link})}
 return [...byPin.values()];
}
async function queueLegacyInventoryAfterUsers(env,device,sourceMeta,createdBy){
 if(protocolAtLeast(device.push_version,2,2,14))return {queued:0,pins:0};
 const candidates=await biometricImportCandidates(env,device,null),pending=await pendingBiometricImports(env,device.id),commands=[];
 for(const row of candidates){
  const pin=safeDeviceText(row.device_pin,24);if(!pin||pendingBiometricCovers(pending,row.attendance_employee_id,pin))continue;
  commands.push({type:'biometric_import_fingerprint',command:'DATA QUERY FINGERTMP PIN='+pin,entity_type:row.attendance_employee_id?'attendance_employee':'attendance_device_pin',entity_id:row.attendance_employee_id||pin,metadata:{...(sourceMeta||{}),stage:'biometrics',pin,attendance_employee_id:row.attendance_employee_id||null,biometric_type:'finger',strategy:'legacy_fingertmp',inventory_only:!row.attendance_employee_id}});
 }
 if(!commands.length)return {queued:0,pins:candidates.length};
 const rows=commands.map(x=>({device_id:device.id,command_type:x.type,command_text:x.command,operation_group_id:null,entity_type:x.entity_type||null,entity_id:x.entity_id||null,metadata:x.metadata||{},created_by:createdBy||'system:biometric-inventory'}));
 const created=await rest(env,'attendance_device_commands',{method:'POST',body:rows,prefer:'return=representation'}).catch(()=>[]);
 return {queued:created?.length||0,pins:candidates.length};
}

async function importDeviceBiometrics(env,me,body){
 if(!canManageBiometrics(me))throw Object.assign(new Error('لا توجد صلاحية مستقلة لاستيراد البصمات.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(device.status!=='active')throw Object.assign(new Error('جهاز البصمة موقوف.'),{status:409});
 const employeeId=txt(body.attendance_employee_id),pending=await pendingBiometricImports(env,device.id),modern=protocolAtLeast(device.push_version,2,2,14);
 let candidates=await biometricImportCandidates(env,device,employeeId);
 if(employeeId&&!candidates.length)throw Object.assign(new Error('الموظف غير مربوط بهذا الجهاز أو لا يوجد له PIN صالح.'),{status:400});
 const batch='bio-import-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),commands=[];
 if(modern){
  if(employeeId&&candidates.every(x=>pendingBiometricCovers(pending,x.attendance_employee_id,x.device_pin)))return {ok:true,queued:false,already_pending:true,commands:0,linked_pins:candidates.length,message:'يوجد طلب قراءة بصمات لهذا الموظف قيد التنفيذ بالفعل.'};
  if(!employeeId&&pending.some(x=>txt(x?.metadata?.strategy)==='biodata_all'))return {ok:true,queued:false,already_pending:true,commands:0,linked_pins:candidates.filter(x=>x.attendance_employee_id).length,message:'يوجد استيراد بصمات شامل لهذا الجهاز قيد التنفيذ بالفعل.'};
  if(employeeId){
   for(const row of candidates){
    const pin=safeDeviceText(row.device_pin,24),metaBase={batch,pin,attendance_employee_id:row.attendance_employee_id,strategy:'biodata_pin'};
    commands.push({type:'biometric_import_fingerprint',command:'DATA QUERY BIODATA Type=1\tPIN='+pin,entity_type:'attendance_employee',entity_id:row.attendance_employee_id,metadata:{...metaBase,biometric_type:'finger'}});
    commands.push({type:'biometric_import_face',command:'DATA QUERY BIODATA Type=2\tPIN='+pin,entity_type:'attendance_employee',entity_id:row.attendance_employee_id,metadata:{...metaBase,biometric_type:'face'}});
    commands.push({type:'biometric_import_face',command:'DATA QUERY BIODATA Type=9\tPIN='+pin,entity_type:'attendance_employee',entity_id:row.attendance_employee_id,metadata:{...metaBase,biometric_type:'visible_face'}});
   }
  }else{
   commands.push({type:'biometric_import_fingerprint',command:'DATA QUERY BIODATA Type=1',metadata:{batch,biometric_type:'finger',strategy:'biodata_all'}});
   commands.push({type:'biometric_import_face',command:'DATA QUERY BIODATA Type=2',metadata:{batch,biometric_type:'face',strategy:'biodata_all'}});
   commands.push({type:'biometric_import_face',command:'DATA QUERY BIODATA Type=9',metadata:{batch,biometric_type:'visible_face',strategy:'biodata_all'}});
  }
 }else{
  candidates=candidates.filter(x=>!pendingBiometricCovers(pending,x.attendance_employee_id,x.device_pin));
  for(const row of candidates){
   const pin=safeDeviceText(row.device_pin,24);
   commands.push({type:'biometric_import_fingerprint',command:'DATA QUERY FINGERTMP PIN='+pin,entity_type:row.attendance_employee_id?'attendance_employee':'attendance_device_pin',entity_id:row.attendance_employee_id||pin,metadata:{batch,pin,attendance_employee_id:row.attendance_employee_id||null,biometric_type:'finger',strategy:'legacy_fingertmp',inventory_only:!row.attendance_employee_id}});
  }
  if(!commands.length&&!employeeId){
   const pendingUsers=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.sync_users&status=in.(queued,sent)&select=id&limit=1').catch(()=>[]);
   if(pendingUsers?.length)return {ok:true,queued:false,already_pending:true,commands:0,linked_pins:0,message:'يتم الآن سحب موظفي الجهاز أولًا، وبعد وصول الـPINs سيبدأ استيراد البصمات تلقائيًا.'};
   const staged=await queueCommands(env,device,me,[{type:'sync_users',command:'DATA QUERY USERINFO',metadata:{biometric_inventory_after_users:true,biometric_import_batch:batch,stage:'users_before_biometrics',requested_at:new Date().toISOString()}}]);
   return {ok:true,queued:true,batch,strategy:'legacy_userinfo_then_fingertmp',commands:staged?.length||0,linked_pins:0,message:'بدأ سحب موظفي الجهاز أولًا. بعد وصول الـPINs سيستورد النظام البصمات الموجودة تلقائيًا حتى لو لم تكن مرتبطة بموظفين.'};
  }
  if(!commands.length)return {ok:true,queued:false,already_pending:true,commands:0,linked_pins:0,message:'طلبات قراءة البصمات المطلوبة قيد التنفيذ بالفعل.'};
 }
 const queued=await queueCommands(env,device,me,commands);
 const now=new Date().toISOString(),linkedCount=candidates.filter(x=>x.attendance_employee_id).length,meta={...(device.metadata||{}),last_biometric_import_requested_at:now,last_biometric_import_batch:batch,last_biometric_import_strategy:modern?'biodata':'legacy_fingertmp',last_biometric_import_command_count:commands.length,last_biometric_import_candidate_pins:candidates.length,raw_biometric_templates_stored:false};
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:{metadata:meta,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,'attendance_biometric_import_requested','attendance_device',device.id,device.branch_id,null,{batch,strategy:modern?'biodata':'legacy_fingertmp',commands:commands.length,candidate_pins:candidates.length,linked_pins:linkedCount,employee_id:employeeId||null,inventory_without_links:!employeeId,duplicate_guard:true},'طلب جرد واستيراد البصمات الموجودة على الجهاز');
 return {ok:true,queued:true,batch,strategy:modern?'biodata':'legacy_fingertmp',commands:queued?.length||0,candidate_pins:candidates.length,linked_pins:linkedCount,message:'تم بدء قراءة بصمات '+candidates.length+' PIN من الجهاز. سيتم الاحتفاظ بالجرد حتى للـPIN غير المربوط، بدون حفظ القالب الخام.'};
}

async function autoReconcileBiometrics(env,me,body){
 if(!canManageBiometrics(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة ومطابقة البصمات.'),{status:403});
 const mode=accountMode(me),branchId=requestedBranch(me,body),targetDeviceId=txt(body.device_id),maxActions=Math.max(1,Math.min(200,Number(body.max_actions||120)));
 let devices=[];
 if(targetDeviceId){
  const device=await scopedDevice(env,me,targetDeviceId);if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
  if(device.status==='active'&&txt(device.data_environment)===mode)devices=[device];
 }else{
  let devicePath='attendance_devices?status=eq.active&data_environment=eq.'+enc(mode)+'&select=*';
  if(branchId)devicePath+='&branch_id=eq.'+enc(branchId);
  devicePath+='&order=name.asc&limit=500';
  devices=await rest(env,devicePath).catch(()=>[]);
 }
 const summary={devices_reviewed:devices.length,device_scans:0,employee_scans:0,queued_commands:0,already_pending:0,count_gaps:0,missing_employees:0,unsafe_requires_review:0,unlinked_pins:0,duplicate_pins:0,link_mismatches:0,truncated:false,mode};
 let actions=0;
 for(const device of devices){
  const [links,states,inventory,users]=await Promise.all([
   rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=id,device_pin,attendance_employee_id,branch_id').catch(()=>[]),
   rest(env,'attendance_biometric_device_states?device_id=eq.'+enc(device.id)+'&data_environment=eq.'+enc(mode)+'&status=eq.active&select=id,device_pin,attendance_employee_id,biometric_type,biometric_key').catch(()=>[]),
   rest(env,'attendance_biometric_inventory?device_id=eq.'+enc(device.id)+'&data_environment=eq.'+enc(mode)+'&status=eq.active&select=id,device_pin,attendance_employee_id,biometric_type,biometric_key').catch(()=>[]),
   rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&select=device_pin,name&limit=5000').catch(()=>[])
  ]);
  const linkByPin=new Map(),stateEmployees=new Set();
  for(const link of links||[]){
   const pin=txt(link.device_pin),arr=linkByPin.get(pin)||[];arr.push(link);linkByPin.set(pin,arr);
  }
  for(const state of states||[])stateEmployees.add(txt(state.attendance_employee_id));
  for(const [pin,pinLinks] of linkByPin.entries()){
   const employeeIds=[...new Set(pinLinks.map(x=>txt(x.attendance_employee_id)).filter(Boolean))];
   if(employeeIds.length>1){summary.duplicate_pins+=1;summary.unsafe_requires_review+=1}
  }
  for(const user of users||[]){
   const pinLinks=linkByPin.get(txt(user.device_pin))||[];
   if(!pinLinks.some(x=>txt(x.attendance_employee_id))){summary.unlinked_pins+=1;summary.unsafe_requires_review+=1}
  }
  for(const state of states||[]){
   const pinLinks=linkByPin.get(txt(state.device_pin))||[];
   if(!pinLinks.some(x=>txt(x.attendance_employee_id)===txt(state.attendance_employee_id))){summary.link_mismatches+=1;summary.unsafe_requires_review+=1}
  }
  const linkedEmployees=[...new Map((links||[]).filter(x=>x.attendance_employee_id&&txt(x.device_pin)).map(x=>[txt(x.attendance_employee_id),x])).values()];
  const missing=linkedEmployees.filter(x=>!stateEmployees.has(txt(x.attendance_employee_id)));
  summary.missing_employees+=missing.length;
  const knownFp=(inventory||[]).filter(x=>x.biometric_type==='finger').length,knownFace=(inventory||[]).filter(x=>x.biometric_type==='face').length;
  const reportedFp=Number(device.reported_fp_count),reportedFace=Number(device.reported_face_count);
  const fpGap=Number.isFinite(reportedFp)&&reportedFp!==knownFp,faceGap=Number.isFinite(reportedFace)&&reportedFace>0&&reportedFace!==knownFace;
  if(fpGap||faceGap){
   summary.count_gaps+=1;
   if(actions>=maxActions){summary.truncated=true;continue}
   const out=await importDeviceBiometrics(env,me,{device_id:device.id}).catch(e=>({ok:false,error:e.message}));
   if(out?.queued){summary.device_scans+=1;summary.queued_commands+=Number(out.commands||0);actions+=1}
   else if(out?.already_pending)summary.already_pending+=1;
   continue;
  }
  for(const link of missing){
   if(actions>=maxActions){summary.truncated=true;break}
   const out=await importDeviceBiometrics(env,me,{device_id:device.id,attendance_employee_id:link.attendance_employee_id}).catch(e=>({ok:false,error:e.message}));
   if(out?.queued){summary.employee_scans+=1;summary.queued_commands+=Number(out.commands||0);actions+=1}
   else if(out?.already_pending)summary.already_pending+=1;
  }
 }
 await audit(env,me,'attendance_biometric_safe_auto_reconcile','attendance_biometric_reconciliation',targetDeviceId||branchId||mode,branchId||null,null,summary,'Safe Auto-Reconcile: إعادة قراءة فقط بدون تعديل روابط أو حذف قوالب');
 const started=summary.device_scans+summary.employee_scans;
 return {ok:true,...summary,message:started?('تم بدء '+started+' إجراء مطابقة آمن. الحالات المتعارضة لم يتم تعديلها تلقائيًا.'):(summary.already_pending?'طلبات المطابقة الآمنة المطلوبة قيد التنفيذ بالفعل.':'لا توجد حالات آمنة تحتاج إعادة فحص حاليًا.')};
}

async function biometricProfileForActor(env,me,id){
 const rows=await rest(env,'attendance_biometric_profiles?id=eq.'+enc(id)+'&select=*&limit=1').catch(()=>[]),profile=rows?.[0]||null;
 if(!profile)return null;
 if(!elevated(me)&&txt(profile.branch_id)!==actorBranch(me))return null;
 return profile;
}
function biometricDeleteCommand(device,profile){
 const pin=safeDeviceText(profile.device_pin,24);if(!pin)throw Object.assign(new Error('PIN البصمة غير موجود في السجل.'),{status:400});
 const modern=protocolAtLeast(device.push_version,2,2,14);
 if(profile.biometric_type==='face')return modern?'DATA DELETE biodata Type=2\tPin='+pin:'DELETE FACE PIN='+pin;
 const slot=safeInt(profile.slot_no);if(slot==null||slot<0||slot>9)throw Object.assign(new Error('رقم الإصبع غير صالح.'),{status:400});
 return modern?'DATA DELETE biodata Type=1\tPin='+pin+'\tNo='+slot:'DELETE FINGERTMP PIN='+pin+'\tFID='+slot;
}
async function requestBiometricDelete(env,me,body){
 if(!canManageBiometrics(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة البصمات البيومترية.'),{status:403});
 const profile=await biometricProfileForActor(env,me,txt(body.profile_id));if(!profile)throw Object.assign(new Error('البصمة غير موجودة أو خارج نطاق الفرع.'),{status:404});
 if(profile.status!=='active')throw Object.assign(new Error('البصمة ليست نشطة حاليًا.'),{status:409});
 const reason=txt(body.reason);if(!reason)throw Object.assign(new Error('سبب حذف البصمة مطلوب.'),{status:400});
 const device=await scopedDevice(env,me,profile.source_device_id);if(!device)throw Object.assign(new Error('الجهاز المصدر غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(device.status!=='active')throw Object.assign(new Error('الجهاز موقوف ولا يمكن حذف البصمة منه الآن.'),{status:409});
 const pending=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.biometric_delete&status=in.(queued,sent)&entity_id=eq.'+enc(profile.id)+'&select=id&limit=1').catch(()=>[]);
 if(pending?.length)throw Object.assign(new Error('يوجد طلب حذف لهذه البصمة قيد التنفيذ بالفعل.'),{status:409});
 const queued=await queueCommands(env,device,me,[{type:'biometric_delete',command:biometricDeleteCommand(device,profile),entity_type:'attendance_biometric_profile',entity_id:profile.id,metadata:{profile_id:profile.id,attendance_employee_id:profile.attendance_employee_id,device_pin:profile.device_pin,biometric_type:profile.biometric_type,biometric_key:profile.biometric_key,finger_code:profile.finger_code,slot_no:profile.slot_no,reason}}]);
 const cmd=queued?.[0]||null;if(!cmd)throw Object.assign(new Error('تعذر إنشاء أمر حذف البصمة.'),{status:500});
 await audit(env,me,'attendance_biometric_delete_requested','attendance_biometric_profile',profile.id,profile.branch_id,profile,{...profile,delete_command_id:cmd.id,delete_reason:reason},reason);
 return {ok:true,queued:true,command_id:cmd.id,message:'تم إرسال طلب حذف البصمة المحددة من الجهاز.'};
}
async function finalizeBiometricDelete(env,cmd,rc,now){
 const profileId=txt(cmd?.metadata?.profile_id||cmd?.entity_id);if(!profileId)return;
 const rows=await rest(env,'attendance_biometric_profiles?id=eq.'+enc(profileId)+'&select=*&limit=1').catch(()=>[]),before=rows?.[0]||null;if(!before)return;
 const systemActor={id:'device:'+String(cmd.device_id||''),name:'جهاز البصمة',role:'system',permissions:{}},completed=now||new Date().toISOString(),deviceId=txt(cmd.device_id);
 if(rc!==0){
  await rest(env,'attendance_biometric_profiles?id=eq.'+enc(profileId),{method:'PATCH',body:{last_result_code:rc,updated_at:completed},prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_biometric_device_states?device_id=eq.'+enc(deviceId)+'&attendance_employee_id=eq.'+enc(before.attendance_employee_id)+'&biometric_key=eq.'+enc(before.biometric_key)+'&data_environment=eq.'+enc(before.data_environment),{method:'PATCH',body:{last_result_code:rc,updated_at:completed},prefer:'return=minimal'}).catch(()=>{});
  await audit(env,systemActor,'attendance_biometric_delete_failed','attendance_biometric_profile',profileId,before.branch_id,before,{...before,last_result_code:rc},txt(cmd?.metadata?.reason)||'فشل حذف البصمة من الجهاز').catch(()=>{});
  return;
 }
 const stateMeta={deleted_from_device_at:completed,delete_command_id:cmd.id,delete_reason:txt(cmd?.metadata?.reason)||null,raw_template_stored:false};
 await rest(env,'attendance_biometric_device_states?device_id=eq.'+enc(deviceId)+'&attendance_employee_id=eq.'+enc(before.attendance_employee_id)+'&biometric_key=eq.'+enc(before.biometric_key)+'&data_environment=eq.'+enc(before.data_environment),{method:'PATCH',body:{status:'disabled',last_result_code:0,last_seen_at:completed,metadata:stateMeta,updated_at:completed},prefer:'return=minimal'}).catch(()=>{});
 const remaining=await rest(env,'attendance_biometric_device_states?attendance_employee_id=eq.'+enc(before.attendance_employee_id)+'&biometric_key=eq.'+enc(before.biometric_key)+'&data_environment=eq.'+enc(before.data_environment)+'&status=eq.active&select=device_id,device_pin,last_seen_at&order=last_seen_at.desc&limit=1').catch(()=>[]);
 const keep=remaining?.[0]||null,metadata={...(before.metadata||{}),deleted_from_device_at:completed,delete_command_id:cmd.id,delete_reason:txt(cmd?.metadata?.reason)||null,active_on_other_device:!!keep};
 const patch={status:keep?'active':'disabled',source_device_id:keep?.device_id||before.source_device_id,device_pin:keep?.device_pin||before.device_pin,last_result_code:0,last_sync_at:completed,metadata,updated_by:'device',updated_at:completed};
 const after=(await rest(env,'attendance_biometric_profiles?id=eq.'+enc(profileId),{method:'PATCH',body:patch,prefer:'return=representation'}).catch(()=>[]))?.[0]||{...before,...patch};
 await audit(env,systemActor,'attendance_biometric_deleted','attendance_biometric_profile',profileId,before.branch_id,before,after,txt(cmd?.metadata?.reason)||'حذف بصمة من الجهاز').catch(()=>{});
}
async function setBiometricPreference(env,me,body){
 if(!canManageBiometrics(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة البصمات البيومترية.'),{status:403});
 const profile=await biometricProfileForActor(env,me,txt(body.profile_id));if(!profile)throw Object.assign(new Error('البصمة غير موجودة أو خارج نطاق الفرع.'),{status:404});
 const preference=['primary','backup','normal'].includes(txt(body.preference))?txt(body.preference):'normal',now=new Date().toISOString();
 if(preference==='primary'){
  const peers=await rest(env,'attendance_biometric_profiles?attendance_employee_id=eq.'+enc(profile.attendance_employee_id)+'&biometric_type=eq.'+enc(profile.biometric_type)+'&data_environment=eq.'+enc(profile.data_environment)+'&status=eq.active&select=*').catch(()=>[]);
  for(const peer of peers||[]){
   if(String(peer.id)===String(profile.id))continue;
   if(txt(peer?.metadata?.preference)==='primary')await rest(env,'attendance_biometric_profiles?id=eq.'+enc(peer.id),{method:'PATCH',body:{metadata:{...(peer.metadata||{}),preference:'normal'},updated_by:actorId(me)||actorName(me)||null,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  }
 }
 const metadata={...(profile.metadata||{}),preference};
 const after=(await rest(env,'attendance_biometric_profiles?id=eq.'+enc(profile.id),{method:'PATCH',body:{metadata,updated_by:actorId(me)||actorName(me)||null,updated_at:now},prefer:'return=representation'}))?.[0]||{...profile,metadata};
 await audit(env,me,'attendance_biometric_preference_update','attendance_biometric_profile',profile.id,profile.branch_id,profile,after,'تحديد أولوية البصمة: '+preference);
 return {ok:true,profile:after};
}
function biometricSpec(body){
 const type=txt(body.biometric_type)==='face'?'face':'finger';
 if(type==='face')return {biometric_type:'face',biometric_key:'face',finger_code:null,slot_no:null};
 const finger=txt(body.finger_code);
 if(!Object.prototype.hasOwnProperty.call(FINGER_SLOTS,finger))throw Object.assign(new Error('حدد الإصبع المطلوب تسجيله.'),{status:400});
 return {biometric_type:'finger',biometric_key:'finger:'+finger,finger_code:finger,slot_no:FINGER_SLOTS[finger]};
}
function biometricEnrollCommand(pin,spec,retry,overwrite){
 const p=safeDeviceText(pin,24);
 if(!p)throw Object.assign(new Error('PIN الموظف داخل جهاز البصمة مطلوب.'),{status:400});
 if(spec.biometric_type==='face')return 'ENROLL_BIO TYPE=2\tPIN='+p+'\tCardNo=\tRETRY='+retry+'\tOVERWRITE='+(overwrite?1:0);
 return 'ENROLL_FP PIN='+p+'\tFID='+spec.slot_no+'\tRETRY='+retry+'\tOVERWRITE='+(overwrite?1:2);
}
async function requestBiometricEnrollment(env,me,body){
 if(!canManageBiometrics(me))throw Object.assign(new Error('لا توجد صلاحية مستقلة لإدارة البصمات البيومترية.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));
 if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const device=await scopedDevice(env,me,txt(body.device_id));
 if(!device)throw Object.assign(new Error('جهاز البصمة غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(device.status!=='active')throw Object.assign(new Error('جهاز البصمة موقوف ولا يمكن بدء التسجيل عليه.'),{status:409});
 if(txt(device.data_environment)!==txt(employee.data_environment))throw Object.assign(new Error('بيئة الموظف والجهاز غير متطابقة.'),{status:409});
 const links=await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id)+'&device_id=eq.'+enc(device.id)+'&active=eq.true&select=*&limit=1').catch(()=>[]);
 const link=links?.[0]||null;
 if(!link)throw Object.assign(new Error('اربط الموظف بهذا الجهاز أولًا وحدد PIN الجهاز قبل تسجيل البصمة.'),{status:409});
 const spec=biometricSpec(body),mode=employee.data_environment==='production'?'production':'training';
 const retry=Math.max(1,Math.min(9,safeInt(body.retry_count)??3)),overwrite=body.overwrite_existing!==false,reason=txt(body.reason);
 const existing=(await rest(env,'attendance_biometric_profiles?attendance_employee_id=eq.'+enc(employee.id)+'&biometric_key=eq.'+enc(spec.biometric_key)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(existing&&!overwrite)throw Object.assign(new Error('هذه البصمة مسجلة بالفعل. اختر الاستبدال لتسجيلها من جديد.'),{status:409});
 if(existing&&!reason)throw Object.assign(new Error('اكتب سبب تغيير أو إعادة تسجيل البصمة الحالية.'),{status:400});
 const pending=(await rest(env,'attendance_biometric_enrollment_requests?attendance_employee_id=eq.'+enc(employee.id)+'&device_id=eq.'+enc(device.id)+'&biometric_key=eq.'+enc(spec.biometric_key)+'&data_environment=eq.'+enc(mode)+'&status=in.(queued,sent)&select=id,status&limit=1').catch(()=>[]))?.[0]||null;
 if(pending)throw Object.assign(new Error('يوجد طلب تسجيل لنفس البصمة على هذا الجهاز قيد التنفيذ بالفعل.'),{status:409});
 const now=new Date().toISOString(),requestRows=await rest(env,'attendance_biometric_enrollment_requests',{method:'POST',body:{
  attendance_employee_id:employee.id,branch_id:employee.branch_id||device.branch_id||null,device_id:device.id,device_pin:txt(link.device_pin),
  ...spec,overwrite_existing:overwrite,retry_count:retry,status:'queued',reason:reason||null,requested_by:actorId(me)||actorName(me)||null,
  data_environment:mode,metadata:{protocol:'zkteco_adms',raw_template_stored:false},requested_at:now,created_at:now,updated_at:now
 },prefer:'return=representation'});
 const requestRow=requestRows?.[0]||null;
 if(!requestRow)throw Object.assign(new Error('تعذر إنشاء طلب تسجيل البصمة.'),{status:500});
 try{
  const command=biometricEnrollCommand(link.device_pin,spec,retry,overwrite);
  const queued=await queueCommands(env,device,me,[{type:'biometric_enroll',command,entity_type:'attendance_employee',entity_id:employee.id,metadata:{biometric_request_id:requestRow.id,attendance_employee_id:employee.id,device_pin:txt(link.device_pin),biometric_type:spec.biometric_type,biometric_key:spec.biometric_key,finger_code:spec.finger_code,slot_no:spec.slot_no,overwrite_existing:overwrite}}]);
  const cmd=queued?.[0]||null;
  if(!cmd)throw new Error('لم يتم إنشاء أمر التسجيل على الجهاز.');
  const updated=(await rest(env,'attendance_biometric_enrollment_requests?id=eq.'+enc(requestRow.id),{method:'PATCH',body:{command_id:cmd.id,updated_at:new Date().toISOString()},prefer:'return=representation'}))?.[0]||requestRow;
  await audit(env,me,'attendance_biometric_enrollment_requested','attendance_biometric_enrollment',requestRow.id,employee.branch_id,existing,{...updated,employee_name:employee.name,device_name:device.name},reason||'تسجيل بصمة بيومترية');
  return {ok:true,queued:true,request:updated,command_id:cmd.id,message:spec.biometric_type==='face'?'تم إرسال طلب تسجيل الوجه إلى الجهاز.':'تم إرسال طلب تسجيل الإصبع إلى الجهاز.'};
 }catch(e){
  await rest(env,'attendance_biometric_enrollment_requests?id=eq.'+enc(requestRow.id),{method:'PATCH',body:{status:'failed',completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:{...(requestRow.metadata||{}),queue_error:txt(e.message)}},prefer:'return=minimal'}).catch(()=>{});
  throw e;
 }
}
async function finalizeBiometricEnrollment(env,cmd,rc,now){
 if(!cmd?.id)return;
 const rows=await rest(env,'attendance_biometric_enrollment_requests?command_id=eq.'+enc(cmd.id)+'&select=*&limit=1').catch(()=>[]);
 const req=rows?.[0]||null;if(!req)return;
 const success=rc===0,status=success?'success':'failed',completed=now||new Date().toISOString();
 await rest(env,'attendance_biometric_enrollment_requests?id=eq.'+enc(req.id),{method:'PATCH',body:{status,result_code:rc,completed_at:completed,updated_at:completed},prefer:'return=minimal'}).catch(()=>{});
 const systemActor={id:'device:'+String(cmd.device_id||''),name:'جهاز البصمة',role:'system',permissions:{}};
 if(!success){
  await audit(env,systemActor,'attendance_biometric_enrollment_failed','attendance_biometric_enrollment',req.id,req.branch_id,req,{...req,status,result_code:rc,completed_at:completed},'فشل تسجيل البصمة على الجهاز').catch(()=>{});
  return;
 }
 const existing=(await rest(env,'attendance_biometric_profiles?attendance_employee_id=eq.'+enc(req.attendance_employee_id)+'&biometric_key=eq.'+enc(req.biometric_key)+'&data_environment=eq.'+enc(req.data_environment)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 const payload={
  attendance_employee_id:req.attendance_employee_id,branch_id:req.branch_id||null,source_device_id:req.device_id,device_pin:req.device_pin,
  biometric_type:req.biometric_type,biometric_key:req.biometric_key,finger_code:req.finger_code||null,slot_no:req.slot_no??null,status:'active',
  version:existing?Number(existing.version||1)+1:1,last_enrolled_at:completed,last_sync_at:completed,last_result_code:rc,data_environment:req.data_environment,
  metadata:{...(existing?.metadata||{}),last_request_id:req.id,protocol:'zkteco_adms',raw_template_stored:false},
  created_by:existing?.created_by||req.requested_by||null,updated_by:req.requested_by||'device',created_at:existing?.created_at||completed,updated_at:completed
 };
 const profiles=await rest(env,'attendance_biometric_profiles?on_conflict=attendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=representation'}).catch(()=>[]);
 const after=profiles?.[0]||payload;
 await rest(env,'attendance_biometric_device_states?on_conflict=device_id%2Cattendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:{
  device_id:req.device_id,attendance_employee_id:req.attendance_employee_id,branch_id:req.branch_id||null,device_pin:req.device_pin,
  biometric_type:req.biometric_type,biometric_key:req.biometric_key,finger_code:req.finger_code||null,slot_no:req.slot_no??null,status:'active',
  last_seen_at:completed,last_result_code:0,data_environment:req.data_environment,
  metadata:{source:'system_enrollment',last_request_id:req.id,raw_template_stored:false},created_at:completed,updated_at:completed
 },prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
 await audit(env,systemActor,existing?'attendance_biometric_reenrolled':'attendance_biometric_enrolled','attendance_biometric_profile',after.id||req.id,req.branch_id,existing,after,existing?'إعادة تسجيل بصمة بيومترية':'تسجيل بصمة بيومترية').catch(()=>{});
}

async function saveEmployee(env,me,body){
 if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة موظفي الحضور.'),{status:403});
 const id=txt(body.id),name=txt(body.name),branchId=elevated(me)?txt(body.branch_id):actorBranch(me),staffId=txt(body.staff_user_id),requestedEnv=body.data_environment==='production'?'production':'training',systemMode=await runtimeMode(env);
 if(!name)throw Object.assign(new Error('اسم الموظف مطلوب.'),{status:400});if(!branchId)throw Object.assign(new Error('اختر فرع الموظف.'),{status:400});if(requestedEnv==='production'&&systemMode!=='production')throw Object.assign(new Error('لا يمكن إنشاء موظف حضور Production بينما النظام في وضع التدريب.'),{status:409});
 let staff=null;if(staffId){const rows=await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,branch_id,status&limit=1');staff=rows?.[0]||null;if(!staff)throw Object.assign(new Error('حساب الموظف المختار غير موجود.'),{status:404});if(!elevated(me)&&txt(staff.branch_id)!==actorBranch(me))throw Object.assign(new Error('لا يمكن ربط حساب من فرع آخر.'),{status:403})}
 let before=null,beforePeriods=[];if(id){before=await scopedEmployee(env,me,id);if(!before)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});beforePeriods=await rest(env,'attendance_employee_shift_periods?attendance_employee_id=eq.'+enc(id)+'&active=eq.true&select=*&order=sequence_no.asc').catch(()=>[])}
 const suppliedPeriods=Array.isArray(body.shift_periods),periods=suppliedPeriods?cleanShiftPeriods(body.shift_periods):cleanShiftPeriods([{label:'الفترة الأولى',start_time:body.shift_start,end_time:body.shift_end,grace_minutes:body.grace_minutes}]);
 const firstPeriod=periods[0]||null,weeklyOffDays=cleanOffDays(body.weekly_off_days);
 const previousPeriods=beforePeriods.length?cleanShiftPeriods(beforePeriods):(before?.shift_start&&before?.shift_end?cleanShiftPeriods([{label:'الفترة الأولى',start_time:before.shift_start,end_time:before.shift_end,grace_minutes:before.grace_minutes,weekdays:[0,1,2,3,4,5,6]}]):[]);
 const scheduleChanged=!id||scheduleSignature(previousPeriods,before?.weekly_off_days||[])!==scheduleSignature(periods,weeklyOffDays);
 const scheduleEffectiveFrom=txt(body.schedule_effective_from)||saudiTodayKey();
 if(scheduleChanged&&!/^\d{4}-\d{2}-\d{2}$/.test(scheduleEffectiveFrom))throw Object.assign(new Error('حدد تاريخ سريان صحيح لجدول الدوام.'),{status:400});
 if(scheduleChanged&&id)await assertAttendanceMonthOpen(env,branchId,scheduleEffectiveFrom,scheduleEffectiveFrom,requestedEnv);
 const payload={name,branch_id:branchId,phone:txt(body.phone)||null,national_id:txt(body.national_id)||null,department:txt(body.department)||null,job_title:txt(body.job_title)||null,staff_user_id:staff?.id||null,shift_start:firstPeriod?.start_time||null,shift_end:firstPeriod?.end_time||null,grace_minutes:firstPeriod?.grace_minutes??Math.max(0,Math.min(240,Number(body.grace_minutes||0))),weekly_off_days:weeklyOffDays,status:body.status==='inactive'?'inactive':'active',data_environment:requestedEnv,notes:txt(body.notes)||null};
 const employeeCode=txt(body.employee_code);if(employeeCode)payload.employee_code=employeeCode;
 const actorValue=actorId(me)||actorName(me)||null,reason=txt(body.reason)||('تعديل جدول الدوام ساري من '+scheduleEffectiveFrom);
 const atomic=await rest(env,'rpc/attendance_save_employee_atomic',{method:'POST',body:{
  p_employee_id:id||null,p_employee:payload,p_shift_periods:periods,p_replace_shift_periods:suppliedPeriods,
  p_schedule_changed:scheduleChanged,p_effective_from:scheduleChanged?scheduleEffectiveFrom:null,
  p_reason:reason,p_actor:actorValue
 }}).catch(e=>{
  const msg=String(e?.message||'');
  if(msg.includes('attendance_month_closed'))throw Object.assign(new Error('لا يمكن تعديل جدول الدوام داخل شهر حضور مقفل. أعد فتح الشهر أولًا ثم أعد المحاولة.'),{status:409});
  throw Object.assign(new Error(msg||'تعذر حفظ الموظف وجدول الدوام كعملية واحدة.'),{status:409});
 });
 const after=atomic?.employee||null,savedPeriods=Array.isArray(atomic?.shift_periods)?atomic.shift_periods:periods,scheduleVersion=atomic?.schedule_version||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ موظف الحضور وجدول الدوام داخل Transaction واحدة.'),{status:500});
 const autoPush=body.auto_push!==false,devicesQueued=autoPush?await queueEmployeeAutoPush(env,me,after):0;
 await audit(env,me,id?'attendance_employee_update':'attendance_employee_create','attendance_employee',after.id,after.branch_id,before,{...after,shift_periods:savedPeriods,schedule_changed:scheduleChanged,schedule_effective_from:scheduleChanged?scheduleEffectiveFrom:null,schedule_version:scheduleVersion,atomic_schedule_save:true,auto_push:autoPush,devices_queued:devicesQueued},txt(body.reason)||'إدارة موظف حضور');
 return {ok:true,employee:after,shift_periods:savedPeriods,schedule_changed:scheduleChanged,schedule_effective_from:scheduleChanged?scheduleEffectiveFrom:null,schedule_version:scheduleVersion,atomic_schedule_save:true,auto_push:autoPush,devices_queued:devicesQueued};
}

async function promoteInventoryToEmployee(env,device,pin,employee,actorValue){
 const p=txt(pin),eid=txt(employee?.id);if(!p||!eid)return {attached:0,conflicts:0};
 const inventory=await rest(env,'attendance_biometric_inventory?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(p)+'&data_environment=eq.'+enc(device.data_environment||'training')+'&status=eq.active&select=*').catch(()=>[]);
 if(!inventory?.length)return {attached:0,conflicts:0};
 const conflicts=inventory.filter(x=>x.attendance_employee_id&&txt(x.attendance_employee_id)!==eid);
 if(conflicts.length)return {attached:0,conflicts:conflicts.length,conflict_rows:conflicts.map(x=>({id:x.id,biometric_key:x.biometric_key,attendance_employee_id:x.attendance_employee_id}))};
 const now=new Date().toISOString(),branchId=employee.branch_id||device.branch_id||null;
 const existing=await rest(env,'attendance_biometric_profiles?attendance_employee_id=eq.'+enc(eid)+'&data_environment=eq.'+enc(device.data_environment||'training')+'&select=*').catch(()=>[]);
 const existingMap=new Map((existing||[]).map(x=>[txt(x.biometric_key),x]));
 const profiles=[],deviceStates=[];
 for(const inv of inventory){
  const old=existingMap.get(txt(inv.biometric_key))||null;
  const meta={...(old?.metadata||{}),source:'inventory_link_promotion',inventory_id:inv.id,linked_from_pin:p,linked_at:now,raw_template_stored:false};
  profiles.push({
   attendance_employee_id:eid,branch_id:branchId,source_device_id:device.id,device_pin:p,
   biometric_type:inv.biometric_type,biometric_key:inv.biometric_key,finger_code:inv.finger_code||null,slot_no:inv.slot_no??null,status:'active',
   version:Math.max(1,Number(old?.version||1)),last_enrolled_at:old?.last_enrolled_at||null,last_sync_at:inv.last_seen_at||now,last_result_code:inv.last_result_code??0,
   data_environment:device.data_environment||'training',metadata:meta,
   created_by:old?.created_by||actorValue||'inventory_link',updated_by:actorValue||'inventory_link',created_at:old?.created_at||now,updated_at:now
  });
  deviceStates.push({
   device_id:device.id,attendance_employee_id:eid,branch_id:branchId,device_pin:p,
   biometric_type:inv.biometric_type,biometric_key:inv.biometric_key,finger_code:inv.finger_code||null,slot_no:inv.slot_no??null,status:'active',
   last_seen_at:inv.last_seen_at||now,last_result_code:inv.last_result_code??0,data_environment:device.data_environment||'training',
   metadata:{source:'inventory_link_promotion',inventory_id:inv.id,raw_template_stored:false},created_at:now,updated_at:now
  });
 }
 if(profiles.length)await rest(env,'attendance_biometric_profiles?on_conflict=attendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:profiles,prefer:'resolution=merge-duplicates,return=minimal'});
 if(deviceStates.length)await rest(env,'attendance_biometric_device_states?on_conflict=device_id%2Cattendance_employee_id%2Cbiometric_key%2Cdata_environment',{method:'POST',body:deviceStates,prefer:'resolution=merge-duplicates,return=minimal'});
 await rest(env,'attendance_biometric_inventory?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(p)+'&data_environment=eq.'+enc(device.data_environment||'training')+'&status=eq.active',{method:'PATCH',body:{attendance_employee_id:eid,branch_id:branchId,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 return {attached:profiles.length,conflicts:0};
}

async function saveLink(env,me,body){
 if(!canManageLinks(me))throw Object.assign(new Error('لا توجد صلاحية لربط موظفي أجهزة البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const pin=txt(body.device_pin),attendanceEmployeeId=txt(body.attendance_employee_id),staffId=txt(body.staff_user_id);if(!pin)throw Object.assign(new Error('رقم الموظف داخل جهاز البصمة مطلوب.'),{status:400});
 let attendanceEmployee=null,staff=null;
 if(attendanceEmployeeId){attendanceEmployee=await scopedEmployee(env,me,attendanceEmployeeId);if(!attendanceEmployee)throw Object.assign(new Error('موظف الحضور المختار غير موجود.'),{status:404});if(device.branch_id&&attendanceEmployee.branch_id&&txt(device.branch_id)!==txt(attendanceEmployee.branch_id))throw Object.assign(new Error('الجهاز وموظف الحضور يجب أن يكونا في نفس الفرع.'),{status:400});}
 if(!attendanceEmployee&&staffId){const rows=await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,branch_id,status&limit=1');staff=rows?.[0]||null;if(!staff)throw Object.assign(new Error('الموظف المختار غير موجود.'),{status:404});if(!elevated(me)&&txt(staff.branch_id)!==actorBranch(me))throw Object.assign(new Error('لا يمكن ربط موظف من فرع آخر.'),{status:403})}
 const resolvedStaff=attendanceEmployee?.staff_user_id||staff?.id||null,branchId=txt(device.branch_id||attendanceEmployee?.branch_id||staff?.branch_id)||null,displayName=txt(attendanceEmployee?.name||staff?.name||body.display_name)||null;
 const payload={device_id:device.id,device_pin:pin,attendance_employee_id:attendanceEmployee?.id||null,staff_user_id:resolvedStaff,branch_id:branchId,display_name:displayName,active:true,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 const before=(await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin)+'&select=*&limit=1'))?.[0]||null;
 let inventoryPromotion={attached:0,conflicts:0};
 if(attendanceEmployee){
  inventoryPromotion=await promoteInventoryToEmployee(env,device,pin,attendanceEmployee,actorId(me)||actorName(me)||null);
  if(inventoryPromotion.conflicts)throw Object.assign(new Error('هذا الـPIN لديه بصمة مكتشفة مرتبطة بموظف مختلف. افتح مركز مطابقة البصمات وراجع التعارض قبل تغيير الربط.'),{status:409});
 }
 const rows=await rest(env,'attendance_employee_links?on_conflict=device_id%2Cdevice_pin',{method:'POST',body:{...payload,created_by:before?.created_by||actorId(me)||actorName(me)||null},prefer:'resolution=merge-duplicates,return=representation'}),after=rows?.[0]||null;
 if(attendanceEmployee||staff||displayName){const patch={attendance_employee_id:attendanceEmployee?.id||null,staff_user_id:resolvedStaff,employee_name:displayName,branch_id:branchId};await rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{})}
 await audit(env,me,before?'attendance_link_update':'attendance_link_create','attendance_employee_link',after?.id||'',branchId,before,{...after,biometric_inventory_attached:inventoryPromotion.attached},'ربط رقم جهاز البصمة بموظف');
 return {ok:true,link:after,biometrics_attached:inventoryPromotion.attached};
}

async function resolveLinkIdentityReview(env,me,body){
 if(!canManageLinks(me))throw Object.assign(new Error('لا توجد صلاحية لمراجعة روابط أجهزة البصمة.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 const pin=txt(body.device_pin),resolution=txt(body.resolution),reason=txt(body.reason);
 if(!pin)throw Object.assign(new Error('PIN الجهاز مطلوب.'),{status:400});
 if(!['confirm_current','relink','snooze'].includes(resolution))throw Object.assign(new Error('قرار المراجعة غير صحيح.'),{status:400});
 if(!reason)throw Object.assign(new Error('سبب القرار مطلوب لحفظ سجل المراجعة.'),{status:400});
 const link=(await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin)+'&active=eq.true&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(!link?.attendance_employee_id)throw Object.assign(new Error('لا يوجد موظف حضور مربوط بهذا الـPIN حاليًا.'),{status:404});
 const currentEmployee=await scopedEmployee(env,me,link.attendance_employee_id);
 if(!currentEmployee)throw Object.assign(new Error('الموظف الحالي غير موجود أو خارج نطاق الفرع.'),{status:404});
 const deviceUser=(await rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin)+'&select=device_pin,name&limit=1').catch(()=>[]))?.[0]||null;
 let newEmployee=null,reviewUntil=null;
 if(resolution==='relink'){
  newEmployee=await scopedEmployee(env,me,txt(body.new_employee_id));
  if(!newEmployee)throw Object.assign(new Error('اختر موظفًا جديدًا صالحًا من نفس الفرع.'),{status:400});
  if(txt(newEmployee.id)===txt(currentEmployee.id))throw Object.assign(new Error('الموظف الجديد هو نفس الموظف الحالي.'),{status:400});
  if(device.branch_id&&newEmployee.branch_id&&txt(device.branch_id)!==txt(newEmployee.branch_id))throw Object.assign(new Error('الموظف الجديد يجب أن يكون في نفس فرع الجهاز.'),{status:400});
 }
 if(resolution==='snooze'){
  const days=Math.max(1,Math.min(90,Number(body.snooze_days||7)));
  reviewUntil=new Date(Date.now()+days*86400000).toISOString();
 }
 const actorValue=actorId(me)||actorName(me)||null;
 const rpc=await rest(env,'rpc/attendance_resolve_link_identity_review',{method:'POST',body:{
  p_device_id:device.id,p_device_pin:pin,p_resolution:resolution,p_reason:reason,
  p_device_name_snapshot:device.name||null,p_device_user_name_snapshot:deviceUser?.name||null,
  p_current_employee_id:currentEmployee.id,p_current_employee_name_snapshot:currentEmployee.name||link.display_name||null,
  p_new_employee_id:newEmployee?.id||null,p_new_employee_name_snapshot:newEmployee?.name||null,
  p_new_staff_user_id:newEmployee?.staff_user_id||null,p_new_branch_id:newEmployee?.branch_id||device.branch_id||null,
  p_actor:actorValue,p_environment:device.data_environment||'training',p_review_until:reviewUntil
 }}).catch(e=>{throw Object.assign(new Error(e.message||'تعذر حفظ قرار المراجعة.'),{status:409})});
 const after=(await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin)+'&select=*&limit=1').catch(()=>[]))?.[0]||link;
 if(resolution!=='snooze')await rest(env,'attendance_self_service_biometric_requests?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin)+'&status=eq.pending',{method:'PATCH',body:{status:resolution==='relink'?'approved':'rejected',resolved_at:new Date().toISOString(),resolved_by:actorId(me)||actorName(me)||null,resolution_note:resolution==='relink'?'تم اعتماد تصحيح الموظف وإعادة الربط':'تمت مراجعة طلب الموظف وتأكيد أن الربط الحالي صحيح'},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,'attendance_link_identity_review','attendance_employee_link',link.id,device.branch_id,link,{...after,identity_review:{resolution,reason,review_until:reviewUntil,new_employee_id:newEmployee?.id||null,device_user_name:deviceUser?.name||null}},reason).catch(()=>{});
 return {
  ok:true,resolution,review_until:reviewUntil,new_employee_id:newEmployee?.id||null,
  inventory_count:Number(rpc?.inventory_count||0),device_state_rows_written:Number(rpc?.device_state_rows_written||0),
  message:resolution==='confirm_current'
   ?'تم تأكيد أن الربط الحالي صحيح. لن يظهر نفس التحذير طالما الاسم على الجهاز والموظف لم يتغيرا.'
   :resolution==='snooze'
    ?'تم تأجيل التنبيه مؤقتًا حتى '+new Date(reviewUntil).toLocaleDateString('ar-SA')+'.'
    :'تم إعادة ربط الـPIN بالموظف الجديد مع نقل ملكية بصمات هذا الجهاز والحركات القديمة داخل النظام بأمان.'
 };
}

async function deleteLink(env,me,body){if(!canManageLinks(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة روابط موظفي البصمة.'),{status:403});const id=txt(body.id),rows=await rest(env,'attendance_employee_links?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;if(!before)throw Object.assign(new Error('الرابط غير موجود.'),{status:404});const device=await scopedDevice(env,me,before.device_id);if(!device)throw Object.assign(new Error('الرابط خارج نطاق الفرع.'),{status:403});await rest(env,'attendance_employee_links?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});await audit(env,me,'attendance_link_delete','attendance_employee_link',id,before.branch_id,before,null,'حذف ربط البصمة');return {ok:true}}


async function selfServiceAccount(env,me){
 const id=actorId(me);if(!id||isDeveloper(me))return null;
 const row=(await rest(env,'staff_users?id=eq.'+enc(id)+'&select=id,name,username,phone,role,branch_id,status,account_mode&limit=1').catch(()=>[]))?.[0]||null;
 if(!row||txt(row.status)==='موقوف'||lower(row.status)==='inactive')return null;
 return row;
}
async function selfServiceEmployee(env,account,mode){
 if(!account?.id)return null;
 const rows=await rest(env,'attendance_employees?staff_user_id=eq.'+enc(account.id)+'&status=eq.active&data_environment=eq.'+enc(mode)+'&select=*&limit=2').catch(()=>[]);
 if((rows||[]).length>1)throw Object.assign(new Error('حسابك مربوط بأكثر من ملف حضور. يحتاج مراجعة الموارد البشرية.'),{status:409});
 return rows?.[0]||null;
}
async function createSelfServiceRequest(env,{account,employee=null,deviceId=null,pin=null,type,reason='',evidence={},mode='training'}){
 const path='attendance_self_service_biometric_requests?staff_user_id=eq.'+enc(account.id)+'&request_type=eq.'+enc(type)+'&status=eq.pending&select=*&order=requested_at.desc&limit=20';
 const existing=await rest(env,path).catch(()=>[]);
 const same=(existing||[]).find(x=>txt(x.device_id)===txt(deviceId)&&txt(x.device_pin)===txt(pin)&&txt(x.attendance_employee_id)===txt(employee?.id));
 if(same)return same;
 const body={staff_user_id:account.id,attendance_employee_id:employee?.id||null,branch_id:employee?.branch_id||account.branch_id||null,device_id:deviceId||null,device_pin:pin||null,request_type:type,status:'pending',requested_reason:txt(reason)||null,evidence:evidence&&typeof evidence==='object'?evidence:{},data_environment:mode,requested_at:new Date().toISOString()};
 return (await rest(env,'attendance_self_service_biometric_requests',{method:'POST',body,prefer:'return=representation'}))?.[0]||body;
}
function saudiDayUtcRange(day){
 const key=/^\d{4}-\d{2}-\d{2}$/.test(txt(day))?txt(day):saudiTodayKey();
 const start=new Date(key+'T00:00:00+03:00'),end=new Date(start.getTime()+86400000);
 return {key,start:start.toISOString(),end:end.toISOString()};
}
function haversineMeters(lat1,lng1,lat2,lng2){
 const r=6371000,toRad=v=>Number(v)*Math.PI/180,a1=toRad(lat1),a2=toRad(lat2),dLat=toRad(Number(lat2)-Number(lat1)),dLng=toRad(Number(lng2)-Number(lng1));
 const a=Math.sin(dLat/2)**2+Math.cos(a1)*Math.cos(a2)*Math.sin(dLng/2)**2;
 return 2*r*Math.asin(Math.min(1,Math.sqrt(a)));
}
async function sha256Hex(value){
 const data=new TextEncoder().encode(String(value||'')),digest=await crypto.subtle.digest('SHA-256',data);
 return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function effectiveEmployeeAttendancePolicy(env,employee,mode,day=saudiTodayKey()){
 const branchId=txt(employee?.branch_id);if(!branchId)return {attendance_mode:'biometric',mobile_enabled:false,rules:[],exceptions:{}};
 const [baseRows,versions,rules]=await Promise.all([
  rest(env,'attendance_branch_policies?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]),
  rest(env,'attendance_branch_policy_versions?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&effective_from=lte.'+enc(day)+'&select=*&order=effective_from.desc&limit=50').catch(()=>[]),
  rest(env,'attendance_employee_calendar_rules?attendance_employee_id=eq.'+enc(employee.id)+'&status=eq.active&data_environment=eq.'+enc(mode)+'&start_date=lte.'+enc(day)+'&end_date=gte.'+enc(day)+'&select=*&order=start_date.desc,created_at.desc&limit=100').catch(()=>[])
 ]);
 const basePolicy=baseRows?.[0]||{},version=(versions||[]).find(v=>!v.effective_to||String(v.effective_to)>=day)||null,snapshot=version?.policy_snapshot&&typeof version.policy_snapshot==='object'&&!Array.isArray(version.policy_snapshot)?version.policy_snapshot:{};
 const policy={...basePolicy,...snapshot,branch_id:branchId,data_environment:mode,policy_version_id:version?.id||null,policy_effective_from:version?.effective_from||basePolicy.policy_effective_from||null,policy_effective_to:version?.effective_to||null};
 const modeRule=(rules||[]).find(r=>r.rule_type==='attendance_mode_override'),override=modeRule?.policy_payload?.attendance_mode;
 const attendanceMode=['biometric','mobile','hybrid'].includes(txt(override))?txt(override):(['biometric','mobile','hybrid'].includes(txt(policy.attendance_mode))?txt(policy.attendance_mode):'biometric');
 const exceptions={
  attendance_exempt:!!(rules||[]).find(r=>r.rule_type==='attendance_exempt'),
  location_exempt:!!(rules||[]).find(r=>r.rule_type==='location_exempt'),
  late_exempt:!!(rules||[]).find(r=>r.rule_type==='late_exempt'),
  checkout_exempt:!!(rules||[]).find(r=>r.rule_type==='checkout_exempt'),
  attendance_mode_override:modeRule||null
 };
 return {...policy,attendance_mode:attendanceMode,mobile_enabled:attendanceMode==='mobile'||attendanceMode==='hybrid',rules,exceptions};
}
async function mobileSelfServiceStatus(env,account,employee,mode){
 const day=saudiTodayKey(),range=saudiDayUtcRange(day),policy=await effectiveEmployeeAttendancePolicy(env,employee,mode,day);
 const events=await rest(env,'attendance_mobile_events?attendance_employee_id=eq.'+enc(employee.id)+'&data_environment=eq.'+enc(mode)+'&occurred_at=gte.'+enc(range.start)+'&occurred_at=lt.'+enc(range.end)+'&select=id,event_type,occurred_at,accuracy_m,distance_from_site_m,inside_geofence,mobile_device_id,source&order=occurred_at.asc&limit=50').catch(()=>[]);
 const last=events?.[events.length-1]||null,nextEvent=!events?.length||last?.event_type==='check_out'?'check_in':'check_out';
 return {
  enabled:policy.mobile_enabled,
  exempt:policy.exceptions?.attendance_exempt===true,
  attendance_mode:policy.attendance_mode,
  next_event_type:nextEvent,
  today_events:events||[],
  policy:{
   geofence_enabled:policy.mobile_geofence_enabled!==false,
   geofence_radius_m:Number(policy.mobile_geofence_radius_m||100),
   max_accuracy_m:Number(policy.mobile_max_accuracy_m||120),
   require_trusted_device:policy.mobile_require_trusted_device!==false,
   require_selfie:policy.mobile_require_selfie===true,
   require_dynamic_qr:policy.mobile_require_dynamic_qr===true,
   location_exempt:policy.exceptions?.location_exempt===true,
   policy_effective_from:policy.policy_effective_from||null,
   policy_effective_to:policy.policy_effective_to||null
  }
 };
}
async function captureMobileAttendance(env,me,body,request){
 const account=await selfServiceAccount(env,me);if(!account)throw Object.assign(new Error('هذا الحساب غير متاح للخدمة الذاتية.'),{status:403});
 const mode=account.account_mode==='production'?'production':accountMode(me),employee=await selfServiceEmployee(env,account,mode);
 if(!employee)throw Object.assign(new Error('اربط حسابك بملف الحضور أولًا.'),{status:409});
 const day=saudiTodayKey(),policy=await effectiveEmployeeAttendancePolicy(env,employee,mode,day);
 if(policy.exceptions?.attendance_exempt)return {ok:true,exempt:true,message:'أنت معفى من تسجيل الحضور والانصراف خلال الفترة الحالية.'};
 if(!policy.mobile_enabled)throw Object.assign(new Error('سياسة فرعك الحالية لا تسمح بتسجيل الحضور من الجوال.'),{status:403});
 if(policy.mobile_require_selfie===true)throw Object.assign(new Error('سياسة الفرع تشترط صورة لحظية، وهذه الخطوة لم تُفعّل في نسخة الويب الحالية بعد.'),{status:409});
 if(policy.mobile_require_dynamic_qr===true)throw Object.assign(new Error('سياسة الفرع تشترط QR ديناميكي، وهذه الخطوة لم تُفعّل في نسخة الويب الحالية بعد.'),{status:409});
 const eventType=txt(body.event_type);
 if(!['check_in','check_out'].includes(eventType))throw Object.assign(new Error('نوع حركة الحضور غير صحيح.'),{status:400});
 const deviceKey=txt(body.device_key);if(!deviceKey||deviceKey.length<16||deviceKey.length>256)throw Object.assign(new Error('تعذر التحقق من هوية هذا الجوال. أعد فتح الصفحة وحاول مرة أخرى.'),{status:400});
 const deviceHash=await sha256Hex(deviceKey),now=new Date().toISOString(),deviceLabel=txt(body.device_label||request?.headers?.get('User-Agent')).slice(0,180)||'جوال الموظف';
 let mobileDevice=(await rest(env,'attendance_mobile_devices?attendance_employee_id=eq.'+enc(employee.id)+'&device_key_hash=eq.'+enc(deviceHash)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 if(!mobileDevice){
  const initialStatus=policy.mobile_require_trusted_device!==false?'pending':'approved';
  mobileDevice=(await rest(env,'attendance_mobile_devices',{method:'POST',body:{attendance_employee_id:employee.id,staff_user_id:account.id,branch_id:employee.branch_id||null,device_key_hash:deviceHash,device_label:deviceLabel,status:initialStatus,data_environment:mode,first_seen_at:now,last_seen_at:now,approved_at:initialStatus==='approved'?now:null,approved_by:initialStatus==='approved'?'system:auto':null,updated_at:now},prefer:'return=representation'}))?.[0]||null;
  await audit(env,me,'attendance_mobile_device_registered','attendance_mobile_device',mobileDevice?.id||deviceHash,employee.branch_id,null,{employee_id:employee.id,status:initialStatus,device_label:deviceLabel},'تسجيل جهاز جوال جديد للحضور').catch(()=>{});
 }else{
  await rest(env,'attendance_mobile_devices?id=eq.'+enc(mobileDevice.id),{method:'PATCH',body:{last_seen_at:now,device_label:deviceLabel,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
 }
 if(mobileDevice?.status==='revoked')throw Object.assign(new Error('هذا الجوال موقوف من تسجيل الحضور. راجع الموارد البشرية.'),{status:403});
 if(policy.mobile_require_trusted_device!==false&&mobileDevice?.status!=='approved')return {ok:true,pending_device:true,mobile_device_id:mobileDevice?.id||null,message:'تم التعرف على هذا الجوال، لكنه يحتاج اعتماد الإدارة قبل تسجيل الحضور.'};

 let lat=null,lng=null,accuracy=null,distance=null,inside=null;
 if(policy.mobile_geofence_enabled!==false&&!policy.exceptions?.location_exempt){
  lat=Number(body.latitude);lng=Number(body.longitude);accuracy=Number(body.accuracy_m);
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lng)||lng<-180||lng>180)throw Object.assign(new Error('تعذر قراءة موقعك الحالي بشكل صحيح.'),{status:400});
  if(!Number.isFinite(accuracy)||accuracy<0)throw Object.assign(new Error('دقة الموقع غير متاحة. فعّل الموقع الدقيق وحاول مرة أخرى.'),{status:400});
  const maxAccuracy=Math.max(10,Number(policy.mobile_max_accuracy_m||120));
  if(accuracy>maxAccuracy)throw Object.assign(new Error('دقة الموقع ضعيفة ('+Math.round(accuracy)+'م). انتظر تحسن GPS وحاول مرة أخرى.'),{status:409});
  const siteLat=Number(policy.mobile_location_lat),siteLng=Number(policy.mobile_location_lng);
  if(!Number.isFinite(siteLat)||!Number.isFinite(siteLng))throw Object.assign(new Error('موقع الفرع غير مضبوط في سياسة الحضور. راجع الإدارة.'),{status:409});
  distance=Math.round(haversineMeters(lat,lng,siteLat,siteLng)*10)/10;inside=distance<=Number(policy.mobile_geofence_radius_m||100);
  if(!inside)throw Object.assign(new Error('أنت خارج نطاق مقر العمل بحوالي '+Math.round(distance)+' متر.'),{status:403});
 }else if(Number.isFinite(Number(body.latitude))&&Number.isFinite(Number(body.longitude))){
  lat=Number(body.latitude);lng=Number(body.longitude);accuracy=Number.isFinite(Number(body.accuracy_m))?Number(body.accuracy_m):null;
 }

 const range=saudiDayUtcRange(day),todayEvents=await rest(env,'attendance_mobile_events?attendance_employee_id=eq.'+enc(employee.id)+'&data_environment=eq.'+enc(mode)+'&occurred_at=gte.'+enc(range.start)+'&occurred_at=lt.'+enc(range.end)+'&select=*&order=occurred_at.asc&limit=50').catch(()=>[]),last=todayEvents?.[todayEvents.length-1]||null;
 if(eventType==='check_out'&&!last)throw Object.assign(new Error('لا يوجد حضور مسجل اليوم حتى يتم تسجيل الانصراف.'),{status:409});
 if(last?.event_type===eventType)return {ok:true,duplicate:true,event:last,message:eventType==='check_in'?'حضورك مسجل بالفعل.':'انصرافك مسجل بالفعل.'};
 const requestId=txt(body.request_id)||crypto.randomUUID(),dedupeKey='mobile|'+employee.id+'|'+requestId;
 const policySnapshot={attendance_mode:policy.attendance_mode,mobile_geofence_enabled:policy.mobile_geofence_enabled!==false,mobile_geofence_radius_m:Number(policy.mobile_geofence_radius_m||100),mobile_max_accuracy_m:Number(policy.mobile_max_accuracy_m||120),mobile_require_trusted_device:policy.mobile_require_trusted_device!==false,location_exempt:policy.exceptions?.location_exempt===true,policy_version_id:policy.policy_version_id||null,policy_effective_from:policy.policy_effective_from||null};
 const event=(await rest(env,'attendance_mobile_events',{method:'POST',body:{attendance_employee_id:employee.id,staff_user_id:account.id,branch_id:employee.branch_id||null,mobile_device_id:mobileDevice?.id||null,event_type:eventType,occurred_at:now,latitude:lat,longitude:lng,accuracy_m:accuracy,distance_from_site_m:distance,inside_geofence:inside,source:'mobile_web',policy_snapshot:policySnapshot,metadata:{source_ip:clientIp(request),device_label:deviceLabel},data_environment:mode,dedupe_key:dedupeKey},prefer:'return=representation'}))?.[0]||null;
 if(!event)throw Object.assign(new Error('تعذر حفظ حركة الحضور بالجوال.'),{status:500});
 await audit(env,me,eventType==='check_in'?'attendance_mobile_check_in':'attendance_mobile_check_out','attendance_mobile_event',event.id,employee.branch_id,null,{employee_id:employee.id,event_type:eventType,occurred_at:event.occurred_at,distance_from_site_m:distance,inside_geofence:inside,mobile_device_id:mobileDevice?.id||null},eventType==='check_in'?'تسجيل حضور بالجوال':'تسجيل انصراف بالجوال').catch(()=>{});
 return {ok:true,event,message:eventType==='check_in'?'تم تسجيل حضورك بنجاح.':'تم تسجيل انصرافك بنجاح.'};
}
async function reviewMobileAttendanceDevice(env,me,body){
 if(!canManageEmployees(me)&&!canManagePolicies(me))throw Object.assign(new Error('لا توجد صلاحية لاعتماد أجهزة حضور الجوال.'),{status:403});
 const id=txt(body.id),decision=txt(body.decision);if(!id||!['approve','revoke'].includes(decision))throw Object.assign(new Error('حدد الجهاز والقرار المطلوب.'),{status:400});
 const before=(await rest(env,'attendance_mobile_devices?id=eq.'+enc(id)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;if(!before)throw Object.assign(new Error('جهاز الجوال غير موجود.'),{status:404});
 if(!elevated(me)&&txt(before.branch_id)!==actorBranch(me))throw Object.assign(new Error('الجهاز خارج نطاق فرعك.'),{status:403});
 const now=new Date().toISOString(),who=actorId(me)||actorName(me)||null,payload=decision==='approve'?{status:'approved',approved_at:now,approved_by:who,revoked_at:null,revoked_by:null,review_note:txt(body.reason)||'اعتماد جهاز حضور الجوال',updated_at:now}:{status:'revoked',revoked_at:now,revoked_by:who,review_note:txt(body.reason)||'إلغاء اعتماد جهاز حضور الجوال',updated_at:now};
 const after=(await rest(env,'attendance_mobile_devices?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 await audit(env,me,decision==='approve'?'attendance_mobile_device_approved':'attendance_mobile_device_revoked','attendance_mobile_device',id,before.branch_id,before,after,txt(body.reason)||payload.review_note).catch(()=>{});
 return {ok:true,device:after,message:decision==='approve'?'تم اعتماد جهاز الجوال.':'تم إلغاء اعتماد جهاز الجوال.'};
}

async function employeeSelfServiceStatus(env,me){
 const account=await selfServiceAccount(env,me);if(!account)return {ok:true,available:false,message:'هذا الحساب ليس حساب موظف عادي قابل للربط بملف حضور.'};
 const mode=account.account_mode==='production'?'production':accountMode(me),requests=await rest(env,'attendance_self_service_biometric_requests?staff_user_id=eq.'+enc(account.id)+'&data_environment=eq.'+enc(mode)+'&select=*&order=requested_at.desc&limit=50').catch(()=>[]);
 const employee=await selfServiceEmployee(env,account,mode);
 if(!employee)return {ok:true,available:true,binding_required:true,account:{id:account.id,name:account.name,branch_id:account.branch_id},requests,message:'اربط حسابك بملف الحضور مرة واحدة لتفعيل خدمة «بصمتي».'};
 const devices=employee.branch_id?await rest(env,'attendance_devices?branch_id=eq.'+enc(employee.branch_id)+'&status=eq.active&data_environment=eq.'+enc(mode)+'&select=id,name,serial_number,branch_id,status,data_environment&order=name.asc').catch(()=>[]):[];
 const deviceIds=devices.map(x=>x.id),inFilter=deviceIds.length?'device_id=in.('+deviceIds.map(enc).join(',')+')':'device_id=eq.00000000-0000-0000-0000-000000000000';
 const [deviceUsers,links,inventory,profiles]=await Promise.all([
  rest(env,'attendance_device_users?'+inFilter+'&select=device_id,device_pin,name,last_seen_at&limit=5000').catch(()=>[]),
  rest(env,'attendance_employee_links?'+inFilter+'&active=eq.true&select=id,device_id,device_pin,attendance_employee_id,staff_user_id,branch_id,display_name,active&limit=5000').catch(()=>[]),
  rest(env,'attendance_biometric_inventory?'+inFilter+'&data_environment=eq.'+enc(mode)+'&status=eq.active&select=id,device_id,device_pin,attendance_employee_id,biometric_type,biometric_key,last_seen_at&limit=5000').catch(()=>[]),
  rest(env,'attendance_biometric_profiles?attendance_employee_id=eq.'+enc(employee.id)+'&data_environment=eq.'+enc(mode)+'&select=id,source_device_id,device_pin,biometric_type,biometric_key,status,last_sync_at&limit=500').catch(()=>[])
 ]);
 const deviceMap=new Map(devices.map(x=>[txt(x.id),x])),userMap=new Map((deviceUsers||[]).map(x=>[txt(x.device_id)+'|'+txt(x.device_pin),x])),linkMap=new Map((links||[]).map(x=>[txt(x.device_id)+'|'+txt(x.device_pin),x])),inventoryMap=new Map(),ownPinsByDevice=new Map();
 for(const inv of inventory||[]){const k=txt(inv.device_id)+'|'+txt(inv.device_pin),a=inventoryMap.get(k)||[];a.push(inv);inventoryMap.set(k,a)}
 for(const l of links||[]){if(txt(l.attendance_employee_id)===txt(employee.id))ownPinsByDevice.set(txt(l.device_id),txt(l.device_pin))}
 const ownLinks=(links||[]).filter(l=>txt(l.attendance_employee_id)===txt(employee.id)).map(l=>{
  const d=deviceMap.get(txt(l.device_id)),u=userMap.get(txt(l.device_id)+'|'+txt(l.device_pin)),bios=inventoryMap.get(txt(l.device_id)+'|'+txt(l.device_pin))||[],match=deviceEmployeeMatch(u||{name:l.display_name,device_pin:l.device_pin},employee);
  return {id:l.id,device_id:l.device_id,device_name:d?.name||'جهاز بصمة',device_pin:l.device_pin,device_user_name:u?.name||null,biometric_count:bios.length,match_score:match.score,match_reasons:match.reasons,mismatch:!!u?.name&&match.score<48,last_seen_at:u?.last_seen_at||null};
 });
 const safeCandidates=[],conflicts=[];
 for(const u of deviceUsers||[]){
  const key=txt(u.device_id)+'|'+txt(u.device_pin),link=linkMap.get(key)||null,match=deviceEmployeeMatch(u,employee),bios=inventoryMap.get(key)||[],otherPin=ownPinsByDevice.get(txt(u.device_id));
  if(match.score<68)continue;
  if(link?.attendance_employee_id&&txt(link.attendance_employee_id)!==txt(employee.id)){
   conflicts.push({device_id:u.device_id,device_name:deviceMap.get(txt(u.device_id))?.name||'جهاز بصمة',device_pin:u.device_pin,device_user_name:u.name||null,match_score:match.score,match_reasons:match.reasons,biometric_count:bios.length});
   continue;
  }
  if(link?.attendance_employee_id||otherPin&&txt(otherPin)!==txt(u.device_pin))continue;
  if(!bios.length)continue;
  if(bios.some(x=>x.attendance_employee_id&&txt(x.attendance_employee_id)!==txt(employee.id)))continue;
  safeCandidates.push({device_id:u.device_id,device_name:deviceMap.get(txt(u.device_id))?.name||'جهاز بصمة',device_pin:u.device_pin,device_user_name:u.name||null,match_score:match.score,match_reasons:match.reasons,biometric_count:bios.length});
 }
 const mobileAttendance=await mobileSelfServiceStatus(env,account,employee,mode).catch(e=>({enabled:false,error:e.message||'تعذر تحميل حالة الحضور بالجوال'}));
 return {ok:true,available:true,binding_required:false,account:{id:account.id,name:account.name,branch_id:account.branch_id},employee:{id:employee.id,name:employee.name,employee_code:employee.employee_code,branch_id:employee.branch_id,department:employee.department,job_title:employee.job_title},links:ownLinks,safe_candidates:safeCandidates,conflicts,biometric_profiles:(profiles||[]).filter(x=>x.status==='active'),requests,auto_correct_available:safeCandidates.length>0,mobile_attendance:mobileAttendance};
}
async function bindEmployeeSelfService(env,me,body){
 const account=await selfServiceAccount(env,me);if(!account)throw Object.assign(new Error('هذا الحساب غير متاح للخدمة الذاتية.'),{status:403});
 if(!account.branch_id)throw Object.assign(new Error('حسابك غير مرتبط بفرع. اطلب من الإدارة تحديد فرع الحساب أولًا.'),{status:409});
 const mode=account.account_mode==='production'?'production':accountMode(me),code=txt(body.employee_code).toUpperCase();
 if(!code)throw Object.assign(new Error('أدخل الكود الوظيفي الموجود في ملف الحضور.'),{status:400});
 const already=await selfServiceEmployee(env,account,mode);if(already)return {ok:true,bound:true,employee:{id:already.id,name:already.name,employee_code:already.employee_code},message:'حسابك مربوط بملف الحضور بالفعل.'};
 let path='attendance_employees?employee_code=eq.'+enc(code)+'&status=eq.active&data_environment=eq.'+enc(mode)+'&select=*&limit=2';
 if(account.branch_id)path+='&branch_id=eq.'+enc(account.branch_id);
 const rows=await rest(env,path).catch(()=>[]),employee=rows?.[0]||null;
 if(!employee||rows.length!==1)throw Object.assign(new Error('الكود الوظيفي غير موجود في فرع حسابك أو غير فريد.'),{status:404});
 if(employee.staff_user_id&&txt(employee.staff_user_id)!==txt(account.id))throw Object.assign(new Error('ملف الحضور هذا مربوط بحساب آخر. أرسل طلب مراجعة للموارد البشرية.'),{status:409});
 const match=deviceEmployeeMatch({name:account.name,device_pin:''},employee),actorValue='self:'+account.id;
 if(match.score>=56){
  const other=await rest(env,'attendance_employees?staff_user_id=eq.'+enc(account.id)+'&id=neq.'+enc(employee.id)+'&status=eq.active&data_environment=eq.'+enc(mode)+'&select=id&limit=1').catch(()=>[]);
  if(other?.length)throw Object.assign(new Error('الحساب مربوط بملف حضور آخر. يحتاج مراجعة الموارد البشرية.'),{status:409});
  const now=new Date().toISOString();
  await rest(env,'attendance_employees?id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:account.id,updated_by:actorValue,updated_at:now},prefer:'return=minimal'});
  await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:account.id,updated_by:actorValue,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_raw_logs?attendance_employee_id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:account.id},prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_self_service_biometric_requests',{method:'POST',body:{staff_user_id:account.id,attendance_employee_id:employee.id,branch_id:employee.branch_id,request_type:'account_binding',status:'auto_resolved',requested_reason:'ربط ذاتي بالكود الوظيفي',evidence:{account_name:account.name,employee_name:employee.name,employee_code:employee.employee_code,match_score:match.score,reasons:match.reasons},data_environment:mode,requested_at:now,resolved_at:now,resolved_by:actorValue,resolution_note:'تم الربط تلقائيًا بعد تحقق الكود والفرع وتشابه الاسم'},prefer:'return=minimal'}).catch(()=>{});
  await audit(env,me,'attendance_self_service_account_bound','attendance_employee',employee.id,employee.branch_id,null,{staff_user_id:account.id,employee_code:employee.employee_code,match_score:match.score},'ربط حساب الموظف بملف الحضور عبر الخدمة الذاتية').catch(()=>{});
  return {ok:true,bound:true,employee:{id:employee.id,name:employee.name,employee_code:employee.employee_code},message:'تم ربط حسابك بملف الحضور بنجاح.'};
 }
 const req=await createSelfServiceRequest(env,{account,employee,type:'account_binding',reason:'طلب ربط حساب الموظف بملف الحضور',evidence:{account_name:account.name,employee_name:employee.name,employee_code:employee.employee_code,match_score:match.score,reasons:match.reasons},mode});
 await audit(env,me,'attendance_self_service_binding_requested','attendance_self_service_request',req.id,employee.branch_id,null,req,'تشابه الاسم غير كافٍ للربط التلقائي').catch(()=>{});
 return {ok:true,bound:false,pending:true,request_id:req.id,message:'الكود صحيح، لكن الاسم يحتاج مراجعة بشرية قبل ربط الحساب. تم إرسال الطلب للموارد البشرية.'};
}
async function autoCorrectEmployeeBiometric(env,me,body){
 const status=await employeeSelfServiceStatus(env,me);if(status.binding_required||!status.employee)throw Object.assign(new Error('اربط حسابك بملف الحضور أولًا.'),{status:409});
 const account=await selfServiceAccount(env,me),mode=account.account_mode==='production'?'production':accountMode(me),deviceId=txt(body.device_id),pin=txt(body.device_pin);
 const candidate=(status.safe_candidates||[]).find(x=>txt(x.device_id)===deviceId&&txt(x.device_pin)===pin);
 if(!candidate){
  const req=await createSelfServiceRequest(env,{account,employee:status.employee,deviceId:deviceId||null,pin:pin||null,type:'claim_unlinked_pin',reason:txt(body.reason)||'طلب تصحيح ربط البصمة',evidence:{requested_device_id:deviceId||null,requested_pin:pin||null,auto_safe:false},mode});
  return {ok:true,auto_corrected:false,pending:true,request_id:req.id,message:'الحالة غير آمنة للتصحيح التلقائي. تم إرسال طلب للموارد البشرية بدل تغيير البيانات.'};
 }
 const rpc=await rest(env,'rpc/attendance_self_service_claim_pin',{method:'POST',body:{p_staff_user_id:account.id,p_employee_id:status.employee.id,p_device_id:candidate.device_id,p_device_pin:candidate.device_pin,p_actor:'self:'+account.id,p_environment:mode}}).catch(e=>{throw Object.assign(new Error(e.message||'تعذر تنفيذ التصحيح التلقائي.'),{status:409})});
 await audit(env,me,'attendance_self_service_auto_corrected','attendance_employee_link',candidate.device_id+':'+candidate.device_pin,status.employee.branch_id,null,{employee_id:status.employee.id,device_id:candidate.device_id,device_pin:candidate.device_pin,match_score:candidate.match_score,inventory_count:rpc?.inventory_count||0},'تصحيح تلقائي آمن لربط بصمة الموظف').catch(()=>{});
 return {ok:true,auto_corrected:true,device_id:candidate.device_id,device_pin:candidate.device_pin,inventory_count:Number(rpc?.inventory_count||0),message:'تم تصحيح ربط البصمة تلقائيًا بأمان.'};
}
async function confirmEmployeeCurrentLink(env,me,body){
 const status=await employeeSelfServiceStatus(env,me);if(status.binding_required||!status.employee)throw Object.assign(new Error('اربط حسابك بملف الحضور أولًا.'),{status:409});
 const account=await selfServiceAccount(env,me),mode=account.account_mode==='production'?'production':accountMode(me),deviceId=txt(body.device_id),pin=txt(body.device_pin),link=(status.links||[]).find(x=>txt(x.device_id)===deviceId&&txt(x.device_pin)===pin);
 if(!link)throw Object.assign(new Error('هذا الـPIN غير مربوط بملف حضورك.'),{status:403});
 const device=(await rest(env,'attendance_devices?id=eq.'+enc(deviceId)+'&select=id,name,branch_id,data_environment&limit=1').catch(()=>[]))?.[0]||null;
 const deviceUser=(await rest(env,'attendance_device_users?device_id=eq.'+enc(deviceId)+'&device_pin=eq.'+enc(pin)+'&select=name&limit=1').catch(()=>[]))?.[0]||null;
 const reason=txt(body.reason)||'أكد الموظف من الخدمة الذاتية أن الربط يخصه';
 await rest(env,'rpc/attendance_resolve_link_identity_review',{method:'POST',body:{p_device_id:deviceId,p_device_pin:pin,p_resolution:'confirm_current',p_reason:reason,p_device_name_snapshot:device?.name||null,p_device_user_name_snapshot:deviceUser?.name||null,p_current_employee_id:status.employee.id,p_current_employee_name_snapshot:status.employee.name,p_new_employee_id:null,p_new_employee_name_snapshot:null,p_new_staff_user_id:null,p_new_branch_id:status.employee.branch_id,p_actor:'self:'+account.id,p_environment:mode,p_review_until:null}}).catch(e=>{throw Object.assign(new Error(e.message||'تعذر تأكيد الربط الحالي.'),{status:409})});
 const now=new Date().toISOString();
 await rest(env,'attendance_self_service_biometric_requests',{method:'POST',body:{staff_user_id:account.id,attendance_employee_id:status.employee.id,branch_id:status.employee.branch_id,device_id:deviceId,device_pin:pin,request_type:'other',status:'auto_resolved',requested_reason:reason,evidence:{action:'confirm_current',device_user_name:deviceUser?.name||null},data_environment:mode,requested_at:now,resolved_at:now,resolved_by:'self:'+account.id,resolution_note:'أكد الموظف أن الربط الحالي يخصه'},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,'attendance_self_service_link_confirmed','attendance_employee_link',link.id,status.employee.branch_id,null,{device_id:deviceId,device_pin:pin,employee_id:status.employee.id},reason).catch(()=>{});
 return {ok:true,message:'تم تأكيد أن هذا الربط يخصك. لو تغير الاسم أو البيانات لاحقًا سيظهر التنبيه من جديد.'};
}
async function requestEmployeeBiometricCorrection(env,me,body){
 const status=await employeeSelfServiceStatus(env,me);if(status.binding_required||!status.employee)throw Object.assign(new Error('اربط حسابك بملف الحضور أولًا.'),{status:409});
 const account=await selfServiceAccount(env,me),mode=account.account_mode==='production'?'production':accountMode(me),deviceId=txt(body.device_id),pin=txt(body.device_pin),type=body.request_type==='not_mine'?'not_mine':'wrong_link',reason=txt(body.reason);
 if(!reason)throw Object.assign(new Error('اكتب ملاحظة قصيرة توضح المشكلة.'),{status:400});
 const own=(status.links||[]).find(x=>txt(x.device_id)===deviceId&&txt(x.device_pin)===pin),conflict=(status.conflicts||[]).find(x=>txt(x.device_id)===deviceId&&txt(x.device_pin)===pin);
 if(type==='not_mine'&&!own)throw Object.assign(new Error('لا يمكن إرسال «ليست بصمتي» لرقم غير مربوط بك.'),{status:403});
 if(type==='wrong_link'&&!conflict&&!own)throw Object.assign(new Error('هذه الحالة غير ظاهرة ضمن مشاكل ملفك.'),{status:403});
 const req=await createSelfServiceRequest(env,{account,employee:status.employee,deviceId,pin,type,reason,evidence:{employee_name:status.employee.name,device_user_name:own?.device_user_name||conflict?.device_user_name||null,match_score:own?.match_score??conflict?.match_score??null,biometric_count:own?.biometric_count??conflict?.biometric_count??0,current_link_is_self:!!own},mode});
 await audit(env,me,'attendance_self_service_correction_requested','attendance_self_service_request',req.id,status.employee.branch_id,null,req,reason).catch(()=>{});
 return {ok:true,pending:true,request_id:req.id,message:'تم إرسال طلب التصحيح للموارد البشرية مع بيانات الجهاز والـPIN تلقائيًا.'};
}
async function attendanceSelfServiceApi(request,env,ctx){
 const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);
 try{
  if(request.method==='GET')return json(await employeeSelfServiceStatus(env,me));
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=txt(body.action);
  if(action==='bind_account')return json(await bindEmployeeSelfService(env,me,body));
  if(action==='auto_correct')return json(await autoCorrectEmployeeBiometric(env,me,body));
  if(action==='confirm_current_link')return json(await confirmEmployeeCurrentLink(env,me,body));
  if(action==='request_correction')return json(await requestEmployeeBiometricCorrection(env,me,body));
  if(action==='mobile_attendance')return json(await captureMobileAttendance(env,me,body,request));
  return json({error:'إجراء خدمة ذاتية غير مدعوم.'},400);
 }catch(e){return json({error:e.message||'تعذر تنفيذ الخدمة الذاتية للحضور'},e.status||500)}
}
async function reviewSelfServiceBiometricRequest(env,me,body){
 const id=txt(body.id),decision=txt(body.decision),reason=txt(body.reason);if(!id)throw Object.assign(new Error('طلب الموظف غير محدد.'),{status:400});
 const req=(await rest(env,'attendance_self_service_biometric_requests?id=eq.'+enc(id)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;if(!req)throw Object.assign(new Error('طلب الموظف غير موجود.'),{status:404});
 if(!elevated(me)&&txt(req.branch_id)!==actorBranch(me))throw Object.assign(new Error('الطلب خارج نطاق فرعك.'),{status:403});
 if(req.status!=='pending')return {ok:true,request:req,message:'هذا الطلب تمت معالجته بالفعل.'};
 const now=new Date().toISOString(),who=actorId(me)||actorName(me)||null;
 if(decision==='reject'){
  if(!canManageLinks(me)&&!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لرفض طلب التصحيح.'),{status:403});
  const after=(await rest(env,'attendance_self_service_biometric_requests?id=eq.'+enc(id),{method:'PATCH',body:{status:'rejected',resolved_at:now,resolved_by:who,resolution_note:reason||'تم رفض الطلب بعد المراجعة'},prefer:'return=representation'}))?.[0]||req;
  await audit(env,me,'attendance_self_service_request_rejected','attendance_self_service_request',id,req.branch_id,req,after,reason||'رفض طلب خدمة ذاتية').catch(()=>{});
  return {ok:true,request:after,message:'تم رفض الطلب وتسجيل السبب.'};
 }
 if(decision==='approve_binding'&&req.request_type==='account_binding'){
  if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لاعتماد ربط حساب الموظف.'),{status:403});
  const employee=await scopedEmployee(env,me,req.attendance_employee_id);if(!employee)throw Object.assign(new Error('ملف الحضور المطلوب غير موجود.'),{status:404});
  const staff=(await rest(env,'staff_users?id=eq.'+enc(req.staff_user_id)+'&select=id,name,branch_id,status&limit=1').catch(()=>[]))?.[0]||null;if(!staff)throw Object.assign(new Error('حساب الموظف غير موجود.'),{status:404});
  if(employee.branch_id&&staff.branch_id&&txt(employee.branch_id)!==txt(staff.branch_id))throw Object.assign(new Error('الحساب وملف الحضور في فرعين مختلفين.'),{status:409});
  if(employee.staff_user_id&&txt(employee.staff_user_id)!==txt(staff.id))throw Object.assign(new Error('ملف الحضور مربوط بحساب آخر.'),{status:409});
  const other=await rest(env,'attendance_employees?staff_user_id=eq.'+enc(staff.id)+'&id=neq.'+enc(employee.id)+'&status=eq.active&select=id&limit=1').catch(()=>[]);if(other?.length)throw Object.assign(new Error('حساب الموظف مربوط بملف حضور آخر.'),{status:409});
  await rest(env,'attendance_employees?id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:staff.id,updated_by:who,updated_at:now},prefer:'return=minimal'});
  await rest(env,'attendance_employee_links?attendance_employee_id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:staff.id,updated_by:who,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
  await rest(env,'attendance_raw_logs?attendance_employee_id=eq.'+enc(employee.id),{method:'PATCH',body:{staff_user_id:staff.id},prefer:'return=minimal'}).catch(()=>{});
  const after=(await rest(env,'attendance_self_service_biometric_requests?id=eq.'+enc(id),{method:'PATCH',body:{status:'approved',resolved_at:now,resolved_by:who,resolution_note:reason||'تم اعتماد ربط الحساب بملف الحضور'},prefer:'return=representation'}))?.[0]||req;
  await audit(env,me,'attendance_self_service_binding_approved','attendance_employee',employee.id,employee.branch_id,{staff_user_id:employee.staff_user_id},{staff_user_id:staff.id,request_id:id},reason||'اعتماد ربط حساب الموظف').catch(()=>{});
  return {ok:true,request:after,message:'تم اعتماد ربط حساب الموظف بملف الحضور.'};
 }
 throw Object.assign(new Error('هذا القرار غير متاح لهذا النوع من الطلبات.'),{status:400});
}

async function attendanceApi(request,env,ctx){
 const me=await actor(request,env,ctx);if(!me)return json({error:'غير مصرح'},401);if(!canView(me))return json({error:'لا توجد صلاحية للوصول إلى الحضور والبصمة.'},403);const url=new URL(request.url);
 try{
  if(request.method==='GET')return json(await attendanceState(env,me,url));
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await request.json().catch(()=>({})),action=txt(body.action);
  if(action==='report')return json(await attendanceReport(env,me,body));
  if(action==='sync_device_data')return json(await queueDeviceSync(env,me,body));
  if(action==='diagnose_device')return json(await diagnoseDevice(env,me,body));
  if(action==='diagnose_all_devices')return json(await diagnoseAllDevices(env,me,body));
  if(action==='probe_device_clock')return json(await probeDeviceClock(env,me,body));
  if(action==='sync_device_clock')return json(await syncDeviceClock(env,me,body));
  if(action==='preview_device_user_matches')return json(await deviceUserMatchPreview(env,me,body));
  if(action==='apply_device_user_matches')return json(await applyDeviceUserMatches(env,me,body));
  if(action==='import_device_users')return json(await importDeviceUsers(env,me,body));
  if(action==='import_historical_attendance')return json(await importHistoricalAttendance(env,me,body));
  if(action==='save_device_shift_template')return json(await saveDeviceShiftTemplate(env,me,body));
  if(action==='delete_device_shift_template')return json(await deleteDeviceShiftTemplate(env,me,body));
  if(action==='push_device_user')return json(await pushDeviceUser(env,me,body));
  if(action==='push_employee_to_devices')return json(await pushEmployeeToDevices(env,me,body));
  if(action==='save_device')return json(await saveDevice(env,me,body));
  if(action==='request_biometric_enrollment')return json(await requestBiometricEnrollment(env,me,body));
  if(action==='import_device_biometrics')return json(await importDeviceBiometrics(env,me,body));
  if(action==='auto_reconcile_biometrics')return json(await autoReconcileBiometrics(env,me,body));
  if(action==='delete_biometric_profile')return json(await requestBiometricDelete(env,me,body));
  if(action==='set_biometric_preference')return json(await setBiometricPreference(env,me,body));
  if(action==='save_employee')return json(await saveEmployee(env,me,body));
  if(action==='save_attendance_policy')return json(await saveAttendancePolicy(env,me,body));
  if(action==='close_attendance_month')return json(await closeAttendanceMonth(env,me,body));
  if(action==='reopen_attendance_month')return json(await reopenAttendanceMonth(env,me,body));
  if(action==='save_violation_decision')return json(await saveAttendanceViolationDecision(env,me,body));
  if(action==='reset_violation_decision')return json(await resetAttendanceViolationDecision(env,me,body));
  if(action==='save_calendar_rule')return json(await saveEmployeeCalendarRule(env,me,body));
  if(action==='delete_calendar_rule')return json(await deleteEmployeeCalendarRule(env,me,body));
  if(action==='delete_employee')return json(await deleteAttendanceEmployee(env,me,body));
  if(action==='save_link')return json(await saveLink(env,me,body));
  if(action==='resolve_link_identity_review')return json(await resolveLinkIdentityReview(env,me,body));
  if(action==='review_self_service_request')return json(await reviewSelfServiceBiometricRequest(env,me,body));
  if(action==='review_mobile_device')return json(await reviewMobileAttendanceDevice(env,me,body));
  if(action==='delete_link')return json(await deleteLink(env,me,body));
  if(action==='update_notification')return json(await updateAttendanceNotification(env,me,body));
  if(action==='mark_notifications_seen')return json(await markAttendanceNotificationsSeen(env,me,body));
  if(action==='save_escalation_rule')return json(await saveAttendanceEscalationRule(env,me,body));
  if(action==='save_delivery_settings')return json(await saveAttendanceDeliverySettings(env,me,body));
  if(action==='retry_notification_delivery')return json(await retryAttendanceDelivery(env,me,body));
  if(action==='run_watchdog')return json(await runAttendanceWatchdogNow(env,me));
  if(action==='update_incident')return json(await updateAttendanceIncident(env,me,body));
  if(action==='save_incident_sla_policy')return json(await saveAttendanceIncidentSlaPolicy(env,me,body));
  if(action==='save_incident_maintenance')return json(await saveAttendanceIncidentMaintenance(env,me,body));
  if(action==='add_incident_maintenance_action')return json(await addAttendanceIncidentMaintenanceAction(env,me,body));
  if(action==='delete_incident_maintenance_action')return json(await deleteAttendanceIncidentMaintenanceAction(env,me,body));
  if(action==='verify_incident_maintenance')return json(await verifyAttendanceIncidentMaintenance(env,me,body));
  if(action==='save_preventive_maintenance_plan')return json(await savePreventiveMaintenancePlan(env,me,body));
  if(action==='complete_preventive_maintenance')return json(await completePreventiveMaintenance(env,me,body));
  if(action==='skip_preventive_maintenance')return json(await skipPreventiveMaintenance(env,me,body));
  if(action==='save_device_asset')return json(await saveAttendanceDeviceAsset(env,me,body));
  if(action==='add_device_asset_event')return json(await addAttendanceDeviceAssetEvent(env,me,body));
  return json({error:'إجراء غير مدعوم.'},400);
 }catch(e){return json({error:e.message||'تعذر تنفيذ عملية الحضور والبصمة'},e.status||500)}
}

export default {
 async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname.startsWith('/iclock/'))return admsRequest(request,env);if(url.pathname==='/api/attendance/self-service')return attendanceSelfServiceApi(request,env,ctx);if(url.pathname==='/api/attendance')return attendanceApi(request,env,ctx);return appWorker.fetch(request,env,ctx)},
 async scheduled(controller,env,ctx){
  await runDeviceClockSyncWatchdog(env).catch(()=>({ok:false}));
  const inherited=typeof appWorker?.scheduled==='function'?Promise.resolve(appWorker.scheduled(controller,env,ctx)):Promise.resolve();
  await Promise.all([inherited,runAttendanceWatchdog(env,'scheduled')]);
 }
};
