export class SdkProbePrinter {
  constructor(device, record, clock=()=>Date.now()) { this.device=device; this.record=record; this.clock=clock; this.queue=[]; this.input=0; this.output=0; }
  async bounded(promise, milliseconds=8000) { let timer; try { return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('USB timeout; physical output is uncertain.')),milliseconds))]); } finally { clearTimeout(timer); } }
  async open() {
    if(this.device.vendorId!==0x04f9||this.device.productId!==0x20e1) throw Error('Select PT-D610BT.');
    await this.device.open();
    if(!this.device.configuration) await this.device.selectConfiguration(1);
    const match=this.device.configuration.interfaces.flatMap(i=>i.alternates.map(a=>({i,a}))).find(({a})=>a.interfaceClass===7&&['in','out'].every(d=>a.endpoints.some(e=>e.type==='bulk'&&e.direction===d)));
    if(!match) throw Error('No printer bulk interface.');
    await this.device.claimInterface(match.i.interfaceNumber);
    if(match.i.alternate?.alternateSetting!==match.a.alternateSetting) await this.device.selectAlternateInterface(match.i.interfaceNumber,match.a.alternateSetting);
    this.input=match.a.endpoints.find(e=>e.direction==='in'&&e.type==='bulk').endpointNumber;
    this.output=match.a.endpoints.find(e=>e.direction==='out'&&e.type==='bulk').endpointNumber;
  }
  async close() { if(this.device.opened) await this.device.close(); this.queue=[]; }
  async send(bytes, purpose) {
    // Any persistence exception prevents the corresponding USB write. Never retry.
    await this.record({kind:'send-intent',purpose,bytes:bytes.length});
    const response=await this.bounded(this.device.transferOut(this.output,bytes));
    if(response.status!=='ok'||response.bytesWritten!==bytes.length) throw Error('Incomplete USB write; no retry.');
    await this.record({kind:'send-return',purpose,bytesWritten:response.bytesWritten});
  }
  async read(deadline) {
    while(this.queue.length<32) {
      const remaining=deadline-this.clock(); if(remaining<=0) throw Error('No receive-phase confirmation; physical output is uncertain.');
      const response=await this.bounded(this.device.transferIn(this.input,64),remaining);
      if(response.status!=='ok') throw Error('USB status read failed.');
      if(response.data?.byteLength) this.queue.push(...new Uint8Array(response.data.buffer,response.data.byteOffset,response.data.byteLength));
      else await new Promise(resolve=>setTimeout(resolve,25));
    }
    const frame=this.queue.splice(0,32);
    await this.record({kind:'status',frame});
    if(frame[0]!==128||frame[1]!==32||frame[2]!==66) throw Error('Unrecognized printer status.');
    if(frame[8]||frame[9]) throw Error('Printer error '+frame[8]+'/'+frame[9]+'.');
    if(frame[10]!==12||frame[11]!==1||frame[24]!==8||frame[25]!==1) throw Error('Load 12 mm laminated white-on-black tape.');
    return frame;
  }
  async ready() {
    const deadline=this.clock()+8000;
    await this.send(Uint8Array.of(27,105,83),'status-only');
    while(this.clock()<deadline) {
      const frame=await this.read(deadline);
      if(frame[18]!==0) continue;
      if(frame[19]||frame[20]||frame[21]) throw Error('Printer is busy or feeding.');
      // Consume every byte already received beside the fresh status reply.
      while(this.queue.length) {
        const trailing=await this.read(deadline);
        if((trailing[18]===6&&trailing[19]===1)||(trailing[18]===0&&(trailing[19]||trailing[20]||trailing[21]))) throw Error('Printer is still printing or feeding.');
      }
      return;
    }
    throw Error('Readiness not confirmed.');
  }
  async receivePhase() {
    const deadline=this.clock()+45000;
    let sawPrinting=false,phase;
    while(this.clock()<deadline) {
      const frame=await this.read(deadline);
      // Stricter correlation than native mode3: observe this page enter printing
      // before accepting receive phase. A queued old phase0 cannot advance it.
      if(frame[18]===6) {
        if(frame[19]===1) { sawPrinting=true; phase=1; }
        else if(frame[19]===0&&sawPrinting) phase=0;
      }
      // Process trailing frames first; receive->printing is not a settled page.
      if(sawPrinting&&phase===0&&this.queue.length===0) return;
    }
    throw Error('Current-page printing/receive transition not confirmed.');
  }
  async run(packets,{shouldStop,afterPage}) {
    for(let index=0;index<packets.length;index++) {
      if(shouldStop()) return {stopped:true,sent:index};
      await this.send(packets[index],'page-'+index);
      await this.receivePhase();
      await afterPage(index);
    }
    // Native SDK sends this only after the final receive-phase wait.
    await this.send(Uint8Array.of(27,105,97,255),'native-end-mode');
    return {stopped:false,sent:packets.length};
  }
}
