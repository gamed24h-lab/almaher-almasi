import React,{useEffect,useMemo,useState} from 'react';
import QRCode from 'qrcode';
import './id-card-print.css';

const statusAr={active:'فعالة',draft:'مسودة',pending_approval:'بانتظار الاعتماد',suspended:'موقوفة',expired:'منتهية',lost:'مفقودة',revoked:'ملغاة',reissued:'أعيد إصدارها'};
const CALIBRATION_KEY='almaher_idstudio_cr80_calibration_v1';

export function getCR80Calibration(){
  try{const x=JSON.parse(localStorage.getItem(CALIBRATION_KEY)||'{}');return {offsetX:Number(x.offsetX)||0,offsetY:Number(x.offsetY)||0,scaleX:Number(x.scaleX)||1,scaleY:Number(x.scaleY)||1}}catch{return {offsetX:0,offsetY:0,scaleX:1,scaleY:1}}
}
export function saveCR80Calibration(value={}){
  const x={offsetX:Number(value.offsetX)||0,offsetY:Number(value.offsetY)||0,scaleX:Number(value.scaleX)||1,scaleY:Number(value.scaleY)||1};
  try{localStorage.setItem(CALIBRATION_KEY,JSON.stringify(x))}catch{}
  return x;
}

function MetaPill({label,value}){return <span><b>{label}</b>{value||'—'}</span>}

export function IDCardFace({card,side='front',verificationBase=''}){
  const [qr,setQr]=useState('');
  const verifyUrl=useMemo(()=>card?.qr_token?`${verificationBase||(typeof window!=='undefined'?window.location.origin:'')}/verify/id/${encodeURIComponent(card.qr_token)}`:'',[card?.qr_token,verificationBase]);
  useEffect(()=>{let alive=true;if(!verifyUrl){setQr('');return}QRCode.toDataURL(verifyUrl,{width:360,margin:1,errorCorrectionLevel:'M'}).then(x=>alive&&setQr(x)).catch(()=>alive&&setQr(''));return()=>{alive=false}},[verifyUrl]);
  if(!card)return null;
  const full=card.print_mode!=='front_back';
  const issueVersion=Number(card.metadata?.issue_version||1);
  if(side==='back'&&!full)return <div className={`idcard-cr80 idcard-${card.template_code||'makkah_luxury'} back`}>
    <div className="idcard-decor idcard-decor-a"></div><div className="idcard-decor idcard-decor-b"></div>
    <div className="idcard-brand"><strong>شركة الماهر الماسي</strong><span>AL MAHER AL MASI</span></div>
    <div className="idcard-back-grid"><div>{qr?<img className="idcard-qr large" src={qr} alt="QR verification"/>:<div className="idcard-qr-placeholder">QR</div>}<small>امسح للتحقق من حالة البطاقة</small></div><div className="idcard-info"><b>رقم البطاقة</b><span>{card.card_number}</span><b>الإصدار</b><span>V{issueVersion}</span><b>القسم</b><span>{card.department_ar||'—'}</span><b>الترخيص</b><span>{card.license_number||'—'}</span><b>الموسم</b><span>{card.season_label||'—'}</span><b>الصلاحية</b><span>{card.expiry_date||'—'}</span></div></div>
    <div className="idcard-verify-note">الحالة الإلكترونية الحالية عبر رمز QR هي المرجع لصلاحية البطاقة.</div>
    <div className="idcard-footer">هذه البطاقة ملك لشركة الماهر الماسي، وفي حال العثور عليها يرجى تسليمها للإدارة.</div>
  </div>;
  return <div className={`idcard-cr80 idcard-${card.template_code||'makkah_luxury'} front`}>
    <div className="idcard-decor idcard-decor-a"></div><div className="idcard-decor idcard-decor-b"></div><div className="idcard-watermark-mark">M</div>
    <div className="idcard-brand"><strong>الماهر الماسي</strong><span>AL MAHER AL MASI</span></div>
    <div className="idcard-company-line">لنقل الحجاج والمعتمرين</div>
    <div className="idcard-photo">{card.photo_url?<img src={card.photo_url} alt=""/>:<span>الصورة</span>}</div>
    <div className="idcard-person"><strong>{card.name_ar||'اسم حامل البطاقة'}</strong><span>{card.name_en||''}</span><b>{card.job_title_ar||'المسمى الوظيفي'}</b><small>{card.job_title_en||''}</small></div>
    <div className="idcard-number"><small>ID CARD</small>{card.card_number||'MA-000'}<em>V{issueVersion}</em></div>
    {full&&<div className="idcard-full-meta"><MetaPill label="القسم" value={card.department_ar}/><MetaPill label="الترخيص" value={card.license_number}/><MetaPill label="الموسم" value={card.season_label}/><MetaPill label="حتى" value={card.expiry_date}/></div>}
    {qr&&<div className="idcard-qr-wrap"><img className="idcard-qr" src={qr} alt="QR verification"/><small>تحقق من البطاقة</small></div>}
    <div className={`idcard-status ${card.status||'draft'}`}>{statusAr[card.status]||card.status}</div>
    {card.status==='active'&&<div className="idcard-approval"><b>معتمدة إلكترونيًا</b><span>Electronic Verification</span></div>}
    {card.status!=='active'&&<div className="idcard-watermark">غير معتمدة</div>}
  </div>;
}

