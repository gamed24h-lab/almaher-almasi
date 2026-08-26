import fs from 'node:fs';
function replaceOne(file,from,to){let s=fs.readFileSync(file,'utf8');if(!s.includes(from))throw new Error(`pattern not found in ${file}: ${from.slice(0,90)}`);s=s.replace(from,to);fs.writeFileSync(file,s)}

replaceOne('src/components/Shell.jsx',
"['/refunds','refunds',Receipt,['refunds','refund_request','refund_approve','refund_complete']],['/operations'",
"['/refunds','refunds',Receipt,['refunds','refund_request','refund_approve','refund_complete']],['/wallets','wallets',WalletCards,['payments','refunds','viewBookings']],['/operations'");
replaceOne('src/components/Shell.jsx',
"const label=key==='destinations'?'إدارة الوجهات':t(key);",
"const label=key==='destinations'?'إدارة الوجهات':key==='wallets'?'محافظ العملاء':t(key);");

replaceOne('src/modules/bookings/BookingEditor.jsx',
"const PAYMENT_METHODS=[['cash','نقدي'],['bank_transfer','تحويل بنكي'],['mada','مدى'],['card','Visa / Mastercard'],['apple_pay','Apple Pay'],['online','دفع إلكتروني / بوابة دفع'],['other','أخرى']];",
"const PAYMENT_METHODS=[['cash','نقدي'],['bank_transfer','تحويل بنكي'],['mada','مدى'],['card','Visa / Mastercard'],['apple_pay','Apple Pay'],['online','دفع إلكتروني / بوابة دفع'],['wallet','محفظة العميل'],['other','أخرى']];");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"const [refundSummary,setRefundSummary]=useState({refunded:0,loaded:!existing});",
"const [refundSummary,setRefundSummary]=useState({refunded:0,loaded:!existing});\n const [walletSummary,setWalletSummary]=useState({balance:0,loaded:false,wallet:null});");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"useEffect(()=>{if(!existing?.booking_number){setRefundSummary({refunded:0,loaded:true});return}let alive=true;setRefundSummary(x=>({...x,loaded:false}));api.admin({action:'refund_quote',booking_number:existing.booking_number}).then(x=>{if(alive)setRefundSummary({refunded:n(x?.refunded_amount),loaded:true})}).catch(()=>{if(alive)setRefundSummary({refunded:0,loaded:true})});return()=>{alive=false}},[existing?.booking_number]);",
"useEffect(()=>{if(!existing?.booking_number){setRefundSummary({refunded:0,loaded:true});return}let alive=true;setRefundSummary(x=>({...x,loaded:false}));api.admin({action:'refund_quote',booking_number:existing.booking_number}).then(x=>{if(alive)setRefundSummary({refunded:n(x?.refunded_amount),loaded:true})}).catch(()=>{if(alive)setRefundSummary({refunded:0,loaded:true})});return()=>{alive=false}},[existing?.booking_number]);\n useEffect(()=>{const identity=String(customerDraft.identity||'').trim();if(!identity){setWalletSummary({balance:0,loaded:true,wallet:null});return}let alive=true;const timer=setTimeout(()=>{setWalletSummary(x=>({...x,loaded:false}));api.admin({action:'wallet_get',customer_identity:identity}).then(x=>{if(alive)setWalletSummary({balance:n(x?.balance),loaded:true,wallet:x?.wallet||null})}).catch(()=>{if(alive)setWalletSummary({balance:0,loaded:true,wallet:null})})},300);return()=>{alive=false;clearTimeout(timer)}},[customerDraft.identity]);");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"const newCollection=normalizedPaymentSplits.reduce((sum,x)=>sum+x.amount,0),effectivePaid=existing?historicalPaid+newCollection:newCollection,liveNetPaid=existing?historicalNetPaid+newCollection:newCollection;",
"const newCollection=normalizedPaymentSplits.reduce((sum,x)=>sum+x.amount,0),walletCollection=normalizedPaymentSplits.filter(x=>x.method==='wallet').reduce((sum,x)=>sum+x.amount,0),effectivePaid=existing?historicalPaid+newCollection:newCollection,liveNetPaid=existing?historicalNetPaid+newCollection:newCollection;");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"if(paymentSplits.some(x=>n(x.amount)>0&&x.method==='other'&&!String(x.customMethod||'').trim()))return 'اكتب طريقة الدفع الأخرى.';",
"if(paymentSplits.some(x=>n(x.amount)>0&&x.method==='other'&&!String(x.customMethod||'').trim()))return 'اكتب طريقة الدفع الأخرى.';if(walletCollection>n(walletSummary.balance)+0.001)return `رصيد محفظة العميل غير كافٍ. المتاح ${money(walletSummary.balance)}.`;");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"async function collectPaymentSplits(bookingNumber,startPaid){let cumulative=n(startPaid),receipts=[];for(const split of normalizedPaymentSplits){cumulative+=n(split.amount);const r=await api.admin({action:'update_booking',booking:{number:bookingNumber,paidAmount:cumulative,paymentMethod:split.method,paymentReference:split.reference}});if(r?.payment_receipt)receipts.push(r.payment_receipt)}if(normalizedPaymentSplits.length>1)await api.admin({action:'update_booking',booking:{number:bookingNumber,paidAmount:cumulative,paymentMethod:'mixed',paymentReference:null}});return receipts}",
"async function collectPaymentSplits(bookingNumber,startPaid){let cumulative=n(startPaid),receipts=[];for(let i=0;i<normalizedPaymentSplits.length;i++){const split=normalizedPaymentSplits[i];cumulative+=n(split.amount);let r;if(split.method==='wallet'){r=await api.admin({action:'wallet_pay_booking',booking_number:bookingNumber,amount:n(split.amount),target_paid:cumulative,reference:split.reference,idempotency_key:`wallet-pay-${bookingNumber}-${i}-${Math.round(cumulative*100)}`});setWalletSummary(x=>({...x,balance:n(r?.balance),loaded:true}));}else r=await api.admin({action:'update_booking',booking:{number:bookingNumber,paidAmount:cumulative,paymentMethod:split.method,paymentReference:split.reference}});if(r?.payment_receipt)receipts.push(r.payment_receipt)}if(normalizedPaymentSplits.length>1)await api.admin({action:'update_booking',booking:{number:bookingNumber,paidAmount:cumulative,paymentMethod:'mixed',paymentReference:null}});return receipts}");
replaceOne('src/modules/bookings/BookingEditor.jsx',
"إجمالي الدفعات الآن: {money(newCollection)}{normalizedPaymentSplits.length>1?' · دفع مختلط':''}</div>",
"إجمالي الدفعات الآن: {money(newCollection)}{normalizedPaymentSplits.length>1?' · دفع مختلط':''}{walletSummary.loaded?` · رصيد المحفظة المتاح: ${money(walletSummary.balance)}`:' · جاري قراءة رصيد المحفظة...'}</div>");
console.log('wallet UI/payment patch applied');
