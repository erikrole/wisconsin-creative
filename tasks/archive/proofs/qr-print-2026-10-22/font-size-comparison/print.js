// Isolated, one-job PT-D610BT USB proof. Protocol facts cross-checked against
// https://git.familie-radermacher.ch/linux/ptouch-print.git/tree/src/libptouch.c
// and ptouch-print.c. This does not use P-touch or an installed print driver.
(async()=>{
  const print=document.querySelector('#print-one');
  const job=await fetch('/job.json').then(r=>{if(!r.ok)throw new Error('Print job could not load.');return r.json();});
  if(job.vendorId!==0x04f9||job.productId!==0x20e1||job.tapeWidthMm!==12||job.width!==194||job.height!==76||job.qr!=='c62a82d7'||job.cellDots!==3||job.verifiedPostScriptName!=='GothamXNarrow-Bold'||job.rasters.length!==job.width)throw new Error('Unexpected print job or unverified font.');
  const rasters=job.rasters.map(s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)));
  if(rasters.some(r=>r.length!==16))throw new Error('Invalid raster line size.');
  const key='qr-print-proof:'+job.id;
  const allowPrint=()=>{print.disabled=!usbDevice?.opened||Boolean(localStorage.getItem(key));};
  window.addEventListener('printer-usb-open',allowPrint);
  allowPrint();
  const bounded=async(promise,label,ms=8000)=>{
    let timer;
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out; completion may be uncertain.')),ms);})]);}
    finally{clearTimeout(timer);}
  };
  const send=async bytes=>{
    const r=await bounded(usbDevice.transferOut(usbOut,new Uint8Array(bytes)),'USB write');
    if(r.status!=='ok'||r.bytesWritten!==bytes.length)throw new Error('Incomplete USB write.');
  };
  let backlog=[];
  const read=async(ms=8000)=>{
    const deadline=Date.now()+ms;
    let emptyPackets=0;
    while(backlog.length<32){
      if(Date.now()>=deadline)throw new Error('USB status timed out.');
      const r=await bounded(usbDevice.transferIn(usbIn,64),'USB status',deadline-Date.now());
      if(r.status!=='ok')throw new Error('Failed USB status response: '+JSON.stringify({status:r.status,bytes:r.data?.byteLength??0}));
      if(!r.data?.byteLength){if(++emptyPackets===1)log('Waiting for a full printer status frame…');await new Promise(resolve=>setTimeout(resolve,50));continue;}
      if(emptyPackets)log('Received status after '+emptyPackets+' empty USB packets.');
      backlog.push(...new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength));
    }
    const s=backlog.splice(0,32);
    if(s[0]!==0x80||s[1]!==0x20||s[2]!==0x42)throw new Error('Unrecognized printer response.');
    log('Printer status '+JSON.stringify({type:s[18],phase:s[19],error1:s[8],error2:s[9],tapeWidthMm:s[10]}));
    if(s[8]||s[9])throw new Error('Printer reported an error.');
    if(s[10]!==12)throw new Error('Printer tape changed; expected 12 mm.');
    return s;
  };
  print.onclick=async()=>{
    if(localStorage.getItem(key))return;
    print.disabled=usb.disabled=query.disabled=connect.disabled=close.disabled=true;
    let started=false,finished=false;
    try{
      if(!usbDevice?.opened||usbDevice.vendorId!==job.vendorId||usbDevice.productId!==job.productId)throw new Error('Connect the expected USB Brother first.');
      await send([0x1b,0x69,0x53]);
      const preflight=await read();
      if(preflight[18]!==0||preflight[19]!==0)throw new Error('Printer is not idle.');
      if(preflight[11]!==1||preflight[24]!==8||preflight[25]!==1)throw new Error('Expected laminated white-on-black tape.');
      localStorage.setItem(key,'started');started=true;
      log('Starting ONE '+job.tag+' label. QR '+job.qr+'; Gotham XNarrow Bold; 3 dots per QR cell.');
      await send([...new Uint8Array(100),0x1b,0x40]);
      await send([0x1b,0x69,0x53]);await read();
      await send([0x1b,0x69,0x61,0x01]);
      // D610BT may end the mode-switch drain with a zero-length packet or
      // a stalled IN endpoint rather than a status frame. The upstream driver
      // ignores this optional drain result. Verify an explicit status afterward.
      const mode=await bounded(usbDevice.transferIn(usbIn,32),'Raster-mode drain',1500);
      log('Raster-mode drain: '+JSON.stringify({status:mode.status,bytes:mode.data?.byteLength??0}));
      if(mode.status==='stall')await usbDevice.clearHalt('in',usbIn);
      else if(mode.status!=='ok')throw new Error('Raster-mode USB drain failed.');
      if(mode.data?.byteLength){backlog.push(...new Uint8Array(mode.data.buffer,mode.data.byteOffset,mode.data.byteLength));await read();}
      await send([0x1b,0x69,0x53]);await read();
      await send([0x1b,0x69,0x7a,0,0,12,0,job.width&255,(job.width>>8)&255,0,0,2,0]);
      await send([0x1b,0x69,0x64,1,0,0x4d,0]);
      // Cut the initial blank leader before the label, then cut after printing.
      await send([0x1b,0x69,0x4d,0x40]);
      for(const row of rasters)await send([0x47,16,0,...row]);
      await send([0x1a]);
      log('One complete raster job sent. Waiting for printer completion.');
      const deadline=Date.now()+20000;
      while(Date.now()<deadline){const s=await read(Math.min(8000,deadline-Date.now()));if(s[18]===1){finished=true;break;}}
      if(!finished)throw new Error('Printer completion was not confirmed.');
      localStorage.setItem(key,'completed');
      log('PRINTER COMPLETED: one '+job.tag+' label. Physical scan confirmation is still required.');
    }catch(error){log(error.name+': '+error.message);if(started)log('No automatic retry. Check the physical label before another attempt.');}
    finally{
      // Closing aborts any timed-out pending IN transfer before further access.
      if(usbDevice?.opened)await usbDevice.close().catch(()=>{});
      usb.disabled=connect.disabled=false;query.disabled=close.disabled=true;allowPrint();
    }
  };
})().catch(error=>log('Print preparation error: '+error.message));
