import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("booking wizard event context recovery", () => {
  it("keeps failed calendar-event reads distinct from true no-event results", () => {
    const hook = readFileSync("src/components/create-booking/use-event-context.ts", "utf8");
    const step = readFileSync("src/components/booking-wizard/WizardStep1.tsx", "utf8");
    const wizard = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");

    expect(hook).toContain("eventsLoadError");
    expect(hook).toContain('throw new Error(await parseErrorMessage(res, "Failed to load events"))');
    expect(hook).toContain('setEventsLoadError(err instanceof TypeError ? "network" : "server")');
    expect(hook).toContain("retryEvents");

    // The Apple-style refresh compressed the recovery copy; what matters is
    // that the error state stays distinct from the true no-event empty state
    // and both keep their recovery actions.
    expect(step).toContain("Events failed to load.");
    expect(step).toContain("Calendar unavailable.");
    expect(step).toContain("Retry");
    expect(step).toContain("Ad hoc");
    expect(step).toContain("No upcoming events");

    expect(wizard).toContain("eventsLoadError={eventsLoadError}");
    expect(wizard).toContain("onRetryEvents={retryEvents}");
  });

  it("loads a reuse plan instead of remaining reservation lines only", () => {
    const wizard = readFileSync("src/components/booking-wizard/BookingWizard.tsx", "utf8");
    expect(wizard).toContain("/api/bookings/${reuseFromId}/reuse-plan");
    expect(wizard).toContain("deriveReusedReservationWindow");
    expect(wizard).toContain("SET_REQUESTER");
    expect(wizard).toContain("Choose a different event when re-reserving");
  });
});
