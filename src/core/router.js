import {useEffect,useState} from 'react';
export function useRoute(){
 const get=()=>location.pathname+location.search;const [route,setRoute]=useState(get);
 useEffect(()=>{const h=()=>setRoute(get());addEventListener('popstate',h);return()=>removeEventListener('popstate',h)},[]);
 const go=(path,{replace=false}={})=>{history[replace?'replaceState':'pushState']({},'',path);setRoute(get());scrollTo({top:0,behavior:'auto'})};
 return {route,path:location.pathname,params:new URLSearchParams(location.search),go,back:()=>history.length>1?history.back():go('/')};
}
