const {createRequire}=require('node:module'),fs=require('node:fs'),assert=require('node:assert/strict');
const req=createRequire('/Users/role/.codex/worktrees/qr-print-audit/wisconsin-creative/package.json');
const {chromium,expect}=req('@playwright/test'),sharp=req('sharp');
const jsQR=req('/Users/role/.codex/worktrees/qr-print-audit/wisconsin-creative/public/qrcode/vendor/jsQR.js');
const root='/private/tmp/qr-print-audit-evidence';
const fake=()=>{
 const frame=(type=0)=>{const b=new Uint8Array(32);b.set([128,32,66]);b[10]=12;b[11]=1;b[18]=type;b[24]=8;b[25]=1;return b;};
 const device={vendorId:0x04f9,productId:0x20e1,opened:false,configuration:{interfaces:[{interfaceNumber:0,alternates:[{alternateSetting:0,interfaceClass:7,endpoints:[{direction:'in',endpointNumber:1,type:'bulk'},{direction:'out',endpointNumber:2,type:'bulk'}]}]}]},
 async open(){this.opened=true;},async close(){this.opened=false;},async selectConfiguration(){},async claimInterface(){},async selectAlternateInterface(){},async clearHalt(){},
 async transferOut(_ep,data){window.usbWrites.push(Array.from(data));const s=Array.from(data).join();if(s==='27,105,83')window.usbReads.push(frame());if(s==='27,105,97,1')window.usbReads.push(new Uint8Array());if(s==='26'){window.finalized++;window.usbReads.push(frame(6),frame(1));}if(data[0]===71&&window.finalized===window.failAfter)return{status:'ok',bytesWritten:2};return{status:'ok',bytesWritten:data.length};},
 async transferIn(){const b=window.usbReads.shift();if(!b)throw Error('Unexpected mock read');if(b[18]===1&&window.slowComplete)await new Promise(r=>setTimeout(r,300));return{status:'ok',data:new DataView(b.buffer)};}};
 window.usbWrites=[];window.usbReads=[];window.finalized=0;window.failAfter=1;window.slowComplete=false;window.holdChoose=false;
 const usb=new EventTarget();usb.getDevices=async()=>[];usb.requestDevice=()=>window.holdChoose?new Promise(resolve=>{window.releaseChoose=()=>resolve(device);}):Promise.resolve(device);
 Object.defineProperty(navigator,'usb',{value:usb,configurable:true});
};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1100},locale:'en-US',timezoneId:'America/Chicago',reducedMotion:'reduce',colorScheme:'light'});
 await context.addInitScript(fake);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto('http://127.0.0.1:3145/dev-labels?device-proof=1');assert.match(response.headers()['permissions-policy'],/usb=\(self\)/);
 await page.getByRole('button',{name:'Add serialized item FB FX3 1 to the print sheet',exact:true}).click();
 await expect(page.locator('#print-sheet img')).toHaveCount(1);
 const src=await page.locator('#print-sheet img').getAttribute('src');fs.writeFileSync(root+'/integrated-label.png',Buffer.from(src.split(',')[1],'base64'));
 const {data,info}=await sharp(root+'/integrated-label.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'attemptBoth'});assert.equal(decoded.data,'c62a82d7');
 const approved=await sharp(root+'/direct-print-probe/label-proof.png').ensureAlpha().raw().toBuffer();let differences=0;for(let i=0;i<data.length;i+=4)if(data[i]!==approved[i])differences++;
 assert.ok(differences<20); // Exact glyph paths; browser edge rasterization may differ from Sharp.
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByRole('button',{name:'Add numbered family Sony NP-FZ100 Battery at Cage to the print sheet',exact:true}).click();
 await page.getByRole('radio',{name:'Unit labels',exact:true}).click();await page.getByRole('radio',{name:'Pick numbers',exact:true}).click();await page.getByRole('textbox',{name:'Unit numbers of Sony NP-FZ100 Battery to print',exact:true}).fill('37-39');
 await page.getByRole('button',{name:'Connect USB',exact:true}).click();await expect(page.getByText('Ready · 12 mm white-on-black tape',{exact:true})).toBeVisible();
 const other=await context.newPage();await other.goto('http://127.0.0.1:3145/dev-labels');await other.evaluate(()=>window.holdChoose=true);await other.getByRole('button',{name:'Connect USB',exact:true}).click();
 await page.getByRole('button',{name:'Print 3 labels',exact:true}).click();
 await expect(page.getByText('1 of 3 labels completed',{exact:true})).toBeVisible();await expect(page.getByText(/Completion of label 2 is unknown/)).toBeVisible();
 const partial=await page.evaluate(()=>({finalized:window.finalized,writes:window.usbWrites}));assert.equal(partial.finalized,1);assert.equal(partial.writes.filter(b=>b[0]===71).length,195);
 await other.evaluate(()=>window.releaseChoose());await expect(other.getByText(/Check the previous physical label/)).toBeVisible();assert.equal(await other.evaluate(()=>window.usbWrites.length),0);
 await page.evaluate(()=>{window.markCalls=[];const original=window.fetch;window.fetch=(input,init)=>{if(String(input).endsWith('/units/labels')&&init?.method==='POST')window.markCalls.push(JSON.parse(init.body));return original(input,init);};});await page.getByRole('button',{name:'Mark 1 printed',exact:true}).click();assert.deepEqual((await page.evaluate(()=>window.markCalls))[0].unitNumbers,[37]);
 await page.reload();await expect(page.getByText(/Completion of label 2 is unknown/)).toBeVisible();await expect(page.getByRole('button',{name:'Connect USB',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'I checked the labels · New batch',exact:true}).click();
 await page.getByRole('textbox',{name:'Unit numbers of Sony NP-FZ100 Battery to print',exact:true}).fill('38-39');await page.evaluate(()=>{window.failAfter=-1;window.slowComplete=true;});
 await page.getByRole('button',{name:'Connect USB',exact:true}).click();await page.getByRole('button',{name:'Print 2 labels',exact:true}).click();await expect(page.getByText(/Printing 1 of 2/)).toBeVisible();await page.getByRole('button',{name:'Stop after current label',exact:true}).click();await expect(page.getByText('1 of 2 labels completed',{exact:true})).toBeVisible();await expect(page.getByText('The batch stopped. Remaining labels were not sent.',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.finalized),1);
 const defaultHeader=await context.request.get('http://127.0.0.1:3145/login');assert.match(defaultHeader.headers()['permissions-policy'],/usb=\(\)/);
 for(const width of[768,390]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);
 fs.writeFileSync(root+'/usb-ui-verification.json',JSON.stringify({bitmap:{width:info.width,height:info.height,decodedQr:decoded.data,approvedPixelDifferences:differences},partialBatch:'1 completed, second unknown, third not sent',concurrentChooser:'zero USB writes after uncertain other-tab batch',recovery:'receipt survives reload; explicit physical review required',appliedMutationUnitNumbers:[37],stop:'first label completes; second not sent',permissions:'USB allowed only on labels/dev fixture; denied on login',widths:[1440,768,390],pageErrors:errors},null,2));
 await browser.close();console.log('USB UI checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
