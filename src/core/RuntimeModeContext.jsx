import React,{createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';

const C=createContext({mode:'training',loading:true,schemaMissing:false,refresh:async()=>{},switchToTraining:async()=>{}});

async function req(path,{method='GET',body}={}){
  const r=await fetch(path,{method,credentials:'include',headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={message:text}}
  if(!r.ok){const e=new Error(data?.error||data?.message||`HTTP ${r.status}`);e.code=data?.code;throw e}return data;
}

export function RuntimeModeProvider({children}){
  const [mode,setMode]=useState('training'),[loading,setLoading]=useState(true),[schemaMissing,setSchemaMissing]=useState(false),[meta,setMeta]=useState({});
  const refresh=useCallback(async()=>{setLoading(true);try{const x=await req('/api/system/runtime-mode');setMode(x.mode==='production'?'production':'training');setSchemaMissing(!!x.schema_missing);setMeta(x);return x}finally{setLoading(false)}},[]);
  useEffect(()=>{refresh().catch(()=>setLoading(false))},[refresh]);
  const switchToTraining=useCallback(async()=>{const x=await req('/api/system/runtime-mode',{method:'POST',body:{mode:'training'}});setMode('training');setSchemaMissing(false);setMeta(x);try{window.dispatchEvent(new CustomEvent('almaher:runtime-mode',{detail:{mode:'training'}}))}catch{}return x},[]);
  const value=useMemo(()=>({mode,isTraining:mode!=='production',isProduction:mode==='production',loading,schemaMissing,meta,refresh,switchToTraining}),[mode,loading,schemaMissing,meta,refresh,switchToTraining]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useRuntimeMode=()=>useContext(C);
