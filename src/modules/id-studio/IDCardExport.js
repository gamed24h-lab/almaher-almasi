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
function isAppleMobile(){if(typeof navigator==='undefined')return false;const ua=String(navigator.userAgent||'');return /iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints)>1)}
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
function inheritedStyles(){return [...document.head.querySelectorAll('link[rel="stylesheet"],style')].map(node=>node.tagName==='LINK'?`<link rel="stylesheet" href="${node.href}">`:node.outerHTML).join('')}
async function waitForStyleSheets(doc){const links=[...doc.querySelectorAll('link[rel="stylesheet"]')];await Promise.all(links.map(link=>link.sheet?Promise.resolve():new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;resolve()};link.addEventListener('load',finish,{once:true});link.addEventListener('error',finish,{once:true});setTimeout(finish,1800)})))}
function openApplePrintWindow(){
  const win=window.open('about:blank','_blank');if(!win)throw new Error('Safari منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.');
  try{const doc=win.document;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"><title>CR80</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;text-align:center;padding:32px;direction:rtl">جاري تجهيز البطاقة للطباعة…</body></html>');doc.close()}catch{}
  return win;
}
async function printElementsAsCr80(elements,{calibration={},printWindow=null}={}){
  const list=(Array.isArray(elements)?elements:[elements]).filter(Boolean);if(!list.length)throw new Error('تعذر العثور على البطاقة المطلوبة للطباعة.');
  const win=printWindow;if(!win||win.closed)throw new Error('تم إغلاق نافذة الطباعة قبل تجهيز البطاقة. حاول مرة أخرى.');
  await waitForDynamicCardContent(list);const o=orientationOf(list[0]),size=SIZE[o],cal=normalizeCalibration(calibration),pages=[];
  for(const element of list){const clone=element.cloneNode(true);copyComputedStyles(element,clone);clone.style.margin='0';clone.style.borderRadius='0';clone.style.boxShadow='none';pages.push(`<div class="idstudio-ios-cr80-page">${clone.outerHTML}</div>`)}
  const doc=win.document;
  const css=`<style>html,body{margin:0!important;padding:0!important;background:#fff!important;width:${size.w}mm!important;min-width:0!important}.idstudio-ios-print-toolbar{position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;display:flex;justify-content:center}.idstudio-ios-print-toolbar button{font:600 16px system-ui;padding:12px 18px;border:0;border-radius:12px;background:#0a4f93;color:#fff;box-shadow:0 3px 14px #0003}.idstudio-ios-cr80-page{display:block!important;position:relative!important;width:${size.w}mm!important;height:${size.h}mm!important;margin:0!important;padding:0!important;overflow:hidden!important;break-after:page;page-break-after:always}.idstudio-ios-cr80-page:last-of-type{break-after:auto;page-break-after:auto}.idstudio-ios-cr80-page>.idcard-cr80{display:block!important;visibility:visible!important;margin:0!important;border-radius:0!important;box-shadow:none!important;transform:translate(${cal.offsetX}mm,${cal.offsetY}mm) scale(${cal.scaleX},${cal.scaleY})!important;transform-origin:top left!important}@page{size:${size.w}mm ${size.h}mm;margin:0}@media print{html,body{margin:0!important;padding:0!important;width:${size.w}mm!important;height:auto!important;overflow:visible!important}.idstudio-ios-print-toolbar{display:none!important}.idstudio-ios-cr80-page{display:block!important}.idstudio-ios-cr80-page>.idcard-cr80{display:block!important}}</style>`;
  doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CR80</title>${inheritedStyles()}${css}</head><body>${pages.join('')}<div class="idstudio-ios-print-toolbar"><button type="button" onclick="window.print()">طباعة / حفظ PDF</button></div></body></html>`);doc.close();
  try{await waitForStyleSheets(doc);if(doc.fonts?.ready)await doc.fonts.ready;await Promise.all([...doc.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve})));await sleep(180);win.focus();win.print();return {pages:list.length,dpi:null,page_sizes_mm:list.map(()=>[size.w,size.h]),calibration:cal,mode:'ios-standalone-print-window'}}catch(err){try{win.focus()}catch{}throw err}
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
  if(isAppleMobile())throw new Error('Safari على iPhone/iPad لا يسمح بتصدير تصميم البطاقة مباشرة إلى PNG. استخدم PDF CR80 أو الطباعة.');
  await waitForDynamicCardContent([element]);
  const {canvas,orientation:o,size}=await renderCardCanvas(element,{dpi,orientation});
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)throw new Error('تعذر إنشاء ملف PNG.');
  downloadBlob(blob,filename.toLowerCase().endsWith('.png')?filename:`${safeName(filename)}.png`);return {width:canvas.width,height:canvas.height,dpi:Number(dpi)||300,orientation:o,width_mm:size.w,height_mm:size.h};
}

export async function exportCardElementsToPdf(elements,{filename='id-card.pdf',dpi=300,quality=.96,calibration={}}={}){
  const list=(Array.isArray(elements)?elements:[elements]).filter(Boolean);if(!list.length)throw new Error('تعذر العثور على البطاقة المطلوبة لتصدير PDF.');
  const apple=isAppleMobile(),printWindow=apple?openApplePrintWindow():null;
  await waitForDynamicCardContent(list);const normalizedCalibration=normalizeCalibration(calibration);
  if(apple)return printElementsAsCr80(list,{calibration:normalizedCalibration,printWindow});
  const pages=[];
  for(const element of list){const {canvas,size}=await renderCardCanvas(element,{dpi});const dataUrl=canvas.toDataURL('image/jpeg',Math.max(.8,Math.min(1,Number(quality)||.96)));pages.push({size,width:canvas.width,height:canvas.height,jpeg:dataUrlBytes(dataUrl)})}
  const blob=buildPdf(pages,normalizedCalibration);downloadBlob(blob,filename.toLowerCase().endsWith('.pdf')?filename:`${safeName(filename)}.pdf`);return {pages:pages.length,dpi:Number(dpi)||300,page_sizes_mm:pages.map(p=>[p.size.w,p.size.h]),calibration:normalizedCalibration};
}

export function exportCardToPngBySelector(selector,{cardNumber='id-card',side='front',dpi=300,orientation}={}){const element=document.querySelector(selector);return exportCardElementToPng(element,{filename:`${safeName(cardNumber)}-${side}.png`,dpi,orientation})}

export function openCR80PdfPrint({rootSelector='#idstudio-print-root',side='front',orientation}={}){
  const root=document.querySelector(rootSelector);if(!root)throw new Error('تعذر تجهيز البطاقة كـ PDF.');
  const face=root.querySelector(`.idcard-cr80.${side==='back'?'back':'front'}`);const o=orientationOf(face,orientation);
  document.body.dataset.idstudioPrintMode='single';root.dataset.side=side==='full'?'front':side;root.dataset.orientation=o;window.print();return true;
}
