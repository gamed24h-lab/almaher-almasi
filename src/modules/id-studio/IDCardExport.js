const MM_PER_INCH=25.4;
const CSS_DPI=96;
const PT_PER_MM=72/25.4;
const SIZE={landscape:{w:85.6,h:53.98},portrait:{w:53.98,h:85.6}};

function safeName(value='id-card'){
  return String(value||'id-card').trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'id-card';
}
function orientationOf(element,explicit){
  const raw=explicit||element?.dataset?.orientation||(element?.classList?.contains('portrait')?'portrait':'landscape');
  return raw==='portrait'?'portrait':'landscape';
}
function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback}
function normalizeCalibration(value={}){return {offsetX:clamp(value.offsetX,-20,20,0),offsetY:clamp(value.offsetY,-20,20,0),scaleX:clamp(value.scaleX,.9,1.1,1),scaleY:clamp(value.scaleY,.9,1.1,1)}}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('تعذر تجهيز الصورة للتصدير.'));r.readAsDataURL(blob)})}
async function inlineImages(root){const images=[...root.querySelectorAll('img')];await Promise.all(images.map(async img=>{const src=img.getAttribute('src')||'';if(!src||src.startsWith('data:'))return;try{const r=await fetch(src,{credentials:'include',cache:'no-store'});if(!r.ok)return;img.setAttribute('src',await blobToDataUrl(await r.blob()))}catch{}}))}
function copyComputedStyles(source,clone){const sourceNodes=[source,...source.querySelectorAll('*')],cloneNodes=[clone,...clone.querySelectorAll('*')];sourceNodes.forEach((node,index)=>{const target=cloneNodes[index];if(!target)return;const cs=getComputedStyle(node);let css='';for(const prop of cs)css+=`${prop}:${cs.getPropertyValue(prop)};`;target.setAttribute('style',`${target.getAttribute('style')||''};${css}`)})}
function waitForImages(root){return Promise.all([...root.querySelectorAll('img')].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true})})))}
function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function qrStillRendering(el){return !!el.querySelector('.idcard-qr-placeholder')||!!(el.querySelector('.idcard-status.active')&&!el.querySelector('.idcard-qr'))}
async function waitForDynamicCardContent(elements){
  const list=(Array.isArray(elements)?elements:[elements]).filter(Boolean);if(!list.length)return;
  await nextPaint();
  const started=Date.now();
  while(list.some(qrStillRendering)&&Date.now()-started<1200){await sleep(40);await nextPaint()}
  await sleep(140);await nextPaint();
  await Promise.all(list.map(waitForImages));
}
function ascii(value){return new TextEncoder().encode(String(value))}
function concatBytes(parts){const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length}return out}
function dataUrlBytes(dataUrl){const base64=String(dataUrl).split(',')[1]||'',raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}

async function renderCardCanvas(element,{dpi=300,orientation}={}){
  if(!element)throw new Error('تعذر العثور على وجه البطاقة المطلوب للتصدير.');
  await waitForImages(element);
  const o=orientationOf(element,orientation),size=SIZE[o];
  const clone=element.cloneNode(true);copyComputedStyles(element,clone);await inlineImages(clone);
  clone.style.margin='0';clone.style.transform='none';clone.style.borderRadius='0';clone.style.width=`${size.w}mm`;clone.style.height=`${size.h}mm`;
  const logicalW=size.w*CSS_DPI/MM_PER_INCH,logicalH=size.h*CSS_DPI/MM_PER_INCH,scale=Math.max(1,Number(dpi)||300)/CSS_DPI;
  const canvas=document.createElement('canvas');canvas.width=Math.round(logicalW*scale);canvas.height=Math.round(logicalH*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('المتصفح لا يدعم تصدير البطاقة كصورة.');
  const serialized=new XMLSerializer().serializeToString(clone);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${logicalW}" height="${logicalH}" viewBox="0 0 ${logicalW} ${logicalH}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${size.w}mm;height:${size.h}mm;margin:0;padding:0;overflow:hidden">${serialized}</div></foreignObject></svg>`;
  const svgUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('تعذر تحويل تصميم البطاقة إلى صورة.'));image.src=svgUrl});ctx.setTransform(scale,0,0,scale,0,0);ctx.drawImage(image,0,0,logicalW,logicalH);return {canvas,orientation:o,size}}finally{URL.revokeObjectURL(svgUrl)}
}

