import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const ts = require('typescript');
const baselineCommit = '1f2af2aa';
const now = Date.UTC(2026, 8, 7, 12);
class FixedDate extends Date { static now() { return now; } }
function load(path, db, baseline) {
  const source = baseline ? execFileSync('git', ['show', `${baselineCommit}:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8');
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', 'Date', code)(exports, name => name === '@/lib/db' ? { db } : {}, FixedDate);
  return exports;
}
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('contains' in value) return (row[key] ?? '').toLowerCase().includes(value.contains.toLowerCase());
      if ('none' in value) return row[key].length === 0;
      if ('gte' in value) return row[key] >= value.gte;
      if ('not' in value) return row[key] !== value.not;
      throw new Error(`Unsupported fixture predicate: ${key}`);
    }
    return row[key] === value;
  });
}
function model(rows, calls) {
  return Object.fromEntries(['findMany', 'count', 'groupBy'].map(method => [method, async args => {
    calls.push({ method, args });
    const filtered = rows.filter(row => matches(row, args.where));
    if (method === 'count') return filtered.length;
    if (method === 'findMany') return filtered.slice(args.skip, args.skip + args.take);
    const groups = new Map();
    for (const row of filtered) {
      const key = JSON.stringify(args.by.map(field => row[field]));
      const group = groups.get(key) ?? { ...Object.fromEntries(args.by.map(field => [field, row[field]])), _count: { _all: 0 } };
      group._count._all++;
      groups.set(key, group);
    }
    return [...groups.values()].map(group => args._count ? group : Object.fromEntries(args.by.map(field => [field, group[field]])));
  }]));
}
const kits = Array.from({ length: 12 }, (_, i) => ({
  id: `kit-${i}`, name: i % 2 ? 'Audio kit' : 'Camera kit', description: i % 3 ? null : 'Interview',
  locationId: i < 6 ? 'home' : 'away', active: i % 3 !== 0,
  members: i % 2 ? [] : ['serialized'], bulkMembers: i % 4 ? [] : ['bulk'],
}));
const events = Array.from({ length: 100 }, (_, i) => ({
  actorHash: `actor-${i % 9}`, platform: ['web', 'ios', 'future-platform'][i % 3],
  surface: i % 2 ? 'home' : 'schedule', eventName: i % 2 ? 'app_opened' : 'surface_viewed',
  appVersion: i % 4 ? `v${i % 12}` : null, occurredAt: new Date(now - i * 86_400_000),
}));
const beforeCalls = [], afterCalls = [];
const beforeKits = load('src/lib/services/kits.ts', { kit: model(kits, beforeCalls) }, true);
const afterKits = load('src/lib/services/kits.ts', { kit: model(kits, afterCalls) }, false);
let kitCases = 0;
for (const includeArchived of [false, true]) for (const search of [undefined, 'camera', 'interview', 'missing'])
for (const locationId of [undefined, 'home', 'away', 'missing']) for (const limit of [1, 25]) for (const offset of [0, 2]) {
  beforeCalls.length = afterCalls.length = 0;
  const params = { includeArchived, search, locationId, limit, offset };
  assert.deepEqual(await afterKits.listKits(params), await beforeKits.listKits(params));
  assert.deepEqual(afterCalls[0], beforeCalls[0]); // Pagination/sort/include query unchanged.
  assert.equal(beforeCalls.length, 5); assert.equal(afterCalls.length, 3); kitCases++;
}
let usageCases = 0;
for (const rows of [events, []]) {
  const before = load('src/lib/services/usage-analytics-report.ts', { productEvent: model(rows, beforeCalls) }, true);
  const after = load('src/lib/services/usage-analytics-report.ts', { productEvent: model(rows, afterCalls) }, false);
  for (const days of [7, 30, 90]) {
    beforeCalls.length = afterCalls.length = 0;
    assert.deepEqual(await after.getUsageAnalyticsReport(days), await before.getUsageAnalyticsReport(days));
    assert.equal(beforeCalls.length, 6); assert.equal(afterCalls.length, 5); usageCases++;
  }
}
console.log(JSON.stringify({ baselineCommit, kitCases, usageCases, kits: { beforeQueries: 5, afterQueries: 3 }, usage: { beforeQueries: 6, afterQueries: 5 }, boundary: 'Full-output fixture replay of real service code with an in-memory database stub. Not a live database or latency benchmark.' }, null, 2));
