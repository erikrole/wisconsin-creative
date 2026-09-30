import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const proof=resolve('tasks/archive/proofs/bh-photo-handoff-2026-09-29');
const owner=resolve('src/components/ChooseImageModal.tsx');
const css=(await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})).css;
const bundles={},hashes={};
for(const variant of ['before','after']) {
 const source=await readFile(variant==='before'?resolve(proof,'before-modal.txt'):owner,'utf8');
 hashes[variant]=createHash('sha256').update(source).update(await readFile('src/lib/image-search-modal.ts','utf8')).update(await readFile('src/lib/bhphoto-image.ts','utf8')).digest('hex');
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import ChooseImageModal from ${JSON.stringify(owner)};import {ConfirmProvider} from ${JSON.stringify(resolve('src/components/ConfirmDialog.tsx'))};createRoot(document.getElementById('root')).render(<ConfirmProvider><ChooseImageModal mode="draft" open onClose={()=>{}} initialSelection={null} searchQuery="Sony FX3" onDraftChanged={image=>window.__selected=image}/></ConfirmProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':resolve('src')},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'baseline',setup(b){if(variant==='before')b.onLoad({filter:/ChooseImageModal\.tsx$/},()=>({contents:source,loader:'tsx',resolveDir:dirname(owner)}));}}]});bundles[variant]=result.outputFiles[0].text;
}
const server=createServer((req,res)=>{const variant=req.url.includes('before')?'before':'after';if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(bundles[variant]);}else{res.setHeader('Content-Type','text/html');res.end(`<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/${variant}.js"></script></body></html>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();const results=[];
try{
 for(const variant of ['before','after'])for(const width of [1280,768,390]) {
 const page=await browser.newPage({viewport:{width,height:900},colorScheme:'light',locale:'en-US',timezoneId:'America/Chicago',reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/image-search**',r=>r.fulfill({json:{data:{configured:false,results:[]}}}));
 await page.route('https://static.bhphoto.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="40" y="65" width="120" height="75" rx="8" fill="#333"/><circle cx="105" cy="104" r="35" fill="#555"/><circle cx="105" cy="104" r="24" fill="#111"/></svg>'}));
 await page.route('https://www.bhphotovideo.com/c/product/**',r=>r.fulfill({contentType:'text/html',body:'<html>product page</html>'}));
 await page.clock.setFixedTime(new Date('2026-09-29T19:00:00Z'));
 await page.goto(`http://127.0.0.1:${server.address().port}/${variant}`);
 await expect(page.getByRole('tab',{name:'Paste URL'})).toBeVisible();
 if(variant==='after') {
 await expect(page.locator('#bh-product-search')).toHaveValue('Sony FX3');
 const link=page.getByRole('link',{name:/Search B&H/});assert.equal(new URL(await link.getAttribute('href')).searchParams.get('Ntt'),'Sony FX3');
 await page.locator('#bh-product-search').fill('Canon RF 24-70mm & hood');assert.equal(new URL(await link.getAttribute('href')).searchParams.get('Ntt'),'Canon RF 24-70mm & hood');
 await page.locator('#bh-product-search').fill('');await expect(page.getByRole('button',{name:'Search B&H'})).toBeDisabled();await page.locator('#bh-product-search').fill('Sony FX3');
 await page.locator('#image-url').fill('https://www.bhphotovideo.com/c/product/1631061-REG/sony_fx3.html');await expect(page.getByRole('alert')).toContainText('image address');await expect(page.getByRole('button',{name:'Use image'})).toBeDisabled();await page.locator('#image-url').fill('');
 }
 await page.locator('#image-url').focus();
 const name=`${variant}-${width}`;await page.screenshot({path:resolve(proof,name+'.png'),animations:'disabled'});
 await writeFile(resolve(proof,name+'-metadata.json'),JSON.stringify({sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourcePatchSha256:hashes[variant],settings:{device:'Chromium desktop',viewport:[width,900],fixture:'bh-photo-handoff-v1-provider-unconfigured',role:'staff fixture',route:'/items/choose-image',appearance:'light',textSize:'default',locale:'en-US',timezone:'America/Chicago',clock:'2026-09-29T19:00:00Z',scroll:[0,0]}},null,2));
 if(variant==='after'){
 await page.locator('#image-url').fill(' https://www.bhphotovideo.com/images/images500x500/sony_fx3.jpg ');await expect(page.getByRole('button',{name:'Use image'})).toBeEnabled();await page.getByRole('button',{name:'Use image'}).click();const selection=await page.evaluate(()=>window.__selected);assert.equal(selection.url,'https://static.bhphoto.com/images/images500x500/sony_fx3.jpg');
 }
 assert.deepEqual(errors,[]);results.push({variant,width,errors,providerConfigured:false,manualImageSelected:variant==='after'});await page.close();
 }
 await writeFile(resolve(proof,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.close();}
