import appWorker from './finance-budget-management-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const key=env=>String(env.SUPABASE_SERVICE_ROLE_KEY||'');
const headers=env=>({apikey:key(env),Authorization:`Bearer ${key(env)}`,Accept:'application/json','Content-Type':'application/json'});
const text=v=>String(v??'').trim();
const lower=v=>text(v).toLowerCase();
const enc=v=>encodeURIComponent(String(v??''));
const elevated=u=>!!u&&(lower(u.role)==='developer'||u.role==='مدير عام'||u.permissions?.all===true||u.permissions?.allBranches===true);
const canPreview=u=>!!u&&(elevated(u)||u.permissions?.editBookings===true||u.permissions?.editPassenger===true);
const canMerge=u=>!!u&&(elevated(u)||u.permissions?.editBookings===true||u.permissions?.editPassenger===true);

async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||('HTTP '+r.status)}}}
async function actor(request,env,ctx){
 try{
  const r=await appWorker.fetch(new Request(new URL('/api/auth/me',request.url),{method:'GET',headers:request.headers}),env,ctx);
  if(!r.ok)return null;
  return (await readJson(r))?.user||null;
 }catch{return null}
}
async function rows(env,table,query){
 const r=await fetch(`${base(env)}/rest/v1/${table}?${query}`,{headers:headers(env)});
 const b=await readJson(r);if(!r.ok)throw new Error(b?.message||`تعذر قراءة ${table}`);return Array.isArray(b)?b:[];
}
async function rpc(env,name,body){
 const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(env),body:JSON.stringify(body)});
 const b=await readJson(r);if(!r.ok){const e=new Error(b?.message||b?.details||'تعذر تنفيذ العملية');e.code=String(b?.message||'');throw e}return b;
}
const digits=v=>text(v).replace(/\D/g,'');
const compact=v=>lower(v).replace(/\s+/g,'');
function strongMatch(a,b){
 const ai=compact(a?.identity_number),bi=compact(b?.identity_number);
 if(ai&&bi&&ai===bi)return {ok:true,type:'identity',label:'نفس رقم الهوية / الإقامة'};
 const ap=digits(a?.phone),bp=digits(b?.phone),an=compact(a?.full_name),bn=compact(b?.full_name);
 if(ap&&bp&&ap===bp&&an&&bn&&an===bn)return {ok:true,type:'phone_name',label:'نفس الاسم والجوال'};
 return {ok:false,type:'none',label:'لا توجد مطابقة قوية كافية'};
}
function activeStatus(v){return !['released','cancelled','canceled'].includes(lower(v||'assigned'))}
function conflictPreview(refs,a,b){
 const conflicts=[];
 const seats=refs.seat_assignments||[],tripSeats=refs.trip_seat_assignments||[],rooms=refs.room_assignments||[],housing=refs.housing_assignments||[];
 const ca=seats.filter(x=>String(x.passenger_id)===String(a.id)&&activeStatus(x.status)),da=seats.filter(x=>String(x.passenger_id)===String(b.id)&&activeStatus(x.status));
 if(ca.some(x=>da.some(y=>String(x.trip_vehicle_id)===String(y.trip_vehicle_id)&&lower(x.segment_type)===lower(y.segment_type))))conflicts.push('يوجد تعارض مقاعد فعّال لنفس الاتجاه.');
 const cta=tripSeats.filter(x=>String(x.booking_passenger_id)===String(a.id)&&activeStatus(x.assignment_status)),dta=tripSeats.filter(x=>String(x.booking_passenger_id)===String(b.id)&&activeStatus(x.assignment_status));
 if(cta.some(x=>dta.some(y=>String(x.trip_bus_id)===String(y.trip_bus_id)&&lower(x.direction)===lower(y.direction))))conflicts.push('يوجد تعارض في مقاعد الرحلة لنفس الاتجاه.');
 if(rooms.some(x=>String(x.passenger_id)===String(a.id)&&activeStatus(x.status))&&rooms.some(x=>String(x.passenger_id)===String(b.id)&&activeStatus(x.status)))conflicts.push('السجلان مرتبطان بتسكين فعّال؛ راجع الغرف أولًا.');
 if(housing.some(x=>String(x.booking_passenger_id)===String(a.id)&&activeStatus(x.assignment_status))&&housing.some(x=>String(x.booking_passenger_id)===String(b.id)&&activeStatus(x.assignment_status)))conflicts.push('السجلان مرتبطان بتوزيع سكن فعّال؛ راجع التسكين أولًا.');
 return conflicts;
}
async function referenceRows(env,a,b){
 const ids=`(${a.id},${b.id})`;
 const specs=[
  ['housing_assignments','booking_passenger_id','id,booking_passenger_id,assignment_status,room_id,housing_id'],
  ['ticket_scan_events','booking_passenger_id','id,booking_passenger_id'],
  ['notification_jobs','booking_passenger_id','id,booking_passenger_id'],
  ['trip_seat_assignments','booking_passenger_id','id,booking_passenger_id,trip_bus_id,direction,assignment_status,seat_number'],
  ['ticket_print_log','booking_passenger_id','id,booking_passenger_id'],
  ['room_assignments','passenger_id','id,passenger_id,trip_room_id,hotel_room_id,status'],
  ['seat_assignments','passenger_id','id,passenger_id,trip_vehicle_id,segment_type,status,seat_no'],
  ['print_events','passenger_id','id,passenger_id'],
  ['passenger_documents','passenger_id','id,passenger_id'],
  ['passenger_meeting_points','passenger_id','id,passenger_id'],
  ['passenger_qr_tokens','passenger_id','id,passenger_id'],
  ['lost_found','passenger_id','id,passenger_id'],
  ['refunds','passenger_id','id,passenger_id'],
  ['scan_events','passenger_id','id,passenger_id']
 ];
 const out={};
 await Promise.all(specs.map(async([table,col,select])=>{out[table]=await rows(env,table,`${col}=in.${ids}&select=${enc(select)}&limit=500`)}));
 return out;
}
function refCounts(refs,id){
 const out={};
 for(const [table,list] of Object.entries(refs))out[table]=(list||[]).filter(x=>String(x.booking_passenger_id||x.passenger_id)===String(id)).length;
 return out;
}
function friendlyMergeError(e){
 const m=String(e?.message||e||'');
 if(/MERGE_REASON_REQUIRED/i.test(m))return 'اكتب سبب الدمج بوضوح (5 أحرف على الأقل).';
 if(/MERGE_SAME_BOOKING_ONLY/i.test(m))return 'الدمج مسموح فقط لسجلين مكررين داخل نفس الحجز. تكرار نفس الشخص في حجوزات مختلفة يُعتبر تاريخ سفر وليس سجلًا مكررًا.';
 if(/MERGE_STRONG_MATCH_REQUIRED/i.test(m))return 'لا توجد مطابقة قوية كافية بين السجلين.';
 if(/MERGE_(SEAT|TRIP_SEAT)_CONFLICT/i.test(m))return 'يوجد تعارض مقاعد بين السجلين. عالج المقاعد أولًا ثم أعد المحاولة.';
 if(/MERGE_(ROOM|HOUSING)_CONFLICT/i.test(m))return 'يوجد تعارض تسكين بين السجلين. عالج التسكين أولًا ثم أعد المحاولة.';
 if(/MERGE_ENVIRONMENT_MISMATCH/i.test(m))return 'لا يمكن دمج سجلين من بيئتين مختلفتين.';
 if(/MERGE_PASSENGER_NOT_FOUND|MERGE_BOOKING_NOT_FOUND/i.test(m))return 'أحد السجلات لم يعد موجودًا.';
 return m||'تعذر دمج السجلين.';
}
async function inspectPair(env,u,canonicalId,duplicateId){
 if(!canonicalId||!duplicateId||canonicalId===duplicateId)return {can_merge:false,reasons:['اختر سجلين مختلفين.']};
 const pair=await rows(env,'booking_passengers',`id=in.(${enc(canonicalId)},${enc(duplicateId)})&select=*&limit=2`);
 const canonical=pair.find(x=>String(x.id)===String(canonicalId)),duplicate=pair.find(x=>String(x.id)===String(duplicateId));
 if(!canonical||!duplicate)return {can_merge:false,reasons:['أحد السجلين غير موجود.']};
 const bookingRows=await rows(env,'bookings',`id=eq.${enc(canonical.booking_id)}&select=id,booking_number,branch_id,data_environment&limit=1`);
 const booking=bookingRows[0]||null;
 if(!booking)return {can_merge:false,reasons:['الحجز غير موجود.'],canonical,duplicate};
 if(!elevated(u)&&String(booking.branch_id||'')!==String(u?.branch_id||''))return {forbidden:true,can_merge:false,reasons:['الحجز خارج نطاق فرعك.']};
 const reasons=[];
 if(String(canonical.booking_id)!==String(duplicate.booking_id))reasons.push('السجلان ليسا داخل نفس الحجز.');
 if(String(canonical.data_environment||'')!==String(duplicate.data_environment||''))reasons.push('السجلان من بيئتين مختلفتين.');
 if(['merged','deleted'].includes(lower(canonical.status))||['merged','deleted'].includes(lower(duplicate.status)))reasons.push('أحد السجلين مدموج أو محذوف بالفعل.');
 const match=strongMatch(canonical,duplicate);if(!match.ok)reasons.push(match.label);
 const refs=await referenceRows(env,canonical,duplicate);
 reasons.push(...conflictPreview(refs,canonical,duplicate));
 return {can_merge:reasons.length===0,match,reasons,canonical,duplicate,booking,references:{canonical:refCounts(refs,canonical.id),duplicate:refCounts(refs,duplicate.id)}};
}
async function handle(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(!canPreview(u))return json({error:'لا توجد صلاحية مراجعة تكرارات المسافرين.'},403);
 const preview=await inspectPair(env,u,String(body.canonical_id||''),String(body.duplicate_id||''));
 if(preview.forbidden)return json({error:preview.reasons?.[0]||'خارج نطاق الفرع.'},403);
 if(body.action==='passenger_duplicate_preview')return json({ok:true,...preview,can_execute:canMerge(u)});
 if(!canMerge(u))return json({error:'دمج سجلات المسافرين يتطلب صلاحية تعديل المسافر أو الحجز.'},403);
 if(!preview.can_merge)return json({error:preview.reasons?.join(' ')||'لا يمكن دمج السجلين.',preview},409);
 if(text(body.confirm_booking_number)!==text(preview.booking?.booking_number))return json({error:'اكتب رقم الحجز كما هو لتأكيد عملية الدمج.'},400);
 if(text(body.reason).length<5)return json({error:'سبب الدمج مطلوب (5 أحرف على الأقل).'},400);
 try{
  const result=await rpc(env,'merge_booking_passenger_duplicates',{
   p_canonical:preview.canonical.id,p_duplicate:preview.duplicate.id,
   p_actor_id:String(u.id||''),p_actor_name:String(u.name||u.username||''),p_actor_role:String(u.role||''),
   p_reason:text(body.reason)
  });
  return json({ok:true,result,preview});
 }catch(e){return json({error:friendlyMergeError(e)},409)}
}


