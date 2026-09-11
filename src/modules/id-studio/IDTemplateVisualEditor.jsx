import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {IDCardFace} from './IDCardPrint.jsx';
import './id-template-visual-editor.css';

const selectors={
 logo:'.idcard-template-logo',brand:'.idcard-brand',serviceLine:'.idcard-company-line',makkah:'.idcard-template-makkah',photo:'.idcard-photo',person:'.idcard-person',number:'.idcard-number',meta:'.idcard-full-meta',qr:'.idcard-qr-wrap',approval:'.idcard-approval',bus:'.idcard-template-bus',slogan:'.idcard-template-slogan',footer:'.idcard-reference-footer'
};
const labels={logo:'الشعار',brand:'اسم الشركة',serviceLine:'وصف النشاط',makkah:'مكة / برج الساعة',photo:'صورة الموظف',person:'الاسم والمسمى',number:'رقم البطاقة',meta:'بيانات البطاقة',qr:'QR',approval:'الاعتماد',bus:'الباص',slogan:'الشعار النصي',footer:'النص السفلي'};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const round=v=>Math.round(v*10)/10;

export default function IDTemplateVisualEditor({templateCode='makkah_luxury',config,orientation='portrait',selectedElement='photo',onSelect,onLayoutChange}){
 const wrapRef=useRef(null),[boxes,setBoxes]=useState({}),dragRef=useRef(null);
 const size=orientation==='portrait'?{w:53.98,h:85.6}:{w:85.6,h:53.98};
 const sample=useMemo(()=>({id:'designer-preview',template_code:templateCode,template_config:config,orientation,print_mode:'single',status:'active',card_number:'MA-001',name_ar:'محمد عبدالرحمن حسن',name_en:'MOHAMED ABDELRAHMAN HASSAN',job_title_ar:'مدير الحجوزات والتسكين',job_title_en:'Reservations & Housing Manager',department_ar:'الحجوزات والتسكين',license_number:'MA-1448',season_label:'1448هـ',expiry_date:'2027-06-01',metadata:{issue_version:1},qr_token:'designer-preview-token'}),[templateCode,config,orientation]);
 const measure=useCallback(()=>{const root=wrapRef.current?.querySelector('.idcard-cr80');if(!root)return;const rr=root.getBoundingClientRect(),next={};Object.entries(selectors).forEach(([key,sel])=>{const el=root.querySelector(sel);if(!el)return;const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return;next[key]={left:r.left-rr.left,top:r.top-rr.top,width:r.width,height:r.height}});setBoxes(next)},[]);
 useEffect(()=>{const t1=requestAnimationFrame(()=>requestAnimationFrame(measure));const t2=setTimeout(measure,180);const onResize=()=>measure();window.addEventListener('resize',onResize);return()=>{cancelAnimationFrame(t1);clearTimeout(t2);window.removeEventListener('resize',onResize)}},[measure,config,orientation,templateCode]);
 function geometryFromBox(key){const root=wrapRef.current?.querySelector('.idcard-cr80'),b=boxes[key];if(!root||!b)return null;const rr=root.getBoundingClientRect(),sx=size.w/rr.width,sy=size.h/rr.height;return {x:round(b.left*sx),y:round(b.top*sy),w:round(b.width*sx),h:round(b.height*sy),sx,sy}}
 function begin(e,key,mode){e.preventDefault();e.stopPropagation();onSelect?.(key);const g=geometryFromBox(key);if(!g)return;dragRef.current={key,mode,startX:e.clientX,startY:e.clientY,...g};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true})}
 function move(e){const d=dragRef.current;if(!d)return;const dx=(e.clientX-d.startX)*d.sx,dy=(e.clientY-d.startY)*d.sy;if(d.mode==='move'){const x=round(clamp(d.x+dx,0,Math.max(0,size.w-d.w))),y=round(clamp(d.y+dy,0,Math.max(0,size.h-d.h)));onLayoutChange?.(d.key,{x,y})}else{const w=round(clamp(d.w+dx,2,size.w-d.x)),h=round(clamp(d.h+dy,2,size.h-d.y));onLayoutChange?.(d.key,{x:d.x,y:d.y,w,h})}}
 function end(){dragRef.current=null;window.removeEventListener('pointermove',move);setTimeout(measure,0)}
 return <div className="idvisual-editor"><div className="idvisual-toolbar"><div><b>تحريك بالسحب</b><span>اسحب أي إطار لتغيير مكانه، واسحب المربع الذهبي لتغيير الحجم.</span></div><span className="idvisual-size">CR80 · {size.w} × {size.h} مم</span></div><div className={`idvisual-canvas ${orientation}`}><div className="idvisual-card-wrap" ref={wrapRef}><IDCardFace card={sample}/>{Object.entries(boxes).map(([key,b])=><div key={key} className={`idvisual-box ${selectedElement===key?'selected':''}`} style={{left:b.left,top:b.top,width:b.width,height:b.height}} onPointerDown={e=>begin(e,key,'move')} onClick={()=>onSelect?.(key)}><span>{labels[key]||key}</span>{selectedElement===key&&<i className="idvisual-resize" onPointerDown={e=>begin(e,key,'resize')}/>}</div>)}</div></div><div className="idvisual-hint">المواضع تُحفظ بالملليمتر، لذلك نفس النتيجة تنتقل للمعاينة والطباعة وPNG/PDF.</div></div>
}
