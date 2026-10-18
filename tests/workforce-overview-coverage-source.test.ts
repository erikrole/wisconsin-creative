import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(process.cwd(), "src/app/(app)/staff/workforce/page.tsx"), "utf8");

describe("Workforce overview coverage", () => {
  it("lists coverage by area with risk flags and anchors to each area", () => {
    expect(page).toContain('aria-label="Coverage by area"');
    expect(page).toContain("href={`#area-${row.key}`}");
    expect(page).toContain("id={`area-${key}`}");
    expect(page).toContain('risk === "gap"');
    expect(page).toContain("leaving * 2 >= studs.length");
  });

  it("keeps the overview admin-only", () => {
    expect(page).toContain('if (user.role !== Role.ADMIN) redirect("/")');
  });
});
