const crypto=require('crypto');
function b64url(v){return Buffer.from(v).toString('base64url')}
function issue(payload,secret,ttlSeconds=43200){
 const body={...payload,exp:Math.floor(Date.now()/1000)+ttlSeconds};
 const enc=b64url(JSON.stringify(body));
 const sig=crypto.createHmac('sha256',secret).update(enc).digest('base64url');
 return `${enc}.${sig}`;
}
function verify(token,secret){
 try{
  const [enc,sig]=String(token||'').split('.');if(!enc||!sig)return null;
  const expected=crypto.createHmac('sha256',secret).update(enc).digest('base64url');
  if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
  const body=JSON.parse(Buffer.from(enc,'base64url').toString('utf8'));
  if(!body.exp||body.exp<Math.floor(Date.now()/1000))return null;
  return body;
 }catch{return null}
}
module.exports={issue,verify};