const employeeMode=u=>u?.permissions?._accountMode==='production'?'production':'training';
const canReviewEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_employees===true||u.permissions?.attendance_view===true);
const canMergeEmployees=u=>!!u&&(elevated(u)||u.permissions?.attendance_manage_employees===true);
function employeeMatch(a,b){
 const as=compact(a?.staff_user_id),bs=compact(b?.staff_user_id);
 if(as&&bs&&as===bs)return {ok:true,type:'staff_user',label:'نفس حساب الموظف'};
 const anid=compact(a?.national_id),bnid=compact(b?.national_id);
 if(anid&&bnid&&anid===bnid)return {ok:true,type:'national_id',label:'نفس الهوية / الإقامة'};
 const ap=digits(a?.phone),bp=digits(b?.phone),an=compact(a?.name),bn=compact(b?.name);
 if(ap&&bp&&ap===bp&&an&&bn&&an===bn)return {ok:true,type:'phone_name',label:'نفس الاسم والجوال'};
 return {ok:false,type:'none',label:'لا توجد مطابقة قوية كافية'};
}
function employeeKeys(x){
 const out=[],staff=compact(x?.staff_user_id),nid=compact(x?.national_id),phone=digits(x?.phone),name=compact(x?.name);
 if(staff)out.push('staff:'+staff);
 if(nid)out.push('nid:'+nid);
 if(phone&&name)out.push('phone_name:'+phone+'|'+name);
 return out;
}
function employeeGroups(list){
 const n=list.length,parent=Array.from({length:n},(_,i)=>i),rank=Array(n).fill(0);
 const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const join=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++};
 const keyOwner=new Map();
 for(let i=0;i<n;i++)for(const k of employeeKeys(list[i])){if(keyOwner.has(k))join(i,keyOwner.get(k));else keyOwner.set(k,i)}
 const grouped=new Map();
 for(let i=0;i<n;i++){const root=find(i),arr=grouped.get(root)||[];arr.push(list[i]);grouped.set(root,arr)}
 return [...grouped.values()].filter(g=>g.length>1).map(records=>{
   records.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
   const match=employeeMatch(records[0],records[1]);
   return {id:'attendance-dup-'+records[0].id,branch_id:records[0].branch_id||null,match:match.label,match_type:match.type,records,canonical:records[0]};
 });
}
async function employeeDuplicateList(env,u){
 if(!canReviewEmployees(u))throw Object.assign(new Error('لا توجد صلاحية مراجعة تكرارات موظفي الحضور.'),{status:403});
 const mode=employeeMode(u),parts=['status=eq.active','data_environment=eq.'+enc(mode),'select='+enc('id,employee_code,name,branch_id,phone,national_id,department,job_title,staff_user_id,status,data_environment,created_at,updated_at,merged_into_id')];
 if(!elevated(u)){
  if(!u?.branch_id)return {ok:true,groups:[],mode};
  parts.push('branch_id=eq.'+enc(u.branch_id));
 }
 parts.push('order=created_at.asc','limit=5000');
 const employees=await rows(env,'attendance_employees',parts.join('&'));
 return {ok:true,groups:employeeGroups(employees),mode,total_employees:employees.length};
}
async function employeeReferenceRows(env,a,b){
 const ids='('+a.id+','+b.id+')',specs=[
  ['attendance_employee_links','attendance_employee_id','id,attendance_employee_id,device_id,device_pin,staff_user_id,active'],
  ['attendance_raw_logs','attendance_employee_id','id,attendance_employee_id,device_id,device_pin,occurred_at'],
  ['attendance_employee_shift_periods','attendance_employee_id','id,attendance_employee_id,sequence_no,label,start_time,end_time,grace_minutes,active,weekdays'],
  ['attendance_employee_calendar_rules','attendance_employee_id','id,attendance_employee_id,rule_type,label,start_date,end_date,status'],
  ['attendance_violation_decisions','attendance_employee_id','id,attendance_employee_id,work_date,data_environment,decision_status'],
  ['attendance_employee_delete_requests','attendance_employee_id','id,attendance_employee_id,status,created_at']
 ],out={};
 await Promise.all(specs.map(async([table,col,select])=>{
  const cap=table==='attendance_raw_logs'?1001:500;
  out[table]=await rows(env,table,col+'=in.'+ids+'&select='+enc(select)+'&limit='+cap).catch(()=>[]);
 }));
 return out;
}
function employeeRefCounts(refs,id){
 const out={};
 for(const [table,list] of Object.entries(refs)){
  const count=(list||[]).filter(x=>String(x.attendance_employee_id)===String(id)).length;
  out[table]={count:table==='attendance_raw_logs'&&count>=1001?'1000+':count,truncated:table==='attendance_raw_logs'&&count>=1001};
 }
 return out;
}
function employeeConflicts(refs,a,b){
 const reasons=[];
 const as=compact(a.staff_user_id),bs=compact(b.staff_user_id),anid=compact(a.national_id),bnid=compact(b.national_id);
 if(as&&bs&&as!==bs)reasons.push('السجلان مربوطان بحسابي موظفين مختلفين.');
 if(anid&&bnid&&anid!==bnid)reasons.push('رقما الهوية مختلفان.');
 const ap=(refs.attendance_employee_shift_periods||[]).filter(x=>String(x.attendance_employee_id)===String(a.id));
 const bp=(refs.attendance_employee_shift_periods||[]).filter(x=>String(x.attendance_employee_id)===String(b.id));
 if(ap.length&&bp.length)reasons.push('السجلان لديهما فترات دوام؛ يلزم توحيد الدوام قبل الدمج.');
 const av=(refs.attendance_violation_decisions||[]).filter(x=>String(x.attendance_employee_id)===String(a.id));
 const bv=(refs.attendance_violation_decisions||[]).filter(x=>String(x.attendance_employee_id)===String(b.id));
 if(av.some(x=>bv.some(y=>String(x.work_date)===String(y.work_date)&&String(x.data_environment)===String(y.data_environment))))reasons.push('يوجد قرار مخالفة لنفس اليوم على السجلين.');
 return reasons;
}
async function inspectEmployeePair(env,u,canonicalId,duplicateId){
 if(!canonicalId||!duplicateId||canonicalId===duplicateId)return {can_merge:false,reasons:['اختر سجلين مختلفين.']};
 const pair=await rows(env,'attendance_employees','id=in.('+enc(canonicalId)+','+enc(duplicateId)+')&select=*&limit=2');
 const canonical=pair.find(x=>String(x.id)===String(canonicalId)),duplicate=pair.find(x=>String(x.id)===String(duplicateId));
 if(!canonical||!duplicate)return {can_merge:false,reasons:['أحد سجلي الموظف غير موجود.']};
 if(!elevated(u)&&String(canonical.branch_id||'')!==String(u?.branch_id||''))return {forbidden:true,can_merge:false,reasons:['السجل خارج نطاق فرعك.']};
 const reasons=[];
 if(String(canonical.branch_id||'')!==String(duplicate.branch_id||''))reasons.push('السجلان ليسا في نفس الفرع.');
 if(String(canonical.data_environment||'')!==String(duplicate.data_environment||''))reasons.push('السجلان من بيئتين مختلفتين.');
 if(lower(canonical.status)!=='active'||lower(duplicate.status)!=='active'||canonical.merged_into_id||duplicate.merged_into_id)reasons.push('أحد السجلين غير نشط أو مدموج بالفعل.');
 const match=employeeMatch(canonical,duplicate);if(!match.ok)reasons.push(match.label);
 const refs=await employeeReferenceRows(env,canonical,duplicate);
 reasons.push(...employeeConflicts(refs,canonical,duplicate));
 return {can_merge:reasons.length===0,match,reasons,canonical,duplicate,references:{canonical:employeeRefCounts(refs,canonical.id),duplicate:employeeRefCounts(refs,duplicate.id)}};
}
function friendlyEmployeeMergeError(e){
 const m=String(e?.message||e||'');
 if(/MERGE_REASON_REQUIRED/i.test(m))return 'اكتب سبب الدمج بوضوح (5 أحرف على الأقل).';
 if(/MERGE_SAME_BRANCH_ONLY/i.test(m))return 'دمج موظفي الحضور مسموح داخل نفس الفرع فقط.';
 if(/MERGE_ENVIRONMENT_MISMATCH/i.test(m))return 'لا يمكن دمج سجلين من بيئتين مختلفتين.';
 if(/MERGE_STAFF_ACCOUNT_CONFLICT/i.test(m))return 'السجلان مربوطان بحسابي موظفين مختلفين.';
 if(/MERGE_NATIONAL_ID_CONFLICT/i.test(m))return 'رقما الهوية مختلفان، لذلك تم إيقاف الدمج.';
 if(/MERGE_SHIFT_CONFLICT/i.test(m))return 'يوجد دوام مسجل على السجلين. وحّد فترات الدوام أولًا.';
 if(/MERGE_VIOLATION_CONFLICT/i.test(m))return 'يوجد قرار مخالفة لنفس اليوم على السجلين.';
 if(/MERGE_STRONG_MATCH_REQUIRED/i.test(m))return 'لا توجد مطابقة قوية كافية بين سجلي الموظف.';
 if(/MERGE_EMPLOYEE_NOT_FOUND|MERGE_INACTIVE_EMPLOYEE|MERGE_ALREADY_MERGED/i.test(m))return 'أحد السجلين لم يعد صالحًا للدمج.';
 return m||'تعذر دمج سجلي الموظف.';
}
async function handleEmployeeMerge(request,env,ctx,body){
 const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);
 if(body.action==='attendance_employee_duplicates_list'){
  try{return json(await employeeDuplicateList(env,u))}catch(e){return json({error:e.message},e.status||500)}
 }
 if(!canReviewEmployees(u))return json({error:'لا توجد صلاحية مراجعة تكرارات موظفي الحضور.'},403);
 const preview=await inspectEmployeePair(env,u,String(body.canonical_id||''),String(body.duplicate_id||''));
 if(preview.forbidden)return json({error:preview.reasons?.[0]||'خارج نطاق الفرع.'},403);
 if(body.action==='attendance_employee_duplicate_preview')return json({ok:true,...preview,can_execute:canMergeEmployees(u)});
 if(!canMergeEmployees(u))return json({error:'دمج موظفي الحضور يتطلب صلاحية إدارة موظفي الحضور.'},403);
 if(!preview.can_merge)return json({error:preview.reasons?.join(' ')||'لا يمكن دمج السجلين.',preview},409);
 if(text(body.confirm_employee_code)!==text(preview.canonical?.employee_code))return json({error:'اكتب رقم الموظف الأساسي كما هو لتأكيد عملية الدمج.'},400);
 if(text(body.reason).length<5)return json({error:'سبب الدمج مطلوب (5 أحرف على الأقل).'},400);
 try{
  const result=await rpc(env,'merge_attendance_employee_duplicates',{
   p_canonical:preview.canonical.id,p_duplicate:preview.duplicate.id,
   p_actor_id:String(u.id||''),p_actor_name:String(u.name||u.username||''),p_actor_role:String(u.role||''),
   p_reason:text(body.reason)
  });
  return json({ok:true,result,preview});
 }catch(e){return json({error:friendlyEmployeeMergeError(e)},409)}
}


