import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const proof = resolve('tasks/archive/proofs/item-creation-2026-09-29');
const owner = resolve('src/app/(app)/items/new-item-sheet.tsx');
const baseline = resolve(proof, 'before-sheet.txt');
const css = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css;
await mkdir(proof, { recursive: true });
const bundles = {};
for (const variant of ['before', 'after']) {
  const result = await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { NewItemSheet } from ${JSON.stringify(owner)};
    import { ConfirmProvider } from ${JSON.stringify(resolve('src/components/ConfirmDialog.tsx'))};
    createRoot(document.getElementById('root')).render(<ConfirmProvider><NewItemSheet open onOpenChange={() => {}} onCreated={() => {}} locations={[]} departments={[]} categories={[]} /></ConfirmProvider>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': resolve('src') }, define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter = () => ({push(){},replace(){},refresh(){}});' }));
    if (variant === 'before') b.onLoad({ filter: /(?:SerializedItemForm|BulkItemForm)\.tsx$/ }, async args => ({ contents: await readFile(resolve(proof, 'before-' + args.path.split('/').pop().replace('.tsx', '.txt')), 'utf8'), loader: 'tsx', resolveDir: dirname(args.path) }));
    if (variant === 'before') b.onLoad({ filter: /new-item-sheet\.tsx$/ }, async () => ({ contents: await readFile(baseline, 'utf8'), loader: 'tsx', resolveDir: dirname(owner) }));
  }}] });
  bundles[variant] = result.outputFiles[0].text;
}
const server = createServer((req, res) => {
  if (req.url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(bundles[req.url.includes('before') ? 'before' : 'after']); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script type="module" src="/${req.url.includes('before') ? 'before' : 'after'}.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const results = [];
try {
  for (const variant of ['before', 'after']) for (const width of [1280, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'light', locale: 'en-US', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.route('**/api/**', r => r.fulfill({ json: { data: [] } }));
    await page.clock.setFixedTime(new Date('2026-09-29T17:00:00Z'));
    await page.goto(`http://127.0.0.1:${server.address().port}/${variant}`);
    await page.locator('#new-item-asset-tag').waitFor();
    await page.screenshot({ animations: 'disabled', path: `${proof}/${variant}-${width}.png` });
    // Regression: a tracking change may not silently discard an edited identity.
    await page.locator('#new-item-asset-tag').fill('CAM 17');
    if (variant === 'after') assert.equal(await page.locator('#new-item-asset-tag').inputValue(), 'CAM 17');
    await page.locator('#kind-units').click();
    if (variant === 'before') {
      assert.equal(await page.getByRole('alertdialog').count(), 0);
      assert.equal(await page.locator('#new-item-asset-tag').count(), 0);
      results.push({ variant, width, baselineSilentDiscard: true, errors });
    } else {
      await page.getByRole('alertdialog').waitFor();
      
      await page.screenshot({ animations: 'disabled', path: `${proof}/confirm-${width}.png` });
      await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
      assert.equal(await page.locator('#new-item-asset-tag').inputValue(), 'CAM 17');
      await page.locator('#kind-units').click();
      await page.getByRole('button', { name: 'Clear draft and switch' }).click();
      await page.locator('#new-bulk-item-name').waitFor();
      assert.equal(await page.locator('#new-bulk-item-name').inputValue(), '');
      // An untouched selection is not an edited draft; arrow navigation stays in the group.
      await page.getByRole('alertdialog').waitFor({ state: 'detached' });
      await page.locator('#kind-units').focus();
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(() => document.querySelector('#kind-quantity')?.getAttribute('aria-checked') === 'true');
      await page.keyboard.up('ArrowRight');
      assert.equal(await page.getByRole('alertdialog').count(), 0);
      assert.equal(await page.locator('#kind-quantity').evaluate(el => el === document.activeElement), true);
      await page.locator('#new-bulk-item-name').fill('Tape');
      await page.locator('#kind-units').click();
      await page.getByRole('button', { name: 'Clear draft and switch' }).click();
      assert.equal(await page.locator('#new-bulk-item-name').inputValue(), '');
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ variant, width, cancelPreservesDraft: true, confirmedSwitchClearsDraft: true, bulkSwitchClearsDraft: true, keyboardChoice: true, noHorizontalOverflow: true, errors });
    }
    await page.close();
  }
  await writeFile(`${proof}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); server.close(); }
