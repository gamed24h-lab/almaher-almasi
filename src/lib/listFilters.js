const arabicDigits='٠١٢٣٤٥٦٧٨٩';
const persianDigits='۰۱۲۳۴۵۶۷۸۹';

export function normalizeListText(value){
 return String(value??'')
  .toLowerCase()
  .replace(/[٠-٩]/g,d=>String(arabicDigits.indexOf(d)))
  .replace(/[۰-۹]/g,d=>String(persianDigits.indexOf(d)))
  .replace(/[إأآٱ]/g,'ا')
  .replace(/ى/g,'ي')
  .replace(/ؤ/g,'و')
  .replace(/ئ/g,'ي')
  .replace(/[ًٌٍَُِّْـ]/g,'')
  .replace(/[^a-z0-9\u0600-\u06ff]+/gi,' ')
  .trim()
  .replace(/\s+/g,' ');
}

export function matchesListQuery(query,...values){
 const q=normalizeListText(query);
 if(!q)return true;
 const hay=normalizeListText(values.flat(Infinity).filter(v=>v!==null&&v!==undefined).join(' '));
 const compactHay=hay.replace(/\s+/g,'');
 return q.split(' ').every(token=>hay.includes(token)||(/^\d+$/.test(token)&&compactHay.includes(token)));
}
