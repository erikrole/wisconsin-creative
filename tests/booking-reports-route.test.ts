import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: vi.fn() },
    checkinItemReport: { findMany: vi.fn() },
  },
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/bookings/[id]/reports/route";

const base = { email: "a@example.com", name: "A", avatarUrl: null };
const request = () => new Request("https://app.example.com/api/bookings/b1/reports", { headers: { host: "app.example.com" } });
const context = { params: Promise.resolve({ id: "b1" }) };

describe("GET /api/bookings/[id]/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findUnique).mockResolvedValue({ requesterUserId: "owner", createdBy: "owner" } as never);
    vi.mocked(db.checkinItemReport.findMany).mockResolvedValue([
      { id: "r1", type: "LOST", quantity: null, resolution: null, lastReportedAt: new Date("2026-10-20"), asset: { assetTag: "70-200 #1", name: null }, bulkSkuUnit: null, bulkSku: null },
    ] as never);
  });

  it("shows the borrower what was reported and that it is open", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...base, id: "owner", role: Role.STUDENT });
    const res = await GET(request(), context);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ label: "70-200 #1", type: "LOST", open: true, resolution: null });
  });

  it("lets staff read any checkout's reports", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...base, id: "staff", role: Role.STAFF });
    expect((await GET(request(), context)).status).toBe(200);
  });

  it("keeps another student out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...base, id: "other", role: Role.STUDENT });
    expect((await GET(request(), context)).status).toBe(403);
    expect(db.checkinItemReport.findMany).not.toHaveBeenCalled();
  });
});
