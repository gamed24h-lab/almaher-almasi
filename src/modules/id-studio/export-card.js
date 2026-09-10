const CR80_RATIO=85.6/53.98;

function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function collectCss(){
  let css='';
  for(const sheet of Array.from(document.styleSheets||[])){
    try{for(const rule of Array.from(sheet.cssRules||[]))css+=`${rule.cssText}\n`}catch{}
  }
  return css;
}

async function imageToDataUrl(src){
  if(!src||src.startsWith('data:'))return src;
  const response=await fetch(src,{credentials:'include'});if(!response.ok)throw new Error('تعذر تحميل إحدى صور البطاقة للتصدير.');
  const blob=await response.blob();return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(blob)});
}

async function inlineImages(root){
  const images=Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async img=>{try{img.setAttribute('src',await imageToDataUrl(img.currentSrc||img.src))}catch{}}));
}

export async function exportCardElementToPng(element,{fileName='almaher-id-card.png',width=2024}={}){
  if(!element)throw new Error('لا توجد بطاقة جاهزة للتصدير.');
  if(document.fonts?.ready)await document.fonts.ready;
  const clone=element.cloneNode(true);await inlineImages(clone);
  clone.style.margin='0';clone.style.transform='none';clone.style.width='85.6mm';clone.style.height='53.98mm';
  const css=collectCss().replace(/<\/style/gi,'<\\/style');
  const serialized=new XMLSerializer().serializeToString(clone);
  const height=Math.round(width/CR80_RATIO);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:85.6mm;height:53.98mm;transform-origin:0 0;transform:scale(${width/(85.6*96/25.4)})"><style>${css}</style>${serialized}</div></foreignObject></svg>`;
  const svgBlob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const url=URL.createObjectURL(svgBlob);
  try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('تعذر تحويل البطاقة إلى صورة PNG.'));img.src=url});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,width,height);
    const png=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر إنشاء ملف PNG.')),'image/png',1));downloadBlob(png,fileName);return {width,height,fileName};
  }finally{URL.revokeObjectURL(url)}
}

export function sanitizeCardFileName(card,side='front'){
  const number=String(card?.card_number||'ID').replace(/[^a-zA-Z0-9_-]+/g,'-');return `${number}-${side}.png`;
}
