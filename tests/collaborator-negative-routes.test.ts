import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/services/licenses", () => ({
  listAllCodes: vi.fn(),
  listCodes: vi.fn(),
  createCode: vi.fn(),
}));
vi.mock("@/lib/guides", () => ({
  listGuides: vi.fn(),
  createGuide: vi.fn(),
  getGuideAudience: vi.fn(),
}));
vi.mock("@/lib/services/shift-trades", () => ({
  listTrades: vi.fn(),
  postTrade: vi.fn(),
}));
vi.mock("@/lib/services/reports", () => ({
  getUtilizationReport: vi.fn(),
  getUtilizationReportExport: vi.fn(),
}));
vi.mock("@/lib/services/bookings", () => ({
  listBookings: vi.fn(),
  getBookingDetail: vi.fn(),
  updateReservation: vi.fn(),
  updateCheckout: vi.fn(),
}));
vi.mock("@/lib/services/booking-rules", () => ({
  getAllowedBookingActions: vi.fn(),
  requireBookingAction: vi.fn(),
}));
vi.mock("@/lib/services/checkout-policies", () => ({ loadCheckoutPolicies: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { getBookingDetail } from "@/lib/services/bookings";
import { getAllowedBookingActions } from "@/lib/services/booking-rules";
import { GET as getUsers } from "@/app/api/users/route";
import { GET as getLicenses } from "@/app/api/licenses/route";
import { GET as getResources } from "@/app/api/resources/route";
import { POST as createShift } from "@/app/api/shifts/route";
import { GET as getTrades } from "@/app/api/shift-trades/route";
import { GET as getUtilization } from "@/app/api/reports/utilization/route";
import { GET as getReservationRules } from "@/app/api/settings/reservation-rules/route";
import { GET as getCheckouts, POST as createCheckout } from "@/app/api/checkouts/route";
import { GET as getBooking } from "@/app/api/bookings/[id]/route";
import { GET as getBookingCalendar } from "@/app/api/calendar/route";
import { GET as getCalendarEvents } from "@/app/api/calendar-events/route";
import { GET as getMyShifts } from "@/app/api/my-shifts/route";
import { GET as getAssetInsights } from "@/app/api/assets/[id]/insights/route";
import { GET as getCommandCenter } from "@/app/api/calendar-events/[id]/command-center/route";
import { GET as getMyHours } from "@/app/api/shifts/my-hours/route";
import { GET as getIcsToken } from "@/app/api/shifts/ics-token/route";
import { GET as getItemsPageInit } from "@/app/api/items-page-init/route";
import { GET as getAssetBrands } from "@/app/api/assets/brands/route";
import { GET as getFormOptions } from "@/app/api/form-options/route";

const collaborator = {
  id: "btn-1",
  email: "trey@example.com",
  name: "Trey",
  role: Role.COLLABORATOR,
  affiliation: "BIG_TEN_NETWORK" as const,
  collaboratorProfile: "BTN_STANDARD" as const,
  capabilities: [],
  avatarUrl: null,
};

function request(path: string, method = "GET") {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      host: "app.example.com",
      ...(method === "GET" ? {} : { origin: "https://app.example.com" }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(collaborator);
});

describe("collaborator default-deny route matrix", () => {
  it.each([
    ["People directory", () => getUsers(request("/api/users"), { params: Promise.resolve({}) })],
    ["licenses", () => getLicenses(request("/api/licenses"), { params: Promise.resolve({}) })],
    ["guides", () => getResources(request("/api/resources"), { params: Promise.resolve({}) })],
    ["shift creation", () => createShift(request("/api/shifts", "POST"), { params: Promise.resolve({}) })],
    ["shift trades", () => getTrades(request("/api/shift-trades"), { params: Promise.resolve({}) })],
    ["reports", () => getUtilization(request("/api/reports/utilization"), { params: Promise.resolve({}) })],
    ["settings", () => getReservationRules(request("/api/settings/reservation-rules"), { params: Promise.resolve({}) })],
    ["checkout list", () => getCheckouts(request("/api/checkouts"), { params: Promise.resolve({}) })],
    ["direct checkout creation", () => createCheckout(request("/api/checkouts", "POST"), { params: Promise.resolve({}) })],
    // Live internal reads that predate the capability model. Each one answered
    // any authenticated caller, so a collaborator could route around the
    // published-snapshot and own-bookings contracts by calling them directly.
    [
      "the org-wide booking calendar (requester emails, serial numbers)",
      () => getBookingCalendar(
        request("/api/calendar?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z"),
        { params: Promise.resolve({}) },
      ),
    ],
    [
      "the live event list, which includes unpublished crew",
      () => getCalendarEvents(request("/api/calendar-events"), { params: Promise.resolve({}) }),
    ],
    [
      "live shift assignments for any user id",
      () => getMyShifts(request("/api/my-shifts?userId=staff-1"), { params: Promise.resolve({}) }),
    ],
    [
      "asset insights, which name who booked the gear",
      () => getAssetInsights(request("/api/assets/asset-1/insights"), { params: Promise.resolve({ id: "asset-1" }) }),
    ],
    [
      "the event command center",
      () => getCommandCenter(request("/api/calendar-events/event-1/command-center"), { params: Promise.resolve({ id: "event-1" }) }),
    ],
  ])("denies %s", async (_label, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(403);
  });

  it.each([
    ["personal shift hours", () => getMyHours(request("/api/shifts/my-hours"), { params: Promise.resolve({}) })],
    ["private calendar token", () => getIcsToken(request("/api/shifts/ics-token"), { params: Promise.resolve({}) })],
    ["items page reference data", () => getItemsPageInit(request("/api/items-page-init"), { params: Promise.resolve({}) })],
    ["asset brand reference data", () => getAssetBrands(request("/api/assets/brands"), { params: Promise.resolve({}) })],
  ])("denies %s outside the collaborator surface", async (_label, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(403);
  });

  it("denies shared form options to a collaborator without a gear or own-bookings capability", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...collaborator, capabilities: [] });

    const response = await getFormOptions(request("/api/form-options"), { params: Promise.resolve({}) });

    expect(response.status).toBe(403);
  });

  // Positive control: the denials above must come from the role gate, not from
  // a route that fails for everybody under the stubbed db. A student is refused
  // by neither gate, so these calls get past authorization and die later.
  it.each([
    [
      "the booking calendar",
      () => getBookingCalendar(
        request("/api/calendar?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z"),
        { params: Promise.resolve({}) },
      ),
    ],
    [
      "my-shifts",
      () => getMyShifts(request("/api/my-shifts"), { params: Promise.resolve({}) }),
    ],
    [
      "asset insights",
      () => getAssetInsights(request("/api/assets/asset-1/insights"), { params: Promise.resolve({ id: "asset-1" }) }),
    ],
  ])("still admits a student to %s", async (_label, invoke) => {
    vi.mocked(requireAuth).mockResolvedValue({ ...collaborator, role: Role.STUDENT, capabilities: [] });
    const response = await invoke();
    expect(response.status).not.toBe(403);
  });

  it("returns 404 for another user's booking instead of exposing its existence", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...collaborator, capabilities: ["MY_GEAR_VIEW"] });
    vi.mocked(getBookingDetail).mockResolvedValue({
      id: "booking-2",
      requesterUserId: "other-user",
      createdBy: "other-user",
    } as unknown as Awaited<ReturnType<typeof getBookingDetail>>);
    vi.mocked(getAllowedBookingActions).mockReturnValue([]);

    const response = await getBooking(request("/api/bookings/booking-2"), {
      params: Promise.resolve({ id: "booking-2" }),
    });

    expect(response.status).toBe(404);
  });

  it("lets a student open another user's booking detail without granting actions", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...collaborator, id: "student-1", role: Role.STUDENT, capabilities: [] });
    vi.mocked(getBookingDetail).mockResolvedValue({
      id: "booking-2",
      requesterUserId: "other-user",
      createdBy: "other-user",
    } as unknown as Awaited<ReturnType<typeof getBookingDetail>>);

    const response = await getBooking(request("/api/bookings/booking-2"), {
      params: Promise.resolve({ id: "booking-2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("booking-2");
    expect(body.data.allowedActions).toEqual([]);
  });
});
