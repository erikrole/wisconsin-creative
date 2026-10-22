import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
const apps = readFileSync("src/lib/apps-page.ts", "utf8");

describe("iPhone app banner", () => {
  it("offers Safari's Smart App Banner on signed-in pages only, using the live App Store id", () => {
    expect(layout).toContain('itunes: { appId: "6763456945" }');
    expect(apps).toContain("id6763456945");
  });
});
