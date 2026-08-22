import {useEffect} from 'react';
import {installPrintIsolation} from '../lib/print.js';
export default function PrintIsolation(){useEffect(()=>installPrintIsolation(),[]);return null}
