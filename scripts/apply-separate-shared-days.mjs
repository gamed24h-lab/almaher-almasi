import fs from 'node:fs';

function replaceExact(path,from,to){
  const src=fs.readFileSync(path,'utf8');
  if(!src.includes(from)) throw new Error(`Expected block not found in ${path}: ${from.slice(0,100)}`);
  const next=src.replace(from,to);
  fs.writeFileSync(path,next);
}

const editor='src/modules/bookings/BookingEditor.jsx';
replaceExact(editor,
` if(mode==='separate'){
  const returnLeg=n(returnTrip?.price_one_way)*count;
  if(type==='shared'){
   if(legacyShared>0)return legacyShared*count+returnLeg;
   return roundTrip*count+sharedCost+returnLeg;
  }
  return legacyNone*count+privateCost+returnLeg;
 }`,
` if(mode==='separate'){
  const returnLeg=n(returnTrip?.price_one_way)*count;
  if(type==='shared'){
   if(sharedDailyConfigured)return legacyNone*count+sharedCost+returnLeg;
   if(legacyShared>0)return legacyShared*count+returnLeg;
   return legacyNone*count+returnLeg;
  }
  return legacyNone*count+privateCost+returnLeg;
 }`);

replaceExact(editor,
`if(journeyMode==='returnonly'&&accommodation!=='none'&&accommodation!=='private'&&Number(housingDays)<1)return 'حدد عدد أيام السكن قبل رحلة العودة.';`,
`if(accommodation==='shared'&&Number(housingDays)<1)return 'حدد عدد أيام السكن المشترك.';`);

replaceExact(editor,
`const effectiveHousingDays=accommodation==='private'?(privateRoomDaysSeparate?Math.max(...roomSpecsForSave.map(x=>x.days),1):Math.max(1,Number(housingDays||1))):(journeyMode==='returnonly'&&accommodation!=='none'?Math.max(1,Number(housingDays||1)):0);`,
`const effectiveHousingDays=accommodation==='private'?(privateRoomDaysSeparate?Math.max(...roomSpecsForSave.map(x=>x.days),1):Math.max(1,Number(housingDays||1))):accommodation==='shared'?Math.max(1,Number(housingDays||1)):0;`);

replaceExact(editor,
`{journeyMode!=='separate'&&accommodation==='shared'&&<Field label={journeyMode==='returnonly'?'عدد أيام السكن قبل العودة':'عدد أيام السكن'} hint="السكن المشترك يُحسب للفرد في اليوم ويُضاف إلى سعر نوع الرحلة المختار."><Input type="number" min="1" value={housingDays||''} onChange={e=>setHousingDays(Number(e.target.value))} required/></Field>}`,
`{accommodation==='shared'&&<Field label={journeyMode==='returnonly'?'عدد أيام السكن المشترك قبل العودة':'عدد أيام السكن المشترك'} hint="السكن المشترك يُحسب للفرد في اليوم ويُضاف إلى سعر نوع الرحلة المختار."><Input type="number" min="1" value={housingDays||''} onChange={e=>setHousingDays(Number(e.target.value))} required/></Field>}`);

const test='scripts/check-pricing.mjs';
replaceExact(test,
`eq(price('separate','shared'),700,'separate shared legacy');`,
`eq(price('separate','shared'),670,'separate + shared daily');`);
replaceExact(test,
`const legacyTrip={...trip,price_shared_daily:null};
eq(calcPrice({...base,mode:'roundtrip',type:'shared',trip:legacyTrip}),520,'legacy shared fallback');`,
`const legacyTrip={...trip,price_shared_daily:null};
eq(calcPrice({...base,mode:'roundtrip',type:'shared',trip:legacyTrip}),520,'legacy shared fallback');
eq(calcPrice({...base,mode:'separate',type:'shared',trip:legacyTrip}),700,'separate legacy shared fallback');`);

console.log('Separate shared-housing days patch applied.');
