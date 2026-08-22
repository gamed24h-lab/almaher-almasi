export function printHtmlDocument(html,{title='Al Maher'}={}){
  const iframe=document.createElement('iframe');
  iframe.setAttribute('aria-hidden','true');
  iframe.style.position='fixed';
  iframe.style.right='0';
  iframe.style.bottom='0';
  iframe.style.width='0';
  iframe.style.height='0';
  iframe.style.border='0';
  iframe.style.opacity='0';
  document.body.appendChild(iframe);
  const doc=iframe.contentDocument||iframe.contentWindow?.document;
  if(!doc){iframe.remove();throw new Error('تعذر تجهيز نافذة الطباعة.');}
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup=()=>setTimeout(()=>iframe.remove(),400);
  const run=()=>{
    try{
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }finally{cleanup();}
  };
  iframe.onload=()=>setTimeout(run,80);
  setTimeout(()=>{if(document.body.contains(iframe))run()},350);
}

export function basicPrintDocument({title,dir='rtl',lang='ar',body,styles=''}){
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  return `<!doctype html><html dir="${esc(dir)}" lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#13233a;background:#fff;margin:0;padding:0}${styles}</style></head><body>${body}</body></html>`;
}
