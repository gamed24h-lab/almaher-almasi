import React,{useMemo,useState} from 'react';
import {ArrowRight,Plus,Trash2,Ticket,RotateCcw,Calculator,MessageCircle,Copy} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Field,Input,Select,Textarea,ErrorBox,Badge} from '../../components/UI.jsx';
import {money,phoneWa,journeyLabel} from '../../lib/format.js';
import {allOps} from '../../lib/permissions.js';

const emptyP=()=>({name:'',gender:'male',nationality:'السعودية',identity:'',phone:'',preferredLanguage:'ar'});
const n=v=>Number(v||0);

function calcPrice({mode,type,travelers,rooms,days,trip,returnTrip}){
 if(!trip)return 0;
 const count=Math.max(1,Number(travelers||1));
 const stayDays=Math.max(1,Number(days||1));
 const one=n(trip.price_one_way),none=n(trip.price_no_accommodation),shared=n(trip.price_shared),priv=n(trip.price_private_room);
 const privateCost=type==='private'?priv*Math.max(1,Number(rooms||1))*stayDays:0;
 if(mode==='oneway'||mode==='returnonly')return one*count+privateCost;
 if(mode==='separate'){
   const outbound=type==='shared'?shared*count:none*count+privateCost;
   return outbound+n(returnTrip?.price_one_way)*count;
 }
 if(type==='none')return none*count;
 if(type==='shared')return shared*count;
 if(type==='private')return none*count+privateCost;
 return 0;
}

function isFemale(v){const x=String(v||'').toLowerCase();return x==='female'||x==='أنثى'||x==='f'}
function onlyDigits(v){return String(v||'').replace(/\D/g,'')}

