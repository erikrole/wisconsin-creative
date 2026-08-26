import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
}

describe("Snow Leopard website bug regressions", () => {
  it("keeps booking list extensions on the optimistic-lock contract", () => {
    const list = source("src/components/BookingListPage.tsx");
    const types = source("src/components/booking-list/types.ts");
    const route = source("src/app/api/bookings/[id]/extend/route.ts");
    const concurrency = source("src/lib/booking-concurrency.ts");

    expect(types).toContain("updatedAt: string;");
    expect(list).toContain("[BOOKING_SNAPSHOT_HEADER]: new Date(item.updatedAt).toISOString()");
    expect(route).toContain("parseBookingSnapshotHeader(req)");
    expect(concurrency).toContain('req.headers.get(BOOKING_SNAPSHOT_HEADER)');
    expect(concurrency).toContain('req.headers.get("if-unmodified-since")');
  });

  it("derives collaborator reservation controls from effective capabilities", () => {
    const policy = source("src/lib/booking-action-policy.ts");
    const list = source("src/components/BookingListPage.tsx");
    const menu = source("src/components/booking-list/BookingContextMenu.tsx");
    const item = source("src/app/(app)/items/[id]/_components/ItemHeader.tsx");

    expect(policy).toContain("RESERVATION_EDIT_OWN");
    expect(policy).toContain("RESERVATION_EXTEND_OWN");
    expect(policy).toContain("RESERVATION_CANCEL_OWN");
    expect(menu).toContain("currentUserCapabilities");
    expect(list).toContain('currentUserCapabilities.includes("RESERVATION_CREATE")');
    expect(item).toContain('currentUser.capabilities?.includes("RESERVATION_CREATE")');
  });

  it("hides Schedule follow controls without the follow grant", () => {
    const page = source("src/app/(app)/schedule/page.tsx");
    const schedule = source("src/app/(app)/schedule/_components/CollaboratorSchedule.tsx");
    const route = source("src/app/api/schedule/published/[id]/follow/route.ts");

    expect(page).toContain('canFollow={user.capabilities?.includes("SCHEDULE_FOLLOW") === true}');
    expect(schedule).toContain("{canFollow && (");
    expect(schedule).toContain("if (!canFollow) return;");
    expect(route).toContain('requireCollaboratorCapability(user, "SCHEDULE_FOLLOW")');
  });

  it("keeps live shifts internal and collaborator reference data capability-gated", () => {
    const myHours = source("src/app/api/shifts/my-hours/route.ts");
    const token = source("src/app/api/shifts/ics-token/route.ts");
    const feed = source("src/app/api/shifts/ics/[token]/route.ts");
    const init = source("src/app/api/items-page-init/route.ts");
    const brands = source("src/app/api/assets/brands/route.ts");
    const options = source("src/app/api/form-options/route.ts");

    expect(myHours).toContain("requireInternalActor(user)");
    expect(token).toContain("requireInternalActor(user)");
    expect(feed).toContain('user.role === "COLLABORATOR"');
    expect(init).toContain('"GEAR_CATALOG_VIEW"');
    expect(brands).toContain('"GEAR_CATALOG_VIEW"');
    expect(options).toContain('"MY_GEAR_VIEW"');
  });

  it("keeps drafts out of active booking lists and never labels one as pickup", () => {
    const route = source("src/app/api/bookings/route.ts");
    const home = source("src/app/(app)/dashboard/collaborator-home.tsx");
    const activeBlock = route.slice(route.indexOf("const ACTIVE_BOOKING_STATUSES"), route.indexOf("const PAST_BOOKING_STATUSES"));

    expect(activeBlock).not.toContain("BookingStatus.DRAFT");
    expect(home).toContain('if (booking.status === "DRAFT")');
    expect(home).toContain('label: "Draft"');
  });

  it("defers the browser Sentry SDK until page load, idle time, interaction, or navigation", () => {
    const instrumentation = source("src/instrumentation-client.ts");

    expect(instrumentation).not.toContain('import * as Sentry from "@sentry/nextjs"');
    expect(instrumentation).toContain('import("@sentry/nextjs")');
    expect(instrumentation).toContain("pointerdown");
    expect(instrumentation).toContain("requestIdleCallback");
    expect(instrumentation).toContain('window.addEventListener("load", warmSentryWhenIdle');
    expect(instrumentation).toContain("onRouterTransitionStart");
  });
});