function buildPdf(pages,calibration={}){
  const cal=normalizeCalibration(calibration),objects=[];
  const pageIds=[],imageIds=[],contentIds=[];
  let nextId=3;
  for(let i=0;i<pages.length;i++){pageIds.push(nextId++);imageIds.push(nextId++);contentIds.push(nextId++)}
  objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2]=ascii(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p,i)=>{
    const pageW=p.size.w*PT_PER_MM,pageH=p.size.h*PT_PER_MM,drawW=pageW*cal.scaleX,drawH=pageH*cal.scaleY,x=cal.offsetX*PT_PER_MM,y=pageH-(cal.offsetY*PT_PER_MM)-drawH;
    const w=pageW.toFixed(4),h=pageH.toFixed(4),dw=drawW.toFixed(4),dh=drawH.toFixed(4),dx=x.toFixed(4),dy=y.toFixed(4),pageId=pageIds[i],imageId=imageIds[i],contentId=contentIds[i];
    const command=`q\n${dw} 0 0 ${dh} ${dx} ${dy} cm\n/Im0 Do\nQ\n`,commandBytes=ascii(command);
    objects[pageId]=ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects[imageId]=concatBytes([ascii(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`),p.jpeg,ascii('\nendstream')]);
    objects[contentId]=concatBytes([ascii(`<< /Length ${commandBytes.length} >>\nstream\n`),commandBytes,ascii('endstream')]);
  });
  const parts=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=[0];let length=parts[0].length;
  for(let id=1;id<objects.length;id++){offsets[id]=length;const obj=concatBytes([ascii(`${id} 0 obj\n`),objects[id],ascii('\nendobj\n')]);parts.push(obj);length+=obj.length}
  const xrefOffset=length;let xref=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let id=1;id<objects.length;id++)xref+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
  parts.push(ascii(xref));parts.push(ascii(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob(parts,{type:'application/pdf'});
}

export async function exportCardElementToPng(element,{filename='id-card.png',dpi=300,orientation}={}){
  await waitForDynamicCardContent([element]);
  const {canvas,orientation:o,size}=await renderCardCanvas(element,{dpi,orientation});
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)throw new Error('تعذر إنشاء ملف PNG.');
  downloadBlob(blob,filename.toLowerCase().endsWith('.png')?filename:`${safeName(filename)}.png`);return {width:canvas.width,height:canvas.height,dpi:Number(dpi)||300,orientation:o,width_mm:size.w,height_mm:size.h};
}

export async function exportCardElementsToPdf(elements,{filename='id-card.pdf',dpi=300,quality=.96,calibration={}}={}){
  const list=(Array.isArray(elements)?elements:[elements]).filter(Boolean);if(!list.length)throw new Error('تعذر العثور على البطاقة المطلوبة لتصدير PDF.');
  await waitForDynamicCardContent(list);
  const pages=[];
  for(const element of list){const {canvas,size}=await renderCardCanvas(element,{dpi});const dataUrl=canvas.toDataURL('image/jpeg',Math.max(.8,Math.min(1,Number(quality)||.96)));pages.push({size,width:canvas.width,height:canvas.height,jpeg:dataUrlBytes(dataUrl)})}
  const normalizedCalibration=normalizeCalibration(calibration),blob=buildPdf(pages,normalizedCalibration);downloadBlob(blob,filename.toLowerCase().endsWith('.pdf')?filename:`${safeName(filename)}.pdf`);return {pages:pages.length,dpi:Number(dpi)||300,page_sizes_mm:pages.map(p=>[p.size.w,p.size.h]),calibration:normalizedCalibration};
}

export function exportCardToPngBySelector(selector,{cardNumber='id-card',side='front',dpi=300,orientation}={}){const element=document.querySelector(selector);return exportCardElementToPng(element,{filename:`${safeName(cardNumber)}-${side}.png`,dpi,orientation})}

export function openCR80PdfPrint({rootSelector='#idstudio-print-root',side='front',orientation}={}){
  const root=document.querySelector(rootSelector);if(!root)throw new Error('تعذر تجهيز البطاقة كـ PDF.');
  const face=root.querySelector(`.idcard-cr80.${side==='back'?'back':'front'}`);const o=orientationOf(face,orientation);
  document.body.dataset.idstudioPrintMode='single';root.dataset.side=side==='full'?'front':side;root.dataset.orientation=o;window.print();return true;
}
