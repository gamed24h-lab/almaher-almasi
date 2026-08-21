import React,{createContext,useCallback,useContext,useMemo,useState} from 'react';
import {api} from '../lib/api.js';
const C=createContext(null);
export function AppDataProvider({children}){
 const [data,setData]=useState({branches:[],branchContacts:[],trips:[],tripBranches:[],bookings:[],passengers:[],users:[],scope:null});
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{setLoading(true);setError('');try{const x=await api.bootstrap();setData(x);return x}catch(e){setError(e.message);throw e}finally{setLoading(false)}},[]);
 const value=useMemo(()=>({data,setData,loading,error,refresh}),[data,loading,error,refresh]);
 return <C.Provider value={value}>{children}</C.Provider>;
}
export const useAppData=()=>useContext(C);
