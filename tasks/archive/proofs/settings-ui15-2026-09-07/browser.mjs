import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.cwd(),'package.json'));
const {chromium}=require('playwright');
const dir=path.join(process.cwd(),'tasks/archive/proofs/settings-ui15-2026-09-07');
const phase=process.argv[2];
const server=http.createServer((req,res)=>{const name=path.basename(new URL(req.url,'http://localhost').pathname);let file=path.join(dir,/\.(js|css)$/.test(name)?name:phase+'.html');if(name.endsWith('.woff2'))file=path.join(process.cwd(),'.next/static/media',name);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(4317,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1100,height:1000},deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce',locale:'en-US',timezoneId:'America/Chicago'});
await context.addInitScript(()=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-07T12:00:00Z']));}static now(){return 1788782400000;}};});
const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>console.log('PAGEERROR',e.message));console.log('Browser ready');
const checks=[];
try{
for(const which of ['rules','policies','appearance']){
 await page.goto('http://127.0.0.1:4317/settings/'+which+'?page='+which);
 await page.getByRole('heading',{name:which==='rules'?'Reservation Rules':which==='policies'?'Checkout Policies':'Appearance',exact:true}).waitFor();
 if(which!=='appearance')await page.locator('input').first().waitFor();
 await page.waitForTimeout(500);
 await page.screenshot({path:path.join(dir,phase+'-'+which+'.png'),fullPage:true});
 if(phase==='after'&&which!=='appearance'){
 const first=page.locator('input').first();const original=await first.inputValue();
 await first.fill('7');await page.getByText('Unsaved changes',{exact:true}).waitFor();
 assert(await page.evaluate(()=>{let e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));checks.push(which+': unload protection');
 await page.getByRole('button',{name:'Reset changes'}).click();assert.equal(await first.inputValue(),original);checks.push(which+': reset');
 await page.evaluate(async which=>{const f=fixture;const values=which==='rules'?{...f.rules,advanceWindowDays:6}:{...f.policies,defaultLoanDays:6};for(const query of f.client.getQueryCache().getAll())f.client.setQueryData(query.queryKey,values);},which);await page.waitForFunction(()=>document.querySelector('input').value==='6');checks.push(which+': clean refresh adopts current values');
 await first.fill('9');await page.evaluate(which=>{const f=fixture;for(const query of f.client.getQueryCache().getAll())f.client.setQueryData(query.queryKey,which==='rules'?{...f.rules,advanceWindowDays:10}:{...f.policies,defaultLoanDays:10});},which);await page.waitForTimeout(50);assert.equal(await first.inputValue(),'9');checks.push(which+': successful refresh preserves draft');await page.getByRole('button',{name:'Reset changes'}).click();
 await page.evaluate(()=>{fixture.delay=600;});await first.fill('7');await first.press('Enter');await page.getByRole('status').filter({hasText:'Saving changes…'}).waitFor();assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).getAttribute('aria-busy'),'true');checks.push(which+': stable pending label');await page.getByRole('button',{name:'Saved',exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture.writes.length),1);checks.push(which+': Enter saves');
 await first.fill('0');await page.getByRole('button',{name:'Save changes'}).click();assert.equal(await first.getAttribute('aria-invalid'),'true');assert(await first.evaluate(el=>el===document.activeElement));checks.push(which+': invalid focus');
 await first.fill('8');await page.evaluate(()=>{fixture.saveError=true;});await page.getByRole('button',{name:'Save changes'}).click();await page.locator('[role="alert"]').filter({hasText:'Settings could not be saved'}).waitFor();checks.push(which+': persistent save error');
 await page.screenshot({path:path.join(dir,phase+'-'+which+'-error.png'),fullPage:true});
 await page.evaluate(async()=>{fixture.readError=true;await fixture.client.refetchQueries();});assert.equal(await first.inputValue(),'8');await page.getByText('Could not refresh settings. Your values are still shown.').waitFor();checks.push(which+': failed refresh preserves draft');await page.evaluate(()=>{fixture.readError=false;});await page.getByRole('button',{name:'Retry refresh'}).click();await page.getByText('Could not refresh settings. Your values are still shown.').waitFor({state:'hidden'});assert.equal(await first.inputValue(),'8');checks.push(which+': refresh retry recovers without losing draft');
 for(const input of await page.locator('input').all()){assert((await input.boundingBox()).height>=40);assert(await input.evaluate(el=>Boolean(document.getElementById(el.getAttribute('aria-describedby')))));}checks.push(which+': targets and descriptions');
 if(which==='policies'){await page.getByRole('button',{name:'Reset changes'}).click();await page.locator('#cp-grace').fill('');await page.getByRole('button',{name:'Save changes'}).click();assert.equal(await page.locator('#cp-grace').getAttribute('aria-invalid'),'true');checks.push('policies: blank grace rejected');}
 } else if(phase==='after') {await page.getByRole('group',{name:'Theme',exact:true}).waitFor();await page.getByRole('group',{name:'Text size',exact:true}).waitFor();const choice=page.getByRole('button',{name:'Text size: Large',exact:true});await choice.click();assert.equal(await choice.getAttribute('aria-pressed'),'true');assert.equal(await choice.locator('svg').count(),1);checks.push('appearance: labelled groups and non-color selection');await page.keyboard.press("Shift+Tab");await page.keyboard.press("Tab");assert(await choice.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).boxShadow!=='none'));checks.push('appearance: visible keyboard focus ring');}
}
if(phase==='after'){await page.setViewportSize({width:390,height:844});for(const which of ['rules','policies','appearance']){await page.goto('http://127.0.0.1:4317/settings/'+which+'?page='+which);await page.getByRole('heading').first().waitFor();await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(dir,'after-'+which+'-mobile.png'),fullPage:true});checks.push(which+': mobile has no horizontal overflow');}}
fs.writeFileSync(path.join(dir,phase+'-browser-results.json'),JSON.stringify({phase,checks,viewport:{width:1100,height:1000},deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce',proof:'Actual components with isolated Admin fixture; not authenticated application proof'},null,2));
console.log(JSON.stringify({phase,checks}));
}finally{await browser.close();server.close();}
