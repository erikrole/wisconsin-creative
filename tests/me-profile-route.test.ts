import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn() } },
  requireAuth: vi.fn(),
  audit: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 30, windowMs: 60_000 },
}));
vi.mock("@/lib/services/companion-projection-publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/companion-projection-publisher")>()),
  deferCompanionProjectionRefreshForCommittedMutation: mocks.refresh,
}));

import { GET, PUT } from "@/app/api/me/profile/route";

const student = { id: "user-1", email: "person@wisc.edu", name: "Person", role: "STUDENT" as const };
const collaborator = { ...student, id: "collab-1", role: "COLLABORATOR" as const };

const stored = {
  name: "Person",
  phone: "(608) 555-0111",
  personalPhone: "(608) 555-0111",
  workPhone: null,
  workPhoneNotApplicable: true,
  wiscardNumber: "123456789",
  primaryArea: "VIDEO",
  title: null,
  athleticsEmail: null,
  slackHandle: null,
};

const form = {
  name: "Person",
  personalPhone: "608-555-0111",
  workPhone: null,
  wiscardNumber: "123456789",
  primaryArea: "VIDEO",
  title: null,
  athleticsEmail: null,
  slackHandle: null,
};

function request(method: string, body?: unknown) {
  return new Request("https://app.example.com/api/me/profile", {
    method,
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({}) };

function auditEntry() {
  return mocks.audit.mock.calls[0]?.[0] as { before?: Record<string, unknown>; after: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.db.user.findUnique.mockResolvedValue(stored);
  mocks.db.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "user-1", ...stored, ...data }));
  mocks.audit.mockResolvedValue(undefined);
});

describe("GET /api/me/profile", () => {
  it("returns the caller's editable fields", async () => {
    const response = await GET(request("GET"), params);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(stored);
  });

  it("gives a collaborator only a name and photo, with the rest blank", async () => {
    mocks.requireAuth.mockResolvedValue(collaborator);
    mocks.db.user.findUnique.mockResolvedValue({ id: "collab-1", name: "Btn Producer", avatarUrl: null });

    const body = await (await GET(request("GET"), params)).json();

    expect(body.data).toEqual(expect.objectContaining({ name: "Btn Producer", wiscardNumber: null, workPhoneNotApplicable: true }));
    expect(mocks.db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, name: true, avatarUrl: true },
    }));
  });

  it("answers 404 when the account is gone", async () => {
    mocks.db.user.findUnique.mockResolvedValue(null);

    expect((await GET(request("GET"), params)).status).toBe(404);
  });
});

describe("PUT /api/me/profile", () => {
  it("audits only the fields that changed, with phones masked", async () => {
    const response = await PUT(request("PUT", { ...form, workPhone: "608 555 0222", title: "  Video intern  " }), params);

    expect(response.status).toBe(200);
    expect(mocks.db.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: "(608) 555-0111",
        personalPhone: "(608) 555-0111",
        workPhone: "(608) 555-0222",
        workPhoneNotApplicable: false,
        title: "Video intern",
      }),
    }));
    expect(auditEntry().after).toEqual({
      workPhone: "***0222",
      workPhoneNotApplicable: false,
      title: "Video intern",
    });
    expect(auditEntry().before).toEqual({ workPhone: null, workPhoneNotApplicable: true, title: null });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("records a Wiscard change without the number", async () => {
    await PUT(request("PUT", { ...form, wiscardNumber: " 987654321 " }), params);

    expect(auditEntry().after).toEqual({ wiscardNumber: "[set]" });
    expect(auditEntry().before).toEqual({ wiscardNumber: "[set]" });
  });

  it("writes no audit row when a save changes nothing", async () => {
    const response = await PUT(request("PUT", form), params);

    expect(response.status).toBe(200);
    expect(mocks.db.user.update).toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns the first validation message", async () => {
    const response = await PUT(request("PUT", { ...form, athleticsEmail: "not-an-email" }), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Must be a valid email address");
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ["athletics_email", "That athletics email is already in use by another account."],
    ["wiscard_number", "That Wiscard value is already linked to another account."],
  ])("explains a taken %s", async (target, message) => {
    mocks.db.user.update.mockRejectedValue({ code: "P2002", meta: { target: [target] } });

    const response = await PUT(request("PUT", { ...form, athleticsEmail: "person@athletics.wisc.edu" }), params);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(message);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("lets a collaborator change only their name", async () => {
    mocks.requireAuth.mockResolvedValue(collaborator);
    mocks.db.user.findUnique.mockResolvedValue({ name: "Old Name" });
    mocks.db.user.update.mockResolvedValue({ id: "collab-1", name: "New Name", avatarUrl: null });

    const response = await PUT(request("PUT", { name: "  New Name  ", wiscardNumber: "ignored" }), params);

    expect(response.status).toBe(200);
    expect(mocks.db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "New Name" } }));
    expect(auditEntry()).toEqual(expect.objectContaining({
      action: "profile_updated",
      before: { name: "Old Name" },
      after: { name: "New Name" },
    }));
  });
});
