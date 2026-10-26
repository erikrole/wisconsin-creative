import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  preview: vi.fn(),
  combine: vi.fn(),
  uncombine: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/services/combined-schedule-events", () => ({
  previewCombinedScheduleEvents: mocks.preview,
  combineScheduleEvents: mocks.combine,
  uncombineScheduleEvents: mocks.uncombine,
}));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { DELETE, POST } from "@/app/api/calendar-events/combine/route";
import { SCHEDULE_MUTATION_LIMIT } from "@/lib/rate-limit";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const headers = { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" };
const noParams = { params: Promise.resolve({}) };
const pair = ["cevent00001", "cevent00002"];

function send(method: "POST" | "DELETE", body: string) {
  const handler = method === "POST" ? POST : DELETE;
  return handler(new Request("https://app.example.com/api/calendar-events/combine", { method, headers, body }), noParams);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.preview.mockResolvedValue({ primaryId: pair[0] });
  mocks.combine.mockResolvedValue({ combined: true });
  mocks.uncombine.mockResolvedValue({ uncombined: true });
});

describe("POST /api/calendar-events/combine", () => {
  it("previews by default without spending the rate limit", async () => {
    const response = await send("POST", JSON.stringify({ eventIds: pair }));

    expect(await response.json()).toEqual({ data: { primaryId: pair[0] } });
    expect(mocks.preview).toHaveBeenCalledWith(pair);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.combine).not.toHaveBeenCalled();
  });

  it("applies a reviewed preview", async () => {
    const response = await send("POST", JSON.stringify({ eventIds: pair, apply: true, expectedPrimaryId: pair[0], expectedSecondaryWorkingVersion: null }));

    expect(await response.json()).toEqual({ data: { combined: true } });
    expect(mocks.rateLimit).toHaveBeenCalledWith("calendar-event:combine:staff-1", SCHEDULE_MUTATION_LIMIT);
    expect(mocks.combine).toHaveBeenCalledWith({
      eventIds: pair,
      expectedPrimaryId: pair[0],
      expectedSecondaryWorkingVersion: null,
      actor: { id: "staff-1", role: Role.STAFF },
    });
  });

  it.each([
    ["without the expected primary", { expectedSecondaryWorkingVersion: 3 }],
    ["without the expected version", { expectedPrimaryId: pair[0] }],
  ])("refuses to apply %s", async (_label, fields) => {
    const response = await send("POST", JSON.stringify({ eventIds: pair, apply: true, ...fields }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Review the combine preview before applying it.");
    expect(mocks.combine).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "{"],
    ["one event", JSON.stringify({ eventIds: [pair[0]] })],
  ])("rejects %s", async (_label, body) => {
    expect((await send("POST", body)).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });

    expect((await send("POST", JSON.stringify({ eventIds: pair }))).status).toBe(403);
  });
});

describe("DELETE /api/calendar-events/combine", () => {
  it("undoes a combined pair", async () => {
    const response = await send("DELETE", JSON.stringify({ primaryEventId: pair[0], secondaryEventId: pair[1] }));

    expect(await response.json()).toEqual({ data: { uncombined: true } });
    expect(mocks.rateLimit).toHaveBeenCalledWith("calendar-event:uncombine:staff-1", SCHEDULE_MUTATION_LIMIT);
    expect(mocks.uncombine).toHaveBeenCalledWith({ primaryEventId: pair[0], secondaryEventId: pair[1], actor: { id: "staff-1", role: Role.STAFF } });
  });

  it("rejects broken JSON and a missing event", async () => {
    expect((await send("DELETE", "{")).status).toBe(400);
    expect((await send("DELETE", JSON.stringify({ primaryEventId: pair[0] }))).status).toBe(400);
    expect(mocks.uncombine).not.toHaveBeenCalled();
  });
});
