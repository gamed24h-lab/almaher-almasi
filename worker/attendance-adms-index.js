import appWorker from './finance-budget-management-index.js';

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
const canView=u=>!!u&&(elevated(u)||u.permissions?.attendance_view===true||u.permissions?.attendance_manage_devices===true||u.permissions?.attendance_manage_links===true||u.permissions?.attendance_manage_employees===true||u.permissions?.attendance_reports===true);
const canManageDevices=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_devices===true);
const canManageLinks=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_links===true);
const canManageEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_employees===true);
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
 if(url.pathname==='/iclock/getrequest')patch.last_command_poll_at=now;
 const pv=txt(url.searchParams.get('pushver')||extra.pushversion);if(pv)patch.push_version=pv;
 const fw=txt(extra.firmware||extra.firmver||extra.fwversion);if(fw)patch.firmware=fw;
 const dn=txt(extra.devicename);if(dn)patch.device_name=dn;
 const uc=safeInt(extra.usercount),fc=safeInt(extra.fpcount),face=safeInt(extra.facecount),tc=safeInt(extra.transactioncount);
 if(uc!=null)patch.reported_user_count=uc;if(fc!=null)patch.reported_fp_count=fc;if(face!=null)patch.reported_face_count=face;if(tc!=null)patch.reported_transaction_count=tc;
 const meta={...(device.metadata||{}),last_protocol_path:url.pathname,last_user_agent:txt(request.headers.get('User-Agent')),platform:txt(extra.platform)||device.metadata?.platform||null,mac:txt(extra.mac||extra.macaddress)||device.metadata?.mac||null,ip_address:txt(extra.ipaddress)||device.metadata?.ip_address||null};
 patch.metadata=meta;
 await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:patch,prefer:'return=minimal'});
}
function handshake(serial){return ['GET OPTION FROM: '+serial,'Stamp=9999','OpStamp=9999','ATTLOGStamp=9999','OPERLOGStamp=9999','PhotoStamp=9999','ATTPHOTOStamp=9999','ErrorDelay=30','Delay=10','TransTimes=00:00;23:59','TransInterval=1','TransFlag=1111000000','Realtime=1','Encrypt=0',''].join('\r\n')}

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
async function completeDeviceCommand(env,body){
 const raw=String(body||''),lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),groups=new Set();
 for(const line of lines){
  const params=new URLSearchParams(line),id=txt(params.get('ID')||params.get('id')),rc=safeInt(params.get('Return')||params.get('return'));
  if(!id)continue;
  const now=new Date().toISOString();
  const rows=await rest(env,'attendance_device_commands?id=eq.'+enc(id),{method:'PATCH',body:{status:rc===0?'success':'failed',result_code:rc,result_body:line.slice(0,2000),completed_at:now,updated_at:now},prefer:'return=representation'}).catch(()=>[]);
  const cmd=rows?.[0];if(cmd?.command_type==='delete_employee_user'&&cmd.operation_group_id)groups.add(String(cmd.operation_group_id));
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
   return plain(handshake(serial));
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
   return plain(request.method==='GET'?handshake(serial):'OK');
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
   if(table==='ATTLOG'){const n=await storeAttendanceLogs(env,device,serial,request,body);if(n){await markSyncComplete(env,device,'sync_attlog','ATTLOG received: '+n+' records in this batch');await markSyncComplete(env,device,'history_attlog','Historical ATTLOG received: '+n+' records in this batch')}return plain('OK')}
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
 if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لحذف موظفي الحضور.'),{status:403});
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
 const existing=await rest(env,'attendance_device_commands?device_id=eq.'+enc(device.id)+'&command_type=eq.history_attlog&status=in.(queued,sent)&select=id&limit=1').catch(()=>[]);
 let queued=false;
 if(!existing?.length){
  const now=deviceLocalNow();
  await queueCommands(env,device,me,[{type:'history_attlog',command:'DATA QUERY ATTLOG StartTime=2000-01-01 00:00:00\tEndTime='+now}]);
  queued=true;
 }
 await audit(env,me,'attendance_history_import_requested','attendance_device',device.id,device.branch_id,null,{linked_pins:linkedPins,queued},'استيراد وربط كامل الحركات القديمة من جهاز البصمة');
 return {ok:true,queued,linked_pins:linkedPins,message:queued?'تم ربط الحركات الموجودة وطلب كامل سجل الحضور القديم من الجهاز.':'تم ربط الحركات الموجودة، ويوجد طلب استيراد تاريخي قيد التنفيذ بالفعل.'};
}

async function saveEmployeeCalendarRule(env,me,body){
 if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة جدول الموظف.'),{status:403});
 const employee=await scopedEmployee(env,me,txt(body.attendance_employee_id));if(!employee)throw Object.assign(new Error('موظف الحضور غير موجود أو خارج نطاق الفرع.'),{status:404});
 const id=txt(body.id),type=txt(body.rule_type),allowed=new Set(['leave','permission','overtime','work_override','off']);
 if(!allowed.has(type))throw Object.assign(new Error('نوع الاستثناء غير صحيح.'),{status:400});
 const startDate=txt(body.start_date),endDate=txt(body.end_date||body.start_date);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||endDate<startDate)throw Object.assign(new Error('حدد تاريخ بداية ونهاية صحيحين.'),{status:400});
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
 if(!canManageEmployees(me))throw Object.assign(new Error('لا توجد صلاحية لإدارة جدول الموظف.'),{status:403});
 const id=txt(body.id),rows=await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id)+'&select=*&limit=1'),before=rows?.[0]||null;
 if(!before)throw Object.assign(new Error('الاستثناء غير موجود.'),{status:404});
 const employee=await scopedEmployee(env,me,before.attendance_employee_id);if(!employee)throw Object.assign(new Error('الاستثناء خارج نطاق الفرع.'),{status:403});
 await rest(env,'attendance_employee_calendar_rules?id=eq.'+enc(id),{method:'DELETE',prefer:'return=minimal'});
 await audit(env,me,'attendance_calendar_rule_delete','attendance_employee_calendar_rule',id,employee.branch_id,before,null,txt(body.reason)||'حذف استثناء جدول حضور');
 return {ok:true};
}

