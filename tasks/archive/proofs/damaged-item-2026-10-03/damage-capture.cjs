const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
for(const state of ['maintenance','available']) { await page.goto('file://'+process.cwd()+'/tasks/archive/proofs/damaged-item-2026-10-03/'+state+'.html'); await page.screenshot({path:'tasks/archive/proofs/damaged-item-2026-10-03/'+state+'.png'}); }
await page.setViewportSize({width:390,height:844}); await page.goto('file://'+process.cwd()+'/tasks/archive/proofs/damaged-item-2026-10-03/maintenance.html'); await page.screenshot({path:'tasks/archive/proofs/damaged-item-2026-10-03/maintenance-mobile.png',fullPage:true}); await browser.close();})();
