import React,{useEffect,useMemo,useState} from 'react';
import HousingBase from './HousingBase.jsx';
import {api} from '../../lib/api.js';
import {useAppData} from '../../core/AppDataContext.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';
import {Button,Card,ErrorBox,Field,Input,SearchSelect,Select} from '../../components/UI.jsx';
import {Hotel,Pencil} from 'lucide-react';
import {tripDisplay} from '../../lib/format.js';

const s=v=>String(v??'');

function ActualRoomNumberEditor(){
 const {data}=useAppData();
 const {user}=useAuth();
 const canManage=has(user,'housing')||has(user,'manageHotels')||has(user,'manageHotelRooms');
 const [payload,setPayload]=useState(null),[tripId,setTripId]=useState(''),[tripHotelId,setTripHotelId]=useState(''),[roomId,setRoomId]=useState(''),[actualNo,setActualNo]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){try{setPayload(await api.module('housing'))}catch(e){setError(e.message)}}
 useEffect(()=>{if(canManage)load()},[canManage]);
 const tripOptions=useMemo(()=>[...(data.trips||[])].sort((a,b)=>String(b.departure_date||'').localeCompare(String(a.departure_date||''))).map(t=>({value:t.id,label:tripDisplay(t),searchText:[t.trip_code,t.code,t.from_city,t.to_city,t.origin,t.destination,t.departure_date,t.return_date].filter(Boolean).join(' ')})),[data.trips]);
 const tripHotels=useMemo(()=>(payload?.trip_hotels||[]).filter(x=>s(x.trip_id)===s(tripId)),[payload,tripId]);
 const hotels=payload?.hotels||[];
 const rooms=useMemo(()=>(payload?.hotel_rooms||[]).filter(x=>s(x.trip_hotel_id)===s(tripHotelId)),[payload,tripHotelId]);
 const room=rooms.find(x=>s(x.id)===s(roomId));
 useEffect(()=>{setTripHotelId('');setRoomId('');setActualNo('')},[tripId]);
 useEffect(()=>{setRoomId('');setActualNo('')},[tripHotelId]);
 useEffect(()=>{setActualNo(s(room?.metadata?.actual_room_no))},[roomId]);
 if(!canManage)return null;
 async function save(){
  if(!room)return setError('اختر الغرفة أولًا.');
  const value=s(actualNo).trim();
  setBusy(true);setError('');setNotice('');
  try{
   const metadata={...(room.metadata&&typeof room.metadata==='object'?room.metadata:{}),actual_room_no:value||null};
   await api.moduleWrite({action:'update',table:'hotel_rooms',id:room.id,row:{metadata}});
   await load();
   setNotice(value?`تم تسجيل رقم الغرفة الفعلي ${value} للغرفة التشغيلية ${room.room_no||'—'}.`:`تم مسح رقم الغرفة الفعلي، وسيظهر الرقم التشغيلي ${room.room_no||'—'} مؤقتًا.`);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <Card><div className="card-title"><div><h3><Hotel size={18}/> تحديث رقم الغرفة الفعلي</h3><small>يبقى رقم P-/M- رقمًا تشغيليًا داخليًا، ويظهر رقم الفندق الفعلي في التذكرة بعد تسجيله.</small></div></div><ErrorBox error={error}/>{notice&&<div className="training-banner" style={{background:'#ecfdf3',color:'#166534',borderColor:'#bbf7d0'}}>{notice}</div>}<div className="form-grid"><Field label="الرحلة"><SearchSelect value={tripId} onChange={e=>setTripId(e.target.value)} options={tripOptions} placeholder="اختر الرحلة"/></Field><Field label="الفندق"><Select value={tripHotelId} onChange={e=>setTripHotelId(e.target.value)} disabled={!tripId}><option value="">اختر الفندق</option>{tripHotels.map(th=><option key={th.id} value={th.id}>{hotels.find(h=>s(h.id)===s(th.hotel_id))?.name||'فندق'}</option>)}</Select></Field><Field label="الغرفة التشغيلية"><Select value={roomId} onChange={e=>setRoomId(e.target.value)} disabled={!tripHotelId}><option value="">اختر الغرفة</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.room_no||'—'}{r.metadata?.actual_room_no?` ← الفعلية ${r.metadata.actual_room_no}`:''}</option>)}</Select></Field><Field label="رقم الغرفة الفعلي بالفندق" hint="مثال: 412. اتركه فارغًا لمسح الرقم الفعلي والعودة لعرض الرقم التشغيلي مؤقتًا."><Input value={actualNo} onChange={e=>setActualNo(e.target.value)} disabled={!roomId} placeholder="مثال: 412"/></Field><div className="modal-actions"><Button variant="primary" onClick={save} disabled={!roomId||busy}><Pencil size={15}/>{busy?'جاري الحفظ...':'حفظ الرقم الفعلي'}</Button></div></div></Card>;
}

export default function Housing(props){return <><ActualRoomNumberEditor/><HousingBase {...props}/></>}
