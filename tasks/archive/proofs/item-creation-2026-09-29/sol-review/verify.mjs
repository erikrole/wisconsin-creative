import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const proof=resolve('tasks/archive/proofs/item-creation-2026-09-29/sol-review');
const owner=resolve('src/app/(app)/items/new-item-sheet.tsx');
const css=(await postcss([tailwind()]).process(await readFile('src/app/globals.css','utf8'),{from:resolve('src/app/globals.css')})).css;
const sourceFiles=[owner,resolve('src/app/(app)/items/new-item-sheet/SerializedItemForm.tsx'),resolve('src/app/(app)/items/new-item-sheet/BulkItemForm.tsx')];
const bundles={};const hashes={};
for(const variant of ['before','after']) {
 const snapshot=await Promise.all(sourceFiles.map(p=>readFile(variant==='before'?resolve(proof,p===owner?'before-sheet.txt':'before-'+p.split('/').at(-1).replace('.tsx','.txt')):p,'utf8')));
 hashes[variant]=createHash('sha256').update(snapshot.join('\n')).digest('hex');
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NewItemSheet} from ${JSON.stringify(owner)};import {ConfirmProvider} from ${JSON.stringify(resolve('src/components/ConfirmDialog.tsx'))};createRoot(document.getElementById('root')).render(<ConfirmProvider><NewItemSheet open onOpenChange={(value)=>{window.__closed=!value}} onCreated={()=>{}} sourceAssetId={new URLSearchParams(location.search).has('copy')?'source':null} locations={[{id:'location',name:'Studio'}]} departments={[]} categories={[{id:'category',name:'Camera',parentId:null}]} /></ConfirmProvider>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':resolve('src')},define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useRouter=()=>({push(){},replace(){},refresh(){}});'}));
 if(variant==='before') b.onLoad({filter:/(?:new-item-sheet|SerializedItemForm|BulkItemForm)\.tsx$/},async a=>({contents:snapshot[sourceFiles.indexOf(a.path)],loader:'tsx',resolveDir:dirname(a.path)}));
 }}]}); bundles[variant]=result.outputFiles[0].text;
}
const server=createServer((req,res)=>{if(req.url.endsWith('.js')){res.setHeader('Content-Type','text/javascript');res.end(bundles[req.url.includes('before')?'before':'after']);return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/${req.url.includes('before')?'before':'after'}.js"></script></body></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();const results=[];
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
async function capture(page,variant,width,scenario){
 const name=`${variant}-${scenario}-${width}`;await page.screenshot({animations:'disabled',path:resolve(proof,name+'.png')});
 const scroll=await page.locator('[data-slot="sheet-body"]').evaluateAll(els=>els.map(el=>[el.scrollLeft,el.scrollTop]));
 const meta={sourceRevision:revision,sourcePatchSha256:hashes[variant],settings:{device:'Chromium desktop',viewport:[width,1000],fixture:'sol-item-recovery-v1',role:'staff fixture',route:'/items/'+scenario,appearance:'light',textSize:'default',locale:'en-US',timezone:'America/Chicago',clock:'2026-09-29T17:00:00Z',scroll:scroll[0] ?? [0,0]}};
 await writeFile(resolve(proof,name+'-metadata.json'),JSON.stringify(meta,null,2));
}
async function setup(variant,width,copy=false){const page=await browser.newPage({viewport:{width,height:1000},colorScheme:'light',locale:'en-US',timezoneId:'America/Chicago',reducedMotion:'reduce'}); const errors=[];page.on('pageerror',e=>errors.push(e.message));const posts=[];
 await page.route('**/api/**',async r=>{const req=r.request();if(req.method()==='POST'&&req.url().endsWith('/api/assets')){const body=req.postDataJSON();posts.push(body);return r.fulfill(posts.length===1?{json:{data:{id:'created-first'}}}:{status:409,json:{error:'Asset tag already in use'}});}if(req.url().endsWith('/api/assets/source'))return r.fulfill({json:{data:{id:'source',assetTag:'CAM 10',name:'Camera',brand:'Sony',model:'FX3',category:{id:'category'},location:{id:'location'},imageUrl:'https://example.com/image.png'}}});return r.fulfill({json:{data:[]}});});
 await page.route('https://example.com/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="gray"/></svg>'}));
 await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));await page.goto(`http://127.0.0.1:${server.address().port}/${variant}${copy?'?copy':''}`);await page.locator('#new-item-asset-tag').waitFor();return {page,errors,posts};}
