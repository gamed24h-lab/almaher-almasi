const ARAB_NATIONALITY_TOKENS=['سعود','مصر','مصري','اردن','الأردن','سوريا','سوري','لبنان','لبناني','عراق','عراقي','يمن','يمني','عمان','عُمان','قطر','قطري','كويت','كويتي','بحرين','بحريني','امارات','الإمارات','إمارات','مغرب','مغربي','جزائر','جزائري','تونس','تونسي','ليبيا','ليبي','سودان','سوداني','فلسطين','فلسطيني','موريتان','موريتاني','صومال','صومالي','جيبوتي','جزر القمر','arab','saudi','egypt','jordan','syri','leban','iraq','yemen','oman','qatar','kuwait','bahrain','emirat','morocc','alger','tunis','libya','sudan','palestin','mauritan','somal','djibouti','comoros'];

export function isFemale(v=''){const s=String(v).trim().toLowerCase();return ['female','f','أنثى','انثى','امرأة','woman'].includes(s)}
export function isArabNationality(v=''){const s=String(v).trim().toLowerCase();return ARAB_NATIONALITY_TOKENS.some(x=>s.includes(x))}
export function sharedHousingEligible(person={}){return !isFemale(person.gender||person.customer_gender)}
export function housingClusterKey(person={}){return `${isFemale(person.gender||person.customer_gender)?'female':'male'}:${isArabNationality(person.nationality||person.customer_nationality)?'arab':'nonarab'}`}
export function sharedRoomPlan(count=0,capacity=5){const n=Math.max(0,Number(count)||0),cap=Math.max(1,Number(capacity)||5);const rooms=[];let left=n;while(left>0){const take=Math.min(cap,left);rooms.push(take);left-=take}return rooms}
export function prioritizeSharedPassengers(rows=[]){return [...rows].sort((a,b)=>{const ga=housingClusterKey(a),gb=housingClusterKey(b);if(ga===gb)return 0;if(ga.endsWith(':arab')&&!gb.endsWith(':arab'))return-1;if(!ga.endsWith(':arab')&&gb.endsWith(':arab'))return 1;return ga.localeCompare(gb,'ar')})}
export const SHARED_ROOM_CAPACITY=5;
