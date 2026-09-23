import React,{useState} from 'react';
import {ArrowDown,ArrowUp,GripVertical,LockKeyhole,Plus,ShieldCheck,Trash2} from 'lucide-react';
import {Badge,Button,Card,Field,Input,Select,Textarea} from '../../components/UI.jsx';

export function TemplateBuilderHome({templates=[],busy='',onNew,onEdit,onToggle}){
 return (
  <Card>
   <div className="card-title">
    <div>
     <h3>منشئ النماذج</h3>
     <small>أنشئ قوالب مخصصة، رتّب الحقول، وحدد مسار الاعتماد. قوالب النظام الأساسية محمية من التعديل.</small>
    </div>
    <Button variant="primary" onClick={onNew}><Plus size={15}/> قالب جديد</Button>
   </div>
   <div className="dashboard-grid">
    {templates.map(t=>(
     <Card key={t.id}>
      <div className="card-title">
       <div><h3>{t.name}</h3><small>{t.description||'بدون وصف'}</small></div>
       {t.is_system
        ? <Badge tone="blue"><LockKeyhole size={12}/> قالب نظام</Badge>
        : <Badge tone="green">مخصص · V{t.version}</Badge>}
      </div>
      <div className="muted-small">الفئة: {templateCategoryLabel(t.category)} · رقم المستند: {t.document_prefix}-…</div>
      <div className="muted-small">الحقول: {(t.form_schema||[]).length} · خطوات الاعتماد: {(t.approval_flow||[]).length}</div>
      <div className="finance-actions" style={{marginTop:10}}>
       <Badge tone={t.active?'green':'red'}>{t.active?'فعال':'موقوف'}</Badge>
       {t.is_system
        ? <span className="muted-small">محمي للحفاظ على التكامل</span>
        : <>
           <Button onClick={()=>onEdit(t)}>تعديل</Button>
           <Button disabled={busy==='template-'+t.id} onClick={()=>onToggle(t)}>{t.active?'إيقاف':'تشغيل'}</Button>
          </>}
      </div>
     </Card>
    ))}
   </div>
  </Card>
 );
}

