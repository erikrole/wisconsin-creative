import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as audit } from "@/app/api/audit/export/route";

const context = { params: Promise.resolve({}) };
const request = (query = "") => new Request(`https://app.example.com/api/audit/export?${query}`);
const admin = { id: "admin", name: "Admin", email: "admin@example.com", role: Role.ADMIN, avatarUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(admin);
  vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
  vi.mocked(db.auditLog.count).mockResolvedValue(0);
});

describe("audit CSV export route", () => {
  it.each(["from=bad", "to=bad", "from=2026-09-07&to=2026-09-06"])(
    "rejects invalid audit export range %s before reading data",
    async (query) => {
      expect((await audit(request(query), context)).status).toBe(400);
      expect(db.auditLog.findMany).not.toHaveBeenCalled();
      expect(db.auditLog.count).not.toHaveBeenCalled();
    },
  );

  it("retains inclusive valid audit date filters", async () => {
    expect((await audit(request("from=2026-09-07&to=2026-09-07"), context)).status).toBe(200);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date("2026-09-07"), lte: new Date("2026-09-07") } },
      }),
    );
  });

  it("disables caching for the audit CSV", async () => {
    const response = await audit(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses stable timestamp ties in capped audit exports", async () => {
    await audit(request(), context);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
  });

  it("keeps non-admin audit exports forbidden", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...admin, role: Role.STAFF });
    expect((await audit(request(), context)).status).toBe(403);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
