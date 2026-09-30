import { describe, expect, it } from "vitest";
import {
  buildEventCards,
  buildWeekStrip,
  eventLinkedBookingIds,
  formatCountdownTo,
  pickContextBanner,
  pickNextUp,
  type AgendaBooking,
  type AgendaEventWork,
  type AgendaInput,
} from "@/lib/home-agenda";

// Local-time fixture clock: Thursday 10:00.
const now = new Date(2026, 8, 24, 10, 0, 0);
const at = (dayOffset: number, hour: number, minute = 0) =>
  new Date(2026, 8, 24 + dayOffset, hour, minute).toISOString();

function booking(overrides: Partial<AgendaBooking> & { id: string }): AgendaBooking {
  return {
    kind: "RESERVATION",
    title: `Booking ${overrides.id}`,
    status: "BOOKED",
    startsAt: at(1, 9),
    endsAt: at(1, 17),
    isOverdue: false,
    itemCount: 2,
    locationName: "Camp Randall",
    linkedEventId: null,
    eventIds: [],
    ...overrides,
  };
}

function work(overrides: Partial<AgendaEventWork> & { id: string }, gear: AgendaBooking[] = []): AgendaEventWork {
  return {
    event: {
      id: overrides.id,
      summary: "Volleyball vs Nebraska",
      startsAt: at(0, 19),
      endsAt: at(0, 21),
      allDay: false,
      sportCode: "VB",
      opponent: "Nebraska",
      isHome: true,
      site: "HOME",
      locationId: "loc-1",
      locationName: "Field House",
    },
    shift: {
      id: `shift-${overrides.id}`,
      area: "VIDEO",
      workerType: "ST",
      startsAt: at(0, 17),
      endsAt: at(0, 21),
      callStartsAt: at(0, 17, 30),
      callEndsAt: at(0, 21),
      callNote: null,
    },
    gearBookings: gear,
    needsGear: gear.length === 0,
    ...overrides,
  };
}

const empty: AgendaInput = { myCheckouts: [], myReservations: [], myPendingPickups: [], myEventWork: [] };

describe("pickContextBanner", () => {
  it("returns null when nothing needs the viewer", () => {
    expect(pickContextBanner(empty, now)).toBeNull();
  });

  it("puts overdue gear ahead of everything else", () => {
    const banner = pickContextBanner({
      ...empty,
      myCheckouts: [booking({ id: "co", kind: "CHECKOUT", status: "OPEN", endsAt: at(0, 8), isOverdue: true, title: "FX3 kit" })],
      myPendingPickups: [booking({ id: "pk", startsAt: at(0, 9) })],
      myEventWork: [work({ id: "ev" })],
    }, now);
    expect(banner).toMatchObject({ kind: "overdue", key: "overdue:co", tone: "red", title: "Return FX3 kit" });
    expect(banner?.detail).toContain("Return to Camp Randall");
  });

  it("counts several overdue checkouts in one banner", () => {
    const banner = pickContextBanner({
      ...empty,
      myCheckouts: [
        booking({ id: "a", kind: "CHECKOUT", endsAt: at(0, 8), isOverdue: true }),
        booking({ id: "b", kind: "CHECKOUT", endsAt: at(-1, 8), isOverdue: true }),
      ],
    }, now);
    expect(banner).toMatchObject({ title: "2 checkouts are overdue", bookingId: "b" });
  });

  it("calls a pickup late only after a short grace", () => {
    const ready = pickContextBanner({ ...empty, myPendingPickups: [booking({ id: "p", startsAt: at(0, 9, 50) })] }, now);
    expect(ready?.title).toBe("Your gear is ready for pickup");
    const late = pickContextBanner({ ...empty, myPendingPickups: [booking({ id: "p", startsAt: at(0, 9) })] }, now);
    expect(late?.title).toMatch(/^Pickup was due at /);
  });

  it("asks for gear only on today's events with nothing reserved", () => {
    const tomorrow = work({ id: "tmrw", event: { ...work({ id: "x" }).event, id: "tmrw", startsAt: at(1, 19), endsAt: at(1, 21) } });
    expect(pickContextBanner({ ...empty, myEventWork: [tomorrow] }, now)).toBeNull();

    const tonight = pickContextBanner({ ...empty, myEventWork: [work({ id: "ev" })] }, now);
    expect(tonight).toMatchObject({ kind: "prep-gear", key: "prep-gear:ev", title: "No gear reserved for Volleyball vs Nebraska" });

    const covered = work({ id: "ev" }, [booking({ id: "r", linkedEventId: "ev" })]);
    expect(pickContextBanner({ ...empty, myEventWork: [covered] }, now)).toBeNull();
  });

  it("reminds about a return due later today", () => {
    const banner = pickContextBanner({
      ...empty,
      myCheckouts: [booking({ id: "co", kind: "CHECKOUT", endsAt: at(0, 17), title: "Audio kit" })],
    }, now);
    expect(banner).toMatchObject({ kind: "due-today", key: "due-today:co" });
    expect(banner?.title).toMatch(/^Return Audio kit by /);
  });
});

