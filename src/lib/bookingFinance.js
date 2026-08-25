const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const lower=v=>String(v??'').trim().toLowerCase();
const EPS=0.001;

export function bookingFinanceNumbers(booking,refundedAmount=0){
  const b=booking||{};
  const total=Math.max(0,num(b.total_price??b.totalPrice));
  const stored=Math.max(0,num(b.paid_amount??b.paidAmount));
  const snapshotGross=Math.max(0,num(b?.snapshot?.finance?.grossPaidHistory));
  const gross=Math.max(stored,snapshotGross);
  const refund=Math.max(0,num(refundedAmount??b.refunded_amount));
  const netRaw=Number((gross-refund).toFixed(2));
  const paid=Math.max(0,netRaw);
  const remaining=Math.max(0,Number((total-paid).toFixed(2)));
  const credit=Math.max(0,Number((paid-total).toFixed(2)));
  const refundExceedsCollection=refund>gross+EPS;
  const zeroValueRefund=total<=EPS&&refund>EPS;
  return {total,stored,gross,refund,netRaw,paid,remaining,credit,refundExceedsCollection,zeroValueRefund};
}

export function bookingFinancialState(booking,refundedAmount=0){
  const x=bookingFinanceNumbers(booking,refundedAmount);
  const status=lower(booking?.status);
  const financialStatus=lower(booking?.financial_status);
  if(x.refundExceedsCollection||x.zeroValueRefund)return {code:'mismatch',label:'عدم تطابق مالي',tone:'red',...x};
  if(['cancelled','refunded'].includes(status)||financialStatus==='refunded'){
    if(x.gross>EPS&&x.refund>=x.gross-EPS)return {code:'refunded',label:'مسترد بالكامل',tone:'blue',...x};
    if(status==='cancelled')return {code:'cancelled',label:'ملغي',tone:'red',...x};
  }
  if(x.total<=EPS)return {code:'no_value',label:'بدون قيمة',tone:'orange',...x};
  if(x.credit>EPS)return {code:'credit',label:'رصيد للعميل',tone:'orange',...x};
  if(x.remaining<=EPS)return {code:'paid',label:'مسدد',tone:'green',...x};
  if(x.paid>EPS)return {code:'partial',label:'مدفوع جزئيًا',tone:'orange',...x};
  return {code:'unpaid',label:'غير مسدد',tone:'red',...x};
}

export function paymentMethodLabel(value,language='ar'){
  const raw=String(value??'').trim();
  if(language!=='ar')return raw;
  const key=lower(raw).replace(/\s+/g,'_');
  const labels={cash:'نقدي',نقدي:'نقدي',mada:'مدى',مدى:'مدى',card:'بطاقة',credit_card:'بطاقة',debit_card:'بطاقة',bank_transfer:'تحويل بنكي',transfer:'تحويل بنكي',تحويل:'تحويل بنكي',تحويل_بنكي:'تحويل بنكي',apple_pay:'Apple Pay',stc_pay:'STC Pay'};
  return labels[key]||raw;
}
