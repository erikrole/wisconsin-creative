const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/print.js','utf8');
const job=JSON.parse(fs.readFileSync(__dirname+'/job.json','utf8'));
const frame=(type=0,phase=0)=>{const s=new Uint8Array(32);s.set([0x80,0x20,0x42]);s[10]=12;s[11]=1;s[18]=type;s[19]=phase;s[24]=8;s[25]=1;return s;};
async function run(shortWrite=false){
  const messages=[],sent=[],states=new Map(),print={disabled:true};
  const sequence=[frame(),frame(),new Uint8Array(),frame(),...Array.from({length:22},()=>new Uint8Array()),frame(6,1),...Array.from({length:22},()=>new Uint8Array()),frame(1,0)];
  const device={opened:true,vendorId:0x04f9,productId:0x20e1,
    async transferIn(endpoint,length){assert.equal(endpoint,1);assert.ok(length===32||length===64);const data=sequence.shift();assert.ok(data,'Unexpected extra read');return {status:'ok',data:new DataView(data.buffer)};},
    async transferOut(endpoint,bytes){assert.equal(endpoint,2);sent.push(Array.from(bytes));return {status:'ok',bytesWritten:shortWrite&&bytes[0]===0x47?0:bytes.length};},
    async close(){this.opened=false;},async clearHalt(){throw new Error('Unexpected halt');}};
  const context={document:{querySelector:()=>print},window:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>structuredClone(job)}),localStorage:{getItem:k=>states.get(k),setItem:(k,v)=>states.set(k,v)},usbDevice:device,usbIn:1,usbOut:2,usb:{},query:{},connect:{},close:{},log:s=>messages.push(s),setTimeout,clearTimeout,Date,Uint8Array,atob};
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof print.onclick,'function');
  await print.onclick();
  assert.equal(device.opened,false);
  const count=sent.length;await print.onclick();assert.equal(sent.length,count,'Consumed attempt must not resend');
  if(shortWrite){assert.equal(states.get('qr-print-proof:'+job.id),'started');assert.equal(sent.filter(b=>b[0]===0x1a).length,0);assert.ok(messages.some(s=>s.includes('No automatic retry')));}
  else{
    assert.equal(states.get('qr-print-proof:'+job.id),'completed');assert.ok(messages.some(s=>s.includes('PRINTER COMPLETED')));
    const rows=sent.filter(b=>b[0]===0x47);assert.equal(rows.length,job.width);
    rows.forEach((row,i)=>{assert.deepEqual(row.slice(0,3),[0x47,16,0]);assert.deepEqual(row.slice(3),Array.from(Buffer.from(job.rasters[i],'base64')));});
    assert.equal(sent.filter(b=>b[0]===0x1a).length,1);
  }
  return {case:shortWrite?'Short raster write stops without retry':'Empty packets and phase notification precede completion',outTransfers:sent.length,finalCommands:sent.filter(b=>b[0]===0x1a).length,state:states.get('qr-print-proof:'+job.id),closed:!device.opened};
}
(async()=>{const results=[await run(),await run(true)];fs.writeFileSync(__dirname+'/sender-verification.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));})().catch(e=>{console.error(e);process.exit(1);});
