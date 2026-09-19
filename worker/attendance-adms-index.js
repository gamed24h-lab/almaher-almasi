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
function parseDeviceInfo(body){const out={};for(const raw of String(body||'').split(/\r?\n/)){const line=raw.trim();if(!line.startsWith('~')||!line.includes('='))continue;const i=line.indexOf('='),key=line.slice(1,i).trim().toLowerCase(),value=line.slice(i+1).trim();if(['devicename','firmware','firmver','pushversion','platform','ipaddress','mac'].includes(key))out[key]=value}return out}
async function getDevice(env,serial){if(!serial)return null;const rows=await rest(env,'attendance_devices?serial_number=eq.'+enc(serial)+'&select=*&limit=1');return rows?.[0]||null}
async function touchDevice(env,device,request,url,extra={}){if(!device?.id)return;const patch={last_seen_at:new Date().toISOString(),last_ip:clientIp(request),updated_at:new Date().toISOString()};const pv=txt(url.searchParams.get('pushver')||extra.pushversion);if(pv)patch.push_version=pv;const fw=txt(extra.firmware||extra.firmver);if(fw)patch.firmware=fw;const dn=txt(extra.devicename);if(dn)patch.device_name=dn;const meta={...(device.metadata||{}),last_protocol_path:url.pathname,last_user_agent:txt(request.headers.get('User-Agent')),platform:txt(extra.platform)||device.metadata?.platform||null,mac:txt(extra.mac)||device.metadata?.mac||null};patch.metadata=meta;await rest(env,'attendance_devices?id=eq.'+enc(device.id),{method:'PATCH',body:patch,prefer:'return=minimal'})}
function handshake(serial){return ['GET OPTION FROM: '+serial,'Stamp=9999','ATTLOGStamp=9999','OPERLOGStamp=9999','ATTPHOTOStamp=9999','ErrorDelay=30','Delay=10','TransTimes=00:00;23:59','TransInterval=1','TransFlag=1111000000','Realtime=1','Encrypt=0',''].join('\r\n')}

