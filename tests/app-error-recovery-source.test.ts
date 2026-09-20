import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("app error recovery surfaces", () => {
  it("renders all app error boundaries through the shared recovery panel", () => {
    const root = source("src/app/error.tsx");
    const app = source("src/app/(app)/error.tsx");
    const global = source("src/app/global-error.tsx");

    for (const text of [root, app, global]) {
      expect(text).toContain('import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel"');
      expect(text).toContain("<ErrorRecoveryPanel");
      expect(text).not.toContain("Something went wrong");
      expect(text).not.toContain("style={{");
    }

    expect(root).not.toContain("<html");
    expect(root).not.toContain("<body");
    expect(app).not.toContain("<html");
    expect(app).not.toContain("<body");
    expect(global).toContain("<html");
    expect(global).toContain("<body");
  });

  it("keeps retry and secondary actions on shadcn buttons with operational copy", () => {
    const panel = source("src/components/ErrorRecoveryPanel.tsx");

    expect(panel).toContain('import { Button } from "@/components/ui/button"');
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('retryLabel = "Retry"');
    expect(panel).toContain('<RotateCcwIcon data-icon="inline-start" />');
    expect(panel).toContain('<SecondaryIcon data-icon="inline-start" />');
    expect(panel).toContain("Error ID:");
  });
});
