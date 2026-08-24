import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {api} from '../lib/api.js';
const C=createContext(null);
const emptyData={branches:[],branchContacts:[],trips:[],tripBranches:[],bookings:[],passengers:[],users:[],scope:null};
const text=v=>String(v??'').trim();
const digits=v=>text(v).replace(/\D/g,'');
function normalizeBootstrap(raw){
 const x=raw&&typeof raw==='object'?raw:{};
 const bookings=Array.isArray(x.bookings)?x.bookings:[];
 const passengers=Array.isArray(x.passengers)?x.passengers:[];
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
 });
 const passengerByBooking=new Map();for(const p of normalizedPassengers){const k=text(p.booking_id),a=passengerByBooking.get(k)||[];a.push(p);passengerByBooking.set(k,a)}
 const normalizedBookings=bookings.map(b=>{
  const snapshot=b?.snapshot&&typeof b.snapshot==='object'?b.snapshot:null;if(!snapshot)return b;
  const current=passengerByBooking.get(text(b.id))||[];if(!current.length)return b;
  const details=Array.isArray(snapshot.passengerDetails)?snapshot.passengerDetails:[];if(!details.length)return b;
  const byId=new Map(current.filter(p=>p.id).map(p=>[text(p.id),p]));
  const nextDetails=details.map((d,i)=>{const p=byId.get(text(d?.id))||current[i];if(!p)return d;return {...d,name:p.full_name,full_name:p.full_name,phone:p.phone,identity:p.identity_number,identity_number:p.identity_number,nationality:p.nationality,gender:p.gender}});
  return {...b,snapshot:{...snapshot,passengerDetails:nextDetails}};
 });
 return {...emptyData,...x,bookings:normalizedBookings,passengers:normalizedPassengers};
}
export function AppDataProvider({children}){
 const [data,setData]=useState(emptyData);
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const channelRef=useRef(null),lastRefreshRef=useRef(0);
 const load=useCallback(async({silent=false,broadcast=false}={})=>{if(!silent)setLoading(true);if(!silent)setError('');try{const raw=await api.bootstrap();const x=normalizeBootstrap(raw);setData(x);lastRefreshRef.current=Date.now();if(broadcast)try{channelRef.current?.postMessage({type:'data-changed',at:Date.now()})}catch{}return x}catch(e){if(!silent)setError(e.message);if(!silent)throw e;return null}finally{if(!silent)setLoading(false)}},[]);
 const refresh=useCallback(()=>load({silent:false,broadcast:true}),[load]);
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
