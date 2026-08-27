import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("list state preservation source contracts", () => {
  it("keeps Items query state in the App Router history", () => {
    const filters = source("src/app/(app)/items/hooks/use-url-filters.ts");
    const query = source("src/app/(app)/items/hooks/use-items-query.ts");

    expect(filters).toContain("usePathname, useRouter, useSearchParams");
    expect(filters).toContain("router.replace(newUrl, { scroll: false })");
    expect(filters).not.toContain("window.history.replaceState");
    expect(query).toContain("usePathname, useRouter, useSearchParams");
    expect(query).toContain("router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })");
    expect(query).not.toContain("window.history.replaceState");
  });

  it("serializes and rehydrates the complete Schedule list context", () => {
    const schedule = source("src/hooks/use-schedule-data.ts");

    for (const key of [
      "view",
      "month",
      "week",
      "sportCode",
      "area",
      "coverage",
      "venue",
      "includeArchived",
      "myShifts",
    ]) {
      expect(schedule).toContain(`query.get("${key}")`);
    }

    expect(schedule).toContain("scheduleSearchSignatureRef");
    expect(schedule).toContain("skipNextScheduleUrlWriteRef");
    expect(schedule).toContain("router.replace(nextUrl, { scroll: false })");
    expect(schedule).toContain("setViewMode(parseScheduleViewMode(query.get(\"view\")) ?? \"list\")");
    expect(schedule).toContain("setAreaFilter(query.get(\"area\") ?? \"\")");
    expect(schedule).toContain("setHomeAwayFilter(parseScheduleVenue(query.get(\"venue\")))");
  });

  it("keeps existing queue/deep-link parameters while clearing owned filters", () => {
    const schedule = source("src/hooks/use-schedule-data.ts");

    expect(schedule).toContain('params.set("queue", queue)');
    expect(schedule).toContain('params.delete("queue")');
    for (const key of ["area", "coverage", "venue", "includeArchived", "startDate", "endDate"]) {
      expect(schedule).toContain(`params.delete("${key}")`);
    }
  });
});
