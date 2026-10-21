import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
const prompt = readFileSync("src/components/InstallAppPrompt.tsx", "utf8");
const apps = readFileSync("src/lib/apps-page.ts", "utf8");

describe("app download prompts", () => {
  it("offers Safari's Smart App Banner on signed-in pages only, using the live App Store id", () => {
    expect(layout).toContain('itunes: { appId: "6763456945" }');
    expect(apps).toContain("id6763456945");
  });

  it("offers Android install once, never in the installed app, and not in role previews", () => {
    expect(layout).toContain("{!user.preview && <InstallAppPrompt />}");
    expect(prompt).toContain("/Android/i.test(navigator.userAgent)");
    expect(prompt).toContain("(display-mode: standalone)");
    expect(prompt).toContain("localStorage.setItem(DONE_KEY");
    expect(prompt).toContain("e.preventDefault()");
  });
});
