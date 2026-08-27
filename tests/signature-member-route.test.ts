import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, SignatureCollectionStatus } from "@prisma/client";
import { HttpError } from "@/lib/http";

const { requireAuthMock, requirePermissionMock, bootstrapMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requirePermissionMock: vi.fn(),
  bootstrapMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/rbac", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("@/lib/services/signatures", () => ({
  getSignatureMemberCaptureBootstrap: bootstrapMock,
}));

vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { GET } from "@/app/api/signatures/collections/[id]/members/[memberId]/route";

const routeContext = {
  params: Promise.resolve({ id: "collection-1", memberId: "player-1" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({
    id: "staff-1",
    email: "staff@example.com",
    name: "Staff User",
    role: Role.STAFF,
    avatarUrl: null,
    forcePasswordChange: false,
  });
  bootstrapMock.mockResolvedValue({
    collection: {
      id: "collection-1",
      season: "2026-27",
      status: SignatureCollectionStatus.OPEN,
      collectionVersion: 4,
    },
    member: {
      id: "player-1",
      name: "Bucky Badger",
      jerseyNumber: 1,
      title: "Guard",
      roleGroup: "PLAYER",
      active: true,
      captureVersion: 2,
      settingsVersion: 1,
      captureSettings: {
        strokeColor: "#111827",
        strokeWidth: 4,
        cropPadding: 24,
        maxWidth: 1600,
        maxHeight: 900,
      },
      artifact: { id: "revision-2" },
    },
  });
});

describe("signature member capture bootstrap route", () => {
  it("returns the one-member no-store DTO behind signature capture permission", async () => {
    const response = await GET(
      new Request("https://app.example.com/api/signatures/collections/collection-1/members/player-1"),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      collection: { id: "collection-1" },
      member: { id: "player-1", artifact: { id: "revision-2" } },
    });
    expect(requirePermissionMock).toHaveBeenCalledWith(Role.STAFF, "signature", "capture");
    expect(bootstrapMock).toHaveBeenCalledWith("collection-1", "player-1");
  });

  it("does not load private member data when view permission is denied", async () => {
    requirePermissionMock.mockImplementationOnce(() => {
      throw new HttpError(403, "Permission denied");
    });

    const response = await GET(
      new Request("https://app.example.com/api/signatures/collections/collection-1/members/player-1"),
      routeContext,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Permission denied" });
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});