describe("event cards", () => {
  it("reports Students at their call time and anchors Staff on the event start", () => {
    const [card] = buildEventCards({ ...empty, myEventWork: [work({ id: "ev" })] });
    expect(card).toMatchObject({ reportAt: at(0, 17, 30), isCallTime: true });

    // Staff timing is set outside Schedule: never a call time, even if a
    // window were present.
    const staff = work({ id: "st" });
    staff.shift = { ...staff.shift, workerType: "FT" };
    expect(buildEventCards({ ...empty, myEventWork: [staff] })[0]).toMatchObject({ reportAt: at(0, 19), isCallTime: false });
  });

  it("has no report time for all-day events", () => {
    const allDay = work({ id: "ad" });
    allDay.event = { ...allDay.event, allDay: true };
    expect(buildEventCards({ ...empty, myEventWork: [allDay] })[0]?.hasReportTime).toBe(false);
  });

  it("collects gear already shown inside cards so My reservations can drop it", () => {
    const ids = eventLinkedBookingIds({ ...empty, myEventWork: [work({ id: "ev" }, [booking({ id: "r1" })])] });
    expect([...ids]).toEqual(["r1"]);
  });
});

describe("pickNextUp", () => {
  it("chooses the soonest timed commitment within twelve hours", () => {
    const next = pickNextUp({
      ...empty,
      myEventWork: [work({ id: "ev" })],
      myReservations: [booking({ id: "r", startsAt: at(0, 14) })],
    }, now, null);
    expect(next).toMatchObject({ kind: "pickup", at: at(0, 14) });
  });

  it("folds an event's own pickup into the event", () => {
    const pickup = booking({ id: "r", startsAt: at(0, 14), linkedEventId: "ev" });
    const next = pickNextUp({ ...empty, myEventWork: [work({ id: "ev" }, [pickup])], myReservations: [pickup] }, now, null);
    expect(next?.kind).toBe("event");
  });

  it("skips what the banner already covers and anything past the horizon", () => {
    const due = booking({ id: "co", kind: "CHECKOUT", endsAt: at(0, 17) });
    const banner = pickContextBanner({ ...empty, myCheckouts: [due] }, now);
    expect(pickNextUp({ ...empty, myCheckouts: [due] }, now, banner)).toBeNull();
    expect(pickNextUp({ ...empty, myReservations: [booking({ id: "far", startsAt: at(2, 9) })] }, now, null)).toBeNull();
  });

  it("formats the countdown", () => {
    expect(formatCountdownTo(at(0, 10, 45), now)).toBe("in 45m");
    expect(formatCountdownTo(at(0, 12, 10), now)).toBe("in 2h 10m");
    expect(formatCountdownTo(at(0, 13), now)).toBe("in 3h");
  });
});

describe("buildWeekStrip", () => {
  it("counts shifts, pickups, and returns on the right local day", () => {
    const days = buildWeekStrip({
      myEventWork: [work({ id: "ev" })],
      myReservations: [booking({ id: "r", startsAt: at(2, 9) })],
      myPendingPickups: [booking({ id: "late", startsAt: at(-1, 9) })],
      myCheckouts: [
        booking({ id: "od", kind: "CHECKOUT", endsAt: at(-2, 9), isOverdue: true }),
        booking({ id: "co", kind: "CHECKOUT", endsAt: at(3, 9) }),
      ],
    }, now);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ isToday: true, shifts: 1, pickups: 1, returns: 1 });
    expect(days[2]?.pickups).toBe(1);
    expect(days[3]?.returns).toBe(1);
    expect(days.slice(4).every((d) => d.shifts + d.pickups + d.returns === 0)).toBe(true);
  });
});