export function CR80CalibrationSheet(){return <div className="idcard-calibration-sheet"><div className="calibration-border"></div><div className="calibration-center-x"></div><div className="calibration-center-y"></div><div className="calibration-label">CR80 · 85.60 × 53.98 mm</div><div className="calibration-mm x">10 mm</div><div className="calibration-mm y">10 mm</div></div>}

export function BatchPrintSheet({cards=[],side='front'}){return <div id="idstudio-batch-print-root" className="idstudio-batch-print-sheet" data-side={side}>{cards.flatMap(card=>{const faces=side==='both'&&card.print_mode==='front_back'?['front','back']:[side==='back'?'back':'front'];return faces.map(face=><div className="idstudio-batch-page" key={`${card.id}-${face}`}><IDCardFace card={card} side={face}/></div>)})}</div>}

function applyCalibration(root,{offsetX,offsetY,scaleX,scaleY}={}){const saved=getCR80Calibration();root.style.setProperty('--print-x',`${offsetX??saved.offsetX}mm`);root.style.setProperty('--print-y',`${offsetY??saved.offsetY}mm`);root.style.setProperty('--print-scale-x',String(scaleX??saved.scaleX));root.style.setProperty('--print-scale-y',String(scaleY??saved.scaleY))}

function printRepeatedCopies(root,side,copies,calibration){
  const faces=side==='both'?['front','back']:[side];
  const temp=document.createElement('div');temp.className='idstudio-batch-print-sheet';temp.id='idstudio-single-copy-print-root';temp.dataset.side=side;
  for(let copy=0;copy<copies;copy++)for(const face of faces){const source=root.querySelector(`.idcard-cr80.${face}`);if(!source)continue;const page=document.createElement('div');page.className='idstudio-batch-page';page.dataset.copy=String(copy+1);page.dataset.face=face;page.appendChild(source.cloneNode(true));temp.appendChild(page)}
  if(!temp.children.length)return false;
  document.body.appendChild(temp);applyCalibration(temp,calibration);document.body.dataset.idstudioPrintMode='batch';
  try{window.print()}finally{temp.remove();document.body.dataset.idstudioPrintMode='single'}
  return true;
}

export function printCR80(card,{side='front',copies=1,offsetX,offsetY,scaleX,scaleY,calibration=false}={}){
  const root=document.getElementById('idstudio-print-root');if(!root)return false;
  const normalizedSide=side==='full'?'front':side;
  const count=Math.min(50,Math.max(1,Math.trunc(Number(copies)||1)));
  if(!calibration&&count>1)return printRepeatedCopies(root,normalizedSide,count,{offsetX,offsetY,scaleX,scaleY});
  document.body.dataset.idstudioPrintMode='single';
  root.dataset.side=calibration?'calibration':normalizedSide;
  applyCalibration(root,{offsetX,offsetY,scaleX,scaleY});
  root.dataset.copies=String(count);
  window.print();return true;
}

export function printCR80Batch({side='front',offsetX,offsetY,scaleX,scaleY}={}){
  const root=document.getElementById('idstudio-batch-print-root');if(!root||!root.children.length)return false;
  document.body.dataset.idstudioPrintMode='batch';
  root.dataset.side=side;
  applyCalibration(root,{offsetX,offsetY,scaleX,scaleY});
  window.print();return true;
}