export default function BookingEditor({bookingNo,go}){
 const {user}=useAuth();
 const {data,refresh}=useAppData();
 const existing=data.bookings.find(b=>String(b.booking_number)===String(bookingNo));
 const existingPassengers=existing?data.passengers.filter(p=>String(p.booking_id)===String(existing.id)):[];
 const snap=existing?.snapshot&&typeof existing.snapshot==='object'?existing.snapshot:{};
 const [passengers,setPassengers]=useState(existingPassengers.length?existingPassengers.map(p=>({
   id:p.id,name:p.full_name||'',gender:p.gender||'male',nationality:p.nationality||'',identity:p.identity_number||'',phone:p.phone||'',status:p.status,
   accommodationStatus:p.accommodation_status,preferredLanguage:p.preferred_language||'ar',documentStatus:p.document_status||'unknown',assistanceFlags:Array.isArray(p.assistance_flags)?p.assistance_flags:[]
 })): [emptyP()]);
 const [journeyMode,setJourneyMode]=useState(existing?.journey_mode||snap.journeyMode||'oneway');
 const [tripId,setTripId]=useState(existing?.trip_id||snap.tripId||'');
 const [returnTripId,setReturnTripId]=useState(existing?.return_trip_id||snap.returnTripId||'');
 const [accommodation,setAccommodation]=useState(existing?.accommodation_type||snap.accommodationType||'none');
 const [housingDays,setHousingDays]=useState(Number(snap.housingDays||0));
 const [privateRooms,setPrivateRooms]=useState(Number(existing?.private_rooms||snap.privateRooms||1));
 const [totalPrice,setTotalPrice]=useState(Number(existing?.total_price||snap.totalPrice||0));
 const [err,setErr]=useState(''),[saving,setSaving]=useState(false);
 const [customerDraft,setCustomerDraft]=useState({
   name:existing?.customer_name||'',phone:existing?.customer_phone||'',identity:existing?.customer_identity||'',
   nationality:existing?.customer_nationality||'السعودية',gender:existing?.customer_gender||'male'
 });

 const today=new Date().toISOString().slice(0,10);
 const trips=useMemo(()=>data.trips.filter(t=>!['cancelled','completed'].includes(String(t.status).toLowerCase())&&(!t.departure_date||t.departure_date>=today)),[data.trips,today]);
 const trip=trips.find(t=>String(t.id)===String(tripId));
 const returnTrip=trips.find(t=>String(t.id)===String(returnTripId));
 const suggested=calcPrice({mode:journeyMode,type:accommodation,travelers:passengers.length,rooms:privateRooms,days:housingDays,trip,returnTrip});
 const availableBranches=allOps(user)?data.branches:data.branches.filter(b=>String(b.id)===String(data.scope?.branch_id||user?.branch_id||''));
 const selectedBranchId=existing?.branch_id||data.scope?.branch_id||user?.branch_id||'';
 const selectedBranch=data.branches.find(b=>String(b.id)===String(selectedBranchId));
 const remaining=Math.max(0,n(totalPrice)-n(existing?.paid_amount||0));

 function setCustomer(key,value){setCustomerDraft(x=>({...x,[key]:value}))}
 function copyCustomerToFirst(){
   setPassengers(arr=>arr.map((p,i)=>i? p:{...p,name:customerDraft.name,phone:customerDraft.phone,identity:customerDraft.identity,nationality:customerDraft.nationality,gender:customerDraft.gender}));
 }
 function updatePassenger(i,key,value){setPassengers(a=>a.map((x,j)=>j===i?{...x,[key]:value}:x))}
 function applySuggested(){setTotalPrice(suggested)}
 function validate(paid){
   if(!tripId)return 'اختر الرحلة.';
   if(journeyMode==='separate'&&!returnTripId)return 'اختر رحلة العودة المنفصلة.';
   if(journeyMode==='separate'&&String(returnTripId)===String(tripId))return 'رحلة العودة المنفصلة يجب أن تكون مختلفة عن رحلة الذهاب.';
   if(accommodation==='shared'&&passengers.some(p=>isFemale(p.gender)))return 'السكن المشترك غير متاح للنساء. اختر غرفة خاصة أو بدون سكن.';
   if(accommodation==='private'&&Number(housingDays)<1)return 'عدد أيام السكن إلزامي عند اختيار غرفة خاصة.';
   if(accommodation==='private'&&Number(privateRooms)<1)return 'عدد الغرف الخاصة يجب أن يكون غرفة واحدة على الأقل.';
   if(!passengers.length)return 'أضف مسافرًا واحدًا على الأقل.';
   if(passengers.some(p=>!String(p.name||'').trim()||!String(p.identity||'').trim()))return 'اسم وهوية كل مسافر مطلوبان.';
   const ids=passengers.map(p=>String(p.identity||'').trim()).filter(Boolean);if(new Set(ids).size!==ids.length)return 'يوجد رقم هوية مكرر داخل نفس الحجز.';
   if(n(totalPrice)<0||paid<0)return 'المبالغ لا يمكن أن تكون سالبة.';
   if(paid>n(totalPrice)+0.001)return 'المدفوع لا يمكن أن يكون أكبر من إجمالي الحجز.';
   if(!customerDraft.name.trim()||!customerDraft.phone.trim()||!customerDraft.identity.trim())return 'اسم العميل والجوال والهوية مطلوبة.';
   if(onlyDigits(customerDraft.phone).length<8)return 'رقم جوال العميل غير مكتمل.';
   return '';
 }
 async function save(e){
   e.preventDefault();setErr('');
   const submitAction=e.nativeEvent?.submitter?.dataset?.action||'save';
   const form=new FormData(e.currentTarget);const f=Object.fromEntries(form);const paid=n(f.paid_amount);
   const validation=validate(paid);if(validation){setErr(validation);return}
   const waWindow=submitAction==='save_wa'?window.open('about:blank','_blank'):null;
   setSaving(true);
   const bookingNumber=existing?.booking_number||`MAH-${Date.now().toString().slice(-8)}`;
   const accommodationLabel=accommodation==='none'?'بدون سكن':accommodation==='shared'?'سكن مشترك خماسي':'غرفة خاصة';
   const branchId=f.branch_id||selectedBranchId;
   const branchRel=(data.tripBranches||[]).find(x=>String(x.trip_id)===String(tripId)&&String(x.branch_id)===String(branchId));
   const snapshot={
     ...snap,journeyMode,tripId,returnTripId:returnTripId||null,accommodationType:accommodation,
     housingDays:accommodation==='private'?Number(housingDays):0,privateRooms:accommodation==='private'?Number(privateRooms):0,
     totalPrice:n(totalPrice),paidAmount:paid,passengerDetails:passengers,boardingPoint:branchRel?.boarding_point||null,boardingTime:branchRel?.boarding_time||null
   };
   const base={
     booking_number:bookingNumber,branch_id:branchId,trip_id:tripId||null,return_trip_id:returnTripId||null,journey_mode:journeyMode,
     customer_name:customerDraft.name.trim(),customer_phone:customerDraft.phone.trim(),customer_identity:customerDraft.identity.trim(),
     customer_gender:customerDraft.gender,customer_nationality:customerDraft.nationality.trim(),accommodation_type:accommodation,accommodation_label:accommodationLabel,
     private_rooms:accommodation==='private'?Number(privateRooms):0,private_room_types:accommodation==='private'?Array.from({length:Number(privateRooms)},()=> 'double'):[],
     total_price:n(totalPrice),original_price:n(suggested||totalPrice),paid_amount:paid,payment_method:f.payment_method||null,
     payment_reference:String(f.payment_reference||'').trim()||null,notes:f.notes||'',terms_accepted:true,source:'branch',
     version_no:Number(existing?.version_no||1),status:existing?.status||'confirmed',snapshot
   };
   const pRows=passengers.map((p,i)=>({
     id:p.id||null,passenger_order:i+1,full_name:String(p.name||'').trim(),gender:p.gender,nationality:String(p.nationality||'').trim(),
     identity_number:String(p.identity||'').trim(),phone:String(p.phone||'').trim(),status:p.status||'confirmed',
     accommodation_status:p.accommodationStatus||'active',preferred_language:p.preferredLanguage||'ar',assistance_flags:Array.isArray(p.assistanceFlags)?p.assistanceFlags:[],document_status:p.documentStatus||'unknown'
   }));
   try{
     if(existing){
       await api.admin({action:'update_booking',booking:{
         ...base,number:bookingNumber,versionNo:Number(existing.version_no||1),name:base.customer_name,phone:base.customer_phone,identity:base.customer_identity,
         gender:base.customer_gender,nationality:base.customer_nationality,journeyMode,tripId,returnTripId:returnTripId||null,totalPrice:n(totalPrice),paidAmount:paid,
         paymentMethod:base.payment_method,paymentReference:base.payment_reference,notes:base.notes,accommodationType:accommodation,accommodationLabel,
         privateRooms:Number(privateRooms),snapshot,passengerDetails:passengers
       }});
     }else await api.customerBook(base,pRows);
     await refresh();
     if(submitAction==='save_wa'){
       const route=trip?`${trip.from_city||trip.origin||'—'} ← ${trip.to_city||trip.destination||'—'}`:'';
       const msg=[`شركة الماهر الماسي`,`رقم الحجز: ${bookingNumber}`,customerDraft.name?`العميل: ${customerDraft.name}`:'',route?`الرحلة: ${route}`:'',trip?.departure_date?`التاريخ: ${trip.departure_date} ${trip.departure_time||''}`:'',`الإجمالي: ${money(totalPrice)}`,`المدفوع: ${money(paid)}`].filter(Boolean).join('\n');
       const href=`https://wa.me/${phoneWa(customerDraft.phone)}?text=${encodeURIComponent(msg)}`;
       if(waWindow)waWindow.location.href=href;else window.open(href,'_blank');
     }
     go('/bookings/'+bookingNumber,{replace:true});
   }catch(error){if(waWindow&&!waWindow.closed)waWindow.close();setErr(error.message)}finally{setSaving(false)}
 }

 const tripLabel=journeyMode==='returnonly'?'رحلة العودة':'رحلة الذهاب / الأساسية';
 return <>
  <PageHeader title={existing?`تعديل الحجز ${existing.booking_number}`:'حجز جديد'} subtitle="الحجز والمسافرون والسكن والتحصيل في شاشة واحدة" actions={<>
   <Button onClick={()=>go('/bookings')}><ArrowRight size={16}/> رجوع</Button>
   {existing&&<><Button onClick={()=>go('/ticket/'+existing.booking_number)}><Ticket size={16}/> التذكرة</Button><Button onClick={()=>go('/refunds?booking='+existing.booking_number)}><RotateCcw size={16}/> استرداد</Button></>}
  </>}/>
  <ErrorBox error={err}/>
  <form onSubmit={save}>
   <div className="editor-grid">
    <Card>
     <div className="card-title"><h3>بيانات الحجز</h3>{existing&&<Badge tone={existing.status==='cancelled'?'red':'green'}>{existing.status||'confirmed'}</Badge>}</div>
     <div className="form-grid">
      <Field label="الفرع"><Select name="branch_id" defaultValue={selectedBranchId} required>{availableBranches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <Field label="نوع الرحلة"><Select value={journeyMode} onChange={e=>{setJourneyMode(e.target.value);if(!['separate','roundtrip'].includes(e.target.value))setReturnTripId('')}}><option value="oneway">ذهاب فقط</option><option value="roundtrip">ذهاب وعودة</option><option value="separate">ذهاب + عودة من رحلة أخرى</option><option value="returnonly">عودة فقط</option></Select></Field>
      <Field label={tripLabel}><Select value={tripId} onChange={e=>setTripId(e.target.value)} required><option value="">اختر الرحلة</option>{trips.map(t=><option key={t.id} value={t.id}>{t.trip_code} — {t.from_city||t.origin} ← {t.to_city||t.destination} — {t.departure_date||''}</option>)}</Select></Field>
      <Field label={journeyMode==='separate'?'رحلة العودة المنفصلة':'رحلة العودة (اختيارية)'} hint={journeyMode==='roundtrip'?'اتركها بدون إذا كانت العودة مدمجة في نفس الرحلة.':undefined}><Select value={returnTripId} onChange={e=>setReturnTripId(e.target.value)} disabled={!['separate','roundtrip'].includes(journeyMode)} required={journeyMode==='separate'}><option value="">بدون</option>{trips.map(t=><option key={t.id} value={t.id}>{t.trip_code} — {t.from_city||t.origin} ← {t.to_city||t.destination} — {t.departure_date||''}</option>)}</Select></Field>
      <Field label="اسم العميل"><Input value={customerDraft.name} onChange={e=>setCustomer('name',e.target.value)} required/></Field>
      <Field label="الجوال"><Input value={customerDraft.phone} onChange={e=>setCustomer('phone',e.target.value)} inputMode="tel" required/></Field>
      <Field label="الهوية / الإقامة"><Input value={customerDraft.identity} onChange={e=>setCustomer('identity',e.target.value)} required/></Field>
      <Field label="الجنسية"><Input value={customerDraft.nationality} onChange={e=>setCustomer('nationality',e.target.value)}/></Field>
      <Field label="الجنس"><Select value={customerDraft.gender} onChange={e=>setCustomer('gender',e.target.value)}><option value="male">ذكر</option><option value="female">أنثى</option></Select></Field>
      <Field label="نوع السكن"><Select value={accommodation} onChange={e=>setAccommodation(e.target.value)}><option value="none">بدون سكن</option><option value="shared">مشترك خماسي</option><option value="private">غرفة خاصة</option></Select></Field>
      {accommodation==='private'&&<><Field label="عدد الغرف الخاصة"><Input type="number" min="1" value={privateRooms} onChange={e=>setPrivateRooms(Number(e.target.value))}/></Field><Field label="عدد أيام السكن"><Input type="number" min="1" value={housingDays||''} onChange={e=>setHousingDays(Number(e.target.value))} required/></Field></>}
      <Field label="السعر المقترح"><div className="price-suggestion"><strong>{money(suggested)}</strong><Button type="button" onClick={applySuggested}><Calculator size={15}/> اعتماد السعر</Button></div></Field>
      <Field label="الإجمالي النهائي"><Input type="number" min="0" step="0.01" value={totalPrice} onChange={e=>setTotalPrice(Number(e.target.value))}/></Field>
      <Field label="المدفوع"><Input type="number" min="0" max={Math.max(0,n(totalPrice))} step="0.01" name="paid_amount" defaultValue={existing?.paid_amount||0}/></Field>
      <Field label="طريقة الدفع"><Select name="payment_method" defaultValue={existing?.payment_method||'cash'}><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="mada">مدى</option><option value="online">دفع إلكتروني</option></Select></Field>
      <Field label="مرجع الدفع / رقم العملية"><Input name="payment_reference" defaultValue={existing?.payment_reference||snap.paymentReference||''}/></Field>
      <Field label="ملاحظات"><Textarea name="notes" defaultValue={existing?.notes||''}/></Field>
     </div>
     <div className="booking-summary-strip"><span>{journeyLabel(journeyMode)}</span><span>{selectedBranch?.name||'الفرع'}</span><strong>المتبقي الحالي: {money(remaining)}</strong></div>
    </Card>
    <Card>
     <div className="card-title"><h3>المسافرون</h3><div className="row-actions"><Button type="button" onClick={copyCustomerToFirst}><Copy size={15}/> نسخ العميل للأول</Button><Button type="button" onClick={()=>setPassengers(p=>[...p,emptyP()])}><Plus size={16}/> إضافة</Button></div></div>
     <div className="passengers-editor">{passengers.map((p,i)=><div className="passenger-box" key={p.id||i}>
      <div className="passenger-number">{i+1}</div>
      <div className="form-grid compact">
       <Field label="الاسم"><Input value={p.name} onChange={e=>updatePassenger(i,'name',e.target.value)} required/></Field>
       <Field label="الهوية"><Input value={p.identity} onChange={e=>updatePassenger(i,'identity',e.target.value)} required/></Field>
       <Field label="الجنسية"><Input value={p.nationality||''} onChange={e=>updatePassenger(i,'nationality',e.target.value)}/></Field>
       <Field label="الجوال"><Input value={p.phone||''} onChange={e=>updatePassenger(i,'phone',e.target.value)} inputMode="tel"/></Field>
       <Field label="الجنس"><Select value={p.gender||'male'} onChange={e=>updatePassenger(i,'gender',e.target.value)}><option value="male">ذكر</option><option value="female">أنثى</option></Select></Field>
       <Field label="لغة التواصل"><Select value={p.preferredLanguage||'ar'} onChange={e=>updatePassenger(i,'preferredLanguage',e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="ur">اردو</option></Select></Field>
      </div>
      {passengers.length>1&&<button className="remove-passenger" type="button" onClick={()=>setPassengers(a=>a.filter((_,j)=>j!==i))}><Trash2 size={16}/></button>}
     </div>)}</div>
    </Card>
   </div>
   <div className="sticky-save"><Button variant="primary" type="submit" data-action="save" disabled={saving}>{saving?'جاري الحفظ...':'حفظ الحجز'}</Button><Button type="submit" data-action="save_wa" disabled={saving}><MessageCircle size={16}/> حفظ وإرسال واتساب</Button></div>
  </form>
 </>;
}
