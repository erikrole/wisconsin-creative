import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Product rule: every day bucket, "today/tomorrow" label and displayed date uses
// America/Chicago, never the server clock (Vercel runs UTC). A UTC date slice
// files a 7 PM Central event under the next day. These files predate the guard.
// Fix one, then lower its number; do not add a new entry or raise a number.
const KNOWN_UTC_DAY_SLICES: Record<string, number> = {
  "src/app/api/assets/export/route.ts": 1,
  "src/app/api/budget/[id]/import/route.ts": 1,
  "src/app/api/shifts/ics/[token]/route.ts": 1,
  "src/app/api/users/export/route.ts": 1,
  "src/lib/app-time.ts": 1,
  "src/lib/badges/automatic-rules.ts": 1,
  "src/lib/football-results.ts": 1,
  "src/lib/hiring/contract.ts": 1,
  "src/lib/services/budget.ts": 2,
  "src/lib/services/schedule-exports.ts": 2,
  "src/lib/services/wishlist.ts": 1,
  "src/lib/student-availability.ts": 1,
  "src/lib/youtube/rules.ts": 2,
};

const UTC_DAY_SLICE = /toISOString\(\)\.slice\(0,\s*10\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("Chicago day rule guard", () => {
  const found = new Map<string, number>();
  for (const file of sourceFiles("src")) {
    const count = readFileSync(file, "utf8").match(UTC_DAY_SLICE)?.length ?? 0;
    if (count > 0) found.set(file.split(path.sep).join("/"), count);
  }

  it("adds no new UTC date slicing; use the America/Chicago helpers in src/lib/app-time.ts", () => {
    const worse = [...found].filter(([file, count]) => count > (KNOWN_UTC_DAY_SLICES[file] ?? 0));
    expect(worse).toEqual([]);
  });

  it("keeps the allowlist honest by dropping entries once a file is fixed", () => {
    const stale = Object.entries(KNOWN_UTC_DAY_SLICES).filter(([file, count]) => (found.get(file) ?? 0) < count);
    expect(stale).toEqual([]);
  });
});
