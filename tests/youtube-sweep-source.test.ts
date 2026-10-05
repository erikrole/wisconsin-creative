import { describe, expect, it } from "vitest";

import { source } from "./_helpers/source";

describe("YouTube morning sweep", () => {
  it("is a cron-secret route that only refreshes the library and never sends", () => {
    const route = source("src/app/api/cron/youtube-sweep/route.ts");
    expect(route).toContain("withCron");
    expect(route).toContain("refreshLibrary(null)");
    expect(route).not.toMatch(/publish-service|publishDraft|makePublic|addToPlannedPlaylists/);
    expect(source("vercel.json")).toContain("/api/cron/youtube-sweep");
  });
});
