import React,{useMemo,useState} from 'react';
import {Plus,RefreshCw,ShieldCheck,UserCog,Wand2,LockKeyhole} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Modal,PageHeader,Select,Table} from '../../components/UI.jsx';

const GENERAL_PERMS=[
 ['branchBooking','إنشاء حجوزات'],['viewBookings','عرض الحجوزات'],['editBookings','تعديل الحجوزات'],['editPassenger','تعديل الركاب'],['changeTrip','نقل الحجز بين الرحلات'],['printTickets','طباعة التذاكر'],
 ['trips','إدارة الرحلات'],['operations','التشغيل'],['manifest','كشف التشغيل'],['housingManifest','كشف التسكين'],['scanner','QR والمسح'],['housing','التسكين'],['seats','المقاعد'],['fleet','الأسطول'],['vehicles','المركبات'],['returns','محرك العودة'],
 ['finance','المالية'],['payments','التحصيل'],['expenses','المصروفات'],['shifts','الخزن والورديات'],['refunds','الاسترداد'],['refund_request','طلب استرداد'],['refund_approve','اعتماد استرداد'],['refund_complete','تنفيذ استرداد'],['approvals','الاعتمادات'],
 ['crm','CRM'],['customers','العملاء'],['documents','المستندات'],['notifications','الإشعارات'],['automation','الأتمتة'],['reports','التقارير'],['printReports','طباعة التقارير'],
 ['viewBranches','عرض الفروع'],['addBranches','إضافة فرع'],['editBranches','تعديل الفروع'],['manageCompanyProfile','تعديل بيانات الشركة العامة'],
 ['manageUsers','إدارة بيانات الموظفين'],['managePermissions','إدارة صلاحيات الموظفين'],['allBranches','تشغيل كل الفروع'],['allBranchesFinance','مالية كل الفروع']
];
const DEVELOPER_PERMS=[
 ['developer_console_access','الدخول إلى المطور والنظام'],['developer_backup','نسخ احتياطي'],['developer_restore','استعادة نسخة احتياطية'],['developer_purge','حذف نهائي للبيانات'],['developer_templates','إدارة القوالب'],['developer_labels','إدارة المسميات'],['developer_languages','إدارة اللغات'],['developer_rules','إدارة قواعد النظام']
];
const SENSITIVE=new Set(DEVELOPER_PERMS.map(([k])=>k));
const ROLES=['موظف حجوزات','محاسب','مشرف تشغيل','موظف تسكين','خدمة عملاء','مدير فرع','مدير عام','موظف'];
const ROLE_RANK={'developer':100,'مدير عام':90,'مدير فرع':70,'مشرف تشغيل':60,'محاسب':50,'موظف تسكين':40,'موظف حجوزات':40,'خدمة عملاء':40,'موظف':30};
const rankOf=role=>ROLE_RANK[String(role||'').trim()]||20;
const ROLE_TEMPLATES={
 'موظف حجوزات':['branchBooking','viewBookings','editBookings','editPassenger','changeTrip','printTickets','customers','documents'],
 'محاسب':['viewBookings','finance','payments','expenses','shifts','refunds','refund_request','reports','printReports'],
 'مشرف تشغيل':['viewBookings','trips','operations','manifest','housingManifest','scanner','housing','seats','fleet','vehicles','returns','notifications'],
 'موظف تسكين':['viewBookings','editPassenger','housing','housingManifest','documents','printReports'],
 'خدمة عملاء':['viewBookings','customers','crm','notifications','documents','printTickets'],
 'مدير فرع':['branchBooking','viewBookings','editBookings','editPassenger','changeTrip','printTickets','trips','operations','manifest','housingManifest','scanner','housing','seats','fleet','vehicles','returns','finance','payments','expenses','shifts','refunds','refund_request','approvals','crm','customers','documents','notifications','reports','printReports','manageUsers','viewBranches','editBranches'],
 'مدير عام':GENERAL_PERMS.map(([k])=>k)
};
const modeOf=u=>u?.account_mode==='production'||u?.permissions?._accountMode==='production'?'production':'training';
function defaultForm(){return {id:'',name:'',username:'',phone:'',role:'موظف',branch_id:'',status:'نشط',password:'',accountMode:'training',permissions:{}}}
function newStaffId(){try{return `staff-${crypto.randomUUID()}`}catch{return `staff-${Date.now()}-${Math.random().toString(36).slice(2,10)}`}}