async function choose(page,id,label){await page.locator(id).click();await page.getByRole('option',{name:label,exact:true}).click();}
try{
 for(const variant of ['before','after'])for(const width of [1280,768,390]){
  const {page,errors,posts}=await setup(variant,width);
  await page.locator('#new-item-asset-tag').fill('CAM 17');await expect(page.locator('#new-item-asset-tag')).toHaveValue('CAM 17');
  await page.locator('#new-item-qr-code').fill('QR-FIRST');await choose(page,'#new-item-category','Camera');await choose(page,'#new-item-location','Studio');
  await page.locator('#new-item-batch-size').fill('2');
  await expect(page.locator('#new-item-asset-tag-unit-primary')).toHaveValue('CAM 17');
  await expect(page.locator('#new-item-asset-tag-batch-unit-1')).toHaveValue('CAM 18');
  await page.getByRole('button',{name:/Shipment details/}).count();
  await page.locator('#new-item-notes').fill('Keep shipment note');await expect(page.locator('#new-item-notes')).toHaveValue('Keep shipment note');
  await page.getByRole('button',{name:'Create 2 items',exact:true}).click();await page.getByRole('button',{name:'Fix 1 remaining',exact:true}).waitFor();
  assert.deepEqual(posts.map(p=>p.assetTag),['CAM 17','CAM 18']);
  if(variant==='after'){
   assert.equal(await page.locator('#new-item-form').isVisible(),false);
   await page.locator('#new-item-form').evaluate(el=>el.requestSubmit());assert.equal(posts.length,2);
   await page.getByRole('button',{name:'Return to list',exact:true}).click();await page.getByRole('alertdialog').waitFor();
   await page.getByRole('button',{name:'Keep editing',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'detached'});
  }
  await page.getByRole('button',{name:'Fix 1 remaining',exact:true}).click();await page.locator('#new-item-asset-tag').waitFor();
  const recoveredTag=await page.locator('#new-item-asset-tag').inputValue();
  await page.locator('#new-item-asset-tag').evaluate(el=>el.closest('[data-slot="sheet-body"]')?.scrollTo({top:0}));
  await capture(page,variant,width,'recovered');
  if(variant==='after'){
   assert.equal(recoveredTag,'CAM 18');await page.getByRole('button',{name:/Purchasing & notes/}).click();await expect(page.locator('#new-item-notes')).toHaveValue('Keep shipment note');
   await page.getByRole('button',{name:'Create item',exact:true}).click();await expect(page.locator('#new-item-asset-tag')).toBeFocused();
   assert.deepEqual(posts.map(p=>p.assetTag),['CAM 17','CAM 18','CAM 18']);
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Discard item',exact:true}).click();await page.waitForFunction(()=>window.__closed===true);
  }
  assert.deepEqual(errors,[]);results.push({variant,width,scenario:'partial-batch',recoveredTag,posts:posts.map(p=>p.assetTag),errors});await page.close();
  const copy=await setup(variant,width,true);
  await expect(copy.page.locator('#new-item-asset-tag')).toHaveValue('CAM 11');await copy.page.locator('#new-item-asset-tag').fill('COPY EDIT');await expect(copy.page.locator('#new-item-asset-tag')).toHaveValue('COPY EDIT');
  await copy.page.locator('[data-slot="sheet-body"]').evaluate(el=>el.scrollTo({top:0}));await capture(copy.page,variant,width,'copy-details');
  await copy.page.getByRole('button',{name:'Start a different item',exact:true}).click();
  if(variant==='after'){
   await copy.page.getByRole('alertdialog').waitFor();await capture(copy.page,variant,width,'copy-reset');
   await copy.page.getByRole('button',{name:'Keep editing',exact:true}).click();await copy.page.getByRole('alertdialog').waitFor({state:'detached'});await expect(copy.page.locator('#new-item-asset-tag')).toHaveValue('COPY EDIT');await expect(copy.page.getByRole('button',{name:'Start a different item',exact:true})).toBeFocused();
   await copy.page.getByRole('button',{name:'Start a different item',exact:true}).click();await copy.page.getByRole('button',{name:'Clear draft and start blank',exact:true}).click();await copy.page.getByRole('alertdialog').waitFor({state:'detached'});await expect(copy.page.locator('#new-item-asset-tag')).toHaveValue('');
  }else await capture(copy.page,variant,width,'copy-reset');
  results.push({variant,width,scenario:'copy-reset',confirmation:variant==='after',errors:copy.errors});await copy.page.close();
  const stock=await setup(variant,width);
  await stock.page.locator('#kind-quantity').click();await stock.page.locator('#new-bulk-item-name').fill('Gaff Tape');await expect(stock.page.locator('#new-bulk-item-name')).toHaveValue('Gaff Tape');
  await stock.page.getByRole('button',{name:/Product image/}).click();await stock.page.getByRole('button',{name:'Choose image',exact:true}).click();await stock.page.getByRole('tab',{name:'Paste URL',exact:true}).click();await stock.page.locator('#image-url').fill('https://example.com/image.png');await stock.page.getByRole('button',{name:'Use image',exact:true}).click();await stock.page.getByRole('dialog').filter({has:stock.page.getByText('Choose image',{exact:true})}).waitFor({state:'detached'});
  await expect(stock.page.getByText('Image ready to save',{exact:true})).toBeVisible();
  await stock.page.locator('#bulk-existing').click();await stock.page.locator('#bulk-new').click();await expect(stock.page.locator('#new-bulk-item-name')).toHaveValue('Gaff Tape');
  const imageRetained=await stock.page.getByText('Image ready to save',{exact:true}).count();if(variant==='after')assert.equal(imageRetained,1);else assert.equal(imageRetained,0);
  await stock.page.locator('[data-slot="sheet-body"]').evaluate(el=>el.scrollTo({top:500}));await capture(stock.page,variant,width,'stock-draft');
  assert.deepEqual(stock.errors,[]);results.push({variant,width,scenario:'stock-draft',imageRetained:Boolean(imageRetained),errors:stock.errors});await stock.page.close();
 }
 await writeFile(resolve(proof,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
