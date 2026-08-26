import React,{useEffect,useMemo,useState} from 'react';
import {Search,WalletCards,RefreshCw,ReceiptText} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Input,ErrorBox,Badge} from '../../components/UI.jsx';
import {money} from '../../lib/format.js';

const text=v=>String(v??'').trim();
const txLabel=t=>({credit:'إضافة رصيد',debit:'خصم من الرصيد',adjustment:'تسوية'})[String(t||'')]||String(t||'—');
const statusLabel=s=>({posted:'مرحّل',pending:'معلّق',reversed:'معكوس'})[String(s||'')]||String(s||'—');

export default function Wallets(){
 const [q,setQ]=useState(''),[rows,setRows]=useState([]),[selected,setSelected]=useState(null),[details,setDetails]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const totalBalance=useMemo(()=>rows.reduce((sum,x)=>sum+Number(x.balance||0),0),[rows]);
 async function search(value=q){setBusy(true);setErr('');try{const r=await api.admin({action:'wallet_search',q:text(value)});setRows(Array.isArray(r?.wallets)?r.wallets:[]);if(selected&&!r?.wallets?.some(x=>String(x.id)===String(selected.id))){setSelected(null);setDetails(null)}}catch(e){setErr(e.message)}finally{setBusy(false)}}
 async function openWallet(w){setSelected(w);setErr('');try{const r=await api.admin({action:'wallet_get',customer_identity:w.customer_identity,data_environment:w.data_environment});setDetails(r)}catch(e){setErr(e.message)}}
 useEffect(()=>{search('')},[]);
 return <div>
  <PageHeader title="محافظ العملاء" subtitle="رصيد العميل وكشف الحركات المرتبطة بالإلغاءات والحجوزات." icon={WalletCards}/>
  <Card><div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}><div style={{position:'relative',flex:'1 1 280px',minWidth:0}}><Search size={18} style={{position:'absolute',insetInlineStart:12,top:12,opacity:.55}}/><Input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')search()}} placeholder="ابحث بالاسم أو الجوال أو الهوية" style={{paddingInlineStart:38}}/></div><Button onClick={()=>search()} disabled={busy}>{busy?'جاري البحث...':'بحث'}</Button><Button onClick={()=>search(q)} disabled={busy}><RefreshCw size={16}/>تحديث</Button></div><ErrorBox error={err}/></Card>
  <div className="stats-grid" style={{marginTop:12}}><Card><div className="stat-label">عدد المحافظ</div><div className="stat-value">{rows.length}</div></Card><Card><div className="stat-label">إجمالي الأرصدة الظاهرة</div><div className="stat-value">{money(totalBalance)}</div></Card></div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(320px,100%),1fr))',gap:14,marginTop:14}}>
   <Card><div className="card-title"><div><h3>العملاء</h3><small>اضغط على العميل لعرض كشف المحفظة.</small></div></div><div style={{display:'grid',gap:8}}>{rows.length?rows.map(w=><button key={w.id} type="button" onClick={()=>openWallet(w)} style={{border:'1px solid #dfe5ec',background:String(selected?.id)===String(w.id)?'#eef4fb':'#fff',borderRadius:12,padding:12,textAlign:'start',cursor:'pointer',minWidth:0}}><div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><strong>{w.customer_name||'عميل بدون اسم'}</strong><b>{money(w.balance||0)}</b></div><div className="muted-small" style={{marginTop:5,overflowWrap:'anywhere'}}>{w.customer_phone||'—'} · {w.customer_identity||'—'}</div></button>):<div className="muted-small">لا توجد محافظ مطابقة.</div>}</div></Card>
   <Card><div className="card-title"><div><h3>كشف المحفظة</h3><small>{selected?`${selected.customer_name||''} · ${selected.customer_identity||''}`:'اختر عميلًا أولًا'}</small></div>{details&&<Badge>{money(details.balance||0)}</Badge>}</div>{details?<div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:12}}><div><span className="muted-small">الرصيد الحالي</span><div style={{fontSize:24,fontWeight:900}}>{money(details.balance||0)}</div></div><div><span className="muted-small">آخر تحديث</span><div>{details.wallet?.updated_at?new Date(details.wallet.updated_at).toLocaleString('ar-SA'):'—'}</div></div></div><div style={{display:'grid',gap:8}}>{(details.transactions||[]).length?details.transactions.map(tx=><div key={tx.id} style={{border:'1px solid #e4e9ef',borderRadius:12,padding:10,minWidth:0}}><div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}><strong><ReceiptText size={15} style={{verticalAlign:'middle',marginInlineEnd:5}}/>{txLabel(tx.transaction_type)}</strong><b>{tx.transaction_type==='debit'?'-':'+'}{money(tx.amount)}</b></div><div className="muted-small" style={{marginTop:5,overflowWrap:'anywhere'}}>{tx.reason||'—'} · {statusLabel(tx.status)}</div><div className="muted-small" style={{overflowWrap:'anywhere'}}>{tx.reference_no||'بدون مرجع'} · {tx.created_at?new Date(tx.created_at).toLocaleString('ar-SA'):'—'}</div></div>):<div className="muted-small">لا توجد حركات على هذه المحفظة.</div>}</div></div>:<div className="muted-small">اختر محفظة من القائمة لعرض التفاصيل.</div>}</Card>
  </div>
 </div>
}
