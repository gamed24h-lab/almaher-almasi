import React,{useEffect,useMemo,useState} from 'react';
import './readiness.css';
import {ArrowRight,CheckCircle2,FileWarning,RefreshCw,ScanLine,Users,XCircle} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Badge,Button,Card,ErrorBox,Loading,PageHeader,Select,Field,Table} from '../../components/UI.jsx';
import {tripDisplay} from '../../lib/format.js';

const s=v=>String(v??'');
const low=v=>s(v).toLowerCase();
const goodStatus=v=>!['cancelled','refunded'].includes(low(v));
const successScan=x=>low(x?.result||x?.metadata?.scan_result||'success')==='success';

export default function Readiness({initialTrip='',go}){
 const {data}=useAppData();
 const [tripId,setTripId]=useState(initialTrip||''),[cloud,setCloud]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){if(!tripId)return;setBusy(true);setError('');setCloud(null);try{
  const [ops,tickets,scanner,documents,fleet]=await Promise.all([
   api.admin({action:'trip_operational_data',trip_id:tripId}),
   api.module('tickets'),api.module('scanner'),api.module('documents'),api.module('fleet')
  ]);setCloud({ops,tickets,scanner,documents,fleet});
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 useEffect(()=>{if(initialTrip)load()},[initialTrip]);
 const trip=data.trips.find(t=>s(t.id)===s(tripId));
 const state=useMemo(()=>{
  if(!cloud||!trip)return null;
  const bookings=(cloud.ops?.bookings||[]).filter(b=>goodStatus(b.status));
  const passengers=(cloud.ops?.passengers||[]).filter(p=>goodStatus(p.status));
  const pids=new Set(passengers.map(p=>s(p.id)));
  const bookingsById=new Map(bookings.map(b=>[s(b.id),b]));
  const seats=(cloud.tickets?.seat_assignments||[]).filter(x=>s(x.trip_id)===s(tripId)&&pids.has(s(x.passenger_id))&&!['released','cancelled'].includes(low(x.status)));
  const seated=new Set(seats.map(x=>s(x.passenger_id)));
  const rooms=(cloud.tickets?.room_assignments||[]).filter(x=>pids.has(s(x.passenger_id))&&low(x.status||'assigned')!=='released');
  const housed=new Set(rooms.map(x=>s(x.passenger_id)));
  const housingRequired=passengers.filter(p=>{const b=bookingsById.get(s(p.booking_id));return b&&low(b.accommodation_type)!=='none'});
  const docs=(cloud.documents?.passenger_documents||[]).filter(x=>pids.has(s(x.passenger_id)));
  const docsByPassenger=new Map();for(const d of docs){const a=docsByPassenger.get(s(d.passenger_id))||[];a.push(d);docsByPassenger.set(s(d.passenger_id),a)}
  const documentProblems=passengers.filter(p=>['unknown','missing','expired'].includes(low(p.document_status||'unknown')) && !(docsByPassenger.get(s(p.id))||[]).length);
  const scans=(cloud.scanner?.scan_events||[]).filter(x=>s(x.trip_id)===s(tripId)&&low(x.scan_mode)==='outbound_boarding'&&successScan(x));
  const boarded=new Set(scans.map(x=>s(x.passenger_id)).filter(Boolean));
  const boardedBookings=new Set(scans.map(x=>s(x.booking_id)).filter(Boolean));for(const p of passengers)if(boardedBookings.has(s(p.booking_id)))boarded.add(s(p.id));
  const tripVehicles=(cloud.fleet?.trip_vehicles||[]).filter(x=>s(x.trip_id)===s(tripId)&&!['cancelled','released'].includes(low(x.status)));
  const departure=trip.departure_date?new Date(`${trip.departure_date}T${trip.departure_time||'00:00:00'}`):null;
  const departed=departure&&!Number.isNaN(departure.getTime())&&departure.getTime()<Date.now();
  const noShow=departed?passengers.filter(p=>!boarded.has(s(p.id))):[];
  const checks=[
   {key:'passengers',label:'يوجد ركاب على الرحلة',ok:passengers.length>0,detail:`${passengers.length} مسافر`},
   {key:'seats',label:'توزيع المقاعد مكتمل',ok:passengers.length>0&&seated.size>=passengers.length,detail:`${seated.size}/${passengers.length}`},
   {key:'housing',label:'تسكين المطلوبين مكتمل',ok:housingRequired.length===0||housingRequired.every(p=>housed.has(s(p.id))),detail:`${housingRequired.filter(p=>housed.has(s(p.id))).length}/${housingRequired.length}`},
   {key:'vehicle',label:'مركبة مرتبطة بالرحلة',ok:tripVehicles.length>0,detail:tripVehicles.length?`${tripVehicles.length} مركبة`:'غير محددة'},
   {key:'documents',label:'لا توجد مستندات حرجة ناقصة',ok:documentProblems.length===0,detail:documentProblems.length?`${documentProblems.length} يحتاج مراجعة`:'سليم'},
  ];
  const done=checks.filter(x=>x.ok).length,score=Math.round(done/checks.length*100);
  return {bookings,passengers,seated,housed,housingRequired,documentProblems,boarded,noShow,checks,score,departed,tripVehicles};
 },[cloud,trip,tripId]);
 const passengerCols=[
  {key:'full_name',label:'المسافر'},
  {key:'identity_number',label:'الهوية'},
  {key:'nationality',label:'الجنسية'},
  {key:'booking',label:'الحجز',render:p=>state?.bookings.find(b=>s(b.id)===s(p.booking_id))?.booking_number||'—'},
  {key:'seat',label:'المقعد',render:p=>state?.seated.has(s(p.id))?<Badge tone="green">محدد</Badge>:<Badge tone="orange">بدون مقعد</Badge>},
  {key:'boarding',label:'الصعود',render:p=>state?.boarded.has(s(p.id))?<Badge tone="green">تم الصعود</Badge>:<Badge tone={state?.departed?'red':'orange'}>{state?.departed?'No-show':'لم يسجل بعد'}</Badge>}
 ];
 return <><PageHeader title="جاهزية الرحلة" subtitle="فحص تشغيلي قبل الانطلاق ومتابعة الصعود وNo-show" actions={<>{tripId&&<Button onClick={()=>go('/operations?trip='+tripId)}><ArrowRight size={16}/> التشغيل</Button>}<Button disabled={!tripId||busy} onClick={load}><RefreshCw size={16}/> فحص الآن</Button></>}/>
 <Card><Field label="الرحلة"><Select value={tripId} onChange={e=>{setTripId(e.target.value);setCloud(null)}}><option value="">اختر رحلة</option>{data.trips.map(t=><option key={t.id} value={t.id}>{tripDisplay(t)}</option>)}</Select></Field></Card><ErrorBox error={error}/>{busy&&<Loading text="فحص جاهزية الرحلة..."/>}
 {state&&<><div className="readiness-hero"><Card className="readiness-score"><span>نسبة الجاهزية</span><strong>{state.score}%</strong><Badge tone={state.score===100?'green':state.score>=60?'orange':'red'}>{state.score===100?'جاهزة تشغيليًا':'تحتاج استكمال'}</Badge></Card><Card className="stat-card"><Users/><div><span>المسافرون</span><strong>{state.passengers.length}</strong></div></Card><Card className="stat-card"><ScanLine/><div><span>تم الصعود</span><strong>{state.boarded.size}</strong></div></Card><Card className="stat-card"><XCircle/><div><span>No-show</span><strong>{state.noShow.length}</strong></div></Card></div>
 <Card><div className="card-title"><h3>Checklist الجاهزية</h3><Badge>{state.checks.filter(x=>x.ok).length}/{state.checks.length}</Badge></div><div className="readiness-checks">{state.checks.map(c=><div className={c.ok?'ready-check ok':'ready-check bad'} key={c.key}>{c.ok?<CheckCircle2/>:<XCircle/>}<div><b>{c.label}</b><span>{c.detail}</span></div></div>)}</div></Card>
 {state.documentProblems.length>0&&<Card><div className="card-title"><h3><FileWarning size={18}/> مستندات تحتاج تدخل</h3><Badge tone="orange">{state.documentProblems.length}</Badge></div><div className="chips-list">{state.documentProblems.map(p=><span key={p.id}>{p.full_name||p.identity_number}</span>)}</div></Card>}
 <Card><div className="card-title"><h3>حالة الركاب</h3><span>{state.departed?'الرحلة تجاوزت موعد الانطلاق — تم احتساب No-show':'قبل الانطلاق'}</span></div><Table rows={state.passengers} columns={passengerCols}/></Card>
 </>}</>;
}
