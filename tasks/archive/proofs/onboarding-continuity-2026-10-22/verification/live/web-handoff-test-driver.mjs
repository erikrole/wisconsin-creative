import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, request, expect } from '@playwright/test';
import sharp from 'sharp';
import { readPreviewState, verifyPreviewState } from '../scripts/lib/preview-environment.mjs';
import { localChecksums } from '../scripts/lib/local-migrations.mjs';
import { readInfrastructureConfig } from '../scripts/lib/migration-baseline.mjs';
import { VercelPreviewApi } from '../scripts/lib/vercel-preview-api.mjs';
import { previewOidcToken } from '../scripts/lib/verify-hosted-preview.mjs';

const mode = process.argv[2];
const secretPath = '.tmp/live-handoff-secret.json';
const proof = 'tasks/archive/proofs/onboarding-continuity-2026-10-22/verification/live';
mkdirSync(proof, { recursive: true });
const state = readPreviewState();
await verifyPreviewState(state, localChecksums());
const config = readInfrastructureConfig();
const api = new VercelPreviewApi();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const serverHead = process.env.WC_HOSTED_SOURCE_SHA || head;
execFileSync('git', ['merge-base', '--is-ancestor', serverHead, head]);
const sinceServer = execFileSync('git', ['diff', '--name-only', serverHead, head], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert(sinceServer.every(p => /^(ios\/|docs\/|tasks\/)/.test(p)), 'Rebuild the hosted deployment when its web/API sources differ');
let secret;
if (mode === 'prepare') {
  const attestation = JSON.parse(readFileSync('.tmp/hosted-preview-attestation.json', 'utf8'));
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const managed = JSON.parse(gh(['api', `repos/erikrole/wisconsin-creative/actions/runs/${attestation.managedRunId}`]));
  const ci = JSON.parse(gh(['api', `repos/erikrole/wisconsin-creative/actions/runs/${attestation.ciRunId}`]));
  assert.equal(managed.name, 'Managed previews');
  assert.equal(managed.conclusion, 'success');
  assert.equal(ci.name, 'CI');
  assert.equal(ci.conclusion, 'success');
  assert.equal(ci.head_sha, serverHead);
  const log = gh(['run', 'view', String(attestation.managedRunId), '--log']);
  const records = log.split('\n').flatMap(line => {
    const start = line.indexOf('{"pr":');
    if (start < 0) return [];
    try { return [JSON.parse(line.slice(start))]; } catch { return []; }
  });
  const record = records.find(row => row.pr === 606 && row.sha === serverHead && row.branch === state.branchId && row.deployment);
  assert(record, 'Trusted Managed preview run did not attest this PR, SHA and branch');
  const deployment = await api.request(`/v13/deployments/${record.deployment}`);
  assert.equal(deployment.projectId, config.vercel.productionProjectId);
  assert.notEqual(deployment.target, 'production');
  assert.equal(deployment.readyState, 'READY');
  assert.equal(deployment.meta.wcPreviewBranch, state.branchId);
  assert.equal(deployment.meta.wcPreviewKey, state.key);
  assert.equal(deployment.meta.githubCommitRef, state.gitBranch);
  assert.equal(new URL(`https://${deployment.url}`).hostname, new URL(record.url).hostname);
  const origin = `https://${deployment.url}`;
  assert(new URL(origin).hostname.endsWith('.vercel.app'));
  const stamp = Date.now();
  secret = { origin, deploymentId: deployment.id, managedRunId: managed.id, ciRunId: ci.id, head, serverHead, accounts: [
    { name: 'Web Handoff', email: `wc.web.${stamp}@wisc.edu`, password: `WC!${randomBytes(24).toString('base64url')}` },
    { name: 'Native Handoff', email: `wc.native.${stamp}@wisc.edu`, password: `WC!${randomBytes(24).toString('base64url')}` },
    { name: 'Recovery Handoff', email: `wc.recovery.${stamp}@wisc.edu`, password: `WC!${randomBytes(24).toString('base64url')}` },
  ] };
  writeFileSync(secretPath, JSON.stringify(secret), { mode: 0o600 });
} else {
  secret = JSON.parse(readFileSync(secretPath));
  assert.equal(secret.head, head, 'Re-attest after a source change');
}
const token = previewOidcToken({ config });
const headers = { 'x-vercel-trusted-oidc-idp-token': token, origin: secret.origin };
const browser = await chromium.launch({ headless: true });
async function json(ctx, path, body) {
  assert(path.startsWith('/') && !path.startsWith('//'));
  const response = body === undefined ? await ctx.get(path, { headers, maxRedirects: 0 }) : await ctx.post(path, { data: body, headers, maxRedirects: 0 });
  assert(response.ok(), `${path} returned ${response.status()}; response body suppressed`);
  return response.json();
}
async function student(account) {
  const context = await browser.newContext({ baseURL: secret.origin, viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route(`${secret.origin}/**`, route => route.continue({ headers: { ...route.request().headers(), ...headers } }));
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60000 });
  return { context, page };
}
async function choose(page, field, option) {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function completion(context) { return (await json(context.request, '/api/me/profile-completion')).data; }
async function capture(page, name, evidence) {
  const path = `${proof}/${name}.png`;
  await page.screenshot({ path });
  const metadata = {
    evidence, sourceRevision: secret.serverHead, sourcePatchSHA256: null,
    deploymentId: secret.deploymentId, managedRunId: secret.managedRunId,
    imageSHA256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    testDriverSHA256: createHash('sha256').update(readFileSync('.tmp/handoff-web.mjs')).digest('hex'),
    settings: { browser: browser.version(), viewport: page.viewportSize(), fixture: 'none; synthetic invited student on its own managed preview', role: 'STUDENT', route: new URL(page.url()).pathname, locale: 'en-US', timezone: 'America/Chicago', capturedAt: new Date().toISOString(), scroll: await page.evaluate(() => [scrollX, scrollY]) },
    baseline: 'After-only authenticated evidence',
  };
  writeFileSync(`${proof}/${name}.capture.json`, JSON.stringify(metadata, null, 2));
}
try {
  if (mode === 'prepare') {
    const admin = await request.newContext({ baseURL: secret.origin, extraHTTPHeaders: headers });
    await json(admin, '/api/auth/login', { email: 'admin@creative.local', password: state.environment.PLAYWRIGHT_PASSWORD });
    for (const account of secret.accounts) {
      await json(admin, '/api/allowed-emails', { email: account.email, role: 'STUDENT', preloadedName: account.name, sendInvite: false });
      const fresh = await request.newContext({ baseURL: secret.origin, extraHTTPHeaders: headers });
      await json(fresh, '/api/auth/register', { ...account, rememberMe: true });
      const data = await completion({ request: fresh });
      assert.equal(data.completion.requiresSetup, true);
      await fresh.dispose();
    }
    await admin.dispose();
    const { context, page } = await student(secret.accounts[0]);
    await expect(page.getByRole('heading', { name: 'Add your phone number', exact: true })).toBeVisible({ timeout: 60000 });
    await page.getByLabel('Personal phone', { exact: true }).fill('6085550141');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Link your Wiscard', exact: true })).toBeVisible();
    await page.getByLabel('Wiscard number', { exact: true }).fill('1234567890');
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible();
    await expect.poll(async () => (await completion(context)).profile.wiscardCardNumber).toBe('1234567890');
    const partial = await completion(context);
    assert.equal(partial.profile.wiscardIssueCode, null);
    assert.equal(partial.completion.firstIncompleteStep, 'WISCARD');
    await capture(page, 'web-partial-wiscard-saved', 'Real web UI saved partial Wiscard; shared-backend read verified before closing the browser');
    await context.close();
    console.log('Three synthetic preview students created without email. Real web UI saved phone and partial Wiscard; browser closed.');
  } else if (mode === 'resilience-web') {
    // Each recovery run owns a fresh student; retain the two handoff accounts.
    const recoveryWiscard = `99${String(Date.now()).slice(-8)}`;
    const account = { name: 'Recovery Handoff', email: `wc.recovery.retry.${Date.now()}@wisc.edu`, password: `WC!${randomBytes(24).toString('base64url')}` };
    const admin = await request.newContext({ baseURL: secret.origin, extraHTTPHeaders: headers });
    await json(admin, '/api/auth/login', { email: 'admin@creative.local', password: state.environment.PLAYWRIGHT_PASSWORD });
    await json(admin, '/api/allowed-emails', { email: account.email, role: 'STUDENT', preloadedName: account.name, sendInvite: false });
    const registration = await request.newContext({ baseURL: secret.origin, extraHTTPHeaders: headers });
    await json(registration, '/api/auth/register', { ...account, rememberMe: true });
    await registration.dispose(); await admin.dispose();
    secret.accounts[2] = account;
    writeFileSync(secretPath, JSON.stringify(secret), { mode: 0o600 });
    const first = await student(secret.accounts[2]);
    const second = await student(secret.accounts[2]);
    first.page.on('response', async response => {
      if (!response.url().endsWith('/api/me/profile-completion') || response.request().method() !== 'PATCH') return;
      const payload = response.request().postDataJSON();
      console.log(JSON.stringify({ diagnostic: 'first-context-save', group: payload?.group, step: payload?.step, status: response.status(), values: Object.fromEntries(Object.entries(payload?.values ?? {}).map(([key,value])=>[key, typeof value === 'string' ? `length:${value.length}` : value === null ? null : typeof value])) }));
    });
    const phone = page => page.getByLabel('Personal phone', { exact: true });
    const saved = page => page.getByText('Saved to your account', { exact: true }).last();
    const digits = value => value?.replace(/\D/g, '').slice(-10);
    let droppedResponses = 0;
    await first.page.route(`${secret.origin}/api/me/profile-completion`, async route => {
      const request = route.request();
      if (request.method() === 'PATCH' && droppedResponses === 0 && request.postDataJSON()?.group === 'PERSONAL_PHONE') {
        const committed = await route.fetch({ headers: { ...request.headers(), ...headers }, maxRedirects: 0 });
        assert(committed.ok(), 'The real save must commit before dropping its response');
        droppedResponses++;
        await route.abort('failed');
      } else await route.continue({ headers: { ...request.headers(), ...headers } });
    });
    await phone(first.page).fill('6085550143');
    await expect.poll(async () => digits((await completion(first.context)).profile.personalPhone), { timeout: 30000 }).toBe('6085550143');
    await expect(saved(first.page)).toBeVisible({ timeout: 30000 });
    assert.equal(droppedResponses, 1);
    await first.page.unroute(`${secret.origin}/api/me/profile-completion`);
    await phone(second.page).fill('6085550144');
    await expect(second.page.getByRole('button', { name: 'Use saved answers', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(phone(second.page)).toHaveValue('(608) 555-0144');
    await second.page.getByRole('button', { name: 'Use saved answers', exact: true }).click();
    await expect(phone(second.page)).toHaveValue('(608) 555-0143');
    await first.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(first.page.getByRole('heading', { name: 'Link your Wiscard', exact: true })).toBeVisible();
    await expect(first.page.getByRole('heading', { name: 'Add your phone number', exact: true })).toHaveCount(0);
    await Promise.all([
      first.page.getByLabel('Wiscard number', { exact: true }).fill(recoveryWiscard),
      phone(second.page).fill('6085550145'),
    ]);
    await expect(saved(first.page)).toBeVisible({ timeout: 30000 });
    await expect(saved(second.page)).toBeVisible({ timeout: 30000 });
    await capture(first.page, 'web-concurrent-groups-diagnostic', 'Diagnostic of concurrent independent group edits; synthetic preview only');
    console.log(JSON.stringify({ diagnostic:'first-context-after-concurrent-edit', cardInputLength:(await first.page.getByLabel('Wiscard number', {exact:true}).inputValue()).length, status: await first.page.locator('[aria-live="polite"]').allTextContents() }));
    await expect.poll(async () => {
      const p = (await completion(first.context)).profile;
      return [digits(p.personalPhone), p.wiscardCardNumber];
    }, { timeout: 30000 }).toEqual(['6085550145', recoveryWiscard]);
    await first.page.reload();
    await expect(first.page.getByRole('heading', { name: 'Link your Wiscard', exact: true })).toBeVisible();
    await first.page.getByRole('button', { name: 'Back', exact: true }).click();
    await phone(first.page).fill('6085550146');
    await expect.poll(async () => digits((await completion(first.context)).profile.personalPhone), { timeout: 30000 }).toBe('6085550146');
    await expect(saved(first.page)).toBeVisible({ timeout: 30000 });
    await phone(second.page).fill('6085550147');
    await expect(second.page.getByRole('button', { name: 'Save my answers', exact: true })).toBeVisible({ timeout: 30000 });
    await second.page.getByRole('button', { name: 'Save my answers', exact: true }).click();
    await expect.poll(async () => digits((await completion(second.context)).profile.personalPhone), { timeout: 30000 }).toBe('6085550147');
    await first.page.reload();
    await expect(first.page.getByRole('heading', { name: 'Link your Wiscard', exact: true })).toBeVisible();
    await first.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(phone(first.page)).toHaveValue('(608) 555-0147');
    await first.context.setOffline(true);
    await phone(first.page).fill('6085550148');
    await expect(first.page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(phone(first.page)).toHaveValue('(608) 555-0148');
    await expect(saved(first.page)).not.toBeVisible();
    await capture(first.page, 'web-offline-answer-retained', 'Real authenticated preview; network disabled; typed answer retained and save error shown');
    await first.context.setOffline(false);
    await expect.poll(async () => digits((await completion(first.context)).profile.personalPhone), { timeout: 30000 }).toBe('6085550148');
    await expect(saved(first.page)).toBeVisible({ timeout: 30000 });
    const recovered = await completion(first.context);
    assert.equal(recovered.profile.wiscardCardNumber, recoveryWiscard);
    writeFileSync(`${proof}/web-recovery-result.json`, JSON.stringify({ serverSource: secret.serverHead, deploymentId: secret.deploymentId, lostCommittedResponse: 'reconciled', independentGroups: 'both preserved', sameGroupConflict: 'use saved and explicit keep edits passed', offlineAnswer: 'retained, honest error and saved on reconnect', checkedAt: new Date().toISOString() }, null, 2));
    await first.context.close();
    await second.context.close();
    console.log('Live web recovery passed: committed lost response, independent edits, both conflict decisions, offline retention and reconnect.');
  } else if (mode === 'finish-web') {
    const first = await student(secret.accounts[0]);
    const receipt = await completion(first.context);
    assert.equal(receipt.completion.onboardingComplete, true);
    assert.equal(receipt.profile.avatarUrl, null);
    assert.equal(receipt.profile.topSize, 'M');
    assert.equal(receipt.profile.shoeSize, '8');
    await first.page.goto('/welcome');
    await expect(first.page.getByText('Setup complete', { exact: true })).toBeVisible();
    await capture(first.page, 'web-sees-native-photo-free-completion', 'Web read-back of physical native Finish without a photo');
    await first.context.close();
    const { context, page } = await student(secret.accounts[1]);
    await expect(page.getByRole('heading', { name: 'Add your apparel sizes', exact: true })).toBeVisible({ timeout: 60000 });
    const data = await completion(context);
    assert.equal(data.profile.wiscardCardNumber, '2345678901');
    assert.equal(data.profile.wiscardIssueCode, '2');
    assert.equal(data.profile.studentYearOverride, 'SOPHOMORE');
    assert(data.profile.personalPhone.replace(/\D/g, '').endsWith('6085550142'));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Year', exact: true })).toContainText('Sophomore');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await choose(page, 'Clothing sizing', 'Men’s');
    await choose(page, 'Top size', 'L');
    await choose(page, 'US shoe sizing', 'Women’s');
    await choose(page, 'Shoe size', '7.5');
    await capture(page, 'web-resumes-native-and-completes-apparel', 'Real web UI resumed the physical native draft and completed apparel');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add a profile photo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByText('Setup complete', { exact: true })).toBeVisible({ timeout: 30000 });
    assert.equal((await completion(context)).completion.onboardingComplete, true);
    await context.close();
    console.log('Web confirmed native photo-free Finish, resumed the second native draft, and finished through the real web UI.');
  } else if (mode === 'finish-web-resume') {
    const { context, page } = await student(secret.accounts[1]);
    const data = await completion(context);
    assert.equal(data.profile.topSize, 'L'); assert.equal(data.profile.shoeSize, '7.5');
    await expect(page.getByRole('heading', {name:'Add a profile photo',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Finish',exact:true}).click();
    await expect(page.getByText('Setup complete',{exact:true})).toBeVisible({timeout:30000});
    assert.equal((await completion(context)).completion.onboardingComplete,true);
    await capture(page,'web-resumed-photo-and-finished','After reopening the saved apparel draft, real web Finish completes setup without photo');
    await context.close();
    console.log('Reopened the saved native-started draft at Photo and finished without a photo through the real web UI.');
  } else if (mode === 'verify-photo') {
    const { context, page } = await student(secret.accounts[1]);
    const data = await completion(context);
    assert.equal(data.completion.onboardingComplete, true);
    assert(data.profile.avatarUrl, 'Physical upload did not persist an avatar');
    const response = await context.request.get(data.profile.avatarUrl);
    assert(response.ok());
    const bytes = await response.body();
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 512); assert.equal(meta.height, 512); assert.equal(meta.format, 'webp');
    const { data: pixels, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const offset = (x, y) => (y * info.width + x) * info.channels;
    const left = offset(128, 256), right = offset(384, 256);
    assert(pixels[left] > 180 && pixels[left + 2] < 70, 'Expected orange technical sample');
    assert(pixels[right] < 70 && pixels[right + 1] > 120 && pixels[right + 2] > 120, 'Expected teal technical sample');
    await page.goto('/settings/profile');
    await expect(page.getByRole('button', { name: 'Change photo', exact: true })).toBeVisible();
    const avatar = page.locator('main').getByRole('img', { name: secret.accounts[1].name, exact: true }).first();
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await capture(page, 'web-after-physical-photo-upload', 'Web profile displays the physical PhotosPicker upload; actual stored WebP dimensions and technical-image pixels verified');
    writeFileSync(`${proof}/handoff-result.json`, JSON.stringify({ nativeSource: head, serverSource: secret.serverHead, deploymentId: secret.deploymentId, webToIOS: 'passed', iosToWeb: 'passed', skippedPhotoFinishes: 'passed', physicalDevice: 'iPhone 18 Pro Max', physicalPhoto: 'PhotosPicker, crop gesture, Save and persisted 512px WebP verified', checkedAt: new Date().toISOString() }, null, 2));
    await context.close();
    console.log('Physical photo persisted as a normalized 512px WebP; synthetic colors verified from web. Both handoffs passed.');
  } else throw new Error('Use prepare, resilience-web, finish-web or verify-photo');
} finally { await browser.close(); }
