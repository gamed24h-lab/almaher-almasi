const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

function frame(){
 const iframe=document.createElement('iframe');
 iframe.setAttribute('aria-hidden','true');
 Object.assign(iframe.style,{position:'fixed',right:'0',bottom:'0',width:'1px',height:'1px',border:'0',opacity:'0',pointerEvents:'none'});
 document.body.appendChild(iframe);return iframe;
}
function runFrame(iframe){
 let done=false;const cleanup=()=>{if(done)return;done=true;setTimeout(()=>iframe.remove(),600)};
 const run=()=>{if(done)return;try{iframe.contentWindow?.focus();iframe.contentWindow?.print()}finally{cleanup()}};
 iframe.onload=()=>setTimeout(run,100);setTimeout(run,500);
}
export function printHtmlDocument(html,{title='Al Maher'}={}){
 const iframe=frame(),doc=iframe.contentDocument||iframe.contentWindow?.document;
 if(!doc){iframe.remove();throw new Error('تعذر تجهيز مستند الطباعة.');}
 doc.open();doc.write(html);doc.close();runFrame(iframe);
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
export function printElement(element,{title='Al Maher',dir,lang,pageSize='A4',orientation='portrait',bodyAttributes={}}={}){
 if(!element)throw new Error('لا يوجد مستند محدد للطباعة.');
 const clone=printableClone(element);
 const actualLang=lang||document.documentElement.lang||'ar';
 const actualDir=dir||document.documentElement.dir||(['ar','ur'].includes(actualLang)?'rtl':'ltr');
 const page=String(pageSize).toLowerCase()==='80mm'?'80mm auto':String(pageSize).toLowerCase()==='58mm'?'58mm auto':`A4 ${orientation==='landscape'?'landscape':'portrait'}`;
 const attrs=Object.entries(bodyAttributes||{}).map(([k,v])=>` ${esc(k)}="${esc(v)}"`).join('');
 const shellCss=`<style>@page{size:${page};margin:${pageSize==='A4'?'10mm':'3mm'}}html,body{background:#fff!important;margin:0!important;padding:0!important}body{direction:${actualDir}}.isolated-print-root{width:100%;max-width:none!important;margin:0!important;box-shadow:none!important}.isolated-print-root .print-only{display:block!important}.print-field-value{display:inline-block;padding:4px 0}a{color:inherit;text-decoration:none}@media print{.no-print,.page-actions,button{display:none!important}}</style>`;
 const html=`<!doctype html><html lang="${esc(actualLang)}" dir="${esc(actualDir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${cssAssets()}${shellCss}</head><body${attrs}><div class="isolated-print-root">${clone.outerHTML}</div></body></html>`;
 printHtmlDocument(html,{title});
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
 return()=>{if(window.__almaherPrintIsolation){window.print=window.__almaherPrintIsolation.native;delete window.__almaherPrintIsolation}};
}