async function attendanceState(env,me,url){
 const branchId=requestedBranch(me,{},url),mode=accountMode(me),dFilter=branchId?'&branch_id=eq.'+enc(branchId):'',lFilter=branchId?'&branch_id=eq.'+enc(branchId):'',logFilter=branchId?'&branch_id=eq.'+enc(branchId):'',empFilter=branchId?'&branch_id=eq.'+enc(branchId):'',userFilter=branchId?'&branch_id=eq.'+enc(branchId):'',deleteFilter=branchId?'&branch_id=eq.'+enc(branchId):'',calendarFilter=branchId?'&branch_id=eq.'+enc(branchId):'',branchFilter=branchId?'?id=eq.'+enc(branchId)+'&select=id,name,status,address':'?select=id,name,status,address&order=name.asc';
 const [devices,links,logs,employees,users,branches,shiftPeriods,deleteRequests,calendarRules]=await Promise.all([
  rest(env,'attendance_devices?select=*&order=created_at.asc'+dFilter),
  rest(env,'attendance_employee_links?select=*&order=created_at.desc'+lFilter),
  rest(env,'attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at&data_environment=eq.'+enc(mode)+logFilter+'&order=occurred_at.desc&limit=500'),
  rest(env,'attendance_employees?select=*&data_environment=eq.'+enc(mode)+empFilter+'&order=name.asc'),
  rest(env,'staff_users?select=id,name,username,role,branch_id,status&status=neq.%D9%85%D9%88%D9%82%D9%88%D9%81'+userFilter+'&order=name.asc'),
  rest(env,'branches'+branchFilter),
  rest(env,'attendance_employee_shift_periods?select=*&active=eq.true&order=attendance_employee_id.asc,sequence_no.asc'),
  rest(env,'attendance_employee_delete_requests?select=*&order=created_at.desc&limit=100'+deleteFilter),
  rest(env,'attendance_employee_calendar_rules?select=*&status=eq.active&data_environment=eq.'+enc(mode)+calendarFilter+'&order=start_date.desc,created_at.desc&limit=2000')
 ]);
 const deviceIds=(devices||[]).map(d=>d.id).filter(Boolean),inFilter=deviceIds.length?'&device_id=in.('+deviceIds.map(enc).join(',')+')':'';
 const [deviceUsers,commands,deviceShiftTemplates]=deviceIds.length?await Promise.all([
   rest(env,'attendance_device_users?select=id,device_id,serial_number,device_pin,name,privilege,card_number,group_no,timezone_raw,verify_mode,data_environment,source_table,first_seen_at,last_seen_at'+inFilter+'&order=device_pin.asc'),
   rest(env,'attendance_device_commands?select=id,device_id,command_type,status,result_code,created_at,sent_at,completed_at,updated_at'+inFilter+'&order=id.desc&limit=100'),
   rest(env,'attendance_device_shift_templates?select=*&active=eq.true'+inFilter+'&order=device_id.asc,sequence_no.asc,name.asc')
 ]):[[],[],[]];
 const employeeIds=new Set((employees||[]).map(x=>String(x.id))),scopedShiftPeriods=(shiftPeriods||[]).filter(x=>employeeIds.has(String(x.attendance_employee_id)));
 return {ok:true,devices,deviceUsers,commands,deviceShiftTemplates,deleteRequests,calendarRules,links,logs,employees,shiftPeriods:scopedShiftPeriods,users,branches,scope:{branch_id:branchId||null,all_branches:elevated(me),environment:mode},permissions:{view:true,manage_devices:canManageDevices(me),manage_links:canManageLinks(me),manage_employees:canManageEmployees(me),reports:canReports(me)},adms:{host:'system.almaheralmasi.sa',port:443,https:true,domain:true,proxy:false,path:'/iclock'}};
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
 return {ok:true,logs,from_date:txt(body.from_date),to_date:txt(body.to_date||body.from_date),environment:mode,branch_id:branchId||null,truncated:Array.isArray(logs)&&logs.length>=10000};
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
  if(action==='import_device_users')return json(await importDeviceUsers(env,me,body));
  if(action==='import_historical_attendance')return json(await importHistoricalAttendance(env,me,body));
  if(action==='save_device_shift_template')return json(await saveDeviceShiftTemplate(env,me,body));
  if(action==='delete_device_shift_template')return json(await deleteDeviceShiftTemplate(env,me,body));
  if(action==='push_device_user')return json(await pushDeviceUser(env,me,body));
  if(action==='push_employee_to_devices')return json(await pushEmployeeToDevices(env,me,body));
  if(action==='save_device')return json(await saveDevice(env,me,body));
  if(action==='save_employee')return json(await saveEmployee(env,me,body));
  if(action==='delete_employee')return json(await deleteAttendanceEmployee(env,me,body));
  if(action==='save_link')return json(await saveLink(env,me,body));
  if(action==='delete_link')return json(await deleteLink(env,me,body));
  return json({error:'إجراء غير مدعوم.'},400);
 }catch(e){return json({error:e.message||'تعذر تنفيذ عملية الحضور والبصمة'},e.status||500)}
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname.startsWith('/iclock/'))return admsRequest(request,env);if(url.pathname==='/api/attendance')return attendanceApi(request,env,ctx);return appWorker.fetch(request,env,ctx)}};
