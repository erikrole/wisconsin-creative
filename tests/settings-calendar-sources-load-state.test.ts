import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calendarSourceHealthErrorFromSync,
  calendarSourceSyncToast,
} from "@/app/(app)/settings/calendar-sources/calendar-source-sync-copy";

describe("settings calendar sources load state", () => {
  it("does not report an API load failure as an empty calendar-source list", () => {
    const source = readFileSync("src/app/(app)/settings/calendar-sources/page.tsx", "utf8");

    expect(source).toContain("error: sourcesError");
    expect(source).toContain("hasInitialLoadError");
    expect(source).toContain("Calendar sources could not load.");
    expect(source).toContain("Retry sources");
    expect(source).toContain('title="No calendar sources configured"');
  });

  it("keeps add-source fields connected to explicit labels and form metadata", () => {
    const source = readFileSync("src/app/(app)/settings/calendar-sources/page.tsx", "utf8");

    expect(source).toContain('htmlFor="calendar-source-name"');
    expect(source).toContain('id="calendar-source-name"');
    expect(source).toContain('name="calendarSourceName"');
    expect(source).toContain('htmlFor="calendar-source-url"');
    expect(source).toContain('id="calendar-source-url"');
    expect(source).toContain('name="calendarSourceUrl"');
  });

  it("formats calendar source sync outcomes without hiding feed errors", () => {
    expect(calendarSourceSyncToast("UW Badgers", {
      added: 2,
      updated: 3,
      cancelled: 1,
      skipped: 0,
      shiftGeneration: { groupsCreated: 1, shiftsCreated: 4 },
    })).toEqual({
      variant: "success",
      message: "Synced UW Badgers: 2 events added, 3 events refreshed, 1 event cancelled. Created 1 shift group and 4 shifts.",
    });

    expect(calendarSourceSyncToast("UW Badgers", {
      error: "HTTP 500",
    })).toEqual({
      variant: "error",
      message: "UW Badgers sync failed: HTTP 500",
    });

    expect(calendarSourceSyncToast("UW Badgers", {
      added: 0,
      updated: 4,
      skipped: 1,
      errors: [{ uid: "bad-event" }],
      shiftGenerationError: "Template failed",
    })).toEqual({
      variant: "warning",
      message: "Synced UW Badgers with warnings: 4 events refreshed, 1 event skipped. Shift generation failed after sync.",
    });
  });

  it("derives calendar source health errors from sync result data", () => {
    expect(calendarSourceHealthErrorFromSync({ error: "HTTP 404" })).toBe("HTTP 404");
    expect(calendarSourceHealthErrorFromSync({ skipped: 2 })).toBe("2 events skipped during the last sync.");
    expect(calendarSourceHealthErrorFromSync({ added: 1, updated: 0, skipped: 0 })).toBe(null);
  });

  it("keeps calendar source actions guarded and copy scoped in the page source", () => {
    const source = readFileSync("src/app/(app)/settings/calendar-sources/page.tsx", "utf8");

    expect(source).toContain("const sourceActionRef = useRef<string | null>(null)");
    expect(source).toContain("if (sourceActionRef.current) return;");
    expect(source).toContain("const toastCopy = calendarSourceSyncToast(source.name, json.data)");
    expect(source).toContain("calendarSourceHealthErrorFromSync(json.data)");
    expect(source).toContain("They sync every morning");
    expect(source).toContain("disabled={Boolean(syncing || toggling) || !source.enabled}");
    expect(source).toContain("addBusyRef.current = true");
    expect(source).toContain("testingRef.current = true");
  });
});
