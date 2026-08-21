import React from 'react';import GenericModule from '../generic.jsx';
export default function Workflow(){return <GenericModule title="المهام والموافقات" subtitle="متابعة مهام التشغيل وطلبات الموافقة" resource="tasks" tabs={[
{table:'tasks',label:'المهام',columns:['title','priority','status','due_at','assigned_to'],writable:true,fields:[{name:'title',label:'عنوان المهمة',required:true},{name:'description',label:'الوصف'},{name:'priority',label:'الأولوية',type:'select',options:[['low','منخفضة'],['normal','عادية'],['high','عالية'],['urgent','عاجلة']]},{name:'status',label:'الحالة',type:'select',options:[['open','مفتوحة'],['in_progress','قيد التنفيذ'],['done','منتهية']]},{name:'due_at',label:'الاستحقاق',type:'datetime-local',nullable:true},{name:'assigned_to',label:'معرف الموظف',nullable:true}]},
{table:'approval_requests',label:'الموافقات',columns:['request_type','amount','status','branch_id','requested_by','created_at'],writable:false}
]}/>}
