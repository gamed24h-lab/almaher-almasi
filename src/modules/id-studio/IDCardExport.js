const MM_PER_INCH=25.4;
const CSS_DPI=96;
const CARD_W_MM=85.6;
const CARD_H_MM=53.98;

function safeName(value='id-card'){
  return String(value||'id-card').trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'id-card';
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('تعذر تجهيز الصورة للتصدير.'));r.readAsDataURL(blob)});
}

async function inlineImages(root){
  const images=[...root.querySelectorAll('img')];
  await Promise.all(images.map(async img=>{
    const src=img.getAttribute('src')||'';
    if(!src||src.startsWith('data:'))return;
    try{
      const r=await fetch(src,{credentials:'include',cache:'no-store'});
      if(!r.ok)return;
      img.setAttribute('src',await blobToDataUrl(await r.blob()));
    }catch{}
  }));
}

function copyComputedStyles(source,clone){
  const sourceNodes=[source,...source.querySelectorAll('*')];
  const cloneNodes=[clone,...clone.querySelectorAll('*')];
  sourceNodes.forEach((node,index)=>{
    const target=cloneNodes[index];if(!target)return;
    const cs=getComputedStyle(node);
    let css='';
    for(const prop of cs)css+=`${prop}:${cs.getPropertyValue(prop)};`;
    target.setAttribute('style',`${target.getAttribute('style')||''};${css}`);
  });
}

function waitForImages(root){
  return Promise.all([...root.querySelectorAll('img')].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true})})));
}

export async function exportCardElementToPng(element,{filename='id-card.png',dpi=300}={}){
  if(!element)throw new Error('تعذر العثور على وجه البطاقة المطلوب للتصدير.');
  await waitForImages(element);
  const clone=element.cloneNode(true);
  copyComputedStyles(element,clone);
  await inlineImages(clone);
  clone.style.margin='0';clone.style.transform='none';clone.style.borderRadius='0';clone.style.width=`${CARD_W_MM}mm`;clone.style.height=`${CARD_H_MM}mm`;

  const logicalW=CARD_W_MM*CSS_DPI/MM_PER_INCH;
  const logicalH=CARD_H_MM*CSS_DPI/MM_PER_INCH;
  const scale=Math.max(1,Number(dpi)||300)/CSS_DPI;
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(logicalW*scale);canvas.height=Math.round(logicalH*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('المتصفح لا يدعم تصدير البطاقة كصورة.');

  const serialized=new XMLSerializer().serializeToString(clone);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${logicalW}" height="${logicalH}" viewBox="0 0 ${logicalW} ${logicalH}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${CARD_W_MM}mm;height:${CARD_H_MM}mm;margin:0;padding:0;overflow:hidden">${serialized}</div></foreignObject></svg>`;
  const svgUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('تعذر تحويل تصميم البطاقة إلى PNG.'));image.src=svgUrl});
    ctx.setTransform(scale,0,0,scale,0,0);ctx.drawImage(image,0,0,logicalW,logicalH);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));
    if(!blob)throw new Error('تعذر إنشاء ملف PNG.');
    downloadBlob(blob,filename.toLowerCase().endsWith('.png')?filename:`${safeName(filename)}.png`);
    return {width:canvas.width,height:canvas.height,dpi:Number(dpi)||300};
  }finally{URL.revokeObjectURL(svgUrl)}
}

export function exportCardToPngBySelector(selector,{cardNumber='id-card',side='front',dpi=300}={}){
  const element=document.querySelector(selector);
  return exportCardElementToPng(element,{filename:`${safeName(cardNumber)}-${side}.png`,dpi});
}

export function openCR80PdfPrint({rootSelector='#idstudio-print-root',side='front'}={}){
  const root=document.querySelector(rootSelector);if(!root)throw new Error('تعذر تجهيز البطاقة كـ PDF.');
  const normalized=side==='full'?'front':side;
  document.body.dataset.idstudioPrintMode='single';root.dataset.side=normalized;
  window.print();
  return true;
}
