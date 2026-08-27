import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { copyTextToClipboard } from "@/lib/clipboard";

const source = (path: string) => readFileSync(path, "utf8");

const clipboardConsumers = [
  "src/app/(app)/settings/kiosk-devices/page.tsx",
  "src/components/resources/MarkdownReader.tsx",
  "src/app/(app)/users/[id]/UserInfoTab.tsx",
  "src/app/(app)/items/[id]/ItemInfoTab.tsx",
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operator clipboard feedback", () => {
  it("reports success only after the browser clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("visible value")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("visible value");
  });

  it("reports failure when the browser rejects or lacks clipboard access", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("visible value")).resolves.toBe(false);

    vi.stubGlobal("navigator", {});
    await expect(copyTextToClipboard("visible value")).resolves.toBe(false);
    await expect(copyTextToClipboard("")).resolves.toBe(false);
  });

  it("routes selected copy controls through the shared outcome helper", () => {
    for (const path of clipboardConsumers) {
      const text = source(path);
      expect(text, path).toMatch(/copyTextToClipboard|useCopyFeedback/);
      expect(text, path).not.toContain("navigator.clipboard.writeText");
      expect(text, path).toContain("Select the visible");
    }
  });

  it("BUG: keeps transient copied feedback owned by the latest attempt", () => {
    const hook = source("src/hooks/use-copy-feedback.ts");
    const item = source("src/app/(app)/items/[id]/ItemInfoTab.tsx");
    const markdown = source("src/components/resources/MarkdownReader.tsx");

    expect(hook).toContain('export type CopyFeedbackResult = "copied" | "failed" | "superseded"');
    expect(hook).toContain("if (attempt !== latestAttemptRef.current) return \"superseded\"");
    expect(hook).toContain("window.clearTimeout(resetTimerRef.current)");
    expect(hook).toContain("latestAttemptRef.current += 1");
    expect(item).toContain("useCopyFeedback(2000)");
    expect(item.match(/useCopyFeedback\(1600\)/g)).toHaveLength(2);
    expect(markdown).toContain("useCopyFeedback(1400)");
    expect(item).not.toMatch(/setTimeout\(\(\) => setCopied/);
    expect(markdown).not.toMatch(/setTimeout\(\(\) => setCopied/);
  });
});

describe("user deactivation confirmation", () => {
  it("confirms the consequence before the optimistic status update", () => {
    const page = source("src/app/(app)/users/[id]/page.tsx");
    const start = page.indexOf("async function toggleActive");
    const end = page.indexOf("async function handlePasswordReset", start);
    const toggle = page.slice(start, end);

    expect(toggle).toContain("if (!newActive)");
    expect(toggle).toContain("const ok = await confirm({");
    expect(toggle).toContain("will be signed out");
    expect(toggle).toContain("future reservations or pending pickups will be cancelled");
    expect(toggle).toContain("Any open checkout must be returned before deactivation");
    expect(toggle).toContain('confirmLabel: "Deactivate user"');
    expect(toggle).toContain("if (!ok) return;");
    expect(toggle.indexOf("if (!ok) return;")).toBeLessThan(
      toggle.indexOf("setUserOverrides((prev) => ({ ...prev, active: newActive }))"),
    );
  });
});
