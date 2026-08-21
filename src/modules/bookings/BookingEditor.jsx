import React,{useMemo,useState} from 'react';
import {ArrowRight,Plus,Trash2,Ticket,RotateCcw,Calculator} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Field,Input,Select,Textarea,ErrorBox} from '../../components/UI.jsx';
import {money,pick} from '../../lib/format.js';
const emptyP=()=>({name:'',gender:'male',nationality:'السعودية',identity:'',phone:'',preferredLanguage:'ar'});
const tripPrice=(t,key)=>Number(pick(t,key,{priceOneWay:'price_one_way',priceNoAccommodation:'price_no_accommodation',priceShared:'price_shared',pricePrivateRoom:'price_private_room'}[key])||0);
function calcPrice({mode,type,travelers,rooms,days,trip,returnTrip}){
 if(!trip)return 0; const n=Math.max(1,travelers); const d=Math.max(1,Number(days||1));
 const one=Number(trip.price_one_way||0),none=Number(trip.price_no_accommodation||0),shared=Number(trip.price_shared||0),priv=Number(trip.price_private_room||0);
 const privateCost=type==='private'?priv*Math.max(1,Number(rooms||1))*d:0;
 if(mode==='oneway'||mode==='returnonly')return one*n+privateCost;
 if(mode==='separate')return one*n+(type==='shared'?Math.max(0,shared-none)*n:privateCost)+(Number(returnTrip?.price_one_way||0)*n);
 if(type==='none')return none*n;
 if(type==='shared')return shared*n;
 if(type==='private')return none*n+privateCost;
 return 0;
}
export default function BookingEditor({bookingNo,go}){
 const {data,refresh}=useAppData(); const existing=data.bookings.find(b=>String(b.booking_number)===String(bookingNo));
 const existingPassengers=existing?data.passengers.filter(p=>String(p.booking_id)===String(existing.id)):[];
 const [passengers,setPassengers]=useState(existingPassengers.length?existingPassengers.map(p=>({id:p.id,name:p.full_name,gender:p.gender,nationality:p.nationality,identity:p.identity_number,phone:p.phone,status:p.status,accommodationStatus:p.accommodation_status,preferredLanguage:p.preferred_language})): [emptyP()]);
 const snap=existing?.snapshot||{};
 const [journeyMode,setJourneyMode]=useState(existing?.journey_mode||snap.journeyMode||'oneway');
 const [tripId,setTripId]=useState(existing?.trip_id||snap.tripId||'');
 const [returnTripId,setReturnTripId]=useState(existing?.return_trip_id||snap.returnTripId||'');
 const [accommodation,setAccommodation]=useState(existing?.accommodation_type||snap.accommodationType||'none');
 const [housingDays,setHousingDays]=useState(Number(snap.housingDays||0));
 const [privateRooms,setPrivateRooms]=useState(Number(existing?.private_rooms||snap.privateRooms||1));
 const [totalPrice,setTotalPrice]=useState(Number(existing?.total_price||snap.totalPrice||0));
 const [err,setErr]=useState(''),[saving,setSaving]=useState(false);
 const trips=useMemo(()=>data.trips.filter(t=>!['cancelled','completed'].includes(String(t.status))),[data.trips]);
 const trip=trips.find(t=>String(t.id)===String(tripId)),returnTrip=trips.find(t=>String(t.id)===String(returnTripId));
 const suggested=calcPrice({mode:journeyMode,type:accommodation,travelers:passengers.length,rooms:privateRooms,days:housingDays,trip,returnTrip});
 function applySuggested(){setTotalPrice(suggested)}
 async function save(e){
  e.preventDefault(); setErr('');
  if(accommodation==='shared'&&passengers.some(p=>String(p.gender).toLowerCase()==='female'||p.gender==='أنثى'))return setErr('السكن المشترك غير متاح للنساء. اختر غرفة خاصة أو بدون سكن.');
  if(accommodation==='private'&&Number(housingDays)<1)return setErr('عدد أيام السكن إلزامي عند اختيار غرفة خاصة.');
  if(journeyMode==='separate'&&!returnTripId)return setErr('اختر رحلة العودة المنفصلة.');
  setSaving(true); const f=Object.fromEntries(new FormData(e.currentTarget));
  const bookingNumber=existing?.booking_number||`MAH-${Date.now().toString().slice(-8)}`;
  const accommodationLabel=accommodation==='none'?'بدون سكن':accommodation==='shared'?'سكن مشترك خماسي':'غرفة خاصة';
  const snapshot={...(existing?.snapshot||{}),journeyMode,tripId,returnTripId:returnTripId||null,accommodationType:accommodation,housingDays:accommodation==='private'?Number(housingDays):0,privateRooms:accommodation==='private'?Number(privateRooms):0,totalPrice:Number(totalPrice||0),paidAmount:Number(f.paid_amount||0),passengerDetails:passengers};
  const base={booking_number:bookingNumber,branch_id:f.branch_id,trip_id:tripId||null,return_trip_id:returnTripId||null,journey_mode:journeyMode,customer_name:f.customer_name,customer_phone:f.customer_phone,customer_identity:f.customer_identity,customer_gender:f.customer_gender,customer_nationality:f.customer_nationality,accommodation_type:accommodation,accommodation_label:accommodationLabel,private_rooms:accommodation==='private'?Number(privateRooms):0,private_room_types:accommodation==='private'?Array.from({length:Number(privateRooms)},()=> 'double'):[],total_price:Number(totalPrice||0),original_price:Number(suggested||totalPrice||0),paid_amount:Number(f.paid_amount||0),payment_method:f.payment_method||null,notes:f.notes||'',terms_accepted:true,source:'branch',version_no:Number(existing?.version_no||1),status:existing?.status||'confirmed',snapshot};
  const pRows=passengers.map((p,i)=>({id:p.id||null,passenger_order:i+1,full_name:p.name,gender:p.gender,nationality:p.nationality,identity_number:p.identity,phone:p.phone,status:p.status||'confirmed',accommodation_status:p.accommodationStatus||'active',preferred_language:p.preferredLanguage||'ar',assistance_flags:[],document_status:'unknown'}));
  try{
   if(existing)await api.admin({action:'update_booking',booking:{...base,number:bookingNumber,versionNo:Number(existing.version_no||1),name:base.customer_name,phone:base.customer_phone,identity:base.customer_identity,gender:base.customer_gender,nationality:base.customer_nationality,journeyMode,tripId,returnTripId:returnTripId||null,totalPrice:Number(totalPrice||0),paidAmount:Number(f.paid_amount||0),paymentMethod:base.payment_method,notes:base.notes,accommodationType:accommodation,accommodationLabel,privateRooms:Number(privateRooms),snapshot,passengerDetails:passengers}});
   else await api.customerBook(base,pRows);
   await refresh(); go('/bookings/'+bookingNumber,{replace:true});
  }catch(e){setErr(e.message)}finally{setSaving(false)}
 }
 return <><PageHeader title={existing?`تعديل الحجز ${existing.booking_number}`:'حجز جديد'} subtitle="حفظ ذري للحجز والمسافرين مع تسعير السكن الخاص بالأيام" actions={<><Button onClick={()=>go('/bookings')}><ArrowRight size={16}/> رجوع</Button>{existing&&<><Button onClick={()=>go('/ticket/'+existing.booking_number)}><Ticket size={16}/> التذكرة</Button><Button onClick={()=>go('/refunds?booking='+existing.booking_number)}><RotateCcw size={16}/> استرداد</Button></>}</>}/><ErrorBox error={err}/><form onSubmit={save}><div className="editor-grid"><Card><h3>بيانات الحجز</h3><div className="form-grid">
 <Field label="الفرع"><Select name="branch_id" defaultValue={existing?.branch_id||data.scope?.branch_id||''} required><option value="">اختر الفرع</option>{data.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
 <Field label="نوع الرحلة"><Select value={journeyMode} onChange={e=>setJourneyMode(e.target.value)}><option value="oneway">ذهاب فقط</option><option value="roundtrip">ذهاب وعودة</option><option value="separate">ذهاب + عودة من رحلة أخرى</option><option value="returnonly">عودة فقط</option></Select></Field>
 <Field label="رحلة الذهاب / الأساسية"><Select value={tripId} onChange={e=>setTripId(e.target.value)} required><option value="">اختر</option>{trips.map(t=><option key={t.id} value={t.id}>{t.trip_code} — {t.from_city} ← {t.to_city}</option>)}</Select></Field>
 <Field label="رحلة العودة"><Select value={returnTripId} onChange={e=>setReturnTripId(e.target.value)} disabled={!['separate','roundtrip'].includes(journeyMode)}><option value="">بدون</option>{trips.map(t=><option key={t.id} value={t.id}>{t.trip_code} — {t.from_city} ← {t.to_city}</option>)}</Select></Field>
 <Field label="اسم العميل"><Input name="customer_name" defaultValue={existing?.customer_name||''} required/></Field><Field label="الجوال"><Input name="customer_phone" defaultValue={existing?.customer_phone||''} required/></Field>
 <Field label="الهوية / الإقامة"><Input name="customer_identity" defaultValue={existing?.customer_identity||''} required/></Field><Field label="الجنسية"><Input name="customer_nationality" defaultValue={existing?.customer_nationality||'السعودية'}/></Field>
 <Field label="الجنس"><Select name="customer_gender" defaultValue={existing?.customer_gender||'male'}><option value="male">ذكر</option><option value="female">أنثى</option></Select></Field>
 <Field label="نوع السكن"><Select value={accommodation} onChange={e=>setAccommodation(e.target.value)}><option value="none">بدون سكن</option><option value="shared">مشترك خماسي</option><option value="private">غرفة خاصة</option></Select></Field>
 {accommodation==='private'&&<><Field label="عدد الغرف الخاصة"><Input type="number" min="1" value={privateRooms} onChange={e=>setPrivateRooms(Number(e.target.value))}/></Field><Field label="عدد أيام السكن"><Input type="number" min="1" value={housingDays||''} onChange={e=>setHousingDays(Number(e.target.value))} required/></Field></>}
 <Field label="السعر المقترح"><div className="price-suggestion"><strong>{money(suggested)}</strong><Button type="button" onClick={applySuggested}><Calculator size={15}/> اعتماد السعر</Button></div></Field>
 <Field label="الإجمالي النهائي"><Input type="number" step="0.01" value={totalPrice} onChange={e=>setTotalPrice(Number(e.target.value))}/></Field>
 <Field label="المدفوع"><Input type="number" step="0.01" name="paid_amount" defaultValue={existing?.paid_amount||0}/></Field><Field label="طريقة الدفع"><Select name="payment_method" defaultValue={existing?.payment_method||'cash'}><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="mada">مدى</option></Select></Field>
 <Field label="ملاحظات"><Textarea name="notes" defaultValue={existing?.notes||''}/></Field></div></Card>
 <Card><div className="card-title"><h3>المسافرون</h3><Button type="button" onClick={()=>setPassengers(p=>[...p,emptyP()])}><Plus size={16}/> إضافة</Button></div><div className="passengers-editor">{passengers.map((p,i)=><div className="passenger-box" key={p.id||i}><div className="passenger-number">{i+1}</div><div className="form-grid compact"><Field label="الاسم"><Input value={p.name} onChange={e=>setPassengers(a=>a.map((x,j)=>j===i?{...x,name:e.target.value}:x))} required/></Field><Field label="الهوية"><Input value={p.identity} onChange={e=>setPassengers(a=>a.map((x,j)=>j===i?{...x,identity:e.target.value}:x))} required/></Field><Field label="الجنسية"><Input value={p.nationality||''} onChange={e=>setPassengers(a=>a.map((x,j)=>j===i?{...x,nationality:e.target.value}:x))}/></Field><Field label="الجوال"><Input value={p.phone||''} onChange={e=>setPassengers(a=>a.map((x,j)=>j===i?{...x,phone:e.target.value}:x))}/></Field><Field label="الجنس"><Select value={p.gender||'male'} onChange={e=>setPassengers(a=>a.map((x,j)=>j===i?{...x,gender:e.target.value}:x))}><option value="male">ذكر</option><option value="female">أنثى</option></Select></Field></div>{passengers.length>1&&<button className="remove-passenger" type="button" onClick={()=>setPassengers(a=>a.filter((_,j)=>j!==i))}><Trash2 size={16}/></button>}</div>)}</div></Card></div><div className="sticky-save"><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري الحفظ...':'حفظ الحجز'}</Button></div></form></>
}
