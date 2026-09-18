import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("booking wizard kit fetching recovery", () => {
  it("keeps failed kit reads distinct from true no-kit results", () => {
    const hook = readFileSync("src/components/create-booking/use-kit-fetching.ts", "utf8");
    const step = readFileSync("src/components/booking-wizard/WizardStep1.tsx", "utf8");
    const wizard = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");

    expect(hook).toContain("kitsLoadError");
    expect(hook).toContain('throw new Error(await parseErrorMessage(res, "Failed to load kits"))');
    expect(hook).toContain('setKitsLoadError(err instanceof TypeError ? "network" : "server")');
    expect(hook).toContain("requester_user_id");
    expect(hook).toContain("suggestedKitId");
    expect(hook).toContain("filter((kit) => kit.contents > 0)");
    expect(step).toContain("callingKitLabel");

    // Copy was compressed in the Apple-style refresh; the contract is that a
    // failed kit read renders a visible error with a Retry action (instead of
    // silently looking like "no kits") and the Kit field stays visible while
    // loading or errored.
    expect(step).toContain("Kits failed to load.");
    expect(step).toContain("onClick={onRetryKits}");
    expect(step).toContain("kits.length > 0 || kitsLoading || kitsLoadError");
    expect(step).toContain("Gameday kit");
    expect(step).toContain("Selecting a kit adds every camera, lens, and battery");

    expect(wizard).toContain("kitsLoadError={kitsLoadError}");
    expect(wizard).toContain("onRetryKits={retryKits}");
    expect(wizard).toContain("queryKey: [\"kitDetail\", kitId]");
    expect(wizard).toContain("setSelectedAssetIds(snapshots.map((asset) => asset.id))");
    expect(wizard).toContain("setSelectedBulkItems(selectedKitDetail.bulkMembers.map((member) => ({");
    expect(wizard).toContain("suggestedKitId");
    expect(wizard).not.toContain("value: selectedKit");
  });
});
