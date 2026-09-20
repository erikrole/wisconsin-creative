import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

/**
 * Neon scale-to-zero budget.
 *
 * A Neon compute endpoint suspends after a period with no queries. The kiosk
 * fleet previously made that impossible: a 5-minute heartbeat that ran
 * regardless of use, and a `lastSeenAt` UPDATE on every single authenticated
 * request. That is a write roughly every 5 minutes per device, forever, which
 * sits right on the suspend threshold — so the endpoint stayed hot 24/7 and
 * the existing idle-gating on the dashboard poll bought nothing.
 *
 * These assertions pin the shape of the fix, not just its constants.
 */
describe("kiosk Neon compute budget", () => {
  it("backs the heartbeat off when the kiosk is idle or it is night", () => {
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");

    expect(store).toContain("private static let heartbeatInterval: UInt64 = 300_000_000_000");
    expect(store).toContain("private static let heartbeatIdleInterval: UInt64 = 3_600_000_000_000");
    expect(store).toContain("static func isNightHours(");
    expect(store).toContain("(isDeviceIdle || Self.isNightHours()) ? Self.heartbeatIdleInterval : Self.heartbeatInterval");
    // Chosen per cycle, so a kiosk that wakes mid-sleep returns to the active
    // cadence on its next beat rather than staying slow for an hour.
    expect(store).toContain("let interval = await MainActor.run { self?.nextHeartbeatInterval }");
  });

  it("keeps the idle dashboard poll gated and wake-driven", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");

    expect(idle).toContain("private let refreshInterval: TimeInterval = 5 * 60");
    expect(idle).toContain("guard !store.isDeviceIdle else { continue }");
    // Waking must refetch immediately rather than waiting out the cadence,
    // otherwise backing off the poll would show a returning student stale data.
    expect(idle).toContain(".onChange(of: store.isDeviceIdle)");
  });

  it("keeps the student hub bounded and stops its safety poll while idle", () => {
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const poll = hub.slice(
      hub.indexOf('.task(id: "refresh")'),
      hub.indexOf('.sheet(item: $selectedCheckout)'),
    );

    expect(hub).toContain("private let refreshInterval: TimeInterval = 180");
    expect(hub).not.toContain("private let refreshInterval: TimeInterval = 30");
    expect(poll).toContain("guard !Task.isCancelled else { break }");
    expect(poll).toContain("guard !store.isDeviceIdle else { continue }");
    expect(poll.indexOf("guard !store.isDeviceIdle else { continue }")).toBeLessThan(
      poll.indexOf("await loadContext()"),
    );
  });

  it("throttles the per-request lastSeenAt write", () => {
    const auth = source("src/lib/auth.ts");

    expect(auth).toContain("const lastSeenThrottleMs = 1000 * 60 * 5;");
    expect(auth).toContain("const shouldTouchLastSeen =");
    // The whole point: when neither the slide nor the touch is due, no UPDATE
    // is issued at all. Reads must be able to stay reads.
    expect(auth).toContain("if (!shouldSlide && !shouldTouchLastSeen) {");
    expect(auth).toContain("return kioskContext;");
  });

  it("caches the shared event window but never live custody state", () => {
    const events = source("src/app/api/kiosk/events/route.ts");
    const dashboard = source("src/app/api/kiosk/dashboard/route.ts");

    expect(events).toContain("const EVENT_CACHE_TTL_MS = 60_000;");
    expect(events).toContain("eventCache.expiresAt > now.getTime()");
    // Custody state is never cached — a stale dashboard would misreport who
    // holds what, which is worse than any compute saving.
    expect(dashboard).not.toContain("CACHE_TTL");
    expect(dashboard).not.toContain("cache =");
  });

  it("reports build identity without reintroducing a per-heartbeat write", () => {
    const route = source("src/app/api/kiosk/heartbeat/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const schema = source("prisma/schema.prisma");

    // Fleet visibility: the server can answer "which build is this iPad on?"
    expect(schema).toContain('appVersion              String?   @map("app_version")');
    expect(client).toContain("struct KioskBuildIdentity: Encodable");
    expect(client).toContain("JSONEncoder().encode(KioskBuildIdentity.current)");
    // No UIKit: UIDevice is main-actor isolated under Swift 6 and would force
    // the background heartbeat to hop to the main actor for a version string.
    expect(client).toContain("ProcessInfo.processInfo.operatingSystemVersion");
    expect(client).not.toContain("UIDevice.current.systemVersion");

    // The whole point of the compute work: a kiosk reports the same build on
    // every beat for weeks, so this must only write when a value CHANGED.
    expect(route).toContain("const changed =");
    expect(route).toContain("if (changed) {");
    expect(route).toContain("appReportedAt: new Date()");
  });
});
