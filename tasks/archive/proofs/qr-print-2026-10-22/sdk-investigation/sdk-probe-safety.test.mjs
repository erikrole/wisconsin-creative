import assert from 'node:assert/strict';
import {SdkProbePrinter} from './qr-print-audit-evidence/direct-print-probe/sdk-transport.mjs';
const frame=(type,phase=0,error=0)=>{const b=new Uint8Array(32);b.set([128,32,66]);b[8]=error;b[10]=12;b[11]=1;b[18]=type;b[19]=phase;b[24]=8;b[25]=1;return b;};
function fixture(frames,record=async()=>{}) {const sends=[];const alternate={alternateSetting:0,interfaceClass:7,endpoints:[{direction:'in',endpointNumber:1,type:'bulk'},{direction:'out',endpointNumber:2,type:'bulk'}]};const device={vendorId:0x04f9,productId:0x20e1,opened:false,configuration:{interfaces:[{interfaceNumber:0,alternate,alternates:[alternate]}]},async open(){this.opened=true;},async close(){this.opened=false;},async claimInterface(){},async transferOut(_,data){sends.push([...data]);return{status:'ok',bytesWritten:data.length};},async transferIn(){assert.ok(frames.length,'No unplanned read');const bytes=frames.shift();return{status:'ok',data:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)};}};return{printer:new SdkProbePrinter(device,record),device,sends};}
const packets=[Uint8Array.of(4,12),Uint8Array.of(5,26)];
{
 const f=fixture([frame(1),frame(6,1),frame(6),frame(6,1),frame(1),frame(6)]);
 let pages=0;await f.printer.open();const result=await f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>pages++});
 assert.deepEqual(result,{stopped:false,sent:2});assert.equal(pages,2);assert.deepEqual(f.sends,[[4,12],[5,26],[27,105,97,255]]);await f.printer.close();assert.equal(f.device.opened,false);
}
{
 const f=fixture([frame(1)]);let after=0;await f.printer.open();await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>after++}),/No unplanned read/);assert.equal(after,0);assert.deepEqual(f.sends,[[4,12]]);await f.printer.close();
}
{
 const f=fixture([],async()=>{throw Error('journal failure');});await f.printer.open();await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>{}}),/journal failure/);assert.equal(f.sends.length,0);await f.printer.close();
}
{
 const f=fixture([frame(6,1),frame(6)]);let stop=false;await f.printer.open();const result=await f.printer.run(packets,{shouldStop:()=>stop,afterPage:async()=>{stop=true;}});assert.deepEqual(result,{stopped:true,sent:1});assert.deepEqual(f.sends,[[4,12]]);await f.printer.close();
}
{
 const f=fixture([]);f.device.transferOut=async(_,data)=>{f.sends.push([...data]);return{status:'ok',bytesWritten:data.length-1};};await f.printer.open();await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>{}}),/Incomplete USB write/);assert.deepEqual(f.sends,[[4,12]]);await f.printer.close();
}
{
 const combined=new Uint8Array(64);combined.set(frame(6));combined.set(frame(2,0,4),32);const f=fixture([frame(6,1),combined]);await f.printer.open();await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>{}}),/Printer error/);assert.deepEqual(f.sends,[[4,12]]);await f.printer.close();
}
{
 const combined=new Uint8Array(64);combined.set(frame(0));combined.set(frame(6),32);
 const f=fixture([combined,frame(1)]);await f.printer.open();await f.printer.ready();assert.equal(f.printer.queue.length,0);
 await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>{}}),/No unplanned read/);assert.deepEqual(f.sends,[[27,105,83],[4,12]]);await f.printer.close();
}
{
 const combined=new Uint8Array(64);combined.set(frame(6));combined.set(frame(6,1),32);const f=fixture([frame(6,1),combined]);await f.printer.open();
 await assert.rejects(f.printer.run(packets,{shouldStop:()=>false,afterPage:async()=>{}}),/No unplanned read/);assert.deepEqual(f.sends,[[4,12]]);await f.printer.close();
}
{
 const f=fixture([]);let settle;f.device.open=()=>new Promise(resolve=>{settle=()=>{f.device.opened=true;resolve();};});let done=false;const pending=f.printer.open().then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,1));assert.equal(done,false);settle();await pending;await f.printer.close();assert.equal(f.device.opened,false);
}
console.log('9 SDK probe safety cases passed: receive-phase pacing, type1 rejection, durable-before-output, Stop, short write, trailing error.');
