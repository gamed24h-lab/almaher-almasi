const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function frame(){
 const iframe=document.createElement('iframe');
 iframe.setAttribute('aria-hidden','true');
 Object.assign(iframe.style,{position:'fixed',right:'0',bottom:'0',width:'1px',height:'1px',border:'0',opacity:'0',pointerEvents:'none'});
 document.body.appendChild(iframe);return iframe;
}
function runFrame(iframe,delay=420){
 let done=false;const cleanup=()=>{if(done)return;done=true;setTimeout(()=>iframe.remove(),700)};
 const run=()=>{if(done)return;try{iframe.contentWindow?.focus();iframe.contentWindow?.print()}finally{cleanup()}};
 iframe.onload=()=>setTimeout(run,delay);setTimeout(run,Math.max(900,delay+450));
}
function isIOSLike(){
 if(typeof navigator==='undefined')return false;
 const ua=navigator.userAgent||'';
 return /iPad|iPhone|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&Number(navigator.maxTouchPoints||0)>1);
}
function printStandaloneWindow(html,title,delay=520){
 const w=window.open('','_blank');
 if(!w)return false;
 try{
  w.document.open();w.document.write(html);w.document.close();
  let printed=false;
  const run=()=>{if(printed)return;printed=true;try{w.document.title=title||'Al Maher';w.focus();setTimeout(()=>w.print(),delay)}catch{}}
  if(w.document.readyState==='complete')setTimeout(run,100);else w.addEventListener('load',run,{once:true});
  setTimeout(run,Math.max(1100,delay+600));
  w.addEventListener('afterprint',()=>setTimeout(()=>{try{w.close()}catch{}},300),{once:true});
  return true;
 }catch(e){try{w.close()}catch{};return false}
}
export function printHtmlDocument(html,{title='Al Maher',delay=420}={}){
 if(isIOSLike()&&printStandaloneWindow(html,title,Math.max(520,delay)))return;
 const iframe=frame(),doc=iframe.contentDocument||iframe.contentWindow?.document;
 if(!doc){iframe.remove();throw new Error('تعذر تجهيز مستند الطباعة.');}
 doc.open();doc.write(html);doc.close();runFrame(iframe,delay);
}
export function basicPrintDocument({title,dir='rtl',lang='ar',body,styles=''}){
 return `<!doctype html><html dir="${esc(dir)}" lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#13233a;background:#fff;margin:0;padding:0}${styles}</style></head><body>${body}</body></html>`;
}
function cssAssets(){
 return [...document.head.querySelectorAll('link[rel="stylesheet"],style')].map(el=>{
  if(el.tagName==='LINK')return `<link rel="stylesheet" href="${esc(el.href)}">`;
  return `<style>${el.textContent||''}</style>`;
 }).join('');
}
function printableClone(element){
 const clone=element.cloneNode(true);
 clone.querySelectorAll('.no-print,.page-actions,.topbar,.sidebar,.side-bottom,.language-switcher,.theme-switcher,script').forEach(x=>x.remove());
 clone.querySelectorAll('button').forEach(x=>x.remove());
 clone.querySelectorAll('input,textarea,select').forEach(input=>{
  let value='';
  if(input.tagName==='SELECT')value=input.options?.[input.selectedIndex]?.text||input.value||'';
  else value=input.value||input.getAttribute('value')||'';
  const span=document.createElement('span');span.className='print-field-value';span.textContent=value||'—';input.replaceWith(span);
 });
 return clone;
}
function singlePageFitScript(){
 return `<script>(function(){function mm(v){var d=document.createElement('div');d.style.cssText='position:absolute;visibility:hidden;width:'+v+'mm;height:1mm';document.body.appendChild(d);var n=d.getBoundingClientRect().width;d.remove();return n}function fit(){var root=document.querySelector('.isolated-print-root');var ticket=document.querySelector('.ticket-page');if(!root||!ticket)return;ticket.style.transform='';ticket.style.width='';root.style.height='';var maxW=mm(190),maxH=mm(277);var r=ticket.getBoundingClientRect();var w=Math.max(ticket.scrollWidth,r.width),h=Math.max(ticket.scrollHeight,r.height);var scale=Math.min(1,maxW/w,maxH/h);if(scale<0.999){ticket.style.transformOrigin=document.documentElement.dir==='rtl'?'top right':'top left';ticket.style.transform='scale('+scale+')';ticket.style.width=(100/scale)+'%';root.style.height=Math.ceil(h*scale)+'px';root.style.overflow='hidden'}}function ready(){var imgs=[].slice.call(document.images||[]);Promise.all(imgs.map(function(i){return i.complete?Promise.resolve():new Promise(function(res){i.addEventListener('load',res,{once:true});i.addEventListener('error',res,{once:true})})})).then(function(){requestAnimationFrame(function(){requestAnimationFrame(fit)})})}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();window.addEventListener('beforeprint',fit)})();</script>`;
}
export function printElement(element,{title='Al Maher',dir,lang,pageSize='A4',orientation='portrait',bodyAttributes={},singlePage=false,purpose='print'}={}){
 if(!element)throw new Error('لا يوجد مستند محدد للطباعة.');
 const clone=printableClone(element);
 const actualLang=lang||document.documentElement.lang||'ar';
 const actualDir=dir||document.documentElement.dir||(['ar','ur'].includes(actualLang)?'rtl':'ltr');
 const normalized=String(pageSize).toLowerCase();
 const thermal=normalized==='80mm'||normalized==='58mm';
 const paperWidth=normalized==='80mm'?'80mm':normalized==='58mm'?'58mm':'';
 const innerPad=normalized==='80mm'?'3mm':normalized==='58mm'?'2mm':'0';
 const page=thermal?`${paperWidth} auto`:`A4 ${orientation==='landscape'?'landscape':'portrait'}`;
 const attrs=Object.entries(bodyAttributes||{}).map(([k,v])=>` ${esc(k)}="${esc(v)}"`).join('');
 const thermalCss=thermal?`html,body{width:${paperWidth}!important;max-width:${paperWidth}!important}body{padding:${innerPad}!important;overflow-x:hidden!important}.isolated-print-root{width:100%!important;max-width:100%!important}body[data-print-mode="80"] .ticket-page,body[data-print-mode="58"] .ticket-page{width:100%!important;max-width:100%!important;margin:0!important}img,svg,table{max-width:100%!important}table{width:100%!important;table-layout:fixed!important}th,td{overflow-wrap:anywhere!important;word-break:break-word!important}`:'';
 const singleCss=singlePage&&!thermal?`.isolated-print-root{width:190mm!important;max-width:190mm!important;height:277mm!important;max-height:277mm!important;overflow:hidden!important}.ticket-page{break-inside:avoid!important;page-break-inside:avoid!important;page-break-after:avoid!important;margin:0!important}`:'';
 const pdfCss=purpose==='pdf'?`body:before{content:'PDF';display:none}`:'';
 const shellCss=`<style>@page{size:${page};margin:${thermal?'0':'10mm'}}*{box-sizing:border-box}html,body{background:#fff!important;margin:0!important;padding:0!important}body{direction:${actualDir}}.isolated-print-root{width:100%;max-width:none!important;margin:0!important;box-shadow:none!important}.isolated-print-root .print-only{display:block!important}.print-field-value{display:inline-block;padding:4px 0}a{color:inherit;text-decoration:none}${thermalCss}${singleCss}${pdfCss}@media print{.no-print,.page-actions,button{display:none!important}.ticket-page{break-inside:avoid!important;page-break-inside:avoid!important}}</style>`;
 const fit=singlePage&&!thermal?singlePageFitScript():'';
 const html=`<!doctype html><html lang="${esc(actualLang)}" dir="${esc(actualDir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${cssAssets()}${shellCss}</head><body${attrs}><div class="isolated-print-root">${clone.outerHTML}</div>${fit}</body></html>`;
 printHtmlDocument(html,{title,delay:singlePage?650:420});
}
export function saveElementAsPdf(element,options={}){
 const title=options.title||'Al Maher PDF';
 return printElement(element,{...options,title,purpose:'pdf'});
}
function legacyTarget(){
 if(document.body.dataset.printMode)return document.querySelector('.ticket-page');
 if(document.body.dataset.housingPrint)return document.querySelector('.housing-manifest');
 if(document.body.dataset.reportPrint)return document.querySelector('.printable-report,.report-sheet,.operations-sheet');
 return document.querySelector('[data-print-root],.customer-ticket-card,.operations-sheet,.housing-manifest,.ticket-page,.printable-report,.report-sheet,.printable')||document.querySelector('main');
}
function legacyOptions(){
 const mode=document.body.dataset.printMode||'';
 return {
  title:document.title||'Al Maher',
  pageSize:mode==='80'?'80mm':mode==='58'?'58mm':'A4',
  orientation:document.body.dataset.reportOrientation==='landscape'?'landscape':'portrait',
  lang:document.body.dataset.printLanguage||document.documentElement.lang||'ar',
  singlePage:mode==='a4',
  bodyAttributes:{
   ...(mode?{'data-print-mode':mode}:{}),
   ...(document.body.dataset.printLanguage?{'data-print-language':document.body.dataset.printLanguage}:{}),
   ...(document.body.dataset.housingPrint?{'data-housing-print':'1'}:{}),
   ...(document.body.dataset.reportPrint?{'data-report-print':'1'}:{})
  }
 };
}
export function installPrintIsolation(){
 if(typeof window==='undefined'||window.__almaherPrintIsolation)return()=>{};
 const native=window.print.bind(window);window.__almaherPrintIsolation={native};
 window.print=()=>{
  const target=legacyTarget();
  if(!target)return native();
  try{printElement(target,legacyOptions())}catch(e){console.error('ALMAHER isolated print failed',e);native()}
 };
 return()=>{if(window.__almaherPrintIsolation){window.__almaherPrintIsolation.native&& (window.print=window.__almaherPrintIsolation.native);delete window.__almaherPrintIsolation}};
}
