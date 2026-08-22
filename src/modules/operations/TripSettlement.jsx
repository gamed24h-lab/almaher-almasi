import React,{useEffect,useMemo,useState} from 'react';
import './trip-settlement.css';
import {ArrowRight,CheckCircle2,Printer,RefreshCw,WalletCards,ReceiptText,RotateCcw,TrendingUp,LockKeyhole} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Field,Loading,PageHeader,Select,Table} from '../../components/UI.jsx';
import {money,tripDisplay,dateTime,statusLabel} from '../../lib/format.js';
import {has} from '../../lib/permissions.js';
import {printElement} from '../../lib/print.js';

const s=v=>String(v??'');
const low=v=>s(v).toLowerCase();
const n=v=>Number(v||0);
export default function TripSettlement({initialTrip='',go}){
 const {user}=useAuth();
 const {data,refresh}=useAppData();
 const [tripId,setTripId]=useState(initialTrip||''),[cloud,setCloud]=useState(null),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[error,setError]=useState('');
 async function load(id=tripId){if(!id)return;setBusy(true);setError('');setCloud(null);try{
  const [ops,finance,refunds]=await Promise.all([
   api.admin({action:'trip_operational_data',trip_id:id}),
   api.module('finance_full'),
   api.admin({action:'refund_list'}).catch(()=>({rows:[]}))
  ]);setCloud({ops,finance,refunds});
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{if(initialTrip)load(initialTrip)},[initialTrip]);
 const trip=data.trips.find(t=>s(t.id)===s(tripId));
 const state=useMemo(()=>{
  if(!cloud||!trip)return null;
  const bookings=(cloud.ops?.bookings||[]).filter(b=>!['cancelled'].includes(low(b.status)));
  const bookingIds=new Set(bookings.map(b=>s(b.id)));
  const bookingNos=new Set(bookings.map(b=>s(b.booking_number)));
  const total=bookings.reduce((a,b)=>a+n(b.total_price),0);
  const collected=bookings.reduce((a,b)=>a+n(b.paid_amount),0);
  const outstanding=Math.max(0,total-collected);
  const expenses=(cloud.finance?.expenses||[]).filter(x=>s(x.trip_id)===s(tripId));
  const expensesTotal=expenses.reduce((a,x)=>a+n(x.amount),0);
  const refunds=(cloud.refunds?.rows||[]).filter(x=>bookingNos.has(s(x.booking_number))&&low(x.status)==='completed');
  const refundsTotal=refunds.reduce((a,x)=>a+n(x.amount),0);
  const tx=(cloud.finance?.transactions||[]).filter(x=>s(x.trip_id)===s(tripId)||bookingIds.has(s(x.booking_id)));
  const net=collected-expensesTotal-refundsTotal;
  const returnDate=trip.return_date||trip.departure_date;
  const returnTime=trip.return_time||trip.departure_time||'23:59:59';
  const end=returnDate?new Date(`${returnDate}T${returnTime||'23:59:59'}`):null;
  const returned=!!(end&&!Number.isNaN(end.getTime())&&end.getTime()<=Date.now());
  const pendingRefunds=(cloud.refunds?.rows||[]).filter(x=>bookingNos.has(s(x.booking_number))&&['pending','approved'].includes(low(x.status)));
  const canClose=returned&&outstanding<=0.001&&pendingRefunds.length===0&&!['completed','cancelled'].includes(low(trip.status));
  return {bookings,total,collected,outstanding,expenses,expensesTotal,refunds,refundsTotal,tx,net,returned,pendingRefunds,canClose};
 },[cloud,trip,tripId]);
 async function closeTrip(){if(!trip||!state)return;const ok=window.confirm(`إقفال الرحلة ${trip.trip_code||''} كتسوية نهائية؟\n\nالمحصل: ${money(state.collected)}\nالمصروفات: ${money(state.expensesTotal)}\nالاستردادات: ${money(state.refundsTotal)}\nالصافي: ${money(state.net)}\n\nسيتم تغيير حالة الرحلة إلى مكتملة.`);if(!ok)return;setClosing(true);setError('');try{
   const stamp=new Date().toISOString();
   const note=`[تسوية نهائية ${stamp}] المحصل=${state.collected} المصروفات=${state.expensesTotal} الاستردادات=${state.refundsTotal} الصافي=${state.net}`;
   await api.admin({action:'sync_trips',rows:[{...trip,status:'completed',operational_notes:[trip.operational_notes,note].filter(Boolean).join('\n')}]});
   await refresh();await load(trip.id);
 }catch(e){setError(e.message)}finally{setClosing(false)}}
 function printSettlement(){const el=document.querySelector('.trip-settlement-sheet');if(el)printElement(el,{title:`تسوية الرحلة ${trip?.trip_code||''}`,pageSize:'A4',orientation:'portrait'})}
 const expenseCols=[{key:'expense_date',label:'التاريخ'},{key:'category',label:'البند'},{key:'amount',label:'المبلغ',render:r=>money(r.amount)},{key:'notes',label:'ملاحظات'}];
 const refundCols=[{key:'receipt_no',label:'السند'},{key:'booking_number',label:'الحجز'},{key:'amount',label:'المبلغ',render:r=>money(r.amount)},{key:'completed_at',label:'التنفيذ',render:r=>dateTime(r.completed_at||r.requested_at)}];
 return <><PageHeader title="تسوية الرحلة" subtitle="إقفال مالي وتشغيلي بعد العودة: تحصيلات + مصروفات + استردادات + صافي الرحلة" actions={<>{tripId&&<Button onClick={()=>go('/operations?trip='+tripId)}><ArrowRight size={16}/> التشغيل</Button>}{state&&<Button onClick={printSettlement}><Printer size={16}/> طباعة التسوية</Button>}<Button disabled={!tripId||busy} onClick={()=>load()}><RefreshCw size={16}/> تحديث</Button></>}/>
 <Card><Field label="الرحلة"><Select value={tripId} onChange={e=>{setTripId(e.target.value);setCloud(null)}}><option value="">اختر رحلة</option>{data.trips.map(t=><option key={t.id} value={t.id}>{tripDisplay(t)}</option>)}</Select></Field></Card><ErrorBox error={error}/>{busy&&<Loading text="حساب تسوية الرحلة..."/>}
 {state&&<><Card className="trip-settlement-sheet printable" data-print-root="settlement"><div className="print-only"><h2>تسوية الرحلة — {tripDisplay(trip)}</h2><p>{trip?.trip_code}</p></div>
 <div className="settlement-hero"><Box icon={<WalletCards/>} label="إجمالي الحجوزات" value={money(state.total)}/><Box icon={<CheckCircle2/>} label="المحصل" value={money(state.collected)}/><Box icon={<ReceiptText/>} label="المصروفات" value={money(state.expensesTotal)}/><Box icon={<RotateCcw/>} label="الاستردادات" value={money(state.refundsTotal)}/><Box icon={<TrendingUp/>} label="صافي الرحلة" value={money(state.net)} strong/><Box icon={<LockKeyhole/>} label="المتبقي تحصيل" value={money(state.outstanding)} warn={state.outstanding>0}/></div>
 <div className="settlement-status"><span>حالة الرحلة: <Badge tone={low(trip.status)==='completed'?'green':'blue'}>{statusLabel(trip.status)}</Badge></span><span>العودة: <Badge tone={state.returned?'green':'orange'}>{state.returned?'انتهى موعد الرحلة':'لم تنتهِ بعد'}</Badge></span><span>طلبات استرداد معلقة: <Badge tone={state.pendingRefunds.length?'orange':'green'}>{state.pendingRefunds.length}</Badge></span></div>
 <div className="settlement-tables"><div><h3>مصروفات الرحلة</h3><Table rows={state.expenses} columns={expenseCols}/></div><div><h3>الاستردادات المنفذة</h3><Table rows={state.refunds} columns={refundCols}/></div></div>
 </Card>
 <Card><div className="card-title"><h3>إقفال الرحلة</h3>{state.canClose?<Badge tone="green">جاهزة للإقفال</Badge>:<Badge tone="orange">غير جاهزة</Badge>}</div>
 <div className="readiness-checks"><div className={state.returned?'ready-check ok':'ready-check bad'}><CheckCircle2/><div><b>انتهاء الرحلة/العودة</b><span>{state.returned?'مكتمل':'انتظر حتى انتهاء موعد العودة'}</span></div></div><div className={state.outstanding<=0.001?'ready-check ok':'ready-check bad'}><CheckCircle2/><div><b>لا يوجد متبقي تحصيل</b><span>{money(state.outstanding)}</span></div></div><div className={!state.pendingRefunds.length?'ready-check ok':'ready-check bad'}><CheckCircle2/><div><b>لا توجد استردادات معلقة</b><span>{state.pendingRefunds.length}</span></div></div></div>
 {(has(user,'trips')||has(user,'finance'))&&<Button variant="primary" disabled={!state.canClose||closing} onClick={closeTrip}>{closing?'جاري الإقفال...':'اعتماد التسوية وإقفال الرحلة'}</Button>}</Card></>}
 </>;
}
function Box({icon,label,value,strong,warn}){return <div className={`settlement-box ${strong?'strong':''} ${warn?'warn':''}`}>{icon}<span>{label}</span><b>{value}</b></div>}
