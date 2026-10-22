import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const source=await fs.readFile('/private/tmp/qr-print-audit-evidence/direct-print-probe/sdk-stop.js','utf8');
const job=JSON.parse(await fs.readFile('/private/tmp/qr-print-audit-evidence/direct-print-probe/sdk-stop-packets.json','utf8'));
const shared=new Map();let ran=0,sent=0,statusChecks=0,locked=false;
const storage={getItem:k=>shared.get(k)??null,setItem:(k,v)=>shared.set(k,v)};
const locks={request:async(_,options,callback)=>{if(locked)return callback(null);locked=true;try{return await callback({});}finally{locked=false;}}};
class Printer {constructor(device,record){this.record=record;} async open(){} async close(){} async ready(){await this.record({kind:'send-intent',purpose:'status-only',bytes:3});statusChecks++;} async run(packets,options){ran++;for(let index=0;index<packets.length;index++){if(options.shouldStop())return{stopped:true,sent:index};sent++;await this.record({kind:'send-intent',purpose:'page-'+index,bytes:packets[index].length});const persisted=JSON.parse(storage.getItem('qr-print-sdk-probe-v1'));assert.equal(persisted.pages[index].outcome,'sending-unknown');await options.afterPage(index);}return{stopped:false,sent:packets.length};}}
async function tab() {const elements=new Map();const context=vm.createContext({console,Uint8Array,atob,crypto:webcrypto,URL,Blob,setTimeout,clearTimeout,localStorage:storage,fetch:async()=>({json:async()=>structuredClone(job)}),navigator:{usb:{getDevices:async()=>[{vendorId:0x04f9,productId:0x20e1}]},locks},document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,{textContent:'',scrollTop:0,scrollHeight:0,disabled:false});return elements.get(selector);}}});const module=new vm.SourceTextModule(source,{context});await module.link(()=>new vm.SyntheticModule(['SdkProbePrinter'],function(){this.setExport('SdkProbePrinter',Printer);},{context}));await module.evaluate();return elements;}
const first=await tab();await first.get('#connect').onclick();const pending=first.get('#run').onclick();
await new Promise(resolve=>setTimeout(resolve,5));assert.equal(JSON.parse(storage.getItem('qr-print-sdk-probe-v1')).state,'paused-after-first-page');assert.equal(sent,1);
first.get('#stop').onclick();await pending;const receipt=JSON.parse(storage.getItem('qr-print-sdk-probe-v1'));assert.equal(sent,1);assert.equal(receipt.state,'stopped-physical-review-required');assert.deepEqual(receipt.pages.map(page=>page.outcome),['receive-phase-only','unsent','unsent']);
const reloaded=await tab();assert.equal(reloaded.get('#run').disabled,true);assert.equal(sent,1);
const newer=JSON.parse(storage.getItem('qr-print-sdk-probe-v1'));newer.finishAttempt={id:'retained-finish',state:'reserved'};storage.setItem('qr-print-sdk-probe-v1',JSON.stringify(newer));const protectedRaw=storage.getItem('qr-print-sdk-probe-v1'),beforeChecks=statusChecks;await first.get('#connect').onclick();assert.equal(storage.getItem('qr-print-sdk-probe-v1'),protectedRaw);assert.equal(statusChecks,beforeChecks);
console.log('Stale Stop-page connect preserves feed marker; controlled actual Stop handler sends one of three pages, retains two unsent, and reload never resumes.');
