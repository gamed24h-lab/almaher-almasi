const txt=v=>String(v??'').trim();
let queued=false;
function tripIdFromPath(){const m=window.location.pathname.match(/^\/trips\/([^/?#]+)\/?$/i);return m?decodeURIComponent(m[1]):''}
function firstNumber(v){const m=txt(v).match(/\d+/);return m?Math.max(0,Number(m[0])||0):0}
function makeStat(label,value,tone){const d=document.createElement('div');d.className=tone;const small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=String(value);d.append(small,strong);return d}
function sync(){
  if(!tripIdFromPath()){document.querySelector('.trip360-count-bridge')?.remove();return}
  const root=document.querySelector('.trip360'),health=root?.querySelector('.trip360-health');if(!root||!health)return;
  const strongText=txt(health.querySelector('strong')?.textContent),smallText=txt(health.querySelector('small')?.textContent);
  const total=firstNumber(smallText),critical=strongText.includes('تحتاج معالجة')?firstNumber(strongText):0,warnings=Math.max(0,total-critical);
  const key=`${critical}|${warnings}|${total}`;let bridge=root.querySelector('.trip360-count-bridge');
  if(bridge?.dataset.key===key)return;
  bridge?.remove();bridge=document.createElement('div');bridge.className='trip360-exception-summary trip360-count-bridge';bridge.dataset.key=key;bridge.setAttribute('aria-hidden','true');bridge.style.setProperty('display','none','important');
  bridge.append(makeStat('حرجة',critical,critical?'bad':'good'),makeStat('تحتاج مراجعة',warnings,warnings?'warn':'good'),makeStat('الإجمالي',total,total?'neutral':'good'));
  health.insertAdjacentElement('afterend',bridge);
}
function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
export function installTrip360ReadinessCountBridge(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  queue();const observer=new MutationObserver(queue);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});window.addEventListener('popstate',queue);
}
