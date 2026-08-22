import React,{useMemo,useState} from 'react';
import {Plus,RefreshCw,ShieldCheck,UserCog,Wand2} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Modal,PageHeader,Select,Table} from '../../components/UI.jsx';

const PERMS=[
 ['branchBooking','إنشاء حجوزات'],['viewBookings','عرض الحجوزات'],['editBookings','تعديل الحجوزات'],['editPassenger','تعديل الركاب'],['changeTrip','نقل الحجز بين الرحلات'],['printTickets','طباعة التذاكر'],
 ['trips','إدارة الرحلات'],['operations','التشغيل'],['manifest','كشف التشغيل'],['housingManifest','كشف التسكين'],['scanner','QR والمسح'],['housing','التسكين'],['seats','المقاعد'],['fleet','الأسطول'],['vehicles','المركبات'],['returns','محرك العودة'],
 ['finance','المالية'],['payments','التحصيل'],['expenses','المصروفات'],['shifts','الخزن والورديات'],['refunds','الاسترداد'],['refund_request','طلب استرداد'],['refund_approve','اعتماد استرداد'],['refund_complete','تنفيذ استرداد'],['approvals','الاعتمادات'],
 ['crm','CRM'],['customers','العملاء'],['documents','المستندات'],['notifications','الإشعارات'],['automation','الأتمتة'],['reports','التقارير'],['printReports','طباعة التقارير'],['manageUsers','إدارة الموظفين'],['allBranches','تشغيل كل الفروع'],['allBranchesFinance','مالية كل الفروع'],
 ['developer_console_access','الدخول إلى المطور والنظام'],['developer_backup','نسخ احتياطي'],['developer_restore','استعادة نسخة احتياطية'],['developer_purge','حذف نهائي للبيانات'],['developer_templates','إدارة القوالب'],['developer_labels','إدارة المسميات'],['developer_languages','إدارة اللغات'],['developer_rules','إدارة قواعد النظام']
];
const SENSITIVE=new Set(['developer_console_access','developer_backup','developer_restore','developer_purge','developer_templates','developer_labels','developer_languages','developer_rules']);
const ROLES=['موظف حجوزات','محاسب','مشرف تشغيل','موظف تسكين','خدمة عملاء','مدير فرع','مدير عام','موظف'];
const ROLE_TEMPLATES={
 'موظف حجوزات':['branchBooking','viewBookings','editBookings','editPassenger','changeTrip','printTickets','customers','documents'],
 'محاسب':['viewBookings','finance','payments','expenses','shifts','refunds','refund_request','reports','printReports'],
 'مشرف تشغيل':['viewBookings','trips','operations','manifest','housingManifest','scanner','housing','seats','fleet','vehicles','returns','notifications'],
 'موظف تسكين':['viewBookings','editPassenger','housing','housingManifest','documents','printReports'],
 'خدمة عملاء':['viewBookings','customers','crm','notifications','documents','printTickets'],
 'مدير فرع':['branchBooking','viewBookings','editBookings','editPassenger','changeTrip','printTickets','trips','operations','manifest','housingManifest','scanner','housing','seats','fleet','vehicles','returns','finance','payments','expenses','shifts','refunds','refund_request','approvals','crm','customers','documents','notifications','reports','printReports'],
 'مدير عام':PERMS.map(([k])=>k).filter(k=>!SENSITIVE.has(k))
};
const modeOf=u=>u?.account_mode==='production'||u?.permissions?._accountMode==='production'?'production':'training';
function defaultForm(){return {id:'',name:'',username:'',phone:'',role:'موظف حجوزات',branch_id:'',status:'نشط',password:'',accountMode:'training',permissions:{}}}
function newStaffId(){try{return `staff-${crypto.randomUUID()}`}catch{return `staff-${Date.now()}-${Math.random().toString(36).slice(2,10)}`}}
function templatePermissions(role,current={}){const keys=ROLE_TEMPLATES[role]||[];const out={};for(const k of keys)out[k]=true;for(const k of SENSITIVE)if(current?.[k])out[k]=true;return {...out,_accountMode:current?._accountMode||'training'}}
export default function Staff(){
 const {user}=useAuth();const {data,refresh}=useAppData();const [open,setOpen]=useState(false),[form,setForm]=useState(defaultForm()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const branches=data.branches||[],users=data.users||[];
 const branchMap=useMemo(()=>Object.fromEntries(branches.map(b=>[String(b.id),b.name||b.branch_name||b.id])),[branches]);
 function edit(u){setForm({...defaultForm(),...u,branch_id:u.branch_id||'',password:'',accountMode:modeOf(u),permissions:u.permissions||{}});setError('');setNotice('');setOpen(true)}
 function add(){setForm(defaultForm());setError('');setNotice('');setOpen(true)}
 function applyTemplate(role=form.role){setForm(x=>({...x,role,permissions:templatePermissions(role,x.permissions)}));setNotice(`تم تطبيق قالب صلاحيات «${role}». الصلاحيات الحساسة للمطور لا تُمنح تلقائيًا ويمكن ضبطها يدويًا.`)}
 async function save(e){e.preventDefault();setError('');setBusy(true);try{
   const permissions={...(form.permissions||{}),_accountMode:form.accountMode==='production'?'production':'training'};
   const isNew=!form.id;
   const row={...form,id:isNew?newStaffId():form.id,name:String(form.name||'').trim(),username:String(form.username||'').trim(),phone:String(form.phone||'').trim(),branch_id:form.branch_id||null,account_mode:form.accountMode==='production'?'production':'training',permissions};
   delete row.accountMode;
   if(!row.name||!row.username)throw new Error('الاسم واسم المستخدم مطلوبان');if(isNew&&!row.password)throw new Error('كلمة مرور الموظف الجديد مطلوبة');if(!row.password)delete row.password;
   await api.admin({action:'sync_users',rows:[row]});await refresh();setOpen(false);
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 const cols=[
   {key:'name',label:'الموظف',render:r=><div><strong>{r.name||'—'}</strong><div className="muted-small">@{r.username||'—'} · {r.phone||'—'}</div></div>},
   {key:'role',label:'الدور',render:r=><Badge>{r.role||'موظف'}</Badge>},{key:'branch',label:'الفرع',render:r=>branchMap[String(r.branch_id)]||'كلّي/غير محدد'},
   {key:'mode',label:'وضع الحساب',render:r=>modeOf(r)==='production'?<Badge tone="green">تشغيل فعلي</Badge>:<Badge tone="orange">تدريب</Badge>},
   {key:'status',label:'الحالة',render:r=><Badge tone={String(r.status||'نشط').includes('موق')?'red':'green'}>{r.status||'نشط'}</Badge>},
   {key:'permissions',label:'الصلاحيات',render:r=>r.permissions?.all?'كاملة':`${Object.entries(r.permissions||{}).filter(([k,v])=>!k.startsWith('_')&&!!v).length} صلاحية`},
   {key:'edit',label:'',render:r=><Button onClick={ev=>{ev.stopPropagation();edit(r)}}><UserCog size={15}/> تعديل</Button>}
 ];
 return <><PageHeader title="الموظفون والصلاحيات" subtitle="قوالب صلاحيات جاهزة مع إمكانية التعديل اليدوي لكل موظف" actions={<><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button><Button variant="primary" onClick={add}><Plus size={16}/> موظف جديد</Button></>}/><ErrorBox error={error}/><Card><div className="card-title"><h3>حسابات الموظفين</h3><Badge>{users.length}</Badge></div><Table rows={users} columns={cols}/></Card>
 <Modal open={open} onClose={()=>setOpen(false)} title={form.id?'تعديل الموظف':'إضافة موظف'} wide><form onSubmit={save} className="form-grid">
  <Field label="الاسم"><Input value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="اسم المستخدم"><Input value={form.username} onChange={e=>setForm(x=>({...x,username:e.target.value}))} required/></Field>
  <Field label="الجوال"><Input value={form.phone||''} onChange={e=>setForm(x=>({...x,phone:e.target.value}))}/></Field>
  <Field label="الدور / قالب الصلاحيات"><Select value={form.role||'موظف حجوزات'} onChange={e=>{const role=e.target.value;setForm(x=>({...x,role}));}}>{ROLES.map(r=><option key={r}>{r}</option>)}</Select><Button type="button" onClick={()=>applyTemplate()}><Wand2 size={14}/> تطبيق قالب هذا الدور</Button></Field>
  <Field label="الفرع"><Select value={form.branch_id||''} onChange={e=>setForm(x=>({...x,branch_id:e.target.value}))}><option value="">غير محدد / إدارة عامة</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name||b.branch_name||b.id}</option>)}</Select></Field>
  <Field label="وضع الحساب"><Select value={form.accountMode||'training'} onChange={e=>setForm(x=>({...x,accountMode:e.target.value}))}><option value="training">تدريب — بيانات تجريبية</option><option value="production">تشغيل فعلي — بيانات رسمية</option></Select></Field>
  <Field label={form.id?'كلمة مرور جديدة (اختياري)':'كلمة المرور'}><Input type="password" value={form.password||''} onChange={e=>setForm(x=>({...x,password:e.target.value}))} required={!form.id}/></Field>
  <Field label="الحالة"><Select value={form.status||'نشط'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option>نشط</option><option>موقوف</option></Select></Field>
  {notice&&<div className="training-banner" style={{gridColumn:'1/-1',background:'#eef7ff',color:'#174a7e',borderColor:'#c9def4'}}>{notice}</div>}
  <div className="permissions-box"><div className="card-title"><h3><ShieldCheck size={18}/> الصلاحيات</h3><small>القالب نقطة بداية فقط. صلاحيات المطور الحساسة لا يرثها المدير العام تلقائيًا.</small></div><div className="permission-grid">{PERMS.map(([k,l])=><label className={`check permission-check ${SENSITIVE.has(k)?'sensitive-permission':''}`} key={k}><input type="checkbox" checked={!!form.permissions?.[k]} onChange={e=>setForm(x=>({...x,permissions:{...(x.permissions||{}),[k]:e.target.checked}}))}/><span>{l}{SENSITIVE.has(k)?' 🔐':''}</span></label>)}</div></div>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ الموظف'}</Button></div>
 </form></Modal></>
}