async function admsRequest(request,env){if(!base(env)||!serviceKey(env))return plain('ERROR: SERVER_CONFIG',503);const url=new URL(request.url),serial=serialFrom(url);if(url.pathname==='/iclock/health')return plain('OK');if(!serial)return plain('ERROR: SN_REQUIRED',200);const device=await getDevice(env,serial).catch(()=>null);if(!device||device.status!=='active')return plain('ERROR: DEVICE_NOT_REGISTERED',200);
 if(request.method==='GET'&&url.pathname==='/iclock/cdata'){await touchDevice(env,device,request,url).catch(()=>{});return plain(handshake(serial))}
 if(request.method==='GET'&&url.pathname==='/iclock/getrequest'){await touchDevice(env,device,request,url).catch(()=>{});return plain('OK')}
 if((request.method==='GET'||request.method==='POST')&&url.pathname==='/iclock/registry'){const body=request.method==='POST'?await request.text():'';const info=parseDeviceInfo(body);await touchDevice(env,device,request,url,info).catch(()=>{});return plain(request.method==='GET'?handshake(serial):'OK')}
 if(request.method==='POST'&&url.pathname==='/iclock/devicecmd'){await touchDevice(env,device,request,url).catch(()=>{});return plain('OK')}
 if(request.method==='POST'&&url.pathname==='/iclock/cdata'){
   const body=await request.text(),table=txt(url.searchParams.get('table')).toUpperCase(),info=parseDeviceInfo(body);await touchDevice(env,device,request,url,info).catch(()=>{});
   if(table!=='ATTLOG')return plain('OK: '+String(body.split(/\r?\n/).filter(Boolean).length));
   const links=await rest(env,'attendance_employee_links?device_id=eq.'+enc(device.id)+'&active=eq.true&select=device_pin,attendance_employee_id,staff_user_id,branch_id,display_name').catch(()=>[]);
   const linkMap=new Map((links||[]).map(x=>[txt(x.device_pin),x])),rows=[];
   for(const raw of body.split(/\r?\n/)){
     const line=raw.trim();if(!line)continue;const f=line.split('\t'),pin=txt(f[0]),rawTime=txt(f[1]),occurred=parseSaudiDeviceTime(rawTime);if(!pin||!occurred)continue;
     const statusCode=safeInt(f[2]),verifyCode=safeInt(f[3]),workCode=txt(f[4]),link=linkMap.get(pin)||null,branchId=link?.branch_id||device.branch_id||null;
     rows.push({device_id:device.id,serial_number:serial,branch_id:branchId,device_pin:pin,attendance_employee_id:link?.attendance_employee_id||null,staff_user_id:link?.staff_user_id||null,employee_name:txt(link?.display_name)||null,occurred_at:occurred,device_time_raw:rawTime,status_code:statusCode,verify_code:verifyCode,work_code:workCode||null,source_ip:clientIp(request)||null,raw_line:line.slice(0,700),data_environment:device.data_environment||'training',dedupe_key:dedupe(device.id,pin,rawTime,statusCode,verifyCode,workCode),metadata:{protocol:'zkteco_adms',table:'ATTLOG'}})
   }
   if(rows.length)await rest(env,'attendance_raw_logs?on_conflict=dedupe_key',{method:'POST',body:rows,prefer:'resolution=ignore-duplicates,return=minimal'});
   return plain('OK: '+rows.length)
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

async function attendanceState(env,me,url){
 const branchId=requestedBranch(me,{},url),mode=accountMode(me),dFilter=branchId?'&branch_id=eq.'+enc(branchId):'',lFilter=branchId?'&branch_id=eq.'+enc(branchId):'',logFilter=branchId?'&branch_id=eq.'+enc(branchId):'',empFilter=branchId?'&branch_id=eq.'+enc(branchId):'',userFilter=branchId?'&branch_id=eq.'+enc(branchId):'',branchFilter=branchId?'?id=eq.'+enc(branchId)+'&select=id,name,status,address':'?select=id,name,status,address&order=name.asc';
 const [devices,links,logs,employees,users,branches]=await Promise.all([
  rest(env,'attendance_devices?select=*&order=created_at.asc'+dFilter),
  rest(env,'attendance_employee_links?select=*&order=created_at.desc'+lFilter),
  rest(env,'attendance_raw_logs?select=id,device_id,serial_number,branch_id,device_pin,attendance_employee_id,staff_user_id,employee_name,occurred_at,device_time_raw,status_code,verify_code,work_code,data_environment,received_at&data_environment=eq.'+enc(mode)+logFilter+'&order=occurred_at.desc&limit=500'),
  rest(env,'attendance_employees?select=*&data_environment=eq.'+enc(mode)+empFilter+'&order=name.asc'),
  rest(env,'staff_users?select=id,name,username,role,branch_id,status&status=neq.%D9%85%D9%88%D9%82%D9%88%D9%81'+userFilter+'&order=name.asc'),
  rest(env,'branches'+branchFilter)
 ]);
 return {ok:true,devices,links,logs,employees,users,branches,scope:{branch_id:branchId||null,all_branches:elevated(me),environment:mode},permissions:{view:true,manage_devices:canManageDevices(me),manage_links:canManageLinks(me),manage_employees:canManageEmployees(me),reports:canReports(me)},adms:{host:'system.almaheralmasi.sa',port:443,https:true,domain:true,proxy:false,path:'/iclock'}};
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
 const payload={name,branch_id:branchId,phone:txt(body.phone)||null,national_id:txt(body.national_id)||null,department:txt(body.department)||null,job_title:txt(body.job_title)||null,staff_user_id:staff?.id||null,shift_start:cleanTime(body.shift_start),shift_end:cleanTime(body.shift_end),grace_minutes:Math.max(0,Math.min(240,Number(body.grace_minutes||0))),weekly_off_days:cleanOffDays(body.weekly_off_days),status:body.status==='inactive'?'inactive':'active',data_environment:requestedEnv,notes:txt(body.notes)||null,updated_by:actorId(me)||actorName(me)||null,updated_at:new Date().toISOString()};
 const employeeCode=txt(body.employee_code);if(employeeCode)payload.employee_code=employeeCode;
 let after;if(id)after=(await rest(env,'attendance_employees?id=eq.'+enc(id),{method:'PATCH',body:payload,prefer:'return=representation'}))?.[0]||null;else after=(await rest(env,'attendance_employees',{method:'POST',body:{...payload,created_by:actorId(me)||actorName(me)||null},prefer:'return=representation'}))?.[0]||null;
 if(!after)throw Object.assign(new Error('تعذر حفظ موظف الحضور.'),{status:500});
 await audit(env,me,id?'attendance_employee_update':'attendance_employee_create','attendance_employee',after.id,after.branch_id,before,after,txt(body.reason)||'إدارة موظف حضور');
 return {ok:true,employee:after};
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
  if(action==='save_device')return json(await saveDevice(env,me,body));
  if(action==='save_employee')return json(await saveEmployee(env,me,body));
  if(action==='save_link')return json(await saveLink(env,me,body));
  if(action==='delete_link')return json(await deleteLink(env,me,body));
  return json({error:'إجراء غير مدعوم.'},400);
 }catch(e){return json({error:e.message||'تعذر تنفيذ عملية الحضور والبصمة'},e.status||500)}
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname.startsWith('/iclock/'))return admsRequest(request,env);if(url.pathname==='/api/attendance')return attendanceApi(request,env,ctx);return appWorker.fetch(request,env,ctx)}};
