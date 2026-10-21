import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    wishItem: { count: vi.fn() },
    licenseCode: { count: vi.fn() },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { GET } from "@/app/api/sidebar/counts/route";

const noParams = { params: Promise.resolve({}) };
const request = () =>
  new Request("https://app.example.com/api/sidebar/counts", { headers: { host: "app.example.com" } });
const userWithRole = (role: "ADMIN" | "STAFF" | "STUDENT") => ({
  id: `${role.toLowerCase()}-1`,
  email: `${role.toLowerCase()}@test.com`,
  name: role,
  role,
  avatarUrl: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.wishItem.count).mockResolvedValue(4 as never);
  vi.mocked(db.licenseCode.count).mockResolvedValue(2 as never);
});

describe("GET /api/sidebar/counts", () => {
  it("gives admins open wishes and reported license codes", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWithRole("ADMIN") as never);
    const res = await GET(request(), noParams);
    await expect(res.json()).resolves.toEqual({ data: { openWishes: 4, reportedLicenses: 2 } });
    expect(db.wishItem.count).toHaveBeenCalledWith({ where: { status: "OPEN" } });
    expect(db.licenseCode.count).toHaveBeenCalledWith({ where: { reportedBrokenAt: { not: null } } });
  });

  it("does not read wish counts for staff, who cannot decide wishes", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWithRole("STAFF") as never);
    const res = await GET(request(), noParams);
    await expect(res.json()).resolves.toEqual({ data: { openWishes: 0, reportedLicenses: 2 } });
    expect(db.wishItem.count).not.toHaveBeenCalled();
  });

  it("reads nothing for students", async () => {
    vi.mocked(requireAuth).mockResolvedValue(userWithRole("STUDENT") as never);
    const res = await GET(request(), noParams);
    await expect(res.json()).resolves.toEqual({ data: { openWishes: 0, reportedLicenses: 0 } });
    expect(db.wishItem.count).not.toHaveBeenCalled();
    expect(db.licenseCode.count).not.toHaveBeenCalled();
  });
});
