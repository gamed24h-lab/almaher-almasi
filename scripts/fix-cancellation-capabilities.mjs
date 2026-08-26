import fs from 'node:fs';
const p='worker/wallet-cancellation-index.js';
let s=fs.readFileSync(p,'utf8');
const from="const canDirect=permitted(me,'refunds')||permitted(me,'refund_complete');\n   const canWallet=canDirect||permitted(me,'walletCredit');";
const to="const manager=me.role==='developer'||me.role==='مدير عام'||me.permissions?.all===true||me.permissions?.allBranchesFinance===true;\n   const canApprove=manager||me.permissions?.refund_approve===true||(me.permissions?.refunds===true&&me.permissions?.approvals===true);\n   const canComplete=manager||me.permissions?.refund_complete===true||me.permissions?.refunds===true;\n   const canDirect=canApprove&&canComplete;\n   const canWallet=canDirect;";
if(!s.includes(from))throw new Error('capability anchor missing');
s=s.replace(from,to);
fs.writeFileSync(p,s);
