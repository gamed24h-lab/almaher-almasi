import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
export const THEMES=[
 ['maher','الماهر','🌟'],
 ['ocean','المحيط','🌊'],
 ['emerald','الزمرد','🟢'],
 ['graphite','الجرافيت','⚫']
];
const C=createContext(null);
export function ThemeProvider({children}){
 const [theme,setThemeState]=useState(()=>localStorage.getItem('almaher.theme')||'maher');
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('almaher.theme',theme)},[theme]);
 const value=useMemo(()=>({theme,setTheme:setThemeState,themes:THEMES}),[theme]);
 return <C.Provider value={value}>{children}</C.Provider>;
}
export function useTheme(){return useContext(C)||{theme:'maher',setTheme:()=>{},themes:THEMES}}
