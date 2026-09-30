import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  kioskDeviceFindUnique: vi.fn(),
  kioskDeviceUpdate: vi.fn(),
  kioskDeviceCreate: vi.fn(),
  locationFindUnique: vi.fn(),
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    kioskDevice: {
      findUnique: mocks.kioskDeviceFindUnique,
      update: mocks.kioskDeviceUpdate,
      create: mocks.kioskDeviceCreate,
    },
    location: { findUnique: mocks.locationFindUnique },
  },
}));

vi.mock("@/lib/api", () => ({
  withAuth: <P extends Record<string, string>>(
    handler: (req: Request, ctx: { user: { id: string; role: string }; params: P }) => Promise<Response>,
  ) => async (req: Request, ctx: { params: Promise<P> }) =>
    handler(req, { user: { id: "admin-1", role: "ADMIN" }, params: await ctx.params }),
}));

vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), SETTINGS_MUTATION_LIMIT: { max: 60, windowMs: 60_000 } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry }));
vi.mock("@/lib/auth", () => ({ tokenHash: vi.fn(async () => "hashed"), KIOSK_ACTIVATION_CODE_TTL_MS: 60_000 }));
vi.mock("@/lib/kiosk-activation", () => ({ generateActivationCode: () => "123456" }));

import { POST as createDevice } from "@/app/api/kiosk-devices/route";
import { PATCH as updateDevice } from "@/app/api/kiosk-devices/[id]/route";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://test/api/kiosk-devices", { method, body: JSON.stringify(body) });
}

const device = {
  id: "kiosk-1",
  name: "Video Office",
  active: true,
  locationId: "loc-1",
  activatedAt: null,
  lastSeenAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kioskDeviceFindUnique.mockResolvedValue(device);
  mocks.kioskDeviceUpdate.mockImplementation(async ({ data }) => ({ ...device, ...data, location: { id: "loc-1", name: "Main" } }));
  mocks.locationFindUnique.mockResolvedValue({ id: "loc-1", name: "Main" });
  mocks.kioskDeviceCreate.mockImplementation(async ({ data }) => ({ id: "kiosk-2", ...data }));
});

describe("admin kiosk-device routes validate at the boundary (B9)", () => {
  it("rejects a non-boolean active flag instead of silently ignoring it", async () => {
    await expect(updateDevice(jsonRequest("PATCH", { active: "false" }), { params: Promise.resolve({ id: "kiosk-1" }) }))
      .rejects.toBeInstanceOf(ZodError);
    expect(mocks.kioskDeviceFindUnique).not.toHaveBeenCalled();
    expect(mocks.kioskDeviceUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty update", async () => {
    await expect(updateDevice(jsonRequest("PATCH", {}), { params: Promise.resolve({ id: "kiosk-1" }) }))
      .rejects.toThrow("No valid fields to update");
    expect(mocks.kioskDeviceUpdate).not.toHaveBeenCalled();
  });

  it("deactivating revokes the kiosk session and trims a rename", async () => {
    const res = await updateDevice(
      jsonRequest("PATCH", { active: false, name: "  Field House  " }),
      { params: Promise.resolve({ id: "kiosk-1" }) },
    );

    expect(res.status).toBe(200);
    expect(mocks.kioskDeviceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { active: false, sessionToken: null, sessionExpiresAt: null, name: "Field House" },
    }));
    expect(mocks.createAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      action: "deactivate",
      after: { name: "Field House", active: false, sessionRevoked: true },
    }));
  });

  it("rejects a create with a non-string or blank name before touching the database", async () => {
    for (const body of [{ name: 42, locationId: "loc-1" }, { name: "   ", locationId: "loc-1" }, { name: "Kiosk" }]) {
      await expect(createDevice(jsonRequest("POST", body), { params: Promise.resolve({}) }))
        .rejects.toBeInstanceOf(ZodError);
    }
    expect(mocks.locationFindUnique).not.toHaveBeenCalled();
    expect(mocks.kioskDeviceCreate).not.toHaveBeenCalled();
  });

  it("creates a device from a trimmed, validated body", async () => {
    const res = await createDevice(jsonRequest("POST", { name: "  Video Office  ", locationId: "loc-1" }), { params: Promise.resolve({}) });

    expect(res.status).toBe(201);
    expect(mocks.kioskDeviceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Video Office", locationId: "loc-1" }),
    });
  });
});
