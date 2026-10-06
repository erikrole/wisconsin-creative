#!/usr/bin/env node
// CI dependency gate: fails on any high or critical npm advisory unless it is
// listed below with a reason and an expiry date. Use an exception only when no
// installable fix exists (no patched release, or the patch is younger than the
// .npmrc min-release-age cooldown). Prefer a targeted package.json override.
// An expired exception fails the gate so it is re-evaluated, never forgotten.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const EXCEPTIONS = [
  {
    id: "GHSA-vfj7-8cjw-p6xm",
    package: "braces",
    expires: "2026-11-15",
    reason:
      "No patched braces release exists (<=3.0.3 affected). Reached only through the dev-only lint chain eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch, which expands glob patterns from repository config, never user input.",
  },
  {
    id: "GHSA-ch52-4w7c-c8xp",
    package: "http-cache-semantics",
    expires: "2026-10-12",
    reason:
      "Fixed in 4.3.0, published 2026-10-04 and still inside the 7-day min-release-age cooldown. Reached through workflow > @swc/cli binary download (got > cacheable-request), not request serving. Replace with an override to 4.3.0 once installable.",
  },
  {
    id: "GHSA-5gmw-xhrv-c9v3",
    package: "tinypool",
    expires: "2026-11-06",
    reason:
      "Prototype-pollution gadget in tinypool worker options. Reached only through the dev-only test runner (vitest 3 > tinypool 1.x), which never receives untrusted options; the fix needs the vitest 5 major. Upgrade vitest, then drop this exception.",
  },
  {
    id: "GHSA-85c8-ppgw-ccpr",
    package: "tinypool",
    expires: "2026-11-06",
    reason:
      "Prototype-pollution gadget in tinypool worker options. Reached only through the dev-only test runner (vitest 3 > tinypool 1.x), which never receives untrusted options; the fix needs the vitest 5 major. Upgrade vitest, then drop this exception.",
  },
  {
    id: "GHSA-68fv-2mgg-jv7q",
    package: "source-map-js",
    expires: "2026-10-12",
    reason:
      "Fixed in 1.2.2, published 2026-09-30 and still inside the 7-day min-release-age cooldown. Reached through postcss and tailwind at build time on repository CSS, not request serving. Replace with an override to 1.2.2 once installable.",
  },
];

const BLOCKING = new Set(["high", "critical"]);

/** Direct advisories (not transitive echoes) at blocking severity. */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const [name, vulnerability] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = String(via.url ?? "").split("/").pop() || `${name}:${via.title}`;
      found.set(id, { id, package: name, severity: via.severity, title: via.title });
    }
  }
  return [...found.values()];
}

export function evaluate(report, exceptions = EXCEPTIONS, today = new Date().toISOString().slice(0, 10)) {
  const failures = [];
  const excused = [];
  for (const advisory of blockingAdvisories(report)) {
    const exception = exceptions.find((entry) => entry.id === advisory.id && entry.package === advisory.package);
    if (!exception) failures.push(`${advisory.severity} ${advisory.package} ${advisory.id}: ${advisory.title}`);
    else if (exception.expires < today) failures.push(`${advisory.package} ${advisory.id}: exception expired ${exception.expires}; re-evaluate it`);
    else excused.push(`${advisory.package} ${advisory.id} (until ${exception.expires})`);
  }
  return { failures, excused };
}

function main() {
  // npm audit exits non-zero whenever it finds anything, so read stdout regardless.
  const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("npm audit did not return JSON; failing closed.");
    console.error(result.stderr);
    process.exit(1);
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const { failures, excused } = evaluate(report);
  for (const line of excused) console.log(`excepted: ${line}`);
  if (failures.length) {
    console.error("Blocking advisories:");
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("audit gate: no unexcepted high or critical advisories");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
