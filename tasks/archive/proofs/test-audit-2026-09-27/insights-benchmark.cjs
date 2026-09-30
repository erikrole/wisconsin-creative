const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const ts = require(process.cwd() + '/node_modules/typescript');
const dir = __dirname + '/';
function load(file) {
  const source = fs.readFileSync(file, 'utf8').split('/* ── Route Handler')[0].replace(/^import .*;\n/gm, '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(compiled + '\n({ countBookedDays, computeWindow })', { Date, Math, Map, Set });
}
const before = load(dir + 'asset-insights-before.txt');
const after = load('src/app/api/assets/[id]/insights/route.ts');
const day = 86400000;
let seed = 260927;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const now = new Date('2026-03-01T12:37:28Z');
const windows = [30, 90, 365, 3650].map(days => new Date(+now - days * day));
function asBookings(intervals) {
  return intervals.map(({start, end}, i) => ({ id: '' + i, kind: i % 3 ? 'CHECKOUT' : 'RESERVATION', status: i % 2 ? 'COMPLETED' : 'OPEN', startsAt: start, endsAt: end, updatedAt: end, completedAt: null, sportCode: i % 3 ? 'FB' : null, requesterName: 'Borrower ' + (i % 8) }));
}
for (let trial = 0; trial < 10000; trial++) {
  const start = new Date(+now - (1 + random() * 100) * day);
  const intervals = Array.from({length: Math.floor(random() * 40)}, () => {
    const s = +now - random() * 150 * day;
    return { start: new Date(s), end: new Date(s + (random() * 80 - 5) * day) };
  });
  assert.equal(after.countBookedDays(intervals, start, now), before.countBookedDays(intervals, start, now));
  if (trial < 1000) {
    const bookings = asBookings(intervals);
    for (const window of windows) {
      assert.equal(JSON.stringify(after.computeWindow(bookings, window, now, 2500, new Date('2020-01-01'), bookings.length)), JSON.stringify(before.computeWindow(bookings, window, now, 2500, new Date('2020-01-01'), bookings.length)));
    }
  }
}
const special = [
  [{ start: new Date(NaN), end: now }],
  [{ start: new Date('1960-01-01T23:00Z'), end: new Date('1960-01-03T02:00Z') }],
  [{ start: new Date(+now - day), end: new Date(+now - 1) }],
];
for (const intervals of special) assert.equal(after.countBookedDays(intervals, new Date('1950-01-01'), now), before.countBookedDays(intervals, new Date('1950-01-01'), now));
function measure(owner, bookings, repetitions) {
  const start = performance.now();
  for (let i = 0; i < repetitions; i++) for (const window of windows) owner.computeWindow(bookings, window, now, 2500, new Date('2020-01-01'), bookings.length);
  return (performance.now() - start) / repetitions;
}
function median(values) { return [...values].sort((a,b) => a-b)[Math.floor(values.length/2)]; }
const results = [];
for (const [name, count, duration, repetitions] of [['small', 20, 7, 100], ['large-history', 1000, 180, 10], ['overlap-stress', 1000, 1825, 3]]) {
  const bookings = asBookings(Array.from({length: count}, (_, i) => ({ start: new Date(+now - (duration + i % 30) * day), end: new Date(+now - (i % 30) * day) })));
  measure(before, bookings, 2); measure(after, bookings, 2);
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const row = {};
    for (const lane of i % 2 ? ['after', 'before'] : ['before', 'after']) row[lane] = measure(lane === 'after' ? after : before, bookings, repetitions);
    rows.push(row);
  }
  const baselineMedianMs = median(rows.map(r => r.before));
  const optimizedMedianMs = median(rows.map(r => r.after));
  results.push({ name, bookings: count, durationDays: duration, fourWindowCompute: true, baselineMedianMs, optimizedMedianMs, improvementPct: 100 * (1 - optimizedMedianMs / baselineMedianMs), rows });
}
const result = { node: process.version, seed: 260927, helperComparisons: 10003, fullWindowComparisons: 4000, allEqual: true, measuredScope: 'Synthetic CPU-only computation of all four windows; excludes authentication, database, HTTP and rendering.', results };
fs.writeFileSync(dir + 'insights-benchmark.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
