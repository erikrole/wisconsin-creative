import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listViewSource = readFileSync("src/app/(app)/schedule/_components/ListView.tsx", "utf8");
const crewSource = readFileSync("src/app/(app)/events/[id]/_components/ShiftCoverageCard.tsx", "utf8");
const reservationWizardSource = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");

describe("schedule gear readiness source contracts", () => {
  it("keeps Schedule list free of reservation prep and checkout custody actions", () => {
    expect(listViewSource).not.toContain("Reserve gear");
    expect(listViewSource).not.toContain("/reservations/new?");
    expect(listViewSource).not.toContain("/checkouts/new");
  });

  it("keeps per-row gear readiness out of Event detail Crew rows", () => {
    const eventDetail = readFileSync("src/app/(app)/events/[id]/page.tsx", "utf8");
    const eventHeader = readFileSync("src/app/(app)/events/[id]/_components/EventHeader.tsx", "utf8");
    // Crew rows carry one signal (coverage status). Event detail does not host
    // a gear-readiness or missing-gear card; Reserve gear stays on the header.
    for (const label of ["Assignment gear", "Event reservation", "Pickup ready"]) {
      expect(crewSource).not.toContain(label);
    }
    expect(crewSource).not.toContain("Missing Gear (");
    expect(eventDetail).not.toContain("Missing Gear (");
    expect(eventDetail).not.toContain("EventGearCard");
    expect(eventHeader).toContain("Reserve gear for this event");
  });

  it("shows audit-derived schedule changes without draft/review badges", () => {
    const readinessSource = readFileSync("src/app/(app)/schedule/_components/ScheduleReadiness.tsx", "utf8");
    const activitySource = readFileSync("src/app/(app)/events/[id]/_components/EventActivityCard.tsx", "utf8");
    expect(readinessSource).toContain('label: "Assignee changes"');
    expect(readinessSource).toContain("recentActivityCount");
    expect(listViewSource).not.toContain("Review changes");
    expect(listViewSource).not.toContain("Unpublished changes");
    expect(crewSource).not.toContain("Recent schedule changes");
    expect(activitySource).toContain("Activity");
    expect(activitySource).toContain("Needs review");
  });

  it("preserves assignment context when Schedule opens the reservation wizard", () => {
    expect(reservationWizardSource).toContain("initialShiftAssignmentId");
    expect(reservationWizardSource).toContain("payload.shiftAssignmentId");
  });
});
