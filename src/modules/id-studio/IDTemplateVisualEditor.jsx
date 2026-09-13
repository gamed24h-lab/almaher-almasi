import React,{useMemo,useState,useEffect} from 'react';
import IDTemplateVisualEditorLegacy from './IDTemplateVisualEditorLegacy.jsx';
import {idStudioApi} from './api.js';

const fields={photoPlaceholder:'نص مكان الصورة',holderNamePlaceholder:'اسم حامل البطاقة الافتراضي',jobTitlePlaceholder:'المسمى الوظيفي الافتراضي',idCardLabel:'عنوان رقم البطاقة',departmentLabel:'عنوان القسم',licenseLabel:'عنوان الترخيص',seasonLabel:'عنوان الموسم',expiryLabel:'عنوان الصلاحية',referenceCompanyLabel:'عنوان الشركة في جدول البيانات',referenceLicenseLabel:'عنوان الترخيص في جدول البيانات',referenceSeasonLabel:'عنوان الموسم في جدول البيانات',referenceEmployeeLabel:'عنوان رقم الموظف',qrLabel:'عبارة QR',approvalLabel:'عنوان الاعتماد',approvalAr:'نص الاعتماد العربي',approvalEn:'نص الاعتماد الإنجليزي',value1:'القيمة الأولى',value2:'القيمة الثانية',value3:'القيمة الثالثة',inactiveWatermark:'علامة البطاقة غير المعتمدة'};
const defaults={photoPlaceholder:'الصورة',holderNamePlaceholder:'اسم حامل البطاقة',jobTitlePlaceholder:'المسمى الوظيفي',idCardLabel:'ID CARD',departmentLabel:'القسم',licenseLabel:'الترخيص',seasonLabel:'الموسم',expiryLabel:'حتى',referenceCompanyLabel:'الشركة',referenceLicenseLabel:'الترخيص',referenceSeasonLabel:'الموسم',referenceEmployeeLabel:'رقم الموظف',qrLabel:'تحقق من البطاقة',approvalLabel:'اعتماد الإدارة',approvalAr:'معتمدة إلكترونيًا',approvalEn:'Electronic Verification',value1:'أمان',value2:'راحة',value3:'ثقة',inactiveWatermark:'غير معتمدة'};
const visibilityDefaults={logo:true,companyName:true,serviceLine:true,slogan:true,holderPhoto:true,holderName:true,jobTitle:true,department:true,employeeId:true,licenseNumber:true,season:true,qr:true,approval:true,bus:true,makkah:true,footer:true};
const visibilityLabels={logo:'الشعار',companyName:'اسم الشركة',serviceLine:'وصف النشاط',slogan:'الشعار النصي',holderPhoto:'صورة حامل البطاقة',holderName:'الاسم',jobTitle:'المسمى الوظيفي',department:'القسم',employeeId:'رقم البطاقة',licenseNumber:'الترخيص',season:'الموسم',qr:'QR',approval:'الاعتماد/التوقيع',bus:'صورة الباص',makkah:'مكة / برج الساعة',footer:'النص السفلي'};
const groups={
 brand:{label:'هوية الشركة',elements:['logo','brand','serviceLine'],visibility:['logo','companyName','serviceLine']},
 holder:{label:'بيانات حامل البطاقة',elements:['photo','person'],visibility:['holderPhoto','holderName','jobTitle']},
 card:{label:'بيانات البطاقة',elements:['number','meta','qr'],visibility:['employeeId','department','licenseNumber','season','qr']},
 visual:{label:'العناصر البصرية',elements:['makkah','bus','slogan','footer'],visibility:['makkah','bus','slogan','footer']},
 approval:{label:'الاعتماد',elements:['approval'],visibility:['approval']}
};
const clone=v=>JSON.parse(JSON.stringify(v||{}));

