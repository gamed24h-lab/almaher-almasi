import React,{useEffect,useRef,useState} from 'react';
import QrScanner from 'qr-scanner';
import {Camera,Keyboard} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Field,Input,Select,ErrorBox} from '../../components/UI.jsx';

export default function Scanner({tripId}){
 const [code,setCode]=useState(''),[mode,setMode]=useState('outbound_boarding'),[result,setResult]=useState(null),[error,setError]=useState(''),[camera,setCamera]=useState(false);
 const video=useRef(null),stream=useRef(null),qrRef=useRef(null),running=useRef(false);
 useEffect(()=>()=>stopCamera(),[]);
 async function scan(v=code){if(!String(v).trim())return;setError('');try{const x=await api.moduleWrite({action:'scan',code:String(v).trim(),scan_mode:mode,trip_id:tripId||undefined,device_id:navigator.userAgent.slice(0,120)});setResult(x);tone(x.result==='duplicate'?440:880)}catch(e){setError(e.message);tone(220)}}
 function tone(freq){try{const A=new (window.AudioContext||window.webkitAudioContext)(),o=A.createOscillator(),g=A.createGain();o.frequency.value=freq;o.connect(g);g.connect(A.destination);g.gain.value=.06;o.start();o.stop(A.currentTime+.12)}catch{}}
 function stopCamera(){running.current=false;try{qrRef.current?.stop()}catch{}try{qrRef.current?.destroy()}catch{}qrRef.current=null;try{stream.current?.getTracks?.().forEach(t=>t.stop())}catch{}stream.current=null;if(video.current)video.current.srcObject=null;setCamera(false)}
 async function finishCode(v){if(!running.current)return;running.current=false;setCode(v);await scan(v);stopCamera()}
 async function startCamera(){
  if(!navigator.mediaDevices?.getUserMedia){setError('المتصفح لا يسمح باستخدام الكاميرا. استخدم Chrome/Edge على الكمبيوتر أو Safari حديث على الآيفون.');return}
  stopCamera();setError('');setResult(null);setCamera(true);running.current=true;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  try{
   if('BarcodeDetector' in window){
    stream.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if(!video.current)throw new Error('تعذر تهيئة نافذة الكاميرا');video.current.srcObject=stream.current;await video.current.play();
    const det=new BarcodeDetector({formats:['qr_code']});
    const loop=async()=>{if(!running.current||!video.current)return;try{const codes=await det.detect(video.current);if(codes[0]?.rawValue){await finishCode(codes[0].rawValue);return}}catch{}if(running.current)requestAnimationFrame(loop)};requestAnimationFrame(loop);return;
   }
   if(!video.current)throw new Error('تعذر تهيئة نافذة الكاميرا');
   const qr=new QrScanner(video.current,async r=>{const v=typeof r==='string'?r:r?.data;if(v)await finishCode(v)},{returnDetailedScanResult:true,highlightScanRegion:true,highlightCodeOutline:true,maxScansPerSecond:8,preferredCamera:'environment'});
   qrRef.current=qr;await qr.start();
  }catch(e){stopCamera();setError('تعذر فتح الكاميرا: '+(e?.message||e))}
 }
 return <><PageHeader title="QR والصعود" subtitle="صعود، وصول، تسكين، عودة — مع منع التكرار وصوت الحالة"/><div className="scanner-grid"><Card><Field label="وضع المسح"><Select value={mode} onChange={e=>setMode(e.target.value)}><option value="outbound_boarding">صعود الذهاب</option><option value="outbound_arrival">وصول الذهاب</option><option value="housing_checkin">دخول السكن</option><option value="return_boarding">صعود العودة</option><option value="return_arrival">وصول العودة</option><option value="verify">تحقق فقط</option></Select></Field><Field label="رمز QR / رقم الحجز"><Input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==='Enter'&&scan()} placeholder="امسح أو اكتب الرقم"/></Field><div className="page-actions"><Button variant="primary" onClick={()=>scan()}><Keyboard size={16}/> تحقق</Button><Button onClick={camera?stopCamera:startCamera}><Camera size={16}/> {camera?'إغلاق الكاميرا':'فتح الكاميرا'}</Button></div><ErrorBox error={error}/></Card><Card className="camera-card"><video ref={video} playsInline muted className={camera?'scanner-video':'scanner-video scanner-video-hidden'}/>{!camera&&<div className="scanner-placeholder">{result?<><strong className={result.result==='duplicate'?'warning-text':'success-text'}>{result.result==='duplicate'?'تم المسح سابقًا':'تم المسح بنجاح'}</strong><span>{result.booking?.booking_number}</span><b>{result.booking?.customer_name}</b></>:<><Camera size={50}/><span>نتيجة المسح ستظهر هنا</span></>}</div>}</Card></div></>
}
