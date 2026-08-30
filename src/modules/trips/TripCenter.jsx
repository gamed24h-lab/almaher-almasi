import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,Printer,Hotel,Armchair,ScanLine,Users,RotateCcw,RefreshCw,BusFront,WalletCards,MapPin,AlertTriangle,CheckCircle2,FileText} from 'lucide-react';
import {api} from '../../lib/api.js';
import {Badge,Card,PageHeader,Button,Loading,ErrorBox,Table} from '../../components/UI.jsx';
import {money,statusLabel} from '../../lib/format.js';
import './trip360.css';

const s=v=>String(v??'');
const text=v=>s(v).trim();
const low=v=>text(v).toLowerCase();
const active=v=>!['cancelled','canceled','released','inactive','deleted','refunded'].includes(low(v?.status??v));
const activeTripVehicle=v=>!['cancelled','released','inactive'].includes(low(v?.status||'assigned'));
const activeAssignment=v=>['assigned','hold','confirmed','active',''].includes(low(v?.status||'assigned'));
const docVerified=v=>['approved','verified'].includes(low(v));
const docProblem=v=>['rejected','expired'].includes(low(v));
const needsHousing=b=>!['','none','no','without'].includes(low(b?.accommodation_type||b?.snapshot?.accommodationType||'none'));
const scanSuccess=v=>low(v?.result||v?.metadata?.scan_result||'success')==='success';
function bookingScanMode(b,tripId){
 const snap=b?.snapshot&&typeof b.snapshot==='object'?b.snapshot:{};
 const mode=low(b?.journey_mode||snap.journeyMode);
 if(mode==='returnonly')return 'return_boarding';
 const outbound=s(b?.trip_id||snap.tripId),ret=s(b?.return_trip_id||snap.returnTripId);
 return ret===s(tripId)&&outbound!==s(tripId)?'return_boarding':'outbound_boarding';
}
function boardingPhaseVisible(stage,mode){
 if(mode==='return_boarding')return ['boarding_return','departed_return','arrived_return','completed'].includes(stage);
 return ['boarding_outbound','departed_outbound','arrived_destination','housing','preparing_return','boarding_return','departed_return','arrived_return','completed'].includes(stage);
}
function boardingLate(stage,mode){
 if(mode==='return_boarding')return ['departed_return','arrived_return','completed'].includes(stage);
 return ['departed_outbound','arrived_destination','housing','preparing_return','boarding_return','departed_return','arrived_return','completed'].includes(stage);
}

