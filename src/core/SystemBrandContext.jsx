import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {api} from '../lib/api.js';
const DEFAULT={profile:{display_name:'Mohamed Abdelrahman Hassan',title:'مطور النظام',phone:'00966509444960',email:'',footer_note:''},labels:{system_name:'الماهر الماسي',system_subtitle:'نظام إدارة الرحلات والحجوزات والتسكين والتشغيل',dashboard_title:'مركز تشغيل الماهر',dashboard_subtitle:'نظرة لحظية على الرحلات والحجوزات والاستثناءات',ticket_footer:'',report_footer:''},config:{show_profile_all_pages:true,show_profile_tickets:true,show_profile_reports:true,show_profile_receipts:true}};
const C=createContext({...DEFAULT,refresh:()=>{}});
export function SystemBrandProvider({children}){
 const [value,setValue]=useState(DEFAULT);
 async function refresh(){try{const x=await api.mega('public_brand_profile',{},'GET');setValue({profile:{...DEFAULT.profile,...(x?.profile||{})},labels:{...DEFAULT.labels,...(x?.labels||{})},config:{...DEFAULT.config,...(x?.config||{})}})}catch{}}
 useEffect(()=>{refresh();const fn=()=>refresh();window.addEventListener('almaher:brand-updated',fn);return()=>window.removeEventListener('almaher:brand-updated',fn)},[]);
 const v=useMemo(()=>({...value,refresh}),[value]);return <C.Provider value={v}>{children}</C.Provider>
}
export function useSystemBrand(){return useContext(C)||{...DEFAULT,refresh:()=>{}}}
