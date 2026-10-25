import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import * as meRoute from "@/app/api/me/route";

const get = () => meRoute.GET(new Request("https://app.example.com/api/me"), routeCtx({}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authUser(Role.STUDENT));
});

describe("/api/me", () => {
  it("returns the signed-in person with their account start date", async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: new Date("2026-10-20T15:00:00.000Z") });

    const body = await (await get()).json();

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "student-1" }, select: { createdAt: true } });
    expect(body.user).toEqual(expect.objectContaining({ id: "student-1", role: Role.STUDENT, accountCreatedAt: "2026-10-20T15:00:00.000Z" }));
    expect(body).toEqual(expect.objectContaining({ canViewHiddenUsers: false, canViewUsageAnalytics: false }));
  });

  it("reports no start date when the account row is gone", async () => {
    mocks.findUnique.mockResolvedValue(null);

    expect((await (await get()).json()).user.accountCreatedAt).toBeNull();
  });

  it("offers no write method; password changes use the rate-limited change-password route", () => {
    expect(Object.keys(meRoute)).toEqual(["GET"]);
  });
});
