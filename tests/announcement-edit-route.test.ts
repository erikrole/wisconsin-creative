import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    announcement: { update: vi.fn() },
    announcementDismissal: { deleteMany: vi.fn() },
  };
  return {
    tx,
    db: {
      announcement: { findUnique: vi.fn(), delete: vi.fn() },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    },
    requireAuth: vi.fn(),
    audit: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 30, windowMs: 60_000 },
}));

import { DELETE, PATCH } from "@/app/api/announcements/[id]/route";

const admin = { id: "admin-1", email: "admin@example.com", name: "Admin", role: Role.ADMIN };
const params = { params: Promise.resolve({ id: "ann-1" }) };
const headers = { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" };
const stored = { id: "ann-1", title: "New scanner", body: "Try it", publishedAt: null, endsAt: null };

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("https://app.example.com/api/announcements/ann-1", { method: "PATCH", headers, body: JSON.stringify(body) }), params);
}

function data() {
  return mocks.tx.announcement.update.mock.calls[0]?.[0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.db.announcement.findUnique.mockResolvedValue(stored);
  mocks.tx.announcement.update.mockImplementation(async ({ data: changes }: { data: Record<string, unknown> }) => ({ ...stored, ...changes }));
  mocks.audit.mockResolvedValue(undefined);
});

describe("PATCH /api/announcements/[id]", () => {
  it("publishes now and keeps an end time only when one is given", async () => {
    const response = await patch({ state: "live" });

    expect(await response.json()).toEqual({ id: "ann-1" });
    expect(data()).toEqual({ publishedAt: expect.any(Date), endsAt: null });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "live",
      before: expect.objectContaining({ publishedAt: null }),
      after: expect.objectContaining({ publishedAt: expect.any(Date) }),
    }));
  });

  it("publishes with a future end time", async () => {
    const endsAt = new Date(Date.now() + 86_400_000);

    await patch({ state: "live", endsAt: endsAt.toISOString() });

    expect(data().endsAt).toEqual(endsAt);
  });

  it("returns to draft or ends it now", async () => {
    await patch({ state: "draft" });
    expect(data()).toEqual({ publishedAt: null });

    mocks.tx.announcement.update.mockClear();
    await patch({ state: "ended" });
    expect(data()).toEqual({ endsAt: expect.any(Date) });
  });

  it("shows it to everyone again by clearing dismissals", async () => {
    await patch({ showAgain: true });

    expect(mocks.tx.announcementDismissal.deleteMany).toHaveBeenCalledWith({ where: { announcementId: "ann-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "show_again" }));
  });

  it("edits text without touching dismissals", async () => {
    await patch({ title: "Scanner is live" });

    expect(data()).toEqual({ title: "Scanner is live" });
    expect(mocks.tx.announcementDismissal.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "update", after: expect.objectContaining({ title: "Scanner is live" }) }));
  });

  it.each([
    ["an end time in the past", { endsAt: "2020-01-01T00:00:00.000Z" }],
    ["hiding it everywhere", { showOnWeb: false, showOnIos: false }],
    ["an unknown state", { state: "archived" }],
  ])("rejects %s", async (_label, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(mocks.tx.announcement.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown announcement and 403 for staff", async () => {
    mocks.db.announcement.findUnique.mockResolvedValueOnce(null);
    expect((await patch({ state: "live" })).status).toBe(404);

    mocks.requireAuth.mockResolvedValue({ ...admin, role: Role.STAFF });
    expect((await patch({ state: "live" })).status).toBe(403);
  });
});

describe("DELETE /api/announcements/[id]", () => {
  function remove() {
    return DELETE(new Request("https://app.example.com/api/announcements/ann-1", { method: "DELETE", headers }), params);
  }

  it("deletes and audits it", async () => {
    expect(await (await remove()).json()).toEqual({ deleted: true });
    expect(mocks.db.announcement.delete).toHaveBeenCalledWith({ where: { id: "ann-1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", before: { title: "New scanner", publishedAt: null } }));
  });

  it("returns 404 for an unknown announcement", async () => {
    mocks.db.announcement.findUnique.mockResolvedValue(null);

    expect((await remove()).status).toBe(404);
    expect(mocks.db.announcement.delete).not.toHaveBeenCalled();
  });
});
