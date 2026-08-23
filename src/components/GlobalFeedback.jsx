import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {CheckCircle2,AlertCircle,Info,TriangleAlert,X} from 'lucide-react';
import {feedbackEvent} from '../lib/feedback.js';

const icon={success:CheckCircle2,error:AlertCircle,warning:TriangleAlert,info:Info};
export default function GlobalFeedback(){
  const [items,setItems]=useState([]);
  useEffect(()=>{
    const onFeedback=e=>{
      const d=e.detail||{};if(!d.message)return;
      const item={id:d.id||`${Date.now()}-${Math.random()}`,type:d.type||'info',message:d.message,title:d.title||'',duration:Number(d.duration||3600)};
      setItems(x=>[...x.filter(v=>v.message!==item.message),item].slice(-4));
      if(item.duration>0)setTimeout(()=>setItems(x=>x.filter(v=>v.id!==item.id)),item.duration);
    };
    window.addEventListener(feedbackEvent,onFeedback);return()=>window.removeEventListener(feedbackEvent,onFeedback);
  },[]);
  if(typeof document==='undefined'||!items.length)return null;
  return createPortal(<div className="global-feedback-stack" aria-live="polite" aria-atomic="false">{items.map(item=>{const Icon=icon[item.type]||Info;return <div key={item.id} className={`global-feedback ${item.type}`} role={item.type==='error'?'alert':'status'}><Icon size={21}/><div className="global-feedback-copy">{item.title&&<strong>{item.title}</strong>}<span>{item.message}</span></div><button type="button" className="global-feedback-close" onClick={()=>setItems(x=>x.filter(v=>v.id!==item.id))} aria-label="إغلاق"><X size={17}/></button></div>})}</div>,document.body);
}
