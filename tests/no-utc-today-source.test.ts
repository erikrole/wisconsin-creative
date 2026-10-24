import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Staff read dates on the Madison (Central) calendar. A "today" taken from
// `new Date().toISOString()` is the UTC day, which is already tomorrow after
// 7 PM Central, and a server `setHours(0|24, ...)` is UTC midnight on Vercel.
// Use `appTzDateKey` / `startOfDayInAppTz` (server) or `institutionDateKey` /
// `institutionDayOffset` (client-safe, src/lib/format.ts) instead.
const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk(ROOT).map((path) => ({ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }));

function offenders(pattern: RegExp, skip: (path: string) => boolean = () => false) {
  return files
    .filter((f) => !skip(f.path))
    .flatMap((f) => f.text.split("\n").map((line, i) => ({ at: `${f.path}:${i + 1}`, line })))
    .filter(({ line }) => pattern.test(line))
    .map(({ at }) => at);
}

describe("no UTC day logic in user-facing code", () => {
  it("never derives today's date from the UTC instant", () => {
    expect(offenders(/\b(?:new Date\(\)|now)\.toISOString\(\)\.slice\(0, 10\)/)).toEqual([]);
  });

  it("never buckets an API day boundary on the server clock", () => {
    expect(offenders(/\.setHours\((?:0|24), ?0, ?0, ?0\)/, (p) => !p.startsWith("app/api/"))).toEqual([]);
  });
});