const canReviewRegistry=u=>!!u&&(elevated(u)||u.permissions?.auditLog===true||u.permissions?.managePermissions===true);
const globalRegistry=u=>!!u&&(elevated(u)||u.permissions?.allBranches===true);
function duplicateGroupsByKeys(records,keyFn,{entity_type,label,warning,recordId}){
 const owners=new Map(),parent=records.map((_,i)=>i),rank=records.map(()=>0);
 const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const join=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++};
 records.forEach((r,i)=>{for(const key of keyFn(r)){if(!key)continue;if(owners.has(key))join(i,owners.get(key));else owners.set(key,i)}});
 const grouped=new Map();records.forEach((r,i)=>{const root=find(i),a=grouped.get(root)||[];a.push(r);grouped.set(root,a)});
 return [...grouped.values()].filter(a=>a.length>1).map((group,idx)=>{
  const keys=keyFn(group[0]);let match='مطابقة قوية';
  for(const k of keys){if(group.slice(1).every(r=>keyFn(r).includes(k))){match=k.startsWith('cr:')?'نفس السجل التجاري':k.startsWith('tax:')?'نفس الرقم الضريبي':k.startsWith('email:')?'نفس البريد الإلكتروني':k.startsWith('phone_name:')?'نفس الاسم والجوال':'مطابقة قوية';break}}
  return {id:entity_type+'-'+idx+'-'+recordId(group[0]),entity_type,label,match,merge_mode:'review_only',warning,records:group.map(r=>({...r,id:recordId(r)}))};
 });
}
async function duplicateReviewRegistry(env,u){
 if(!canReviewRegistry(u))throw Object.assign(new Error('لا توجد صلاحية لمراجعة تكرارات السجلات الحساسة.'),{status:403});
 const global=globalRegistry(u),branch=text(u?.branch_id);
 const [staff,agents,customers]=await Promise.all([
  rows(env,'staff_users','select='+enc('id,name,username,phone,role,branch_id,status,account_mode,created_at,updated_at')+(global?'':branch?'&branch_id=eq.'+enc(branch):'&id=eq.__none__')+'&limit=5000').catch(()=>[]),
  rows(env,'agents','select='+enc('id,agent_code,name,company_name,phone,whatsapp,email,commercial_registration,tax_number,branch_id,status,current_balance,portal_enabled,created_at,updated_at')+(global?'':branch?'&branch_id=eq.'+enc(branch):'&id=eq.00000000-0000-0000-0000-000000000000')+'&limit=5000').catch(()=>[]),
  global?rows(env,'customer_profiles','select='+enc('user_id,full_name,phone,preferred_language,marketing_opt_in,created_at,updated_at')+'&limit=5000').catch(()=>[]):Promise.resolve([])
 ]);
 const staffGroups=duplicateGroupsByKeys(staff,r=>{
  const p=digits(r.phone),n=compact(r.name);return p&&n?['phone_name:'+p+'|'+n]:[];
 },{entity_type:'staff_users',label:'حساب موظف',warning:'حسابات الموظفين لا تُدمج تلقائيًا لأن لها جلسات وصلاحيات وسجل اعتماد. راجع الحسابين يدويًا أولًا.',recordId:r=>String(r.id)});
 const agentGroups=duplicateGroupsByKeys(agents,r=>{
  const keys=[],cr=compact(r.commercial_registration),tax=compact(r.tax_number),email=lower(r.email),p=digits(r.phone||r.whatsapp),n=compact(r.company_name||r.name);
  if(cr)keys.push('cr:'+cr);if(tax)keys.push('tax:'+tax);if(email)keys.push('email:'+email);if(p&&n)keys.push('phone_name:'+p+'|'+n);return keys;
 },{entity_type:'agents',label:'وكيل',warning:'الوكلاء لهم أرصدة وحجوزات وتخصيصات؛ الدمج يحتاج معاينة مالية مستقلة قبل أي تنفيذ.',recordId:r=>String(r.id)});
 const customerGroups=duplicateGroupsByKeys(customers,r=>{
  const p=digits(r.phone),n=compact(r.full_name);return p&&n?['phone_name:'+p+'|'+n]:[];
 },{entity_type:'customer_profiles',label:'حساب عميل',warning:'حساب العميل مرتبط بهوية تسجيل دخول خارجية، لذلك المراجعة فقط حاليًا ولا يوجد دمج تلقائي.',recordId:r=>String(r.user_id)});
 const groups=[...staffGroups,...agentGroups,...customerGroups];
 return {ok:true,groups,summary:{total:groups.length,staff:staffGroups.length,agents:agentGroups.length,customers:customerGroups.length},scope:global?'all':'branch'};
}

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/admin'&&request.method==='POST'){
   let body={};try{body=await request.clone().json()}catch{}
   if(body?.action==='passenger_duplicate_preview'||body?.action==='passenger_duplicate_merge')return handle(request,env,ctx,body);
   if(['attendance_employee_duplicates_list','attendance_employee_duplicate_preview','attendance_employee_duplicate_merge'].includes(body?.action))return handleEmployeeMerge(request,env,ctx,body);
   if(body?.action==='duplicate_review_registry'){const u=await actor(request,env,ctx);if(!u)return json({error:'انتهت الجلسة.'},401);try{return json(await duplicateReviewRegistry(env,u))}catch(e){return json({error:e.message},e.status||500)}}
  }
  return appWorker.fetch(request,env,ctx);
 }
};
