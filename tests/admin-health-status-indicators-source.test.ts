import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("admin health status indicators", () => {
  it("uses a static, labeled status dot", () => {
    const indicator = source("src/components/ui/status-indicator.tsx");

    expect(indicator).toContain("bg-current");
    expect(indicator).not.toContain("animate-ping");
    expect(indicator).not.toContain("shouldAnimate");
  });

  it("shows the shared operational rail and status indicators on Operations", () => {
    const sourceText = source("src/app/(app)/operations/OperationsClient.tsx");

    expect(sourceText).toContain('import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail"');
    expect(sourceText).toContain('import StatusIndicator from "@/components/ui/status-indicator"');
    expect(sourceText).toContain("const railItems: OperationalStatusRailItem[]");
    expect(sourceText).toContain('id: "critical-checks"');
    expect(sourceText).toContain('id: "partial-data"');
    expect(sourceText).toContain("<OperationalStatusRail");
    expect(sourceText).toContain('"Operations are clear"');
    expect(sourceText).toContain("state={meta.state}");
  });

  it("redirects the merged Fix Today and Inventory Hygiene routes to Operations", () => {
    expect(source("src/app/(app)/admin/fix-today/page.tsx")).toContain('redirect("/operations")');
    expect(source("src/app/(app)/items/hygiene/page.tsx")).toContain('redirect("/operations")');
  });
});
