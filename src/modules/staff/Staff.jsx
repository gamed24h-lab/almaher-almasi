import React,{useMemo,useState} from 'react';
import {Plus,RefreshCw,ShieldCheck,UserCog} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Input,Modal,PageHeader,Select,Table} from '../../components/UI.jsx';

const PERMS=[
 ['branchBooking','إنشاء حجوزات'],['viewBookings','عرض الحجوزات'],['editBookings','تعديل الحجوزات'],['editPassenger','تعديل الركاب'],
 ['trips','إدارة الرحلات'],['operations','التشغيل'],['scanner','QR والمسح'],['housing','التسكين'],['seats','المقاعد'],['fleet','الأسطول'],
 ['finance','المالية'],['payments','التحصيل'],['refunds','الاسترداد'],['refund_request','طلب استرداد'],['refund_approve','اعتماد استرداد'],['refund_complete','تنفيذ استرداد'],
 ['crm','CRM'],['documents','المستندات'],['notifications','الإشعارات'],['reports','التقارير'],['manageUsers','إدارة الموظفين'],['allBranches','تشغيل كل الفروع'],['allBranchesFinance','مالية كل الفروع']
];
const ROLES=['موظف','مشرف','مدير فرع','محاسب','مشرف تشغيل','مدير عام'];
function defaultForm(){return {id:'',name:'',username:'',phone:'',role:'موظف',branch_id:'',status:'نشط',password:'',permissions:{}}}
export default function Staff(){
 const {user}=useAuth();const {data,refresh}=useAppData();const [open,setOpen]=useState(false),[form,setForm]=useState(defaultForm()),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const branches=data.branches||[],users=data.users||[];
 const branchMap=useMemo(()=>Object.fromEntries(branches.map(b=>[String(b.id),b.name||b.branch_name||b.id])),[branches]);
 function edit(u){setForm({...defaultForm(),...u,branch_id:u.branch_id||'',password:'',permissions:u.permissions||{}});setOpen(true)}
 function add(){setForm(defaultForm());setOpen(true)}
 async function save(e){e.preventDefault();setError('');setBusy(true);try{
   const row={...form,name:String(form.name||'').trim(),username:String(form.username||'').trim(),phone:String(form.phone||'').trim(),branch_id:form.branch_id||null,permissions:form.permissions||{}};
   if(!row.name||!row.username)throw new Error('الاسم واسم المستخدم مطلوبان');if(!row.id&&!row.password)throw new Error('كلمة مرور الموظف الجديد مطلوبة');if(!row.password)delete row.password;
   await api.admin({action:'sync_users',rows:[row]});await refresh();setOpen(false);
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 const cols=[
   {key:'name',label:'الموظف',render:r=><div><strong>{r.name||'—'}</strong><div className="muted-small">@{r.username||'—'} · {r.phone||'—'}</div></div>},
   {key:'role',label:'الدور',render:r=><Badge>{r.role||'موظف'}</Badge>},{key:'branch',label:'الفرع',render:r=>branchMap[String(r.branch_id)]||'كلّي/غير محدد'},
   {key:'status',label:'الحالة',render:r=><Badge tone={String(r.status||'نشط').includes('موق')?'red':'green'}>{r.status||'نشط'}</Badge>},
   {key:'permissions',label:'الصلاحيات',render:r=>r.permissions?.all?'كاملة':`${Object.values(r.permissions||{}).filter(Boolean).length} صلاحية`},
   {key:'edit',label:'',render:r=><Button onClick={ev=>{ev.stopPropagation();edit(r)}}><UserCog size={15}/> تعديل</Button>}
 ];
 return <><PageHeader title="الموظفون والصلاحيات" subtitle="إدارة حسابات الموظفين، الفروع، الأدوار والصلاحيات التشغيلية والمالية" actions={<><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button><Button variant="primary" onClick={add}><Plus size={16}/> موظف جديد</Button></>}/><ErrorBox error={error}/><Card><div className="card-title"><h3>حسابات الموظفين</h3><Badge>{users.length}</Badge></div><Table rows={users} columns={cols}/></Card>
 <Modal open={open} onClose={()=>setOpen(false)} title={form.id?'تعديل الموظف':'إضافة موظف'} wide><form onSubmit={save} className="form-grid">
  <Field label="الاسم"><Input value={form.name} onChange={e=>setForm(x=>({...x,name:e.target.value}))} required/></Field>
  <Field label="اسم المستخدم"><Input value={form.username} onChange={e=>setForm(x=>({...x,username:e.target.value}))} required/></Field>
  <Field label="الجوال"><Input value={form.phone||''} onChange={e=>setForm(x=>({...x,phone:e.target.value}))}/></Field>
  <Field label="الدور"><Select value={form.role||'موظف'} onChange={e=>setForm(x=>({...x,role:e.target.value}))}>{ROLES.map(r=><option key={r}>{r}</option>)}</Select></Field>
  <Field label="الفرع"><Select value={form.branch_id||''} onChange={e=>setForm(x=>({...x,branch_id:e.target.value}))}><option value="">غير محدد / إدارة عامة</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name||b.branch_name||b.id}</option>)}</Select></Field>
  <Field label={form.id?'كلمة مرور جديدة (اختياري)':'كلمة المرور'}><Input type="password" value={form.password||''} onChange={e=>setForm(x=>({...x,password:e.target.value}))} required={!form.id}/></Field>
  <Field label="الحالة"><Select value={form.status||'نشط'} onChange={e=>setForm(x=>({...x,status:e.target.value}))}><option>نشط</option><option>موقوف</option></Select></Field>
  <div className="permissions-box"><div className="card-title"><h3><ShieldCheck size={18}/> الصلاحيات</h3><small>تشغيل كل الفروع لا يمنح مالية كل الفروع تلقائيًا.</small></div><div className="permission-grid">{PERMS.map(([k,l])=><label className="check permission-check" key={k}><input type="checkbox" checked={!!form.permissions?.[k]} onChange={e=>setForm(x=>({...x,permissions:{...(x.permissions||{}),[k]:e.target.checked}}))}/><span>{l}</span></label>)}</div></div>
  <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)}>إلغاء</Button><Button variant="primary" type="submit" disabled={busy}>{busy?'جاري الحفظ...':'حفظ الموظف'}</Button></div>
 </form></Modal></>
}
