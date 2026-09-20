import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("dashboard pending pickup links", () => {
  it("routes pending-pickup rows to checkouts awaiting handoff", () => {
    const component = source("src/app/(app)/dashboard/team-activity-column.tsx");
    expect(component).toContain('const PENDING_PICKUPS_HREF = "/bookings?tab=checkouts&status=PENDING_PICKUP"');
    expect(component).toContain('title="Pending pickup" href={PENDING_PICKUPS_HREF}');
  });

  it("includes Pending Pickup in the active-booking summary", () => {
    const page = source("src/app/(app)/page.tsx");
    expect(page).toContain(
      "const pendingPickupTotal = data?.pendingPickups.total ?? fastStats?.pendingPickupTotal ?? 0",
    );
    expect(page).toContain(
      "stats.checkedOut + stats.reserved + pendingPickupTotal",
    );
    expect(page).toContain('label: "Pending pickup"');
    expect(page).toContain(
      '<OperationalMetricCard label="Pending pickup" value={pendingPickupTotal}',
    );
  });

  it("uses the accepted missed-pickup wording in dashboard rows", () => {
    const row = source("src/app/(app)/dashboard/booking-row.tsx");
    expect(row).toContain('pickupIsLate ? "Pickup was due" : "Pickup"');
    expect(row).toContain("formatOperationalDateTime(");
    expect(row).toContain("showPickupBadge ? booking.startsAt : booking.endsAt");
  });

  it("shows pickup time on team and personal reservation cards", () => {
    const teamActivity = source("src/app/(app)/dashboard/team-activity-column.tsx");
    const myGear = source("src/app/(app)/dashboard/my-gear-column.tsx");

    expect(teamActivity).toContain('accent="reservation"\n                showPickupBadge');
    expect(myGear).toContain('accent="reservation"\n                    showPickupBadge');
  });

  it("retires the separate stale-reservation dashboard lane", () => {
    const component = source("src/app/(app)/dashboard/team-activity-column.tsx");
    const route = source("src/app/api/dashboard/route.ts");
    const countReader = source("src/lib/services/dashboard-counts.ts");
    expect(component).not.toContain("STALE_RESERVATIONS_HREF");
    expect(component).not.toContain('title="Stale reservations"');
    expect(route).toContain("staleReservations");
    expect(countReader).toContain("0::bigint AS stale_reservations");
  });
});
