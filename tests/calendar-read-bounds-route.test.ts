import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
    calendarSource: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as calendar } from "@/app/api/calendar/route";
import { GET as calendarSources } from "@/app/api/calendar-sources/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
  vi.mocked(db.calendarSource.findMany).mockResolvedValue([]);
});

describe("calendar read bounds", () => {
  it("caps calendar and calendar-source read sizes", async () => {
    await calendar(get("/api/calendar?from=2026-06-01&to=2026-06-30"), { params: Promise.resolve({}) });
    await calendarSources(get("/api/calendar-sources"), { params: Promise.resolve({}) });

    expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(db.calendarSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
