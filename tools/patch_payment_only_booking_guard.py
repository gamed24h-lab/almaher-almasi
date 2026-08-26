from pathlib import Path
p=Path('worker/booking-cycle-guard-index.js')
s=p.read_text()
old="function bookingInput(path,body){if(path==='/api/customer/book')return body?.booking||{};if(path==='/api/admin'&&s(body?.action)==='update_booking')return body?.booking||{};return null}\n"
new="""function isPaymentOnlyBookingUpdate(path,body){
 if(path!=='/api/admin'||s(body?.action)!=='update_booking')return false;
 const b=body?.booking;if(!b||typeof b!=='object'||Array.isArray(b))return false;
 const keys=Object.keys(b);
 const allowed=new Set(['number','booking_number','paidAmount','paid_amount','paymentMethod','payment_method','paymentReference','payment_reference']);
 const hasPaymentField=keys.some(k=>['paidAmount','paid_amount','paymentMethod','payment_method','paymentReference','payment_reference'].includes(k));
 return hasPaymentField&&keys.every(k=>allowed.has(k));
}
function bookingInput(path,body){if(path==='/api/customer/book')return body?.booking||{};if(path==='/api/admin'&&s(body?.action)==='update_booking'&&!isPaymentOnlyBookingUpdate(path,body))return body?.booking||{};return null}
"""
if old not in s:
    raise SystemExit('target bookingInput not found')
s=s.replace(old,new,1)
p.write_text(s)
