import appWorker from './agent-360-index.js';

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
const canView=u=>!!u&&(elevated(u)||u.permissions?.attendance_view===true||u.permissions?.attendance_manage_devices===true||u.permissions?.attendance_manage_links===true||u.permissions?.attendance_manage_employees===true||u.permissions?.attendance_manage_schedules===true||u.permissions?.attendance_manage_policies===true||u.permissions?.attendance_review_violations===true||u.permissions?.attendance_close_month===true||u.permissions?.attendance_reopen_month===true||u.permissions?.attendance_delete_employees===true||u.permissions?.attendance_reports===true);
const canManageDevices=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_devices===true);
const canManageLinks=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_links===true);
const canManageEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_employees===true);
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
 return ['GET OPTION FROM: '+serial,'Stamp='+attStamp,'OpStamp=9999','ATTLOGStamp='+attStamp,'OPERLOGStamp=9999','PhotoStamp=9999','ATTPHOTOStamp=9999','ErrorDelay=30','Delay=10','TransTimes=00:00;23:59','TransInterval=1','TransFlag=1111000000','Realtime=1','Encrypt=0',''].join('\r\n');
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
async function reconcileAttendanceNotifications(env,devices,deviceHealth,devicePredictiveAlerts){
 const rows=Array.isArray(devices)?devices:[],ids=rows.map(x=>x.id).filter(Boolean);
 if(!ids.length)return [];
 const now=new Date().toISOString(),deviceMap=new Map(rows.map(x=>[String(x.id),x])),desired=[];
 const add=(x)=>{if(x?.notification_key)desired.push(x)};
 for(const h of deviceHealth||[]){
  const d=deviceMap.get(String(h.device_id));if(!d)continue;
  if(h.connection==='offline')add({notification_key:'device_offline:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'device_health',severity:'critical',title:'جهاز البصمة غير متصل — '+d.name,message:'لم يصل اتصال حديث من الجهاز خلال آخر 30 دقيقة.',metadata:{type:'offline',health_score:h.score,last_seen_at:h.last_seen_at}});
  if(Number(h.stuck_commands)>0)add({notification_key:'stuck_commands:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'device_health',severity:'critical',title:'أوامر معلقة على جهاز البصمة — '+d.name,message:String(h.stuck_commands)+' أمر/أوامر معلقة لأكثر من 15 دقيقة.',metadata:{type:'stuck_commands',count:Number(h.stuck_commands),health_score:h.score}});
  if(Number(h.unlinked_count)>0)add({notification_key:'unlinked_movements:'+d.id,device_id:d.id,branch_id:d.branch_id||null,category:'linking',severity:'warning',title:'حركات بصمة تحتاج ربط — '+d.name,message:String(h.unlinked_count)+(h.unlinked_truncated?'+':'')+' حركة تحتاج ربط موظف.',metadata:{type:'unlinked_movements',count:Number(h.unlinked_count),truncated:!!h.unlinked_truncated}});
 }
 for(const p of devicePredictiveAlerts||[]){
  const d=deviceMap.get(String(p.device_id));if(!d)continue;
  add({notification_key:'predictive:'+d.id+':'+txt(p.primary_type||'watch'),device_id:d.id,branch_id:d.branch_id||null,category:'predictive',severity:p.level==='high'?'critical':p.level==='medium'?'warning':'info',title:'تنبيه استباقي — '+d.name,message:(p.signals||[]).slice(0,3).join(' '),metadata:{type:p.primary_type||'watch',risk_score:p.risk_score,level:p.level,confidence:p.confidence,signals:p.signals||[],recommended_action:p.recommended_action||null,recommended_label:p.recommended_label||null,metrics:p.metrics||{}}});
 }
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

async function runAttendanceWatchdog(env,source='scheduled'){
 const startedAt=new Date(),startedIso=startedAt.toISOString(),mode=await runtimeMode(env);
 const runRows=await rest(env,'attendance_watchdog_runs',{method:'POST',body:{source,status:'running',runtime_mode:mode,started_at:startedIso,created_at:startedIso},prefer:'return=representation'}).catch(()=>[]);
 const run=runRows?.[0]||null;
 try{
  const systemActor={id:'system:attendance-watchdog',name:'Attendance Watchdog',role:'developer',permissions:{all:true,allBranches:true,_accountMode:mode}};
  const state=await attendanceState(env,systemActor,new URL('https://attendance-watchdog.internal/api/attendance'));
  const completedAt=new Date(),durationMs=Math.max(0,completedAt.getTime()-startedAt.getTime()),activeNotifications=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved').length,criticalNotifications=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved'&&x.severity==='critical').length,activeEscalations=(state.notifications||[]).filter(x=>x.active&&x.status!=='resolved'&&Number(x.escalation_level)>0).length;
  const summary={ok:true,run_id:run?.id||null,source,runtime_mode:mode,devices_count:(state.devices||[]).length,active_notifications:activeNotifications,critical_notifications:criticalNotifications,escalations_count:activeEscalations,deliveries_queued:Number(state.deliveryCounts?.queued||0)+Number(state.deliveryCounts?.sending||0),deliveries_failed:Number(state.deliveryCounts?.failed||0),completed_at:completedAt.toISOString(),duration_ms:durationMs};
  if(run?.id)await rest(env,'attendance_watchdog_runs?id=eq.'+enc(run.id),{method:'PATCH',body:{status:'success',completed_at:summary.completed_at,duration_ms:durationMs,devices_count:summary.devices_count,active_notifications:activeNotifications,critical_notifications:criticalNotifications,escalations_count:activeEscalations,deliveries_queued:summary.deliveries_queued,deliveries_failed:summary.deliveries_failed,metadata:{notification_new:Number(state.notificationCounts?.new||0),notification_level2:Number(state.notificationCounts?.level2||0),notification_level3:Number(state.notificationCounts?.level3||0),delivery_blocked:Number(state.deliveryCounts?.blocked||0),delivery_delivered:Number(state.deliveryCounts?.delivered||0)+Number(state.deliveryCounts?.read||0),incident_open:Number(state.incidentCounts?.open||0)+Number(state.incidentCounts?.acknowledged||0)+Number(state.incidentCounts?.investigating||0),incident_breached:Number(state.incidentCounts?.breached||0)}},prefer:'return=minimal'}).catch(()=>{});
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
  const key=incidentKey(n),old=byKey.get(key),policy=selectIncidentPolicy(policies,n),started=n.first_seen_at||n.created_at||nowIso,startMs=new Date(started).getTime(),responseMin=Math.max(0,Number(policy?.response_minutes??60)),resolutionMin=Math.max(responseMin,Number(policy?.resolution_minutes??480)),responseDue=new Date((Number.isFinite(startMs)?startMs:now.getTime())+responseMin*60000).toISOString(),resolutionDue=new Date((Number.isFinite(startMs)?startMs:now.getTime())+resolutionMin*60000).toISOString();
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
 const id=txt(body.id),category=['*','device_health','predictive','linking'].includes(txt(body.category))?txt(body.category):'*',severity=['*','critical','warning','info'].includes(txt(body.severity))?txt(body.severity):'*',branchId=elevated(me)?(txt(body.branch_id)||null):actorBranch(me)||null;
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

async function saveAttendanceEscalationRule(env,me,body){
 if(!canManagePolicies(me)&&!elevated(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة قواعد تصعيد التنبيهات.'),{status:403});
 const id=txt(body.id),category=['*','device_health','predictive','linking'].includes(txt(body.category))?txt(body.category):'*',severity=['*','critical','warning','info'].includes(txt(body.severity))?txt(body.severity):'*';
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
 if(!lastLog){severity=Math.max(severity,1);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=15;issues.push('لم يستقبل النظام أي حركة حضور من هذا الجهاز حتى الآن.')}
 else if(logAge!=null&&logAge>72*3600){severity=Math.max(severity,1);if(severity<3){label='يحتاج متابعة';tone='orange'}score-=10;issues.push('لا توجد حركة حضور جديدة منذ أكثر من 72 ساعة.')}
 score=Math.max(0,Math.min(100,score));
 const compat=profile.preferred_mode==='push_replay'?'push_replay':profile.preferred_mode==='data_query'?'data_query':'auto';
 let recommended_action=null,recommended_label=null;
 if(device?.status==='active'&&connection!=='offline'){
  if(Number(unlinkedCount)>0){recommended_action='links';recommended_label='مراجعة الربط'}
  else if(latestCommand?.status==='failed'&&latestCommandAge!=null&&latestCommandAge<=3600){recommended_action='diagnose';recommended_label='إعادة التشخيص'}
  else if(!lastLog||(logAge!=null&&logAge>72*3600)){recommended_action='history';recommended_label=compat==='push_replay'?'إعادة إرسال الحركات':'استيراد الحركات القديمة'}
  else if(severity>0){recommended_action='diagnose';recommended_label='تشخيص الجهاز'}
 }
 return {device_id:device?.id||null,severity,tone,label,score,connection,connection_age_seconds:seenAge,last_seen_at:seen,last_log_at:lastLog,last_received_at:lastReceived,unlinked_count:Number(unlinkedCount)||0,unlinked_truncated:!!unlinkedTruncated,pending_commands:pending,stuck_commands:stuck,last_command_type:latestCommand?.command_type||null,last_command_status:latestCommand?.status||null,last_command_at:latestCommand?.completed_at||latestCommand?.updated_at||latestCommand?.created_at||null,last_command_code:latestCommand?.result_code??null,compatibility_mode:compat,compatibility_strategy:profile.preferred_strategy||null,recommended_action,recommended_label,issues};
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
 const queued=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&status=eq.queued&select=id,command_text&order=id.asc&limit=3').catch(()=>[]);
 if(!queued?.length)return [];
 const now=new Date().toISOString();
 for(const cmd of queued)await rest(env,'attendance_device_commands?id=eq.'+enc(cmd.id),{method:'PATCH',body:{status:'sent',sent_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
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
  if(cmd&&rc!==0)await recordDeviceHealthEvent(env,{event_key:'command_failed:'+cmd.id,device_id:cmd.device_id,branch_id:null,event_type:'command_failed',severity:['history_attlog','history_attlog_replay','sync_attlog','sync_users','diagnostic_info'].includes(cmd.command_type)?'warning':'info',started_at:now,ended_at:now,duration_seconds:0,command_id:cmd.id,result_code:rc,summary:'فشل أمر '+cmd.command_type+(rc!=null?' (Code '+rc+')':''),metadata:{command_type:cmd.command_type,history_strategy:cmd?.metadata?.history_strategy||null}});
  if(cmd&&['sync_info','diagnostic_info'].includes(cmd.command_type))await updateDeviceInfoFromInfoCommand(env,cmd,raw,rc).catch(()=>{});
  if(cmd?.command_type==='history_attlog'&&rc===0){
   const devices=await rest(env,'attendance_devices?id=eq.'+enc(cmd.device_id)+'&select=*&limit=1').catch(()=>[]);
   const device=devices?.[0]||null,strategy=txt(cmd?.metadata?.history_strategy)||'range_space';
   if(device)await saveHistoryProfile(env,device,{preferred_mode:'data_query',supports_data_query:true,preferred_strategy:strategy,last_success_at:now,last_result_code:0});
  }
  if(cmd?.command_type==='history_attlog'&&rc===-3)await queueHistoricalFallback(env,cmd,rc).catch(()=>false);
  if(cmd?.command_type==='delete_employee_user'&&cmd.operation_group_id)groups.add(String(cmd.operation_group_id));
 }
 for(const groupId of groups)await finalizeEmployeeDeleteGroup(env,groupId);
}
async function markSyncComplete(env,device,commandType,resultBody){
 const rows=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.'+enc(commandType)+'&status=in.(queued,sent)&select=id&order=id.desc&limit=1').catch(()=>[]);
 const id=rows?.[0]?.id;if(!id)return;
 const now=new Date().toISOString();
 await rest(env,'attendance_device_commands?id=eq.'+enc(id),{method:'PATCH',body:{status:'success',result_code:0,result_body:String(resultBody||'').slice(0,2000),completed_at:now,updated_at:now},prefer:'return=minimal'}).catch(()=>{});
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
 if(request.method==='POST'&&url.pathname==='/iclock/cdata'){
   const body=await request.text(),table=txt(url.searchParams.get('table')).toUpperCase(),info=parseDeviceInfo(body);
   await touchDevice(env,device,request,url,info).catch(()=>{});
   if(table==='ATTLOG'){
    const n=await storeAttendanceLogs(env,device,serial,request,body);
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
     const users=parseUserLines(body),n=await upsertDeviceUsers(env,device,serial,users,table);if(n){await markSyncComplete(env,device,'sync_users','USERINFO received: '+n+' users');await markSyncComplete(env,device,'verify_user','USERINFO verified: '+n+' users')}
     return plain('OK')
   }
   if(table==='FINGERTMP'||table==='BIODATA'||table==='FP'){
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
 const existing=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&status=in.(queued,sent)&select=id,command_type,status&limit=20').catch(()=>[]);
 if(existing?.some(x=>x.command_type==='sync_users'||x.command_type==='sync_attlog'))return {ok:true,queued:false,message:'يوجد طلب مزامنة قيد التنفيذ بالفعل.'};
 const now=deviceLocalNow();
 const commands=[
  {device_id:device.id,command_type:'sync_info',command_text:'INFO',created_by:actorId(me)||actorName(me)||null},
  {device_id:device.id,command_type:'sync_users',command_text:'DATA QUERY USERINFO',created_by:actorId(me)||actorName(me)||null},
  {device_id:device.id,command_type:'sync_attlog',command_text:'DATA QUERY ATTLOG StartTime=2000-01-01 00:00:00\tEndTime='+now,created_by:actorId(me)||actorName(me)||null}
 ];
 const created=await rest(env,'attendance_device_commands',{method:'POST',body:commands,prefer:'return=representation'});
 await audit(env,me,'attendance_device_sync_requested','attendance_device',device.id,device.branch_id,null,{commands:commands.map(x=>x.command_type)},'سحب بيانات الجهاز والموظفين وسجل الحضور');
 return {ok:true,queued:true,commands:created?.map(x=>({id:x.id,type:x.command_type,status:x.status}))||[]};
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
 let after;
 if(id)after=(await rest(env,'attendance_device_shift_templates?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;
 else after=(await rest(env,'attendance_device_shift_templates',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ فترة الجهاز.'),{status:500});
 await rest(env,'attendance_employee_shift_periods?device_shift_template_id=eq.'+enc(after.id),{method:'PATCH',body:{label:after.name,start_time:after.start_time,end_time:after.end_time,grace_minutes:after.grace_minutes,source_type:'device_template',updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()},prefer:'return=minimal'}).catch(()=>{});
 await audit(env,me,id?'attendance_device_shift_update':'attendance_device_shift_create','attendance_device_shift_template',after.id,device.branch_id,before,after,'إدارة فترات دوام الجهاز');
 return {ok:true,template:after};
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

async function importDeviceUsers(env,me,body){
 if(!canManageEmployees(me)||!canManageLinks(me))throw Object.assign(new Error('تحتاج صلاحية إدارة موظفي الحضور وربط البصمة للاستيراد.'),{status:403});
 const device=await scopedDevice(env,me,txt(body.device_id));if(!device)throw Object.assign(new Error('الجهاز غير موجود أو خارج نطاق الفرع.'),{status:404});
 if(!device.branch_id)throw Object.assign(new Error('اربط الجهاز بفرع أولًا قبل استيراد الموظفين.'),{status:400});
 const deviceUsers=await rest(env,'attendance_device_users?device_id=eq.'+enc(device.id)+'&select=*&order=device_pin.asc');
 if(!deviceUsers?.length)throw Object.assign(new Error('لا توجد بيانات موظفين مسحوبة من الجهاز حتى الآن.'),{status:400});
 const links=await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&select=*');
 const linkMap=new Map((links||[]).map(x=>[txt(x.device_pin),x]));
 const pending=deviceUsers.filter(u=>!linkMap.get(txt(u.device_pin))?.attendance_employee_id);
 if(!pending.length)return {ok:true,imported:0,skipped:deviceUsers.length,message:'كل موظفي الجهاز مستوردون بالفعل.'};
 const actorValue=actorId(me)||actorName(me)||null,now=new Date().toISOString();
 const employees=await Promise.all(pending.map(async u=>{
  const rows=await rest(env,'attendance_employees',{method:'POST',body:{name:txt(u.name)||('PIN '+txt(u.device_pin)),branch_id:device.branch_id,status:'active',data_environment:device.data_environment||'training',notes:'مستورد من جهاز '+device.name+' / PIN '+txt(u.device_pin),created_by:actorValue,updated_by:actorValue,created_at:now,updated_at:now},prefer:'return=representation'});
  return {user:u,employee:rows?.[0]||null};
 }));
 const valid=employees.filter(x=>x.employee);
 const linkRows=valid.map(({user,employee})=>{const old=linkMap.get(txt(user.device_pin));return {device_id:device.id,device_pin:txt(user.device_pin),attendance_employee_id:employee.id,staff_user_id:old?.staff_user_id||null,branch_id:device.branch_id,display_name:employee.name,active:true,created_by:old?.created_by||actorValue,updated_by:actorValue,created_at:old?.created_at||now,updated_at:now}});
 if(linkRows.length)await rest(env,'attendance_employee_links?on_conflict=device_id%2Cdevice_pin',{method:'POST',body:linkRows,prefer:'resolution=merge-duplicates,return=minimal'});
 await Promise.all(valid.map(({user,employee})=>rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(user.device_pin),{method:'PATCH',body:{attendance_employee_id:employee.id,employee_name:employee.name,branch_id:device.branch_id},prefer:'return=minimal'}).catch(()=>{})));
 await audit(env,me,'attendance_device_users_import','attendance_device',device.id,device.branch_id,null,{imported:valid.length,total_device_users:deviceUsers.length},'استيراد موظفي جهاز البصمة إلى موظفي الحضور');
 return {ok:true,imported:valid.length,skipped:deviceUsers.length-valid.length};
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
 const id=txt(body.id),type=txt(body.rule_type),allowed=new Set(['leave','permission','overtime','work_override','off']);
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
 const now=new Date().toISOString(),version=Math.max(1,Number(before?.closure_version||0)+1),payload={
  branch_id:branchId,period_month:period,data_environment:mode,status:'closed',closure_version:version,
  snapshot:{daily,monthly,filters:snapshot.filters||{},generated_at:now},
  totals:body.totals&&typeof body.totals==='object'&&!Array.isArray(body.totals)?body.totals:{},
  closed_by:actorName(me)||actorId(me)||null,closed_at:now,reopened_by:null,reopened_at:null,reopen_reason:null,updated_at:now
 };
 const rows=await rest(env,'attendance_month_closures?on_conflict=branch_id%2Cperiod_month%2Cdata_environment',{method:'POST',body:{...payload,created_at:before?.created_at||now},prefer:'resolution=merge-duplicates,return=representation'}),after=rows?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر إقفال شهر الحضور.'),{status:500});
 await audit(env,me,before?'attendance_month_reclose':'attendance_month_close','attendance_month_closure',after.id,branchId,before,after,txt(body.reason)||'إقفال شهر الحضور');
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
 const now=new Date().toISOString(),rows=await rest(env,'attendance_month_closures?id=eq.'+enc(before.id),{method:'PATCH',body:{status:'open',reopened_by:actorName(me)||actorId(me)||null,reopened_at:now,reopen_reason:reason,updated_at:now},prefer:'return=representation'}),after=rows?.[0]||null;
 await audit(env,me,'attendance_month_reopen','attendance_month_closure',before.id,branchId,before,after,reason);
 return {ok:true,closure:after,message:'تمت إعادة فتح شهر '+period.slice(0,7)+' للتعديل والمراجعة.'};
}

async function saveAttendancePolicy(env,me,body){
 if(!canManagePolicies(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة سياسات الحضور والمخالفات.'),{status:403});
 const branchId=elevated(me)?txt(body.branch_id):actorBranch(me),mode=body.data_environment==='production'?'production':'training';
 if(!branchId)throw Object.assign(new Error('اختر الفرع أولًا.'),{status:400});
 const branch=(await rest(env,'branches?id=eq.'+enc(branchId)+'&select=id,name&limit=1'))?.[0]||null;
 if(!branch)throw Object.assign(new Error('الفرع غير موجود.'),{status:404});
 const clamp=(v,min,max,def)=>{const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):def};
 const payload={
  branch_id:branchId,
  data_environment:mode,
  early_leave_grace_minutes:clamp(body.early_leave_grace_minutes,0,240,10),
  shortage_grace_minutes:clamp(body.shortage_grace_minutes,0,480,15),
  partial_absence_threshold_minutes:clamp(body.partial_absence_threshold_minutes,1,720,60),
  late_penalty_minutes:clamp(body.late_penalty_minutes,0,1440,0),
  early_leave_penalty_minutes:clamp(body.early_leave_penalty_minutes,0,1440,0),
  missing_punch_penalty_minutes:clamp(body.missing_punch_penalty_minutes,0,1440,0),
  partial_absence_penalty_minutes:clamp(body.partial_absence_penalty_minutes,0,1440,0),
  absence_penalty_minutes:clamp(body.absence_penalty_minutes,0,1440,0),
  notes:txt(body.notes)||null,
  updated_by:actorId(me)||actorName(me)||null,
  updated_at:new Date().toISOString()
 };
 const before=(await rest(env,'attendance_branch_policies?branch_id=eq.'+enc(branchId)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1'))?.[0]||null;
 const rows=await rest(env,'attendance_branch_policies?on_conflict=branch_id%2Cdata_environment',{method:'POST',body:{...payload,created_by:before?.created_by||actorId(me)||actorName(me)||null},prefer:'resolution=merge-duplicates,return=representation'});
 const after=rows?.[0]||null;if(!after)throw Object.assign(new Error('تعذر حفظ سياسة الحضور.'),{status:500});
 await audit(env,me,before?'attendance_policy_update':'attendance_policy_create','attendance_branch_policy',after.id,branchId,before,after,txt(body.reason)||'إدارة سياسة الحضور والمخالفات');
 return {ok:true,policy:after};
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
 const branchId=requestedBranch(me,{},url),mode=accountMode(me),dFilter=branchId?'&branch_id=eq.'+enc(branchId):'',lFilter=branchId?'&branch_id=eq.'+enc(branchId):'',logFilter=branchId?'&branch_id=eq.'+enc(branchId):'',empFilter=branchId?'&branch_id=eq.'+enc(branchId):'',userFilter=branchId?'&branch_id=eq.'+enc(branchId):'',deleteFilter=branchId?'&branch_id=eq.'+enc(branchId):'',calendarFilter=branchId?'&branch_id=eq.'+enc(branchId):'',policyFilter=branchId?'&branch_id=eq.'+enc(branchId):'',branchFilter=branchId?'?id=eq.'+enc(branchId)+'&select=id,name,status,address':'?select=id,name,status,address&order=name.asc';
 const [devices,links,logs,unlinkedRows,employees,users,branches,shiftPeriods,deleteRequests,calendarRules,policies]=await Promise.all([
  rest(env,'attendance_devices?select=*&order=created_at.asc'+dFilter),
  rest(env,'attendance_employee_links?select=*&order=created_at.desc'+lFilter),
  rest(env,'attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at&data_environment=eq.'+enc(mode)+logFilter+'&order=occurred_at.desc&limit=500'),
  rest(env,'attendance_raw_logs?select=device_id,serial_number,branch_id,device_pin,occurred_at,received_at&data_environment=eq.'+enc(mode)+logFilter+'&attendance_employee_id=is.null&staff_user_id=is.null&employee_name=is.null&order=occurred_at.desc&limit=5000'),
  rest(env,'attendance_employees?select=*&data_environment=eq.'+enc(mode)+empFilter+'&order=name.asc'),
  rest(env,'staff_users?select=id,name,username,role,branch_id,status&status=neq.%D9%85%D9%88%D9%82%D9%88%D9%81'+userFilter+'&order=name.asc'),
  rest(env,'branches'+branchFilter),
  rest(env,'attendance_employee_shift_periods?select=*&active=eq.true&order=attendance_employee_id.asc,sequence_no.asc'),
  rest(env,'attendance_employee_delete_requests?select=*&order=created_at.desc&limit=100'+deleteFilter),
  rest(env,'attendance_employee_calendar_rules?select=*&status=eq.active&data_environment=eq.'+enc(mode)+calendarFilter+'&order=start_date.desc,created_at.desc&limit=2000'),
  rest(env,'attendance_branch_policies?select=*&data_environment=eq.'+enc(mode)+policyFilter+'&order=branch_id.asc')
 ]);
 const deviceIds=(devices||[]).map(d=>d.id).filter(Boolean),inFilter=deviceIds.length?'&device_id=in.('+deviceIds.map(enc).join(',')+')':'';
 const historySince=new Date(Date.now()-90*86400000).toISOString();
 const [deviceUsers,commands,deviceShiftTemplates,healthEvents]=deviceIds.length?await Promise.all([
   rest(env,'attendance_device_users?select=id,device_id,serial_number,device_pin,name,privilege,card_number,group_no,timezone_raw,verify_mode,data_environment,source_table,first_seen_at,last_seen_at'+inFilter+'&order=device_pin.asc'),
   rest(env,'attendance_device_commands?select=id,device_id,command_type,status,result_code,result_body,command_text,metadata,created_at,sent_at,completed_at,updated_at'+inFilter+'&order=id.desc&limit=100'),
   rest(env,'attendance_device_shift_templates?select=*&active=eq.true'+inFilter+'&order=device_id.asc,sequence_no.asc,name.asc'),
   rest(env,'attendance_device_health_events?select=id,event_key,device_id,branch_id,event_type,severity,status,started_at,ended_at,duration_seconds,command_id,result_code,summary,metadata,created_at'+inFilter+'&started_at=gte.'+enc(historySince)+'&order=started_at.desc&limit=1000').catch(()=>[])
 ]):[[],[],[],[]];
 const latestDeviceLogs=deviceIds.length?await Promise.all(deviceIds.map(async id=>({device_id:id,row:(await rest(env,'attendance_raw_logs?device_id=eq.'+enc(id)+'&select=occurred_at,received_at&order=occurred_at.desc&limit=1').catch(()=>[]))?.[0]||null}))):[];
 const employeeIds=new Set((employees||[]).map(x=>String(x.id))),scopedShiftPeriods=(shiftPeriods||[]).filter(x=>employeeIds.has(String(x.attendance_employee_id)));
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
  const expectedCompatibilityFailure=ev=>ev.event_type==='command_failed'&&Number(ev.result_code)===-3&&pushReplayKnown&&txt(ev?.metadata?.command_type)==='history_attlog';
  const operationalFailures=events.filter(ev=>ev.event_type==='command_failed'&&!expectedCompatibilityFailure(ev));
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
 const rawNotifications=await reconcileAttendanceNotifications(env,devices,deviceHealth,devicePredictiveAlerts);
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
 const watchdog=(await rest(env,'attendance_watchdog_runs?select=*&order=started_at.desc&limit=1').catch(()=>[]))?.[0]||null;
 return {ok:true,devices,deviceHealth,deviceHealthHistory,devicePredictiveAlerts,healthEvents,notifications,notificationCounts,escalationRules,escalationEvents,deliverySettings,deliveries:sanitizedDeliveries,deliveryCounts,incidents,incidentCounts,incidentAnalytics,incidentPolicies,incidentEvents,watchdog,deviceUsers,commands,deviceShiftTemplates,deleteRequests,calendarRules,policies,links,logs,unlinkedGroups,unlinkedTotal,unlinkedTruncated:(unlinkedRows||[]).length>=5000,employees,shiftPeriods:scopedShiftPeriods,users,branches,scope:{branch_id:branchId||null,all_branches:elevated(me),environment:mode},permissions:{view:true,manage_devices:canManageDevices(me),manage_links:canManageLinks(me),manage_employees:canManageEmployees(me),manage_schedules:canManageSchedules(me),manage_policies:canManagePolicies(me),review_violations:canReviewViolations(me),close_month:canCloseMonth(me),reopen_month:canReopenMonth(me),delete_employees:canDeleteEmployees(me),reports:canReports(me)},adms:{host:'system.almaheralmasi.sa',port:443,https:true,domain:true,proxy:false,path:'/iclock'}};
}

async function attendanceReport(env,me,body){
 if(!canReports(me))throw Object.assign(new Error('لا توجد صلاحية لطباعة وعرض كشوف الحضور.'),{status:403});
 const branchId=requestedBranch(me,body),mode=accountMode(me),from=dateStart(body.from_date),to=dateEndExclusive(body.to_date||body.from_date);
 if(!from||!to)throw Object.assign(new Error('حدد تاريخ بداية ونهاية صحيحين.'),{status:400});
 const maxDays=93;if((to-from)/86400000>maxDays)throw Object.assign(new Error('الفترة القصوى للكشف الواحد 93 يومًا.'),{status:400});
 let path='attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at';
 path+='&data_environment=eq.'+enc(mode)+'&occurred_at=gte.'+enc(from.toISOString())+'&occurred_at=lt.'+enc(to.toISOString());
 if(branchId)path+='&branch_id=eq.'+enc(branchId);
 if(txt(body.attendance_employee_id))path+='&attendance_employee_id=eq.'+enc(body.attendance_employee_id);
 if(txt(body.device_id))path+='&device_id=eq.'+enc(body.device_id);
 path+='&order=occurred_at.asc&limit=10000';
 const logs=await rest(env,path);
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
 let monthClosure=null;
 const fromKey=txt(body.from_date),toKey=txt(body.to_date||body.from_date),period=monthStartKey(fromKey);
 if(branchId&&period&&fromKey===period&&toKey===monthEndKey(period)){
  monthClosure=(await rest(env,'attendance_month_closures?branch_id=eq.'+enc(branchId)+'&period_month=eq.'+enc(period)+'&data_environment=eq.'+enc(mode)+'&select=*&limit=1').catch(()=>[]))?.[0]||null;
 }
 return {ok:true,logs,calendar_rules:calendarRules,violation_decisions:violationDecisions,month_closure:monthClosure,from_date:fromKey,to_date:toKey,environment:mode,branch_id:branchId||null,truncated:Array.isArray(logs)&&logs.length>=10000};
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

async function saveEmployee(env,me,body){
 if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة موظفي الحضور.'),{status:403});
 const id=txt(body.id),name=txt(body.name),branchId=elevated(me)?txt(body.branch_id):actorBranch(me),staffId=txt(body.staff_user_id),requestedEnv=body.data_environment==='production'?'production':'training',systemMode=await runtimeMode(env);
 if(!name)throw Object.assign(new Error('اسم الموظف مطلوب.'),{status:400});if(!branchId)throw Object.assign(new Error('اختر فرع الموظف.'),{status:400});if(requestedEnv==='production'&&systemMode!=='production')throw Object.assign(new Error('لا يمكن إنشاء موظف حضور Production بينما النظام في وضع التدريب.'),{status:409});
 let staff=null;if(staffId){const rows=await rest(env,'staff_users?id=eq.'+enc(staffId)+'&select=id,name,branch_id,status&limit=1');staff=rows?.[0]||null;if(!staff)throw Object.assign(new Error('حساب الموظف المختار غير موجود.'),{status:404});if(!elevated(me)&&txt(staff.branch_id)!==actorBranch(me))throw Object.assign(new Error('لا يمكن ربط حساب من فرع آخر.'),{status:403})}
 let before=null;if(id){before=await scopedEmployee(env,me,id);if(!before)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404})}
 const suppliedPeriods=Array.isArray(body.shift_periods),periods=suppliedPeriods?cleanShiftPeriods(body.shift_periods):cleanShiftPeriods([{label:'الفترة الأولى',start_time:body.shift_start,end_time:body.shift_end,grace_minutes:body.grace_minutes}]);
 const firstPeriod=periods[0]||null;
 const payload={name,branch_id:branchId,phone:txt(body.phone)||null,national_id:txt(body.national_id)||null,department:txt(body.department)||null,job_title:txt(body.job_title)||null,staff_user_id:staff?.id||null,shift_start:firstPeriod?.start_time||null,shift_end:firstPeriod?.end_time||null,grace_minutes:firstPeriod?.grace_minutes??Math.max(0,Math.min(240,Number(body.grace_minutes||0))),weekly_off_days:cleanOffDays(body.weekly_off_days),status:body.status==='inactive'?'inactive':'active',data_environment:requestedEnv,notes:txt(body.notes)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 const employeeCode=txt(body.employee_code);if(employeeCode)payload.employee_code=employeeCode;
 let after;if(id)after=(await rest(env,'attendance_employees?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;else after=(await rest(env,'attendance_employees',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ موظف الحضور.'),{status:500});
 if(suppliedPeriods)await replaceShiftPeriods(env,me,after.id,periods);
 const autoPush=body.auto_push!==false,devicesQueued=autoPush?await queueEmployeeAutoPush(env,me,after):0;
 await audit(env,me,id?'attendance_employee_update':'attendance_employee_create','attendance_employee',after.id,after.branch_id,before,{...after,shift_periods:periods,auto_push:autoPush,devices_queued:devicesQueued},txt(body.reason)||'إدارة موظف حضور');
 return {ok:true,employee:after,shift_periods:periods,auto_push:autoPush,devices_queued:devicesQueued};
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
 const rows=await rest(env,'attendance_employee_links?on_conflict=device_id%2Cdevice_pin',{method:'POST',body:{...payload,created_by:before?.created_by||actorId(me)||actorName(me)||null},prefer:'resolution=merge-duplicates,return=representation'}),after=rows?.[0]||null;
 if(attendanceEmployee||staff||displayName){const patch={attendance_employee_id:attendanceEmployee?.id||null,staff_user_id:resolvedStaff,employee_name:displayName,branch_id:branchId};await rest(env,'attendance_raw_logs?device_id=eq.'+enc(device.id)+'&device_pin=eq.'+enc(pin),{method:'PATCH',body:patch,prefer:'return=minimal'}).catch(()=>{})}
 await audit(env,me,before?'attendance_link_update':'attendance_link_create','attendance_employee_link',after?.id||'',branchId,before,after,'ربط رقم جهاز البصمة بموظف');return {ok:true,link:after};
}

async function deleteLink(env,me,body){if(!canManageLinks(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة روابط موظفي البصمة.'),{status:403});const id=txt(body.id),rows=await rest(env,'attendance_employee_links?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;if(!before)throw Object.assign(new Error('الرابط غير موجود.'),{status:404});const device=await scopedDevice(env,me,before.device_id);if(!device)throw Object.assign(new Error('الرابط خارج نطاق الفرع.'),{status:403});await rest(env,'attendance_employee_links?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});await audit(env,me,'attendance_link_delete','attendance_employee_link',id,before.branch_id,before,null,'حذف ربط البصمة');return {ok:true}}

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
  if(action==='import_device_users')return json(await importDeviceUsers(env,me,body));
  if(action==='import_historical_attendance')return json(await importHistoricalAttendance(env,me,body));
  if(action==='save_device_shift_template')return json(await saveDeviceShiftTemplate(env,me,body));
  if(action==='delete_device_shift_template')return json(await deleteDeviceShiftTemplate(env,me,body));
  if(action==='push_device_user')return json(await pushDeviceUser(env,me,body));
  if(action==='push_employee_to_devices')return json(await pushEmployeeToDevices(env,me,body));
  if(action==='save_device')return json(await saveDevice(env,me,body));
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
  if(action==='delete_link')return json(await deleteLink(env,me,body));
  if(action==='update_notification')return json(await updateAttendanceNotification(env,me,body));
  if(action==='mark_notifications_seen')return json(await markAttendanceNotificationsSeen(env,me,body));
  if(action==='save_escalation_rule')return json(await saveAttendanceEscalationRule(env,me,body));
  if(action==='save_delivery_settings')return json(await saveAttendanceDeliverySettings(env,me,body));
  if(action==='retry_notification_delivery')return json(await retryAttendanceDelivery(env,me,body));
  if(action==='run_watchdog')return json(await runAttendanceWatchdogNow(env,me));
  if(action==='update_incident')return json(await updateAttendanceIncident(env,me,body));
  if(action==='save_incident_sla_policy')return json(await saveAttendanceIncidentSlaPolicy(env,me,body));
  return json({error:'إجراء غير مدعوم.'},400);
 }catch(e){return json({error:e.message||'تعذر تنفيذ عملية الحضور والبصمة'},e.status||500)}
}

export default {
 async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname.startsWith('/iclock/'))return admsRequest(request,env);if(url.pathname==='/api/attendance')return attendanceApi(request,env,ctx);return appWorker.fetch(request,env,ctx)},
 async scheduled(controller,env,ctx){
  const inherited=typeof appWorker?.scheduled==='function'?Promise.resolve(appWorker.scheduled(controller,env,ctx)):Promise.resolve();
  await Promise.all([inherited,runAttendanceWatchdog(env,'scheduled')]);
 }
};