export function TemplateBuilderEditor({value,onChange,roles=[],busy=false,onSave,onCancel}){
 const [dragIndex,setDragIndex]=useState(null);
 const fields=value.form_schema||[];
 const flow=value.approval_flow||[];
 const set=(key,val)=>onChange(x=>({...x,[key]:val}));
 const updateField=(index,patch)=>set('form_schema',fields.map((x,i)=>i===index?{...x,...patch}:x));
 const updateFlow=(index,patch)=>set('approval_flow',flow.map((x,i)=>i===index?{...x,...patch}:x).map((x,i)=>({...x,step:i+1})));
 const reorderFields=(from,to)=>set('form_schema',moveItem(fields,from,to));
 const reorderFlow=(from,to)=>set('approval_flow',moveItem(flow,from,to).map((x,i)=>({...x,step:i+1})));

 return (
  <div className="form-grid">
   <Field label="اسم النموذج">
    <Input value={value.name||''} onChange={e=>set('name',e.target.value)} placeholder="مثال: طلب صيانة فرع"/>
   </Field>
   <Field label="اختصار رقم المستند" hint="2–14 حرف/رقم إنجليزي">
    <Input dir="ltr" value={value.document_prefix||''} onChange={e=>set('document_prefix',e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14))} placeholder="MAINT"/>
   </Field>
   <Field label="الفئة">
    <Select value={value.category||'general'} onChange={e=>set('category',e.target.value)}>
     <option value="general">عام</option>
     <option value="hr">موارد بشرية</option>
     <option value="admin">إداري</option>
     <option value="operations">تشغيل</option>
     <option value="finance">مالي</option>
    </Select>
   </Field>
   <Field label="وصف النموذج">
    <Input value={value.description||''} onChange={e=>set('description',e.target.value)} placeholder="وصف مختصر يظهر للموظف"/>
   </Field>

   <div style={{gridColumn:'1/-1'}} className="finance-actions">
    <label><input type="checkbox" checked={!!value.requires_employee} onChange={e=>set('requires_employee',e.target.checked)}/> مرتبط بموظف</label>
    <label><input type="checkbox" checked={value.requires_approval!==false} onChange={e=>set('requires_approval',e.target.checked)}/> يحتاج اعتماد</label>
    <label><input type="checkbox" checked={value.active!==false} onChange={e=>set('active',e.target.checked)}/> فعال</label>
   </div>

   <div style={{gridColumn:'1/-1'}}>
    <div className="card-title">
     <div><h3>حقول النموذج</h3><small>اسحب الحقل لترتيبه أو استخدم الأسهم — تعمل أيضًا على الجوال.</small></div>
     <Button onClick={()=>set('form_schema',[...fields,newBuilderField()])}><Plus size={14}/> إضافة حقل</Button>
    </div>
    <div style={{display:'grid',gap:10}}>
     {fields.map((field,index)=>(
      <div
       key={field.key}
       draggable
       onDragStart={()=>setDragIndex(index)}
       onDragOver={e=>e.preventDefault()}
       onDrop={()=>{if(dragIndex!==null)reorderFields(dragIndex,index);setDragIndex(null)}}
       style={{border:'1px solid var(--border,#dce2e8)',borderRadius:12,padding:12}}
      >
       <div className="finance-actions" style={{justifyContent:'space-between'}}>
        <span className="muted-small"><GripVertical size={15}/> الحقل {index+1}</span>
        <span className="finance-actions">
         <Button disabled={index===0} onClick={()=>reorderFields(index,index-1)}><ArrowUp size={13}/></Button>
         <Button disabled={index===fields.length-1} onClick={()=>reorderFields(index,index+1)}><ArrowDown size={13}/></Button>
         <Button onClick={()=>set('form_schema',fields.filter((_,i)=>i!==index))}><Trash2 size={13}/> حذف</Button>
        </span>
       </div>
       <div className="form-grid" style={{marginTop:8}}>
        <Field label="عنوان الحقل">
         <Input value={field.label||''} onChange={e=>updateField(index,{label:e.target.value})} placeholder="مثال: سبب الطلب"/>
        </Field>
        <Field label="نوع الحقل">
         <Select value={field.type||'text'} onChange={e=>updateField(index,{type:e.target.value,options:e.target.value==='select'?(field.options||[]):[]})}>
          <option value="text">نص قصير</option>
          <option value="textarea">نص طويل</option>
          <option value="date">تاريخ</option>
          <option value="time">وقت</option>
          <option value="number">رقم</option>
          <option value="select">قائمة اختيارات</option>
         </Select>
        </Field>
        <label style={{alignSelf:'end'}}><input type="checkbox" checked={!!field.required} onChange={e=>updateField(index,{required:e.target.checked})}/> حقل إلزامي</label>
        {field.type==='select'&&(
         <Field label="الاختيارات" hint="كل اختيار في سطر">
          <Textarea value={(field.options||[]).join('\n')} onChange={e=>updateField(index,{options:e.target.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)})}/>
         </Field>
        )}
       </div>
      </div>
     ))}
    </div>
   </div>

   {value.requires_approval!==false&&(
    <div style={{gridColumn:'1/-1'}}>
     <div className="card-title">
      <div><h3>مسار الاعتماد</h3><small>الطلب ينتقل من خطوة إلى التي بعدها بالترتيب.</small></div>
      <Button onClick={()=>set('approval_flow',[...flow,{step:flow.length+1,label:'اعتماد جديد',role:roles[0]||'الموارد البشرية'}])}><Plus size={14}/> خطوة اعتماد</Button>
     </div>
     <div style={{display:'grid',gap:10}}>
      {flow.map((step,index)=>(
       <div key={'step-'+index} style={{border:'1px solid var(--border,#dce2e8)',borderRadius:12,padding:12}}>
        <div className="finance-actions" style={{justifyContent:'space-between'}}>
         <Badge tone="orange">الخطوة {index+1}</Badge>
         <span className="finance-actions">
          <Button disabled={index===0} onClick={()=>reorderFlow(index,index-1)}><ArrowUp size={13}/></Button>
          <Button disabled={index===flow.length-1} onClick={()=>reorderFlow(index,index+1)}><ArrowDown size={13}/></Button>
          <Button onClick={()=>set('approval_flow',flow.filter((_,i)=>i!==index).map((x,i)=>({...x,step:i+1})))}><Trash2 size={13}/> حذف</Button>
         </span>
        </div>
        <div className="form-grid" style={{marginTop:8}}>
         <Field label="اسم الخطوة"><Input value={step.label||''} onChange={e=>updateFlow(index,{label:e.target.value})}/></Field>
         <Field label="دور المعتمد">
          <Select value={step.role||''} onChange={e=>updateFlow(index,{role:e.target.value})}>
           <option value="">اختر الدور</option>
           {roles.map(role=><option key={role} value={role}>{role}</option>)}
          </Select>
         </Field>
        </div>
       </div>
      ))}
     </div>
    </div>
   )}

   <div style={{gridColumn:'1/-1'}}>
    <h3>معاينة سريعة</h3>
    <Card>
     <strong>{value.name||'اسم النموذج'}</strong>
     <div className="muted-small">{value.description||'سيظهر وصف النموذج هنا.'}</div>
     <div className="form-grid" style={{marginTop:10}}>
      {fields.length?fields.map(field=>(
       <Field key={field.key} label={(field.label||'حقل بدون عنوان')+(field.required?' *':'')}>
        {field.type==='textarea'
         ? <Textarea disabled placeholder="معاينة"/>
         : field.type==='select'
          ? <Select disabled><option>{(field.options||[])[0]||'اختيار...'}</option></Select>
          : <Input disabled type={['date','time','number'].includes(field.type)?field.type:'text'} placeholder="معاينة"/>}
       </Field>
      )):<div className="muted-small">أضف أول حقل للنموذج.</div>}
     </div>
    </Card>
   </div>

   <div className="modal-actions">
    <Button onClick={onCancel}>إلغاء</Button>
    <Button variant="primary" disabled={busy} onClick={onSave}><ShieldCheck size={14}/>{busy?'جاري الحفظ...':'حفظ القالب'}</Button>
   </div>
  </div>
 );
}

function templateCategoryLabel(value){
 return ({general:'عام',hr:'موارد بشرية',admin:'إداري',operations:'تشغيل',finance:'مالي'})[value]||value||'عام';
}
function newBuilderField(){
 const id=(globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random()).replace(/[^A-Za-z0-9]/g,'').slice(0,12);
 return {key:'field_'+id,label:'',type:'text',required:false,options:[]};
}
function moveItem(rows,from,to){
 const out=[...(rows||[])];
 if(from<0||to<0||from>=out.length||to>=out.length||from===to)return out;
 const [item]=out.splice(from,1);
 out.splice(to,0,item);
 return out;
}
