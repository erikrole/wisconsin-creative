import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const source=await fs.readFile('/private/tmp/qr-print-audit-evidence/direct-print-probe/sdk-chain.js','utf8');
const job=JSON.parse(await fs.readFile('/private/tmp/qr-sdk-packet-verification.json','utf8'));
const shared=new Map();let ran=0,locked=false;
const storage={getItem:k=>shared.get(k)??null,setItem:(k,v)=>shared.set(k,v)};
const locks={request:async(_,options,callback)=>{if(locked)return callback(null);locked=true;try{return await callback({});}finally{locked=false;}}};
class Printer {constructor(device,record){this.record=record;} async open(){} async close(){} async ready(){} async run(packets,options){ran++;for(let index=0;index<packets.length;index++){if(options.shouldStop())return{stopped:true,sent:index};await this.record({kind:'send-intent',purpose:'page-'+index,bytes:packets[index].length});const persisted=JSON.parse(storage.getItem('qr-print-sdk-probe-v1'));assert.equal(persisted.pages[index].outcome,'sending-unknown');await options.afterPage(index);}return{stopped:false,sent:packets.length};}}
async function tab() {const elements=new Map();const context=vm.createContext({console,Uint8Array,atob,crypto:webcrypto,URL,Blob,setTimeout,clearTimeout,localStorage:storage,fetch:async()=>({json:async()=>structuredClone(job)}),navigator:{usb:{getDevices:async()=>[{vendorId:0x04f9,productId:0x20e1}]},locks},document:{querySelector:selector=>{if(!elements.has(selector))elements.set(selector,{textContent:'',scrollTop:0,scrollHeight:0,disabled:false});return elements.get(selector);}}});const module=new vm.SourceTextModule(source,{context});await module.link(()=>new vm.SyntheticModule(['SdkProbePrinter'],function(){this.setExport('SdkProbePrinter',Printer);},{context}));await module.evaluate();return elements;}
const first=await tab(),second=await tab();await first.get('#connect').onclick();await second.get('#connect').onclick();assert.equal(first.get('#run').disabled,false);assert.equal(second.get('#run').disabled,false);
await first.get('#run').onclick();assert.equal(ran,1);assert.equal(JSON.parse(storage.getItem('qr-print-sdk-probe-v1')).state,'awaiting-physical-review');const beforeRejectedRun=storage.getItem('qr-print-sdk-probe-v1');await second.get('#run').onclick();assert.equal(storage.getItem('qr-print-sdk-probe-v1'),beforeRejectedRun);assert.equal(ran,1);assert.equal(second.get('#run').disabled,true);
const reloaded=await tab();assert.equal(reloaded.get('#run').disabled,true);assert.equal(ran,1);
console.log('Cross-tab stale receipt blocked, per-page sending uncertainty persisted before output, and reload does not resume.');