export default function TripCenter({id,go}){
 const [x,setX]=useState(null),[extras,setExtras]=useState({seats:null,housing:null,documents:null,scanner:null,boot:null}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('overview');
 async function load(){
  setBusy(true);setError('');
  try{
   const core=await api.admin({action:'trip_operational_data',trip_id:id});
   setX(core);
   const [seats,housing,documents,scanner,boot]=await Promise.all([
    api.module('seats').catch(()=>null),
    api.module('housing').catch(()=>null),
    api.module('documents').catch(()=>null),
    api.module('scanner').catch(()=>null),
    api.bootstrap().catch(()=>null)
   ]);
   setExtras({seats,housing,documents,scanner,boot});
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[id]);

 const bookings=useMemo(()=>(x?.bookings||[]).filter(active),[x]);
 const bookingById=useMemo(()=>new Map(bookings.map(b=>[s(b.id),b])),[bookings]);
 const pax=useMemo(()=>(x?.passengers||[]).filter(p=>active(p)&&bookingById.has(s(p.booking_id))),[x,bookingById]);
 const passengerIds=useMemo(()=>new Set(pax.map(p=>s(p.id))),[pax]);
 const branchById=useMemo(()=>new Map((extras.boot?.branches||[]).map(b=>[s(b.id),b])),[extras.boot]);

 const tripVehicles=useMemo(()=>(extras.seats?.trip_vehicles||[]).filter(v=>s(v.trip_id)===s(id)&&activeTripVehicle(v)),[extras.seats,id]);
 const tripVehicleIds=useMemo(()=>new Set(tripVehicles.map(v=>s(v.id))),[tripVehicles]);
 const assignedSeats=useMemo(()=>(extras.seats?.seat_assignments||[]).filter(a=>tripVehicleIds.has(s(a.trip_vehicle_id))&&passengerIds.has(s(a.passenger_id))&&activeAssignment(a)),[extras.seats,tripVehicleIds,passengerIds]);
 const seatedPassengerIds=useMemo(()=>new Set(assignedSeats.map(a=>s(a.passenger_id))),[assignedSeats]);
 const fleetCapacity=tripVehicles.reduce((n,v)=>n+Math.max(0,Number(v.booking_capacity||v.capacity||0)),0);
 const fallbackCapacity=Math.max(0,Number(x?.trip?.booking_capacity||x?.trip?.bus_capacity||x?.trip?.default_bus_capacity||0));
 const effectiveCapacity=fleetCapacity||fallbackCapacity;
 const available=Math.max(0,effectiveCapacity-pax.length);
 const unseated=Math.max(0,pax.filter(p=>!seatedPassengerIds.has(s(p.id))).length);

 const tripHotels=useMemo(()=>(extras.housing?.trip_hotels||[]).filter(v=>s(v.trip_id)===s(id)),[extras.housing,id]);
 const tripHotelIds=useMemo(()=>new Set(tripHotels.map(v=>s(v.id))),[tripHotels]);
 const rooms=useMemo(()=>(extras.housing?.hotel_rooms||[]).filter(r=>tripHotelIds.has(s(r.trip_hotel_id))),[extras.housing,tripHotelIds]);
 const roomIds=useMemo(()=>new Set(rooms.map(r=>s(r.id))),[rooms]);
 const roomById=useMemo(()=>new Map(rooms.map(r=>[s(r.id),r])),[rooms]);
 const hotelById=useMemo(()=>new Map((extras.housing?.hotels||[]).map(h=>[s(h.id),h])),[extras.housing]);
 const tripHotelById=useMemo(()=>new Map(tripHotels.map(th=>[s(th.id),th])),[tripHotels]);
 const housedAssignments=useMemo(()=>(extras.housing?.room_assignments||[]).filter(a=>roomIds.has(s(a.hotel_room_id))&&passengerIds.has(s(a.passenger_id))&&active(a)),[extras.housing,roomIds,passengerIds]);
 const housedPassengerIds=useMemo(()=>new Set(housedAssignments.map(a=>s(a.passenger_id))),[housedAssignments]);
 const housingRequiredPax=useMemo(()=>pax.filter(p=>needsHousing(bookingById.get(s(p.booking_id)))),[pax,bookingById]);
 const unhoused=Math.max(0,housingRequiredPax.filter(p=>!housedPassengerIds.has(s(p.id))).length);

 const docs=useMemo(()=>(extras.documents?.passenger_documents||[]).filter(d=>passengerIds.has(s(d.passenger_id))),[extras.documents,passengerIds]);
 const docsByPassenger=useMemo(()=>{const m=new Map();for(const d of docs){const k=s(d.passenger_id),a=m.get(k)||[];a.push(d);m.set(k,a)}return m},[docs]);
 const documented=pax.filter(p=>(docsByPassenger.get(s(p.id))||[]).length>0).length;
 const verifiedDocs=docs.filter(d=>docVerified(d.status)).length;
 const documentProblems=docs.filter(d=>docProblem(d.status)).length;

 const dues=bookings.reduce((n,b)=>n+(b.financial_visible?Math.max(0,Number(b.total_price||0)-Number(b.paid_amount||0)):0),0);
 const visibleTotal=bookings.reduce((n,b)=>n+(b.financial_visible?Number(b.total_price||0):0),0);
 const visiblePaid=bookings.reduce((n,b)=>n+(b.financial_visible?Number(b.paid_amount||0):0),0);
 const financialVisibleCount=bookings.filter(b=>b.financial_visible).length;
 const missingIdentity=pax.filter(p=>!text(p.identity_number)).length;

 const seatByPassenger=useMemo(()=>{const m=new Map();for(const a of assignedSeats)if(!m.has(s(a.passenger_id)))m.set(s(a.passenger_id),a);return m},[assignedSeats]);
 const housingByPassenger=useMemo(()=>{const m=new Map();for(const a of housedAssignments)if(!m.has(s(a.passenger_id)))m.set(s(a.passenger_id),a);return m},[housedAssignments]);
 const vehicleById=useMemo(()=>new Map((extras.seats?.vehicles||[]).map(v=>[s(v.id),v])),[extras.seats]);

 const scanEvents=useMemo(()=>(extras.scanner?.scan_events||[]).filter(ev=>s(ev.trip_id)===s(id)&&scanSuccess(ev)),[extras.scanner,id]);
 const boardedKeys=useMemo(()=>new Set(scanEvents.map(ev=>`${s(ev.booking_id)}|${text(ev.scan_mode)}`)),[scanEvents]);
 const operationsStage=low(x?.trip?.operations_status||'scheduled');
 const pendingBoardingBookings=useMemo(()=>bookings.filter(b=>{
  const mode=bookingScanMode(b,id);
  return boardingPhaseVisible(operationsStage,mode)&&!boardedKeys.has(`${s(b.id)}|${mode}`);
 }),[bookings,id,operationsStage,boardedKeys]);

 const branchRows=useMemo(()=>{
  const m=new Map();
  for(const b of bookings){
   const key=s(b.branch_id)||'none';
   const row=m.get(key)||{branch_id:key,bookings:0,passengers:0,total:0,paid:0,visible:0};
   row.bookings++;
   const pc=pax.filter(p=>s(p.booking_id)===s(b.id)).length;row.passengers+=pc;
   if(b.financial_visible){row.total+=Number(b.total_price||0);row.paid+=Number(b.paid_amount||0);row.visible++}
   m.set(key,row);
  }
  return [...m.values()].map(r=>({...r,branch_name:branchById.get(r.branch_id)?.name||branchById.get(r.branch_id)?.city||'فرع'})).sort((a,b)=>b.passengers-a.passengers);
 },[bookings,pax,branchById]);

 const busRows=useMemo(()=>tripVehicles.map((tv,i)=>{
  const vehicle=vehicleById.get(s(tv.vehicle_id));
  const seats=assignedSeats.filter(a=>s(a.trip_vehicle_id)===s(tv.id));
  const cap=Number(tv.booking_capacity||tv.capacity||vehicle?.booking_capacity||vehicle?.physical_capacity||0);
  return {id:tv.id,label:text(tv.bus_label||tv.label||vehicle?.plate_no)||`باص ${i+1}`,plate:vehicle?.plate_no||'—',capacity:cap,assigned:new Set(seats.map(a=>s(a.passenger_id))).size,available:Math.max(0,cap-new Set(seats.map(a=>s(a.passenger_id))).size),status:tv.status||'assigned',driver_id:tv.driver_id||null,supervisor_id:tv.supervisor_id||null};
 }),[tripVehicles,vehicleById,assignedSeats]);

 const hotelRows=useMemo(()=>tripHotels.map((th,i)=>{
  const hotel=hotelById.get(s(th.hotel_id));
  const hrs=rooms.filter(r=>s(r.trip_hotel_id)===s(th.id));
  const ids=new Set(hrs.map(r=>s(r.id)));
  const ass=housedAssignments.filter(a=>ids.has(s(a.hotel_room_id)));
  const cap=hrs.reduce((n,r)=>n+Math.max(0,Number(r.capacity||0)),0);
  return {id:th.id,name:hotel?.name||`فندق ${i+1}`,rooms:hrs.length,capacity:cap,assigned:new Set(ass.map(a=>s(a.passenger_id))).size,locked:th.rooming_locked===true};
 }),[tripHotels,hotelById,rooms,housedAssignments]);

 const exceptions=[];
 if(['cancelled','canceled'].includes(low(x?.trip?.status)))exceptions.push({id:'trip-cancelled',tone:'bad',kind:'الرحلة',title:'الرحلة ملغاة',detail:'يجب عدم تنفيذ أي تشغيل أو صعود على رحلة ملغاة.',subject:x?.trip?.trip_code||'الرحلة',action:'operations',actionLabel:'فتح التشغيل'});
 if(effectiveCapacity>0&&pax.length>effectiveCapacity)exceptions.push({id:'capacity',tone:'bad',kind:'السعة',title:'السعة أقل من عدد الركاب',detail:`يوجد عجز ${pax.length-effectiveCapacity} مقعد في السعة التشغيلية الحالية.`,subject:`${pax.length} راكب / ${effectiveCapacity} سعة`,action:'fleet',actionLabel:'معالجة الأسطول'});
 if(extras.seats&&pax.length>0&&!tripVehicles.length)exceptions.push({id:'no-bus',tone:'bad',kind:'الأسطول',title:'لا يوجد باص مسند للرحلة',detail:'الرحلة تحتوي ركابًا لكن لا يوجد باص فعال مسند لها.',subject:`${pax.length} راكب`,action:'fleet',actionLabel:'فتح الأسطول'});
 for(const [i,tv] of tripVehicles.entries()){
  const vehicle=vehicleById.get(s(tv.vehicle_id)),label=text(tv.bus_label||tv.label||vehicle?.plate_no)||`باص ${i+1}`;
  if(!text(tv.driver_id))exceptions.push({id:`driver-${tv.id}`,tone:'bad',kind:'الطاقم',title:'باص بدون سائق أساسي',detail:'حدد السائق الأساسي قبل اعتماد تشغيل الباص.',subject:label,action:'liveops',actionLabel:'تحديد الطاقم'});
  if(!text(tv.supervisor_id))exceptions.push({id:`supervisor-${tv.id}`,tone:'warn',kind:'الطاقم',title:'باص بدون مشرف',detail:'تحديد المشرف يحسن اعتماد الصعود والتحرك وتتبع المسؤولية.',subject:label,action:'liveops',actionLabel:'تحديد المشرف'});
 }
 for(const p of pax){
  const b=bookingById.get(s(p.booking_id)),bookingNo=b?.booking_number||'—',name=text(p.full_name)||`مسافر ${p.passenger_order||''}`;
  if(extras.seats&&!seatedPassengerIds.has(s(p.id)))exceptions.push({id:`seat-${p.id}`,tone:'bad',kind:'المقاعد',title:'مسافر بدون مقعد',detail:`الحجز ${bookingNo} يحتاج تعيين مقعد على باص الرحلة.`,subject:name,booking_number:bookingNo,action:'seats',actionLabel:'تعيين مقعد'});
  if(extras.housing&&needsHousing(b)&&!housedPassengerIds.has(s(p.id)))exceptions.push({id:`housing-${p.id}`,tone:'bad',kind:'السكن',title:'مسافر يحتاج سكن بدون تسكين',detail:`الحجز ${bookingNo} يتطلب سكنًا ولم يتم ربط المسافر بغرفة.`,subject:name,booking_number:bookingNo,action:'housing',actionLabel:'تسكين الآن'});
  if(!text(p.identity_number))exceptions.push({id:`identity-${p.id}`,tone:'warn',kind:'البيانات',title:'رقم الهوية/الإقامة ناقص',detail:`استكمل بيانات المسافر في Booking 360 للحجز ${bookingNo}.`,subject:name,booking_number:bookingNo,action:'booking',actionLabel:'فتح الحجز'});
  if(extras.documents){
   const pd=docsByPassenger.get(s(p.id))||[];
   if(!pd.length)exceptions.push({id:`docs-${p.id}`,tone:'warn',kind:'المستندات',title:'لا توجد مستندات مرفوعة',detail:`ارفع مستندات المسافر من ملف الحجز ${bookingNo}.`,subject:name,booking_number:bookingNo,action:'booking',actionLabel:'رفع المستند'});
   else if(pd.some(d=>docProblem(d.status)))exceptions.push({id:`docs-problem-${p.id}`,tone:'bad',kind:'المستندات',title:'مستند مرفوض أو منتهي',detail:`يوجد مستند يحتاج معالجة قبل التشغيل للحجز ${bookingNo}.`,subject:name,booking_number:bookingNo,action:'booking',actionLabel:'مراجعة المستند'});
  }
 }
 for(const b of bookings){
  if(!b.financial_visible)continue;
  const remaining=Math.max(0,Number(b.total_price||0)-Number(b.paid_amount||0));
  if(remaining>0.001)exceptions.push({id:`finance-${b.id}`,tone:'warn',kind:'المالية',title:'متبقي مالي على الحجز',detail:`المتبقي الظاهر ${money(remaining)} قبل اكتمال السداد.`,subject:`${b.booking_number} · ${b.customer_name||'عميل'}`,booking_number:b.booking_number,action:'booking',actionLabel:'فتح الحجز'});
 }
 if(extras.scanner)for(const b of pendingBoardingBookings){
  const mode=bookingScanMode(b,id),late=boardingLate(operationsStage,mode),count=pax.filter(p=>s(p.booking_id)===s(b.id)).length;
  exceptions.push({id:`boarding-${b.id}-${mode}`,tone:late?'bad':'warn',kind:'الصعود',title:late?'تحركت المرحلة بدون تسجيل صعود':'الحجز لم يسجل صعوده بعد',detail:`${count||Number(b.travelers_count||b.travelers||0)||1} مسافر · ${mode==='return_boarding'?'صعود العودة':'صعود الذهاب'}.`,subject:`${b.booking_number} · ${b.customer_name||'عميل'}`,booking_number:b.booking_number,action:'scanner',actionLabel:'فتح QR'});
 }
 const exceptionRank={bad:0,warn:1};
 const sortedExceptions=[...exceptions].sort((a,b)=>(exceptionRank[a.tone]??9)-(exceptionRank[b.tone]??9)||a.kind.localeCompare(b.kind,'ar'));
 const criticalExceptions=exceptions.filter(e=>e.tone==='bad').length;
 const warningExceptions=exceptions.filter(e=>e.tone==='warn').length;

 const alerts=[];
 if(['cancelled','canceled'].includes(low(x?.trip?.status)))alerts.push({tone:'bad',text:'الرحلة ملغاة ولا يجب تشغيلها.'});
 if(effectiveCapacity>0&&pax.length>effectiveCapacity)alerts.push({tone:'bad',text:`عدد الركاب أكبر من السعة الحالية بمقدار ${pax.length-effectiveCapacity}.`});
 if(extras.seats&&pax.length>0&&!tripVehicles.length)alerts.push({tone:'bad',text:'لا يوجد باص مسند للرحلة حتى الآن.'});
 if(extras.seats&&unseated>0)alerts.push({tone:'bad',text:`يوجد ${unseated} مسافر بدون مقعد على أسطول الرحلة.`});
 if(extras.housing&&unhoused>0)alerts.push({tone:'bad',text:`يوجد ${unhoused} مسافر يحتاج سكن ولم يتم تسكينه.`});
 if(missingIdentity>0)alerts.push({tone:'warn',text:`يوجد ${missingIdentity} مسافر بدون رقم هوية/إقامة.`});
 if(extras.documents&&documented<pax.length)alerts.push({tone:'warn',text:`مستندات ${pax.length-documented} مسافر غير مرفوعة بعد.`});
 if(documentProblems>0)alerts.push({tone:'bad',text:`يوجد ${documentProblems} مستند مرفوض أو منتهي.`});
 if(dues>0.001)alerts.push({tone:'warn',text:`يوجد متبقي مالي ظاهر قدره ${money(dues)}.`});
 const driverMissing=tripVehicles.filter(v=>!text(v.driver_id)).length,supervisorMissing=tripVehicles.filter(v=>!text(v.supervisor_id)).length;
 if(driverMissing)alerts.push({tone:'bad',text:`يوجد ${driverMissing} باص بدون سائق أساسي.`});
 if(supervisorMissing)alerts.push({tone:'warn',text:`يوجد ${supervisorMissing} باص بدون مشرف محدد.`});
 if(extras.scanner&&pendingBoardingBookings.length)alerts.push({tone:pendingBoardingBookings.some(b=>boardingLate(operationsStage,bookingScanMode(b,id)))?'bad':'warn',text:`يوجد ${pendingBoardingBookings.length} حجز لم يسجل الصعود في المرحلة الحالية.`});
 const critical=criticalExceptions;

 function roomLabelForPassenger(pid){
  const a=housingByPassenger.get(s(pid));if(!a)return '—';
  const room=roomById.get(s(a.hotel_room_id));if(!room)return 'مسكن';
  const th=tripHotelById.get(s(room.trip_hotel_id));const hotel=hotelById.get(s(th?.hotel_id));
  const roomNo=room?.metadata?.actual_room_no||room?.room_no||'—';return `${hotel?.name||'فندق'} · ${roomNo}`;
 }
 function openBooking(no){if(no)go(`/bookings/${encodeURIComponent(no)}`)}
 function handleExceptionAction(item){
  if(item.action==='booking')return openBooking(item.booking_number);
  if(item.action==='seats')return go('/seats?trip='+id);
  if(item.action==='housing')return go('/housing?trip='+id);
  if(item.action==='scanner')return go('/scanner?trip='+id);
  if(item.action==='fleet')return go('/fleet');
  if(item.action==='operations')return go('/operations?trip='+id);
  if(item.action==='liveops'){
   const node=document.querySelector('.trip360-liveops');
   if(node){node.scrollIntoView({behavior:'smooth',block:'start'});return}
   return go('/fleet');
  }
 }

 if(!x&&!error)return <Loading text="تحميل Trip 360..."/>;
 return <>
  <PageHeader title={x?.trip?.trip_code||'Trip 360'} subtitle={`${x?.trip?.from_city||x?.trip?.origin||'—'} ← ${x?.trip?.to_city||x?.trip?.destination||'—'} · ${x?.trip?.departure_date||''} ${x?.trip?.departure_time||''}`} actions={<><Button onClick={()=>go('/trips')}><ArrowRight size={16}/> رجوع</Button><Button onClick={load} disabled={busy}><RefreshCw size={16}/> تحديث</Button><Button onClick={()=>window.print()}><Printer size={16}/> طباعة الكشف</Button></>}/>
  <ErrorBox error={error}/>
  {x&&<div className="trip360">
   <section className={`trip360-health ${critical?'bad':exceptions.length?'warn':'good'}`}>
    <div className="trip360-health-icon">{critical?<AlertTriangle/>:<CheckCircle2/>}</div>
    <div><strong>{critical?`الرحلة تحتاج معالجة ${critical} استثناء حرج`:exceptions.length?'الرحلة مستقرة مع استثناءات للمراجعة':'الرحلة جاهزة تشغيليًا حسب البيانات الحالية'}</strong><small>{exceptions.length?`${exceptions.length} استثناء ظاهر في مركز الرحلة`:'لا توجد نواقص تشغيلية ظاهرة في الفحص الحالي'}</small></div>
    <Badge tone={critical?'red':exceptions.length?'orange':'green'}>{statusLabel(x?.trip?.status||'active')}</Badge>
   </section>

   <div className="stats-grid trip-center-stats trip360-stats">
    <Mini icon={<Users/>} label="الركاب" value={pax.length}/><Mini icon={<FileText/>} label="الحجوزات" value={bookings.length}/><Mini icon={<BusFront/>} label="السعة التشغيلية" value={effectiveCapacity||'—'}/><Mini icon={<Armchair/>} label="بدون مقعد" value={extras.seats?unseated:'—'}/><Mini icon={<Hotel/>} label="بدون تسكين" value={extras.housing?unhoused:'—'}/><Mini icon={<WalletCards/>} label="متبقي ظاهر" value={money(dues)}/>
   </div>

   <div className="mini-actions trip360-actions"><button onClick={()=>go('/operations?trip='+id)}><Users/> التشغيل</button><button onClick={()=>go('/seats?trip='+id)}><Armchair/> المقاعد</button><button onClick={()=>go('/housing?trip='+id)}><Hotel/> التسكين</button><button onClick={()=>go('/scanner?trip='+id)}><ScanLine/> QR</button><button onClick={()=>go('/returns?trip='+id)}><RotateCcw/> العودة</button><button onClick={()=>go('/fleet')}><BusFront/> الأسطول</button></div>

   <nav className="trip360-tabs" aria-label="أقسام Trip 360">
    {[['overview','نظرة عامة'],['exceptions',`الاستثناءات${exceptions.length?` (${exceptions.length})`:''}`],['passengers','الركاب'],['bookings','الحجوزات'],['resources','الموارد']].map(([key,label])=><button key={key} type="button" className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}
   </nav>

   {tab==='overview'&&<div className="trip360-grid">
    <Card className="trip360-card"><div className="card-title"><div><h3>تنبيهات التشغيل</h3><small>فحص لحظي للمقاعد والسكن والبيانات والمالية والمستندات والصعود والطاقم</small></div></div>{alerts.length?<div className="trip360-alerts">{alerts.map((a,i)=><div key={i} className={`trip360-alert ${a.tone}`}>{a.tone==='bad'?<AlertTriangle size={16}/>:<CheckCircle2 size={16}/>}<span>{a.text}</span></div>)}</div>:<div className="trip360-empty good"><CheckCircle2 size={18}/> لا توجد تنبيهات تشغيلية ظاهرة.</div>}</Card>
    <Card className="trip360-card"><div className="card-title"><div><h3>اكتمال الرحلة</h3><small>مؤشرات سريعة قبل التشغيل</small></div></div><div className="trip360-checks"><Check label="المقاعد" good={!extras.seats||unseated===0} detail={extras.seats?`${seatedPassengerIds.size}/${pax.length}`:'غير متاح'}/><Check label="السكن" good={!extras.housing||unhoused===0} detail={extras.housing?`${housingRequiredPax.length-unhoused}/${housingRequiredPax.length} مطلوب`:'غير متاح'}/><Check label="الهويات" good={missingIdentity===0} detail={`${pax.length-missingIdentity}/${pax.length}`}/><Check label="المستندات" good={!extras.documents||documented===pax.length&&documentProblems===0} detail={extras.documents?`${documented}/${pax.length} · موثق ${verifiedDocs}`:'غير متاح'}/><Check label="السعة" good={!effectiveCapacity||pax.length<=effectiveCapacity} detail={effectiveCapacity?`${pax.length}/${effectiveCapacity} · متاح ${available}`:'غير محددة'}/><Check label="المالية" good={dues<=0.001} warn={dues>0.001} detail={financialVisibleCount?`${money(visiblePaid)} / ${money(visibleTotal)}`:'محجوبة حسب الصلاحية'}/></div></Card>
    <Card className="trip360-card trip360-wide"><div className="card-title"><div><h3>توزيع الفروع</h3><small>الرحلة المشتركة والحجوزات والركاب حسب الفرع</small></div></div><div className="trip360-branch-grid">{branchRows.map(r=><div className="trip360-branch" key={r.branch_id}><div><MapPin size={15}/><strong>{r.branch_name}</strong></div><span>{r.bookings} حجز</span><span>{r.passengers} راكب</span><small>{r.visible?`ظاهر ماليًا ${money(Math.max(0,r.total-r.paid))}`:'المالية محجوبة'}</small></div>)}</div></Card>
   </div>}

   {tab==='exceptions'&&<Card className="trip360-card trip360-exceptions-card">
    <div className="card-title"><div><h3>مركز الاستثناءات</h3><small>كل مشكلة ظاهرة مع طريق مباشر لمعالجتها قبل استمرار التشغيل</small></div><Button onClick={load} disabled={busy}><RefreshCw size={15}/> تحديث الفحص</Button></div>
    <div className="trip360-exception-summary"><div className={criticalExceptions?'bad':'good'}><small>حرجة</small><strong>{criticalExceptions}</strong></div><div className={warningExceptions?'warn':'good'}><small>تحتاج مراجعة</small><strong>{warningExceptions}</strong></div><div className={exceptions.length?'neutral':'good'}><small>الإجمالي</small><strong>{exceptions.length}</strong></div></div>
    {!sortedExceptions.length?<div className="trip360-empty good"><CheckCircle2 size={18}/> لا توجد استثناءات ظاهرة حاليًا.</div>:<div className="trip360-exception-list">{sortedExceptions.map(item=><div className={`trip360-exception ${item.tone}`} key={item.id}><div className="trip360-exception-icon">{item.tone==='bad'?<AlertTriangle size={17}/>:<CheckCircle2 size={17}/>}</div><div className="trip360-exception-copy"><div><strong>{item.title}</strong><Badge tone={item.tone==='bad'?'red':'orange'}>{item.kind}</Badge></div><small>{item.detail}</small><span>{item.subject}{item.booking_number?` · حجز ${item.booking_number}`:''}</span></div><button type="button" onClick={()=>handleExceptionAction(item)}>{item.actionLabel}</button></div>)}</div>}
   </Card>}

   {tab==='passengers'&&<Card className="printable trip360-card"><div className="card-title"><div><h3>ركاب الرحلة</h3><small>{pax.length} مسافر · اضغط رقم الحجز لفتح Booking 360</small></div><span>المالية: {x.finance_scope==='all'?'كل الفروع':'حسب نطاق الفرع'}</span></div><Table rows={pax} columns={[{key:'passenger_order',label:'#'},{key:'full_name',label:'المسافر'},{key:'identity_number',label:'الهوية',render:p=>p.identity_number||<Badge tone="orange">ناقص</Badge>},{key:'booking',label:'الحجز',render:p=>{const b=bookingById.get(s(p.booking_id));return <button className="trip360-link" onClick={()=>openBooking(b?.booking_number)}>{b?.booking_number||'—'}</button>}},{key:'seat',label:'المقعد',render:p=>seatByPassenger.get(s(p.id))?.seat_no||<Badge tone="orange">بدون</Badge>},{key:'room',label:'السكن',render:p=>roomLabelForPassenger(p.id)},{key:'docs',label:'المستندات',render:p=>{const d=docsByPassenger.get(s(p.id))||[];return extras.documents?(d.length?<Badge tone={d.some(x=>docProblem(x.status))?'red':d.some(x=>docVerified(x.status))?'green':'blue'}>{d.length}</Badge>:<Badge tone="orange">0</Badge>):'—'}},{key:'paid',label:'المدفوع',render:p=>{const b=bookingById.get(s(p.booking_id));return b?.financial_visible?money(b.paid_amount):<Badge>محجوب</Badge>}}]}/></Card>}

   {tab==='bookings'&&<Card className="trip360-card"><div className="card-title"><div><h3>حجوزات الرحلة</h3><small>عرض تشغيلي موحد لكل الحجوزات المرتبطة</small></div></div><Table rows={bookings} columns={[{key:'booking_number',label:'الحجز',render:b=><button className="trip360-link" onClick={()=>openBooking(b.booking_number)}>{b.booking_number}</button>},{key:'customer_name',label:'العميل'},{key:'branch',label:'الفرع',render:b=>branchById.get(s(b.branch_id))?.name||'—'},{key:'pax',label:'الركاب',render:b=>pax.filter(p=>s(p.booking_id)===s(b.id)).length},{key:'housing',label:'السكن',render:b=>b.accommodation_label||b.accommodation_type||'—'},{key:'total',label:'الإجمالي',render:b=>b.financial_visible?money(b.total_price):<Badge>محجوب</Badge>},{key:'remaining',label:'المتبقي',render:b=>b.financial_visible?money(Math.max(0,Number(b.total_price||0)-Number(b.paid_amount||0))):<Badge>محجوب</Badge>},{key:'status',label:'الحالة',render:b=><Badge tone={['cancelled','canceled'].includes(low(b.status))?'red':'green'}>{statusLabel(b.status)}</Badge>}]}/></Card>}

   {tab==='resources'&&<div className="trip360-grid">
    <Card className="trip360-card"><div className="card-title"><div><h3>الباصات والمقاعد</h3><small>الموارد المسندة لهذه الرحلة فقط</small></div><Button onClick={()=>go('/seats?trip='+id)}>فتح المقاعد</Button></div>{busRows.length?<Table rows={busRows} columns={[{key:'label',label:'الباص'},{key:'plate',label:'اللوحة'},{key:'capacity',label:'السعة'},{key:'assigned',label:'مشغول'},{key:'available',label:'متاح'},{key:'crew',label:'الطاقم',render:r=><Badge tone={!r.driver_id?'red':!r.supervisor_id?'orange':'green'}>{!r.driver_id?'بدون سائق':!r.supervisor_id?'بدون مشرف':'مكتمل'}</Badge>}]}/>:<div className="trip360-empty">لا يوجد باص مسند للرحلة حتى الآن.</div>}</Card>
    <Card className="trip360-card"><div className="card-title"><div><h3>الفنادق والتسكين</h3><small>الفنادق والغرف المرتبطة بالرحلة</small></div><Button onClick={()=>go('/housing?trip='+id)}>فتح السكن</Button></div>{hotelRows.length?<Table rows={hotelRows} columns={[{key:'name',label:'الفندق'},{key:'rooms',label:'الغرف'},{key:'capacity',label:'السعة'},{key:'assigned',label:'مسكن'},{key:'locked',label:'الحالة',render:r=><Badge tone={r.locked?'orange':'green'}>{r.locked?'مقفل':'مفتوح'}</Badge>}]}/>:<div className="trip360-empty">لا يوجد فندق مربوط بالرحلة.</div>}</Card>
   </div>}
  </div>}
 </>;
}

function Mini({icon,label,value}){return <Card className="stat-card">{icon&&<div className="stat-icon">{icon}</div>}<div><span>{label}</span><strong>{value}</strong></div></Card>}
function Check({label,detail,good,warn=false}){return <div className={`trip360-check ${good?'good':warn?'warn':'bad'}`}><span>{good?'✓':warn?'!':'×'}</span><div><strong>{label}</strong><small>{detail}</small></div></div>}
