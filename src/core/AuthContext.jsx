import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
import {api} from '../lib/api.js';
const C=createContext(null);
export function AuthProvider({children}){
 const [user,setUser]=useState(null),[booting,setBooting]=useState(true);
 useEffect(()=>{api.me().then(x=>setUser(x.user||null)).catch(()=>setUser(null)).finally(()=>setBooting(false))},[]);
 const value=useMemo(()=>({user,booting,async login(identity,password,method){const x=await api.login(identity,password,method);setUser(x.user);return x},async developerLogin(email,password){const x=await api.developerLogin(email,password);setUser(x.user);return x},async logout(){try{await api.logout()}finally{setUser(null)}}}),[user,booting]);
 return <C.Provider value={value}>{children}</C.Provider>;
}
export const useAuth=()=>useContext(C);
