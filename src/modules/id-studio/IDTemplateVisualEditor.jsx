import React,{useMemo,useState} from 'react';
import IDTemplateVisualEditorLegacy from './IDTemplateVisualEditorLegacy.jsx';
import {idStudioApi} from './api.js';

const fields={photoPlaceholder:'نص مكان الصورة',holderNamePlaceholder:'اسم حامل البطاقة الافتراضي',jobTitlePlaceholder:'المسمى الوظيفي الافتراضي',idCardLabel:'عنوان رقم البطاقة',departmentLabel:'عنوان القسم',licenseLabel:'عنوان الترخيص',seasonLabel:'عنوان الموسم',expiryLabel:'عنوان الصلاحية',referenceCompanyLabel:'عنوان الشركة في جدول البيانات',referenceLicenseLabel:'عنوان الترخيص في جدول البيانات',referenceSeasonLabel:'عنوان الموسم في جدول البيانات',referenceEmployeeLabel:'عنوان رقم الموظف',qrLabel:'عبارة QR',approvalLabel:'عنوان الاعتماد',approvalAr:'نص الاعتماد العربي',approvalEn:'نص الاعتماد الإنجليزي',value1:'القيمة الأولى',value2:'القيمة الثانية',value3:'القيمة الثالثة',inactiveWatermark:'علامة البطاقة غير المعتمدة'};
const defaults={photoPlaceholder:'الصورة',holderNamePlaceholder:'اسم حامل البطاقة',jobTitlePlaceholder:'المسمى الوظيفي',idCardLabel:'ID CARD',departmentLabel:'القسم',licenseLabel:'الترخيص',seasonLabel:'الموسم',expiryLabel:'حتى',referenceCompanyLabel:'الشركة',referenceLicenseLabel:'الترخيص',referenceSeasonLabel:'الموسم',referenceEmployeeLabel:'رقم الموظف',qrLabel:'تحقق من البطاقة',approvalLabel:'اعتماد الإدارة',approvalAr:'معتمدة إلكترونيًا',approvalEn:'Electronic Verification',value1:'أمان',value2:'راحة',value3:'ثقة',inactiveWatermark:'غير معتمدة'};
const clone=v=>JSON.parse(JSON.stringify(v||{}));

export default function IDTemplateVisualEditor(props){
 const {templateCode='makkah_luxury',config,orientation='portrait'}=props;
 const initial=useMemo(()=>({...defaults,...(config?.designer?.frontCopy||{})}),[templateCode]);
 const [frontCopy,setFrontCopy]=useState(initial),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const previewConfig=useMemo(()=>{const next=clone(config);next.designer=next.designer||{};next.designer.frontCopy=clone(frontCopy);return next},[config,frontCopy]);
 function setField(key,value){setFrontCopy(prev=>({...prev,[key]:value}));setDirty(true);setMessage('')}
 function reset(){setFrontCopy({...defaults});setDirty(true);setMessage('')}
 async function save(){if(!dirty||saving)return;setSaving(true);setMessage('');try{const next=clone(config);next.designer=next.designer||{};next.designer.frontCopy=clone(frontCopy);const out=await idStudioApi.saveTemplate(templateCode,next,orientation,'front_face_copy_publish');setDirty(false);setMessage(`تم نشر نصوص الوجه الأمامي كإصدار v${out?.template?.published_version||''}. البطاقات القديمة لن تتغير.`)}catch(e){setMessage(e.message||'تعذر حفظ نصوص الوجه الأمامي')}finally{setSaving(false)}}
 return <div style={{display:'grid',gap:10}}>
  <details open className="idvisual-back-panel"><summary style={{cursor:'pointer',fontSize:11,fontWeight:900,color:'#1f3550'}}>نصوص الوجه الأمامي القابلة للتعديل</summary><div className="idvisual-back-copy-grid">{Object.entries(fields).map(([key,label])=><label key={key}><span>{label}</span><input dir={key.endsWith('En')||key==='idCardLabel'?'ltr':undefined} value={frontCopy[key]??''} onChange={e=>setField(key,e.target.value)}/></label>)}</div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="idvisual-reset-typo" onClick={reset}>إرجاع نصوص الأمام الافتراضية</button><button type="button" className="idvisual-reset-typo" disabled={!dirty||saving} onClick={save}>{saving?'جاري النشر...':'نشر نصوص الأمام'}</button></div>{message&&<div className={`idvisual-message ${message.startsWith('تم ')?'success':'error'}`}>{message}</div>}</details>
  <IDTemplateVisualEditorLegacy {...props} config={previewConfig}/>
 </div>
}
