import appWorker from './id-studio-index.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const base=env=>String(env.SUPABASE_URL||'').replace(/\/+$/,'');
const headers=env=>{const key=String(env.SUPABASE_SERVICE_ROLE_KEY||'');return {apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'}};
const tokenOk=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'').trim());
async function readJson(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return {error:t||`HTTP ${r.status}`}}}
async function verify(url,env){
 const token=String(url.searchParams.get('token')||'').trim();
 if(!tokenOk(token))return json({error:'رمز التحقق غير صالح.'},400);
 const select='card_number,name_ar,name_en,job_title_ar,department_ar,status,issue_date,expiry_date,photo_path,qr_token';
 const r=await fetch(`${base(env)}/rest/v1/id_cards?qr_token=eq.${encodeURIComponent(token)}&select=${encodeURIComponent(select)}&limit=1`,{headers:headers(env)});
 const body=await readJson(r);if(!r.ok)return json({error:'تعذر التحقق من البطاقة.'},503);
 const row=Array.isArray(body)?body[0]:null;if(!row)return json({error:'البطاقة غير موجودة أو رمز التحقق تم إبطاله.'},404);
 let status=row.status;if(row.expiry_date&&status==='active'&&new Date(`${row.expiry_date}T23:59:59Z`).getTime()<Date.now())status='expired';
 return json({ok:true,card:{card_number:row.card_number,name_ar:row.name_ar,name_en:row.name_en||null,job_title_ar:row.job_title_ar||null,department_ar:row.department_ar||null,status,issue_date:row.issue_date||null,expiry_date:row.expiry_date||null,photo_url:null}});
}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/id/verify'&&request.method==='GET')return verify(url,env);return appWorker.fetch(request,env,ctx)}};
