import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/modules/bookings/BookingEditor.jsx',import.meta.url),'utf8');
const start=source.indexOf('function calcPrice(');
const end=source.indexOf('\nfunction isFemale',start);
if(start<0||end<0)throw new Error('Unable to locate calcPrice in BookingEditor.jsx');

const calcSource=source.slice(start,end);
const n=v=>Number(v||0);
const normalizeRoomDays=(count,values,fallback=1)=>Array.from({length:Math.max(1,Number(count||1))},(_,i)=>Math.max(1,Number(values?.[i]||fallback||1)));
const calcPrice=new Function('n','normalizeRoomDays',`${calcSource}; return calcPrice;`)(n,normalizeRoomDays);

const trip={
 price_one_way:1100,
 price_no_accommodation:1800,
 price_shared:2200,
 price_private_room:300
};
const returnTrip={price_one_way:900};
const base={travelers:2,rooms:1,days:3,roomDays:[3],separateRoomDays:false,trip,returnTrip};
const price=(mode,type,extra={})=>calcPrice({...base,mode,type,...extra});
const assertEq=(actual,expected,label)=>{if(actual!==expected)throw new Error(`${label}: expected ${expected}, got ${actual}`)};

// Core invariant requested by operations: return-only must price exactly like one-way for the same accommodation choice.
for(const type of ['none','shared','private'])assertEq(price('returnonly',type),price('oneway',type),`returnonly equals oneway (${type})`);

// Shared one-way / return-only is a leg package and must not accidentally use round-trip shared pricing.
assertEq(price('oneway','shared'),2200,'oneway shared uses one-way leg price for 2 travelers');
assertEq(price('returnonly','shared'),2200,'returnonly shared mirrors one-way shared price');

// Private housing supplement is per room-day and is identical for one-way and return-only.
assertEq(price('oneway','private'),4000,'oneway private includes room-day supplement');
assertEq(price('returnonly','private'),4000,'returnonly private includes same room-day supplement');
assertEq(price('oneway','private',{rooms:2,days:2,roomDays:[2,4],separateRoomDays:true}),5800,'separate private room days are summed per room');

// Round-trip and separate-return rules remain distinct.
assertEq(price('roundtrip','none'),3600,'roundtrip no-housing uses package price');
assertEq(price('roundtrip','shared'),4400,'roundtrip shared uses shared package price');
assertEq(price('separate','shared'),6200,'separate return adds return leg to outbound shared package');

console.log('Pricing invariants: PASS');