export default function IDTemplateVisualEditor(props){
 const {templateCode='makkah_luxury',config,orientation='portrait'}=props;
 const buildCopy=()=>({...defaults,...(config?.designer?.frontCopy||{})});
 const buildVisibility=()=>({...visibilityDefaults,...(config?.designer?.visibility||{})});
 const [frontCopy,setFrontCopy]=useState(buildCopy),[frontVisibility,setFrontVisibility]=useState(buildVisibility),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{setFrontCopy(buildCopy());setFrontVisibility(buildVisibility());setDirty(false);setMessage('')},[templateCode]);
 function sync(section,value){if(!config)return;config.designer=config.designer||{};config.designer[section]=clone(value)}
 const previewConfig=useMemo(()=>{const next=clone(config);next.designer=next.designer||{};next.designer.frontCopy=clone(frontCopy);next.designer.visibility=clone(frontVisibility);return next},[config,frontCopy,frontVisibility]);
 function touch(){setDirty(true);setMessage('')}
 function setField(key,value){setFrontCopy(prev=>{const next={...prev,[key]:value};sync('frontCopy',next);return next});touch()}
 function reset(){const next={...defaults};setFrontCopy(next);sync('frontCopy',next);touch()}
 function setVisibility(key,value){setFrontVisibility(prev=>{const next={...prev,[key]:value};sync('visibility',next);return next});touch()}
 function setGroupVisibility(group,value){for(const key of groups[group].visibility)setVisibility(key,value)}
 function patchGroupElement(element,patch){config.designer=config.designer||{};config.designer.layout=config.designer.layout||{portrait:{},landscape:{}};config.designer.layout[orientation]=config.designer.layout[orientation]||{};config.designer.layout[orientation][element]={...(config.designer.layout[orientation][element]||{}),...patch};props.onLayoutChange?.(element,patch)}
 function setGroupLock(group,locked){groups[group].elements.forEach(element=>patchGroupElement(element,{locked}));touch()}
 function setGroupLayer(group,toFront){groups[group].elements.forEach((element,index)=>patchGroupElement(element,{z:toFront?40+index:index}));touch()}
 async function save(){if(!dirty||saving)return;setSaving(true);setMessage('');try{const next=clone(config);next.designer=next.designer||{};next.designer.frontCopy=clone(frontCopy);next.designer.visibility=clone(frontVisibility);const out=await idStudioApi.saveTemplate(templateCode,next,orientation,'front_face_controls_publish');setDirty(false);setMessage(`تم نشر إعدادات الوجه الأمامي كإصدار v${out?.template?.published_version||''}. البطاقات القديمة لن تتغير.`)}catch(e){setMessage(e.message||'تعذر حفظ إعدادات الوجه الأمامي')}finally{setSaving(false)}}
 return <div style={{display:'grid',gap:10}}>
  <details open className="idvisual-back-panel"><summary style={{cursor:'pointer',fontSize:11,fontWeight:900,color:'#1f3550'}}>نصوص الوجه الأمامي القابلة للتعديل</summary><div className="idvisual-back-copy-grid">{Object.entries(fields).map(([key,label])=><label key={key}><span>{label}</span><input dir={key.endsWith('En')||key==='idCardLabel'?'ltr':undefined} value={frontCopy[key]??''} onChange={e=>setField(key,e.target.value)}/></label>)}</div><button type="button" className="idvisual-reset-typo" onClick={reset}>إرجاع نصوص الأمام الافتراضية</button></details>
  <details open className="idvisual-back-panel"><summary style={{cursor:'pointer',fontSize:11,fontWeight:900,color:'#1f3550'}}>إظهار وإخفاء عناصر الوجه الأمامي</summary><div className="idvisual-back-toggles">{Object.entries(visibilityLabels).map(([key,label])=><label key={key}><input type="checkbox" checked={frontVisibility[key]!==false} onChange={e=>setVisibility(key,e.target.checked)}/><span>{label}</span></label>)}</div></details>
  <details open className="idvisual-back-panel"><summary style={{cursor:'pointer',fontSize:11,fontWeight:900,color:'#1f3550'}}>تجميع وترتيب عناصر الوجه الأمامي</summary><div style={{display:'grid',gap:8}}>{Object.entries(groups).map(([key,g])=><div key={key} style={{display:'grid',gridTemplateColumns:'minmax(150px,1fr) repeat(6,auto)',gap:6,alignItems:'center',padding:7,border:'1px solid #edf0f4',borderRadius:8}}><strong style={{fontSize:10,color:'#31445d'}}>{g.label}</strong><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupVisibility(key,true)}>إظهار</button><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupVisibility(key,false)}>إخفاء</button><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupLock(key,true)}>قفل</button><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupLock(key,false)}>فتح</button><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupLayer(key,true)}>للواجهة</button><button type="button" className="idvisual-reset-typo" onClick={()=>setGroupLayer(key,false)}>للخلفية</button></div>)}</div><div className="idvisual-hint">المجموعة تطبق الإظهار/الإخفاء والقفل وترتيب الطبقات على عناصرها دفعة واحدة، مع بقاء كل عنصر قابلًا للتحريك والتعديل منفردًا بعد فتحه.</div></details>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><button type="button" className="idvisual-reset-typo" disabled={!dirty||saving} onClick={save}>{saving?'جاري النشر...':'نشر إعدادات الأمام'}</button>{message&&<div className={`idvisual-message ${message.startsWith('تم ')?'success':'error'}`} style={{flex:'1 1 260px'}}>{message}</div>}</div>
  <IDTemplateVisualEditorLegacy {...props} config={previewConfig}/>
 </div>
}
