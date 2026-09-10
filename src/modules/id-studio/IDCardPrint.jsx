import React,{useEffect,useMemo,useState} from 'react';
import QRCode from 'qrcode';
import './id-card-print.css';

const statusAr={active:'فعالة',draft:'مسودة',pending_approval:'بانتظار الاعتماد',suspended:'موقوفة',expired:'منتهية',lost:'مفقودة',revoked:'ملغاة',reissued:'أعيد إصدارها'};

export function IDCardFace({card,side='front',verificationBase=''}){
  const [qr,setQr]=useState('');
  const verifyUrl=useMemo(()=>card?.qr_token?`${verificationBase||window.location.origin}/verify/id/${encodeURIComponent(card.qr_token)}`:'',[card?.qr_token,verificationBase]);
  useEffect(()=>{let alive=true;if(!verifyUrl){setQr('');return}QRCode.toDataURL(verifyUrl,{width:360,margin:1,errorCorrectionLevel:'M'}).then(x=>alive&&setQr(x)).catch(()=>alive&&setQr(''));return()=>{alive=false}},[verifyUrl]);
  if(!card)return null;
  const full=card.print_mode!=='front_back';
  if(side==='back'&&!full)return <div className={`idcard-cr80 idcard-${card.template_code||'makkah_luxury'} back`}>
    <div className="idcard-brand">شركة الماهر الماسي</div>
    <div className="idcard-back-grid"><div>{qr?<img className="idcard-qr large" src={qr} alt="QR verification"/>:<div className="idcard-qr-placeholder">QR</div>}<small>امسح للتحقق من حالة البطاقة</small></div><div className="idcard-info"><b>رقم البطاقة</b><span>{card.card_number}</span><b>القسم</b><span>{card.department_ar||'—'}</span><b>الترخيص</b><span>{card.license_number||'—'}</span><b>الموسم</b><span>{card.season_label||'—'}</span><b>الصلاحية</b><span>{card.expiry_date||'—'}</span></div></div>
    <div className="idcard-footer">هذه البطاقة ملك للشركة، والتحقق الإلكتروني هو المرجع لحالتها الحالية.</div>
  </div>;
  return <div className={`idcard-cr80 idcard-${card.template_code||'makkah_luxury'} front`}>
    <div className="idcard-brand"><strong>الماهر الماسي</strong><span>AL MAHER AL MASI</span></div>
    <div className="idcard-photo">{card.photo_url?<img src={card.photo_url} alt=""/>:<span>الصورة</span>}</div>
    <div className="idcard-person"><strong>{card.name_ar||'اسم حامل البطاقة'}</strong><span>{card.name_en||''}</span><b>{card.job_title_ar||'المسمى الوظيفي'}</b><small>{card.job_title_en||''}</small></div>
    <div className="idcard-number">{card.card_number||'MA-000'}</div>
    {full&&<div className="idcard-full-meta"><span>{card.department_ar||'—'}</span><span>{card.season_label||'—'}</span><span>{card.expiry_date||'—'}</span></div>}
    {qr&&<img className="idcard-qr" src={qr} alt="QR verification"/>}
    <div className={`idcard-status ${card.status||'draft'}`}>{statusAr[card.status]||card.status}</div>
    {card.status!=='active'&&<div className="idcard-watermark">غير معتمدة</div>}
  </div>;
}

export function printCR80(card,{side='front',copies=1,offsetX=0,offsetY=0}={}){
  const root=document.getElementById('idstudio-print-root');if(!root)return;
  root.dataset.side=side;root.style.setProperty('--print-x',`${Number(offsetX)||0}mm`);root.style.setProperty('--print-y',`${Number(offsetY)||0}mm`);root.dataset.copies=String(Math.max(1,Number(copies)||1));window.print();
}
