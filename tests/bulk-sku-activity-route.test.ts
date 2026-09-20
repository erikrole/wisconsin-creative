import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bulkSku: {
      findUnique: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET as bulkActivity } from "@/app/api/bulk-skus/[id]/activity/route";

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
  vi.mocked(db.bulkSku.findUnique).mockResolvedValue(
    { id: "sku-1" } as unknown as Awaited<ReturnType<typeof db.bulkSku.findUnique>>,
  );
  vi.mocked(db.auditLog.findFirst).mockResolvedValue(
    { id: "cursor-1" } as unknown as Awaited<ReturnType<typeof db.auditLog.findFirst>>,
  );
  vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
});

describe("bulk SKU activity route", () => {
  it("rejects bulk activity cursors outside the current SKU activity scope", async () => {
    vi.mocked(db.auditLog.findFirst).mockResolvedValue(null);

    const res = await bulkActivity(
      get("/api/bulk-skus/sku-1/activity?cursor=other-log"),
      { params: Promise.resolve({ id: "sku-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid activity cursor");
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});
