/* Sample Home data for the DB-free preview (/dev-home) and the model tests.
   Times are relative to `now` so the rows always read as today and this week. */

import type { BookingSummary, DashboardData, DashboardStats } from "../dashboard-types";
import type { HomeActivity, HomeTrade, TodayCrewEvent } from "./home-model";

const H = 3_600_000;
const D = 24 * H;

function at(now: Date, offsetMs: number) {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function booking(now: Date, b: Partial<BookingSummary> & { id: string; title: string; requesterName: string }): BookingSummary {
  return {
    kind: "CHECKOUT",
    refNumber: null,
    eventId: null,
    eventIds: [],
    linkedEventId: null,
    sportCode: null,
    requesterInitials: b.requesterName.split(" ").map((p) => p[0]).join(""),
    requesterAvatarUrl: null,
    locationName: "Camp Randall",
    startsAt: at(now, -D),
    endsAt: at(now, 2 * D),
    itemCount: 3,
    status: "OPEN",
    isOverdue: false,
    items: [],
    ...b,
  };
}

function event(now: Date, id: string, summary: string, offset: number, extra: Partial<HomeTrade["shiftAssignment"]["shift"]["shiftGroup"]["event"]> = {}) {
  return { id, summary, startsAt: at(now, offset), sportCode: null, opponent: null, isHome: null, ...extra };
}

export function emptyDashboard(role: string): DashboardData {
  return {
    role,
    stats: { checkedOut: 0, overdue: 0, reserved: 0, dueToday: 0 },
    myCheckouts: { total: 0, overdue: 0, items: [] },
    teamCheckouts: { total: 0, overdue: 0, items: [] },
    teamReservations: { total: 0, items: [] },
    pendingPickups: { total: 0, items: [] },
    staleReservations: { total: 0, items: [] },
    upcomingEvents: [],
    myReservations: [],
    overdueCount: 0,
    overdueItems: [],
    drafts: [],
    myShifts: [],
    myEventWork: [],
    flaggedItems: [],
    lostBulkUnits: [],
  };
}

export function sampleDashboard(role: "STUDENT" | "STAFF" | "ADMIN", now: Date): DashboardData {
  const team = role !== "STUDENT";
  const tonight = new Date(now);
  tonight.setHours(17, 0, 0, 0);
  const mine = [
    booking(now, { id: "b-mine-1", title: "Volleyball vs Purdue", requesterName: "Maya Chen", endsAt: tonight.toISOString(), itemCount: 4 }),
    booking(now, { id: "b-mine-2", title: "Photo day kit", requesterName: "Maya Chen", endsAt: at(now, 3 * D), itemCount: 2 }),
    ...(role === "STUDENT"
      ? [booking(now, { id: "b-mine-3", title: "Soccer at Iowa", requesterName: "Maya Chen", endsAt: at(now, -26 * H), isOverdue: true, itemCount: 5 })]
      : []),
  ];
  const teamOut = [
    booking(now, { id: "b-team-1", title: "Football vs Iowa", requesterName: "Jordan Ruiz", endsAt: at(now, 2 * D), itemCount: 9 }),
    booking(now, { id: "b-team-2", title: "Hockey vs Minnesota", requesterName: "Ava Patel", endsAt: tonight.toISOString(), itemCount: 3 }),
    booking(now, { id: "b-team-3", title: "Soccer at Iowa", requesterName: "Sam Okafor", endsAt: at(now, -26 * H), isOverdue: true, itemCount: 5 }),
    booking(now, { id: "b-team-4", title: "Media day", requesterName: "Lena Brooks", endsAt: at(now, 5 * D), itemCount: 2 }),
  ];
  const shiftEvent = (id: string, summary: string, offset: number, opponent: string | null, sportCode: string | null) => ({
    id,
    summary,
    startsAt: at(now, offset),
    endsAt: at(now, offset + 3 * H),
    allDay: false,
    sportCode,
    opponent,
    isHome: true,
    site: "HOME" as const,
    locationId: "loc-1",
    locationName: "UW Field House",
  });
  const vb = shiftEvent("e-vb", "Volleyball vs Purdue", 6 * H, "Purdue", "WVB");
  const fb = shiftEvent("e-fb", "Football vs Iowa", 3 * D, "Iowa", "FB");
  return {
    ...emptyDashboard(role),
    role,
    stats: team ? { checkedOut: 14, overdue: 1, reserved: 6, dueToday: 3 } : { checkedOut: 14, overdue: 1, reserved: 6, dueToday: 3 },
    myCheckouts: { total: mine.length, overdue: mine.filter((b) => b.isOverdue).length, items: mine },
    teamCheckouts: { total: 14, overdue: 1, items: teamOut },
    pendingPickups: team
      ? { total: 1, items: [booking(now, { id: "b-pickup", title: "Baseball media day", requesterName: "Chris Lund", kind: "RESERVATION", status: "PENDING_PICKUP", startsAt: at(now, -2 * H) })] }
      : { total: 1, items: [] },
    overdueCount: 1,
    overdueItems: [{
      bookingId: "b-team-3",
      bookingTitle: "Soccer at Iowa",
      requesterName: "Sam Okafor",
      requesterInitials: "SO",
      requesterAvatarUrl: null,
      assetTags: ["CAM-014"],
      startsAt: at(now, -3 * D),
      endsAt: at(now, -26 * H),
      itemCount: 5,
      items: [],
    }],
    myReservations: [booking(now, { id: "b-res-1", title: "Football vs Iowa", requesterName: "Maya Chen", kind: "RESERVATION", eventId: "e-fb", eventIds: ["e-fb"], linkedEventId: "e-fb", startsAt: at(now, 3 * D - 3 * H), status: "BOOKED" })],
    drafts: team ? [{ id: "d-1", kind: "RESERVATION", title: "Wrestling open", itemCount: 3, updatedAt: at(now, -5 * H) }] : [],
    myShifts: [
      {
        id: "s-1", area: "PHOTO", workerType: role === "STUDENT" ? "ST" : "FT", workerLabel: "Photo",
        startsAt: vb.startsAt, endsAt: vb.endsAt,
        callStartsAt: role === "STUDENT" ? at(now, 5 * H) : null,
        callEndsAt: role === "STUDENT" ? at(now, 9 * H) : null,
        callNote: null, event: vb, gearStatus: "checked_out", gearItems: [], gearItemCount: 4,
      },
      {
        id: "s-2", area: "VIDEO", workerType: role === "STUDENT" ? "ST" : "FT", workerLabel: "Video",
        startsAt: fb.startsAt, endsAt: fb.endsAt, callStartsAt: null, callEndsAt: null,
        callNote: null, event: fb, gearStatus: "none", gearItems: [], gearItemCount: 0,
      },
    ],
    myEventWork: [{
      id: "w-1",
      event: fb,
      shift: { id: "s-2", area: "VIDEO", workerType: "ST", workerLabel: "Video", startsAt: fb.startsAt, endsAt: fb.endsAt, callStartsAt: null, callEndsAt: null, callNote: null },
      gearStatus: "none",
      gearBookings: [],
      needsGear: true,
    }],
    upcomingEvents: [
      { id: "e-vb", title: "Volleyball vs Purdue", sportCode: "WVB", startsAt: vb.startsAt, endsAt: vb.endsAt, allDay: false, location: "UW Field House", locationId: "loc-1", opponent: "Purdue", isHome: true, site: "HOME", coverage: { total: 4, filled: 4, percentage: 100 }, callTime: null, totalShiftSlots: 4, filledShiftSlots: 4, assignedUsers: [] },
      { id: "e-mhk", title: "Hockey vs Minnesota", sportCode: "MHKY", startsAt: at(now, D + 2 * H), endsAt: at(now, D + 5 * H), allDay: false, location: "Kohl Center", locationId: "loc-2", opponent: "Minnesota", isHome: true, site: "HOME", coverage: { total: 5, filled: 3, percentage: 60 }, callTime: null, totalShiftSlots: 5, filledShiftSlots: 3, assignedUsers: [] },
      { id: "e-fb", title: "Football vs Iowa", sportCode: "FB", startsAt: fb.startsAt, endsAt: fb.endsAt, allDay: false, location: "Camp Randall", locationId: "loc-3", opponent: "Iowa", isHome: true, site: "HOME", coverage: { total: 8, filled: 5, percentage: 63 }, callTime: null, totalShiftSlots: 8, filledShiftSlots: 5, assignedUsers: [] },
    ],
    flaggedItems: team ? [
      { id: "f-1", assetId: "a-1", assetTag: "LENS-022", assetName: "Sony 70-200mm GM", type: "DAMAGED", bookingTitle: "Hockey vs Minnesota", reportedBy: "Ava Patel", description: "Front element scratched", imageUrl: null, assetStatus: "AVAILABLE", createdAt: at(now, -4 * H) },
    ] : [],
    lostBulkUnits: role === "ADMIN" ? [{ skuName: "NP-FZ100 battery", count: 2 }] : [],
  };
}

export function sampleStats(role: "STUDENT" | "STAFF" | "ADMIN"): DashboardStats {
  return {
    role,
    stats: { checkedOut: 14, overdue: 1, reserved: 6, dueToday: 3 },
    overdueCount: 1,
    myCheckoutsTotal: role === "STUDENT" ? 3 : 2,
    myOverdueCount: role === "STUDENT" ? 1 : 0,
    myDueTodayCount: 1,
    teamCheckoutsTotal: 14,
    teamCheckoutsOverdue: 1,
    teamReservationsTotal: 6,
    pendingPickupTotal: 1,
    staleReservationTotal: 0,
    myShiftsCount: 2,
    myShiftsTodayCount: 1,
  };
}

export function sampleTrades(now: Date): { open: HomeTrade[]; claimed: HomeTrade[] } {
  const trade = (id: string, status: string, area: string, ev: ReturnType<typeof event>, posted: string, claimed: string | null, viewerCanClaim: boolean): HomeTrade => ({
    id,
    status,
    viewerCanClaim,
    postedBy: { id: `u-${posted}`, name: posted },
    claimedBy: claimed ? { id: `u-${claimed}`, name: claimed } : null,
    shiftAssignment: { shift: { area, shiftGroup: { event: ev } } },
  });
  return {
    open: [
      trade("t-1", "OPEN", "PHOTO", event(now, "e-mbb", "Men's Basketball vs Marquette", 2 * D + 4 * H, { sportCode: "MBB", opponent: "Marquette", isHome: true }), "Jordan Ruiz", null, true),
      trade("t-2", "OPEN", "VIDEO", event(now, "e-wsoc", "Soccer vs Illinois", 4 * D, { sportCode: "WSOC", opponent: "Illinois", isHome: true }), "Ava Patel", null, true),
      trade("t-3", "OPEN", "GRAPHICS", event(now, "e-wre", "Wrestling open", 5 * D), "Lena Brooks", null, false),
    ],
    claimed: [
      trade("t-9", "CLAIMED", "VIDEO", event(now, "e-mhk", "Hockey vs Minnesota", D + 2 * H, { sportCode: "MHKY", opponent: "Minnesota", isHome: true }), "Sam Okafor", "Maya Chen", false),
    ],
  };
}

export function sampleCrew(now: Date): TodayCrewEvent[] {
  const person = (id: string, name: string, area: string) => ({ id, name, avatarUrl: null, area });
  return [
    {
      id: "g-mhk", summary: "Hockey practice media", startsAt: at(now, -H), endsAt: at(now, 2 * H), when: "now",
      people: [person("u1", "Ava Patel", "PHOTO"), person("u2", "Sam Okafor", "VIDEO")],
    },
    {
      id: "g-vb", summary: "Volleyball vs Purdue", startsAt: at(now, 5 * H), endsAt: at(now, 9 * H), when: "later",
      people: [
        person("u3", "Maya Chen", "PHOTO"), person("u4", "Jordan Ruiz", "VIDEO"), person("u5", "Lena Brooks", "SOCIAL"),
        person("u6", "Chris Lund", "GRAPHICS"), person("u7", "Taylor Kim", "VIDEO"), person("u8", "Noah Fields", "LIVE_PRODUCTION"),
      ],
    },
    {
      id: "g-fb", summary: "Football walkthrough", startsAt: at(now, D), endsAt: at(now, D + 2 * H), when: "tomorrow",
      people: [person("u4", "Jordan Ruiz", "VIDEO")],
    },
  ];
}

export function sampleActivity(now: Date): HomeActivity[] {
  const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
  return [
    { id: "a-1", kind: "returned", bookingId: "b-ret-1", title: "Volleyball practice B-roll", person: person("u3", "Maya Chen"), at: ago(8) },
    { id: "a-2", kind: "checkout", bookingId: "b-out-1", title: "Hockey practice media", person: person("u1", "Ava Patel"), at: ago(52) },
    { id: "a-3", kind: "pickup", bookingId: "b-out-2", title: "Hockey practice media", person: person("u2", "Sam Okafor"), at: ago(64) },
    { id: "a-4", kind: "returned", bookingId: "b-ret-2", title: "Softball headshots", person: person("u4", "Ben Ortiz"), at: ago(190) },
  ];
}
