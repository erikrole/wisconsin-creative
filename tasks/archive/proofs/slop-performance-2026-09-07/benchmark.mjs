import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

// Run from the repository root. Uses the real baseline and working source,
// with no database access and no timing thresholds in the test suite.
const require = createRequire(`${process.cwd()}/package.json`);
const ts = require('typescript');
const sourcePath = 'src/lib/student-availability.ts';
const baselineCommit = '1f2af2aa';
const beforeSource = execFileSync('git', ['show', `${baselineCommit}:${sourcePath}`], { encoding: 'utf8' });
const afterSource = readFileSync(sourcePath, 'utf8');
function load(source) {
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'process', compiled)(exports, { env: { INSTITUTION_TZ: 'America/Chicago' } });
  return exports.evaluateAvailabilityPreferences;
}
const before = load(beforeSource);
const after = load(afterSource);
const blocks = [
  ...Array.from({ length: 7 }, (_, dayOfWeek) => ({
    kind: 'WEEKLY', dayOfWeek, startsAt: '09:00', endsAt: '17:00', label: 'Class',
    semesterStartsOn: '2026-01-15', semesterEndsOn: '2026-12-18',
  })),
  ...['PREFER', 'DISLIKE', 'CANNOT_WORK', 'TIME_OFF'].flatMap(intent =>
    ['APPROVED', 'PENDING', 'DENIED'].map(status => ({
      kind: 'AD_HOC', intent, status, date: '2026-03-01', dateEndsOn: '2026-11-30',
      startsAt: '00:00', endsAt: '23:59', allDay: intent === 'TIME_OFF', label: 'Dated block',
    }))),
];
const windows = Array.from({ length: 365 * 24 }, (_, hour) => ({
  startsAt: new Date(Date.UTC(2026, 0, 1, hour)),
  endsAt: new Date(Date.UTC(2026, 0, 1, hour, 45)),
}));
for (const window of windows) {
  assert.deepEqual(after(blocks, window), before(blocks, window));
  assert.deepEqual(after([], window), before([], window));
}
const iterations = 2000;
function measure(fn) {
  let conflicts = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) conflicts += fn(blocks, windows[i % windows.length]).conflicts.length;
  return { ms: performance.now() - start, conflicts };
}
measure(before);
measure(after);
const samples = { before: [], after: [] };
for (let round = 0; round < 7; round++) {
  for (const key of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    samples[key].push(measure(key === 'before' ? before : after));
  }
  assert.equal(samples.before[round].conflicts, samples.after[round].conflicts);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const beforeMs = median(samples.before.map(sample => sample.ms));
const afterMs = median(samples.after.map(sample => sample.ms));
console.log(JSON.stringify({
  node: process.version, baselineCommit, timezone: 'America/Chicago',
  parityCases: windows.length * 2, blocksPerPopulatedCase: blocks.length,
  iterationsPerSample: iterations, samples, beforeMedianMs: beforeMs, afterMedianMs: afterMs,
  speedup: beforeMs / afterMs,
  boundary: 'Local evaluator CPU benchmark; excludes database, network, browser, and production latency.',
}, null, 2));
