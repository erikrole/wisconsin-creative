import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(path.join(process.cwd(),'package.json'));
const {chromium}=require('playwright');
const dir=path.join(process.cwd(),'tasks/archive/proofs/ios-ui15-2026-09-07');
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.goto(pathToFileURL(path.join(dir,'review.html')).href,{waitUntil:'domcontentloaded'});await page.locator('img').last().waitFor();assert.equal(await page.locator('img').count(),3);assert(await page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)));await page.screenshot({path:path.join(dir,'review-preview.png')});console.log('Review renders with all 3 after-only images.');}finally{await browser.close();}