export default function Staff(){
 const {user}=useAuth();const {data,refresh}=useAppData();
 const [open,setOpen]=useState(false),[form,setForm]=useState(defaultForm()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const branches=data.branches||[],users=data.users||[];
 const isDeveloper=String(user?.role||'').toLowerCase()==='developer';const actorRank=rankOf(user?.role);
 const canEditPermissions=isDeveloper||user?.role==='مدير عام'||user?.permissions?.all||!!user?.permissions?.managePermissions;
 const canManageUsers=isDeveloper||user?.role==='مدير عام'||user?.permissions?.all||!!user?.permissions?.manageUsers;
 const branchMap=useMemo(()=>Object.fromEntries(branches.map(b=>[String(b.id),b.name||b.branch_name||b.id])),[branches]);
 const canGrant=k=>canEditPermissions&&(isDeveloper||user?.role==='مدير عام'||user?.permissions?.all||!!user?.permissions?.[k]);
 const visibleGeneralPerms=canEditPermissions?GENERAL_PERMS.filter(([k])=>canGrant(k)):[];
 const allowedRoles=canEditPermissions?ROLES.filter(r=>isDeveloper||rankOf(r)<=actorRank):['موظف'];
 function canManageTarget(u){if(isDeveloper)return true;if(String(u?.id)===String(user?.id))return false;if(String(u?.role||'').toLowerCase()==='developer')return false;if(Object.keys(u?.permissions||{}).some(k=>SENSITIVE.has(k)&&u.permissions[k]))return false;return rankOf(u?.role)<=actorRank}
 function edit(u){if(!canManageTarget(u)){setError('لا يمكنك تعديل هذا الحساب لأنه أعلى منك إداريًا أو حساب محمي.');return}setForm({...defaultForm(),...u,branch_id:u.branch_id||'',password:'',accountMode:modeOf(u),permissions:u.permissions||{}});setError('');setNotice('');setOpen(true)}
 function add(){if(!canManageUsers&&!canEditPermissions){setError('لا توجد صلاحية إضافة موظفين.');return}setForm(defaultForm());setError('');setNotice('');setOpen(true)}
 function applyTemplate(role=form.role){if(!canEditPermissions){setNotice('حسابك يملك إدارة بيانات الموظفين فقط ولا يملك إدارة الصلاحيات.');return}const keys=(ROLE_TEMPLATES[role]||[]).filter(canGrant);const out={};for(const k of keys)out[k]=true;if(isDeveloper){for(const k of SENSITIVE)if(form.permissions?.[k])out[k]=true}setForm(x=>({...x,role,permissions:{...out,_accountMode:x.permissions?._accountMode||'training'}}));setNotice(`تم تطبيق قالب صلاحيات «${role}». تم استبعاد أي صلاحية أعلى من صلاحياتك الحالية تلقائيًا.`)}
 function togglePerm(k,checked){if(!canGrant(k))return;setForm(x=>({...x,permissions:{...(x.permissions||{}),[k]:checked}}))}
 async function save(e){e.preventDefault();setError('');setBusy(true);try{
   const isNew=!form.id;const existingUser=isNew?null:users.find(u=>String(u.id)===String(form.id));
   if(existingUser&&!canManageTarget(existingUser))throw new Error('لا يمكنك تعديل موظف أعلى منك إداريًا أو حساب محمي.');
   if(!canEditPermissions&&existingUser&&String(form.role)!==String(existingUser.role))throw new Error('تغيير الدور يتطلب صلاحية إدارة الصلاحيات.');
   if(!canEditPermissions&&!existingUser&&form.role!=='موظف')throw new Error('تحديد دور وظيفي يتطلب صلاحية إدارة الصلاحيات.');
   if(canEditPermissions&&!isDeveloper&&rankOf(form.role)>actorRank)throw new Error('لا يمكنك منح موظف دورًا أعلى من مستواك الإداري.');
   let permissions={...(form.permissions||{}),_accountMode:form.accountMode==='production'?'production':'training'};
   if(!canEditPermissions)permissions={...(existingUser?.permissions||{}),_accountMode:existingUser?.permissions?._accountMode||'training'};
   else if(!isDeveloper){for(const k of SENSITIVE){if(existingUser?.permissions?.[k])permissions[k]=true;else delete permissions[k]}for(const [k,v] of Object.entries(permissions)){if(k.startsWith('_')||!v)continue;if(!canGrant(k))delete permissions[k]}}
   const role=!canEditPermissions&&existingUser?existingUser.role:form.role;
   const accountMode=!canEditPermissions&&existingUser?modeOf(existingUser):form.accountMode;
   const row={...form,id:isNew?newStaffId():form.id,name:String(form.name||'').trim(),username:String(form.username||'').trim(),phone:String(form.phone||'').trim(),role,branch_id:form.branch_id||null,account_mode:accountMode==='production'?'production':'training',permissions};
   delete row.accountMode;if(!row.name||!row.username)throw new Error('الاسم واسم المستخدم مطلوبان');if(isNew&&!row.password)throw new Error('كلمة مرور الموظف الجديد مطلوبة');if(!row.password)delete row.password;
   await api.admin({action:'sync_users',rows:[row]});await refresh();setOpen(false);
 }catch(e2){setError(e2.message)}finally{setBusy(false)}}
 const cols=[
  {key:'name',label:'الموظف',render:r=><div><strong>{r.name||'—'}</strong><div className="muted-small">@{r.username||'—'} · {r.phone||'—'}</div></div>},
  {key:'role',label:'الدور',render:r=><Badge>{r.role||'موظف'}</Badge>},{key:'branch',label:'الفرع',render:r=>branchMap[String(r.branch_id)]||'كلّي/غير محدد'},
  {key:'mode',label:'وضع الحساب',render:r=>modeOf(r)==='production'?<Badge tone="green">تشغيل فعلي</Badge>:<Badge tone="orange">تدريب</Badge>},
  {key:'status',label:'الحالة',render:r=><Badge tone={String(r.status||'نشط').includes('موق')?'red':'green'}>{r.status||'نشط'}</Badge>},
  {key:'permissions',label:'الصلاحيات',render:r=>r.permissions?.all?'كاملة':`${Object.entries(r.permissions||{}).filter(([k,v])=>!k.startsWith('_')&&!SENSITIVE.has(k)&&!!v).length} صلاحية تشغيلية`},
  {key:'edit',label:'',render:r=>canManageTarget(r)?<Button onClick={ev=>{ev.stopPropagation();edit(r)}}><UserCog size={15}/> تعديل</Button>:<Badge tone="orange">محمي</Badge>}
 ];
 return <><PageHeader title="الموظفون والصلاحيات" subtitle="إدارة بيانات الموظفين منفصلة عن إدارة الصلاحيات، وكل مستوى يدير فقط من هم في مستواه أو أدنى" actions={<><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button>{(canManageUsers||canEditPermissions)&&<Button variant="primary" onClick={add}><Plus size={16}/> موظف جديد</Button>}</>}/><ErrorBox error={error}/><Card><div className="card-title"><h3>حسابات الموظفين</h3><Badge>{users.length}</Badge></div><Table rows={users} columns={cols}/></Card>
 <Modal open={open} onClose={()=>setOpen(false)} title={form.id?'تعديل الموظف':'إضافة موظف'} wide><form onSubmit={save} className="form-grid">
  <Field label="الاسم"><Input value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))} required/></Field><Field label="اسم المستخدم"><Input value={form.username} onChange={e=>setForm(x=>({...x,username:e.target.value}))} required/></Field><Field label="الجوال"><Input value={form.phone||''} onChange={e=>setForm(x=>({...x,phone:e.target.value}))}/></Field>
  <Field label="الدور / قالب الصلاحيات"><Select disabled={!canEditPermissions&&!!form.id} value={form.role||allowedRoles[0]||'موظف'} onChange={e=>setForm(x=>({...x,role:e.target.value}))}>{(canEditPermissions?allowedRoles:[form.role||'موظف']).map(r=><option key={r}>{r}</option>)}</Select>{canEditPermissions&&<Button type="button" onClick={()=>applyTemplate()}><Wand2 size={14}/> تطبيق قالب هذا الدور</Button>}</Field>
  <Field label="الفرع"><Select value={form.branch_id||''} onChange={e=>setForm(x=>({...x,branch_id:e.target.value}))}><option value="">غير محدد / إدارة عامة</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name||b.branch_name||b.id}</option>)}</Select></Field>
  <Field label="وضع الحساب"><Select disabled={!canEditPermissions&&!!form.id} value={form.accountMode||'training'} onChange={e=>setForm(x=>({...x,accountMode:e.target.value}))}><option value="training">تدريب — بيانات تجريبية</option><option value="production">تشغيل فعلي — بيانات رسمية</option></Select></Field>
  <Field label={form.id?'كلمة مرور جديدة (اختياري)':'كلمة المرور'}><Input type="password" value={form.password||''} onChange={e=>setForm(x=>({...x,password:e.target.value}))} required={!form.id}/></Field><Field label="الحالة"><Select value={form.status||'نشط'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option>نشط</option><option>موقوف</option></Select></Field>
  {notice&&<div className="training-banner" style={{gridColumn:'1/-1',background:'#eef7ff',color:'#174a7e',borderColor:'#c9def4'}}>{notice}</div>}
  {canEditPermissions&&<div className="permissions-box" style={{gridColumn:'1/-1'}}><div className="card-title"><h3><ShieldCheck size={18}/> الصلاحيات التشغيلية</h3><small>لا يمكن منح أي صلاحية لا يملكها المستخدم الحالي.</small></div><div className="permission-grid">{visibleGeneralPerms.map(([k,label])=><label className="permission-item" key={k}><input type="checkbox" checked={!!form.permissions?.[k]} onChange={e=>togglePerm(k,e.target.checked)}/><span>{label}</span></label>)}</div></div>}
  {isDeveloper&&<div className="permissions-box developer-permissions" style={{gridColumn:'1/-1'}}><div className="card-title"><h3><LockKeyhole size={18}/> صلاحيات المطور الحساسة</h3><small>لا تظهر ولا يمكن تعديلها إلا من حساب المطور الحقيقي.</small></div><div className="permission-grid">{DEVELOPER_PERMS.map(([k,label])=><label className="permission-item" key={k}><input type="checkbox" checked={!!form.permissions?.[k]} onChange={e=>setForm(x=>({...x,permissions:{...(x.permissions||{}),[k]:e.target.checked}}))}/><span>{label}</span></label>)}</div></div>}
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ الموظف'}</Button></div>
 </form></Modal></>;
}
