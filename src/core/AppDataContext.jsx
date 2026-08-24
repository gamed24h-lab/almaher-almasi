import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {api} from '../lib/api.js';
import {notifyInfo} from '../lib/feedback.js';
import {tripDisplay} from '../lib/format.js';
const C=createContext(null);
const emptyData={branches:[],branchContacts:[],trips:[],tripBranches:[],bookings:[],passengers:[],users:[],scope:null};
const text=v=>String(v??'').trim();
const digits=v=>text(v).replace(/\D/g,'');
const naturalCollator=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
const bookingDisplayNumber=b=>text(b?.booking_number)||text(b?.booking_no)||text(b?.code)||text(b?.reference)||text(b?.id);
function normalizeBootstrap(raw){
 const x=raw&&typeof raw==='object'?raw:{};
 const bookings=Array.isArray(x.bookings)?x.bookings:[];
 const passengers=(Array.isArray(x.passengers)?x.passengers:[]).filter(p=>!['cancelled','canceled','refunded','deleted','ملغي'].includes(text(p?.status).toLowerCase()));
 const bookingById=new Map(bookings.map(b=>[text(b.id),b]));
 const counts=new Map();for(const p of passengers){const k=text(p.booking_id);counts.set(k,(counts.get(k)||0)+1)}
 const normalizedPassengers=passengers.map(p=>{
  const b=bookingById.get(text(p.booking_id));if(!b)return p;
  const one=(counts.get(text(p.booking_id))||0)===1;
  const sameIdentity=digits(p.identity_number)&&digits(b.customer_identity)&&digits(p.identity_number)===digits(b.customer_identity);
  const samePhone=digits(p.phone)&&digits(b.customer_phone)&&digits(p.phone)===digits(b.customer_phone);
  if(!one&&!sameIdentity&&!samePhone)return p;
  return {...p,
   full_name:text(b.customer_name)||p.full_name,
   phone:text(b.customer_phone)||p.phone,
   identity_number:text(b.customer_identity)||p.identity_number,
   nationality:text(b.customer_nationality)||p.nationality,
   gender:text(b.customer_gender)||p.gender
  };
 }).sort((a,b)=>{
  const ba=bookingById.get(text(a.booking_id)),bb=bookingById.get(text(b.booking_id));
  const byBooking=naturalCollator.compare(bookingDisplayNumber(ba),bookingDisplayNumber(bb));if(byBooking)return byBooking;
  const byOrder=Number(a.passenger_order||0)-Number(b.passenger_order||0);if(byOrder)return byOrder;
  return naturalCollator.compare(text(a.full_name),text(b.full_name));
 });
 const passengerByBooking=new Map();for(const p of normalizedPassengers){const k=text(p.booking_id),a=passengerByBooking.get(k)||[];a.push(p);passengerByBooking.set(k,a)}
 const normalizedBookings=bookings.map(b=>{
  const displayNumber=bookingDisplayNumber(b);
  const base={...b,booking_number:displayNumber,booking_no:displayNumber,code:displayNumber,reference:displayNumber};
  const snapshot=b?.snapshot&&typeof b.snapshot==='object'?b.snapshot:null;if(!snapshot)return base;
  const current=passengerByBooking.get(text(b.id))||[];if(!current.length)return base;
  const details=Array.isArray(snapshot.passengerDetails)?snapshot.passengerDetails:[];if(!details.length)return base;
  const byId=new Map(current.filter(p=>p.id).map(p=>[text(p.id),p]));
  const nextDetails=details.map((d,i)=>{const p=byId.get(text(d?.id))||current[i];if(!p)return d;return {...d,name:p.full_name,full_name:p.full_name,phone:p.phone,identity:p.identity_number,identity_number:p.identity_number,nationality:p.nationality,gender:p.gender}});
  return {...base,snapshot:{...snapshot,passengerDetails:nextDetails}};
 }).sort((a,b)=>naturalCollator.compare(bookingDisplayNumber(a),bookingDisplayNumber(b)));
 return {...emptyData,...x,bookings:normalizedBookings,passengers:normalizedPassengers};
}
function tripBookingSummary(data,tripId){
 const activeBookings=(data.bookings||[]).filter(b=>!['cancelled','refunded'].includes(text(b.status).toLowerCase())&&(text(b.trip_id)===text(tripId)||text(b.return_trip_id)===text(tripId)));
 const bookingIds=new Set(activeBookings.map(b=>text(b.id)));
 const pax=(data.passengers||[]).filter(p=>bookingIds.has(text(p.booking_id))&&!['cancelled','refunded'].includes(text(p.status).toLowerCase())).length;
 const trip=(data.trips||[]).find(t=>text(t.id)===text(tripId));
 return {bookings:activeBookings.length,passengers:pax,trip};
}
export function AppDataProvider({children}){
 const [data,setData]=useState(emptyData);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const channelRef=useRef(null),lastRefreshRef=useRef(0),pendingTripSummaryRef=useRef([]);
 const load=useCallback(async({silent=false,broadcast=false}={})=>{if(!silent)setLoading(true);if(!silent)setError('');try{const raw=await api.bootstrap();const x=normalizeBootstrap(raw);setData(x);lastRefreshRef.current=Date.now();const pending=[...new Set((pendingTripSummaryRef.current||[]).filter(Boolean).map(String))];if(pending.length){pendingTripSummaryRef.current=[];for(const id of pending){const summary=tripBookingSummary(x,id);const label=summary.trip?` — ${tripDisplay(summary.trip)}`:'';notifyInfo(`حجوزات الرحلة حتى الآن${label}: ${summary.bookings} حجز · ${summary.passengers} مسافر`)}}if(broadcast)try{channelRef.current?.postMessage({type:'data-changed',at:Date.now()})}catch{}return x}catch(e){if(!silent)setError(e.message);if(!silent)throw e;return null}finally{if(!silent)setLoading(false)}},[]);
 const refresh=useCallback(()=>load({silent:false,broadcast:true}),[load]);
 useEffect(()=>{
  const onBookingSaved=e=>{const ids=Array.isArray(e?.detail?.tripIds)?e.detail.tripIds:[];pendingTripSummaryRef.current=[...new Set([...(pendingTripSummaryRef.current||[]),...ids.map(String)])]};
  window.addEventListener('almaher-booking-saved',onBookingSaved);
  return()=>window.removeEventListener('almaher-booking-saved',onBookingSaved);
 },[]);
 useEffect(()=>{
  let timer=null;
  if(typeof BroadcastChannel!=='undefined'){try{const ch=new BroadcastChannel('almaher-data-sync-v1');channelRef.current=ch;ch.onmessage=e=>{if(e?.data?.type==='data-changed')load({silent:true,broadcast:false})}}catch{}}
  const refreshIfStale=()=>{if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;if(Date.now()-lastRefreshRef.current<5000)return;load({silent:true,broadcast:false})};
  const onVisibility=()=>{if(document.visibilityState==='visible')refreshIfStale()};
  window.addEventListener('focus',refreshIfStale);document.addEventListener('visibilitychange',onVisibility);
  timer=setInterval(()=>{if(document.visibilityState==='visible')load({silent:true,broadcast:false})},45000);
  return()=>{window.removeEventListener('focus',refreshIfStale);document.removeEventListener('visibilitychange',onVisibility);if(timer)clearInterval(timer);try{channelRef.current?.close()}catch{}channelRef.current=null};
 },[load]);
 const value=useMemo(()=>({data,setData,loading,error,refresh}),[data,loading,error,refresh]);
 return <C.Provider value={value}>{children}</C.Provider>;
}
export const useAppData=()=>useContext(C);