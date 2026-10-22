import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("home pending pickup links", () => {
  it("routes the pending-pickup count to checkouts awaiting handoff", () => {
    const model = source("src/app/(app)/_home/home-model.ts");
    expect(model).toContain('export const PENDING_PICKUP_HREF = "/bookings?tab=checkouts&status=PENDING_PICKUP"');
    expect(model).toContain('{ id: "pending-pickup", label: "Pending pickup", value: pendingPickup');
    expect(model).toContain("const pendingPickup = data?.pendingPickups.total ?? stats?.pendingPickupTotal ?? null;");
  });

  it("uses the accepted missed-pickup wording in Home rows", () => {
    const model = source("src/app/(app)/_home/home-model.ts");
    expect(model).toContain("Pickup was due ${formatOperationalDateTime(p.startsAt, now");
    expect(model).toContain('{ label: "Pickup was due", tone: "warning" }');
  });

  it("retires the separate stale-reservation dashboard lane", () => {
    const view = source("src/app/(app)/_home/HomeView.tsx");
    const model = source("src/app/(app)/_home/home-model.ts");
    const route = source("src/app/api/dashboard/route.ts");
    const countReader = source("src/lib/services/dashboard-counts.ts");
    expect(view + model).not.toContain("STALE_RESERVATIONS_HREF");
    expect(view + model).not.toContain("Stale reservations");
    expect(route).toContain("staleReservations");
    expect(countReader).toContain("0::bigint AS stale_reservations");
  });
});
