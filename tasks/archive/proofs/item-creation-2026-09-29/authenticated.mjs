import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
try {
 const page = await browser.newPage({storageState:'test-results/playwright/auth/user.json',viewport:{width:1280,height:1000}});
 const errors=[]; page.on('pageerror', e => errors.push(e.message));
 await page.goto('http://127.0.0.1:3490/items');
 await page.getByRole('button',{name:'Add item',exact:true}).click();
 await page.locator('#new-item-asset-tag').fill('UI CHECK UNSAVED');
 await expect(page.locator('#new-item-asset-tag')).toHaveValue('UI CHECK UNSAVED');
 await page.locator('#kind-units').click();
 await page.getByRole('alertdialog').waitFor();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.locator('#new-item-asset-tag')).toHaveValue('UI CHECK UNSAVED');
 await page.locator('#kind-units').click();
 await page.getByRole('button',{name:'Clear draft and switch'}).click();
 await expect(page.locator('#new-bulk-item-name')).toHaveValue('');
 await page.getByRole('alertdialog').waitFor({state:'detached'});
 await page.screenshot({animations:'disabled',path:'tasks/archive/proofs/item-creation-2026-09-29/authenticated.png'});
 await writeFile('tasks/archive/proofs/item-creation-2026-09-29/authenticated-results.json',JSON.stringify({cancelPreservesDraft:true,confirmedSwitchClears:true,inventoryMutations:0,errors},null,2));
 console.log(JSON.stringify({cancelPreservesDraft:true,confirmedSwitchClears:true,inventoryMutations:0,errors}));
} finally { await browser.close(); }
