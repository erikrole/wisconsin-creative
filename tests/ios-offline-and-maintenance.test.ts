import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS reconnect refresh", () => {
  const monitor = source("ios/Wisconsin/Core/NetworkMonitor.swift");
  const home = source("ios/Wisconsin/Views/HomeView.swift");
  const bookings = source("ios/Wisconsin/Views/BookingsView.swift");

  /**
   * `NWPathMonitor` reports every path change, including interface swaps that
   * stay satisfied throughout. Observing `isConnected` directly would refetch
   * on those too, so the transition gets its own counter.
   */
  it("signals only the offline to online transition", () => {
    expect(monitor).toContain("private(set) var reconnectionToken = 0");
    expect(monitor).toContain("guard connected != self.isConnected else { return }");
    expect(monitor).toContain("if connected { self.reconnectionToken += 1 }");
  });

  it("refetches the visible tab when signal returns", () => {
    for (const [view, tab] of [
      [home, 0],
      [bookings, 1],
    ] as const) {
      expect(view).toContain("@Environment(NetworkMonitor.self) private var network");
      expect(view).toContain("onChange(of: network.reconnectionToken)");
      // Gated, so a reconnection does not fan out into one refetch per tab
      // that happens to still be alive behind the tab bar.
      expect(view).toContain(`guard appState.selectedTab == ${tab} else { return }`);
    }
  });

  /**
   * The existing contract forbids reading cached rows into the Bookings list
   * (`student-field-contracts.test.ts` — "flashing stale cache rows"). A
   * reconnect refetch must not reintroduce that by another route.
   */
  it("refetches rather than falling back to the cache", () => {
    expect(bookings).not.toContain("GearStore.shared.cachedBookings");
    const reconnect = bookings.slice(
      bookings.indexOf("onChange(of: network.reconnectionToken)"),
      bookings.indexOf(".refreshable { await vm.load(reset: true) }"),
    );
    expect(reconnect).toContain("vm.load(reset: true)");
    // Keeps existing rows: a reconnection must never blank a list that was
    // readable a moment ago.
    expect(reconnect).not.toContain("clearExistingRows: true");
  });

  it("lets only the newest availability check publish", () => {
    const detail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    expect(detail).toContain("@State private var availabilityRequests = LatestRequestGeneration()");
    expect(detail).toContain("let requestToken = availabilityRequests.begin()");
    expect(detail).toContain("guard availabilityRequests.owns(requestToken) else { return }");
  });
});

describe("iOS item maintenance flag (GAP-36, field-work slice)", () => {
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
  const route = source("src/app/api/assets/[id]/maintenance/route.ts");
  const permissions = source("src/lib/permissions.ts");

  it("exposes the toggle the server actually implements", () => {
    expect(apiClient).toContain("func toggleAssetMaintenance(assetId: String) async throws -> Bool");
    expect(apiClient).toContain('request(path: "/api/assets/\\(assetId)/maintenance", method: "POST")');
    // Toggle, not a setter: the route derives the next status itself.
    expect(route).toContain('before.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE"');
    expect(route).toContain('isolationLevel: "Serializable"');
    expect(route).toContain("createAuditEntry(");
  });

  /**
   * The route replies with the raw Prisma row, whose `status` is the stored
   * enum rather than the derived `computedStatus` every Swift asset model
   * reads. Decoding the whole row as an `Asset` would fail at runtime.
   */
  it("decodes only the field the route actually returns", () => {
    const fn = apiClient.slice(
      apiClient.indexOf("func toggleAssetMaintenance("),
      apiClient.indexOf("// MARK: - Notifications"),
    );
    expect(fn).toContain("struct AssetStatus: Decodable { let status: String }");
    expect(fn).toContain("DataWrapper<AssetStatus>");
    expect(fn).not.toContain("DataWrapper<Asset>");
    expect(fn).not.toContain("computedStatus");
  });

  it("gates the action to the roles the permission matrix allows", () => {
    expect(permissions).toContain('maintenance: ["ADMIN", "STAFF"]');
    expect(route).toContain('requirePermission(user.role, "asset", "maintenance")');
    // `canEditAsset` is the same STAFF/ADMIN test.
    expect(itemDetail).toContain('return role == "STAFF" || role == "ADMIN"');
    const menu = itemDetail.slice(
      itemDetail.indexOf("if canEditAsset {"),
      itemDetail.indexOf("if let qr = asset.qrCodeValue"),
    );
    expect(menu).toContain("toggleMaintenance(for: asset)");
  });

  /**
   * GAP-36 also lists Duplicate, Retire, and Delete. Those are catalog
   * administration, which `AREA_MOBILE.md` keeps web-only; only the field-work
   * action ships to the phone.
   */
  it("does not bring catalog administration onto the phone", () => {
    expect(itemDetail).not.toContain("/duplicate");
    expect(itemDetail).not.toContain("/retire");
    expect(itemDetail).not.toContain('Label("Delete Item"');
    expect(itemDetail).not.toContain('Label("Retire Item"');
    expect(itemDetail).not.toContain('Label("Duplicate Item"');
  });

  it("refetches instead of guessing the derived status", () => {
    const fn = itemDetail.slice(
      itemDetail.indexOf("private func toggleMaintenance("),
      itemDetail.indexOf("/// Copy the QR sticker code"),
    );
    expect(fn).toContain("await loadAsset()");
    expect(fn).toContain("guard !isTogglingMaintenance else { return }");
    // Not optimistic: this changes what other people can reserve.
    expect(fn).not.toContain("asset.computedStatus =");
    expect(fn).toContain("Haptics.success()");
    expect(fn).toContain("Haptics.error()");
  });
});
