const {verify}=require('./_staff-session');
function has(s,p){return s?.role==='مدير عام'||s?.permissions?.all||s?.permissions?.[p]}
exports.handler=async(event)=>{
 const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 const url=(process.env.SUPABASE_URL||'').replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key)return{statusCode:500,headers:H,body:JSON.stringify({error:'Server env missing'})};
 const auth=String(event.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):'';const session=verify(token,key);
 if(!session)return{statusCode:401,headers:H,body:JSON.stringify({error:'انتهت جلسة الموظف. سجل الدخول مرة أخرى.'})};
 const sh={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json','Content-Type':'application/json'};
 try{
  if(event.httpMethod==='GET'){
   const resource=event.queryStringParameters?.resource||'platform';
   if(resource==='platform'){
    const [fy,ex,ar,md]=await Promise.all([
     fetch(`${url}/rest/v1/fiscal_years?select=*&order=start_date.desc`,{headers:sh}),
     fetch(`${url}/rest/v1/expenses?select=*&order=expense_date.desc,created_at.desc&limit=2000`,{headers:sh}),
     fetch(`${url}/rest/v1/automation_rules?select=*&order=created_at.desc`,{headers:sh}),
     fetch(`${url}/rest/v1/master_data?select=*&active=eq.true&order=category.asc,sort_order.asc`,{headers:sh})
    ]);
    const [FY,EX,AR,MD]=await Promise.all([fy.json().catch(()=>[]),ex.json().catch(()=>[]),ar.json().catch(()=>[]),md.json().catch(()=>[])]);
    if(!fy.ok||!ex.ok||!ar.ok||!md.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'جداول V8 غير جاهزة. شغّل Master Migration.'})};
    let expenses=Array.isArray(EX)?EX:[]; if(session.role!=='مدير عام'&&!has(session,'allBranches')&&session.branch_id)expenses=expenses.filter(x=>String(x.branch_id||'')===String(session.branch_id));
    let rules=Array.isArray(AR)?AR:[]; if(session.role!=='مدير عام'&&!has(session,'allBranches')&&session.branch_id)rules=rules.filter(x=>!x.branch_id||String(x.branch_id)===String(session.branch_id));
    return{statusCode:200,headers:H,body:JSON.stringify({fiscalYears:FY,expenses,automationRules:rules,masterData:MD})};
   }
   return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown resource'})};
  }
  if(event.httpMethod==='POST'){
   let p={};try{p=JSON.parse(event.body||'{}')}catch{}
   const action=String(p.action||'');
   if(action==='save_fiscal_year'){
    if(!has(session,'financialYears'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية إدارة السنة المالية'})};
    const row=p.row||{}; if(!row.name||!row.start_date||!row.end_date)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات السنة المالية ناقصة'})};
    const r=await fetch(`${url}/rest/v1/fiscal_years?on_conflict=name`,{method:'POST',headers:{...sh,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify([{name:row.name,start_date:row.start_date,end_date:row.end_date,status:row.status||'open',updated_at:new Date().toISOString()}])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ السنة المالية'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
   }
   if(action==='close_fiscal_year'){
    if(!has(session,'closeFinancialPeriod'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الإقفال'})};
    const id=String(p.id||'');const r=await fetch(`${url}/rest/v1/fiscal_years?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify({status:'closed',closed_at:new Date().toISOString(),closed_by:session.name||session.id,updated_at:new Date().toISOString()})});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر إقفال السنة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
   }
   if(action==='add_expense'){
    if(!has(session,'expenses'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية المصروفات'})};
    const row=p.row||{};const branch=row.branch_id||session.branch_id||null;if(session.role!=='مدير عام'&&!has(session,'allBranches')&&session.branch_id&&String(branch)!==String(session.branch_id))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية لهذا الفرع'})};
    const rec={expense_date:row.expense_date,branch_id:branch,trip_id:row.trip_id||null,category:row.category,amount:Number(row.amount||0),notes:row.notes||'',created_by:session.name||session.id};if(!rec.expense_date||!rec.category||rec.amount<=0)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات المصروف غير مكتملة'})};
    const r=await fetch(`${url}/rest/v1/expenses`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ المصروف'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
   }
   if(action==='save_automation'){
    if(!has(session,'automation'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الأتمتة'})};
    const row=p.row||{};const rec={name:row.name,branch_id:row.branch_id||null,trigger_key:row.trigger_key,mode:row.mode||'manual',recipient_emails:row.recipient_emails||[],payload_fields:row.payload_fields||[],active:row.active!==false,config:row.config||{},created_by:session.name||session.id,updated_at:new Date().toISOString()};if(!rec.name||!rec.trigger_key)return{statusCode:400,headers:H,body:JSON.stringify({error:'بيانات القاعدة ناقصة'})};
    const r=await fetch(`${url}/rest/v1/automation_rules`,{method:'POST',headers:{...sh,Prefer:'return=representation'},body:JSON.stringify([rec])});const b=await r.json().catch(()=>[]);if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:b?.message||'تعذر حفظ القاعدة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true,row:b?.[0]})};
   }
   if(action==='delete_automation'){
    if(!has(session,'automation'))return{statusCode:403,headers:H,body:JSON.stringify({error:'لا توجد صلاحية الأتمتة'})};const id=String(p.id||'');const r=await fetch(`${url}/rest/v1/automation_rules?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{...sh,Prefer:'return=minimal'}});if(!r.ok)return{statusCode:500,headers:H,body:JSON.stringify({error:'تعذر حذف القاعدة'})};return{statusCode:200,headers:H,body:JSON.stringify({ok:true})};
   }
   return{statusCode:400,headers:H,body:JSON.stringify({error:'Unknown action'})};
  }
  return{statusCode:405,headers:H,body:JSON.stringify({error:'Method not allowed'})};
 }catch(e){return{statusCode:502,headers:H,body:JSON.stringify({error:e.message||'Platform data error'})}}
};
