import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  db: { user: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() } },
  audit: vi.fn(),
  deactivate: vi.fn(),
  revoke: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/role-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/role-preview")>()),
  readRolePreviewCookie: vi.fn(async () => null),
}));
vi.mock("@/lib/services/user-deactivation", () => ({ deactivateUserWithCleanup: mocks.deactivate }));
vi.mock("@/lib/companion-store", () => ({ revokeCompanionUser: mocks.revoke }));
vi.mock("@/lib/services/companion-projection-publisher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/companion-projection-publisher")>()),
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: mocks.refresh,
}));
vi.mock("@/lib/services/game-record", () => ({ getGameRecordForUser: vi.fn(async () => null) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { GET, PATCH } from "@/app/api/users/[id]/route";

const admin = { id: "admin-1", email: "admin@example.com", name: "Admin", role: Role.ADMIN, avatarUrl: null };
const staff = { ...admin, id: "staff-1", role: Role.STAFF };
const studentId = "cmstudent0000000000000001";
const managerId = "cmmanager0000000000000001";
const student = {
  id: studentId,
  name: "Ada",
  email: "ada@example.com",
  role: Role.STUDENT,
  active: true,
  phone: null,
  personalPhone: null,
  workPhone: null,
  wiscardNumber: null,
  wiscardCardNumber: "1234567890",
  wiscardIssueCode: null,
  birthdayMonth: null,
  directReportId: null,
  directReportName: null,
};

function patch(body: unknown, id = studentId) {
  return PATCH(new Request(`https://app.example.com/api/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

function get(id: string) {
  return GET(new Request(`https://app.example.com/api/users/${id}`, { headers: { host: "app.example.com" } }), { params: Promise.resolve({ id }) });
}

function updateData() {
  return mocks.db.user.update.mock.calls[0]?.[0].data as Record<string, unknown>;
}

function uniqueError(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === studentId ? student : null));
  mocks.db.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...student, ...data }));
  mocks.db.user.findUniqueOrThrow.mockResolvedValue({ ...student, active: false });
});

describe("PATCH /api/users/[id]", () => {
  it("returns 404 for an unknown person and 400 when nothing changes", async () => {
    expect((await patch({ name: "X" }, "missing")).status).toBe(404);
    expect((await patch({ email: "ADA@example.com" })).status).toBe(400);
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it("lets staff edit students only, and only admins set a birth year", async () => {
    mocks.requireAuth.mockResolvedValue(staff);
    mocks.db.user.findUnique.mockResolvedValueOnce({ ...student, role: Role.STAFF });
    const blocked = await patch({ name: "X" });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe("Staff can only edit student profiles");

    const birthYear = await patch({ birthYear: 2004 });
    expect(birthYear.status).toBe(403);
    expect((await birthYear.json()).error).toBe("Only the user or an admin can update the birth year");
  });

  it("normalizes contact fields and keeps the old phone field in step", async () => {
    const response = await patch({
      email: "New@Example.com",
      phone: "608-555-0100",
      workPhone: null,
      slackHandle: "@ada",
      primaryArea: "VIDEO",
      staffingType: "FT",
      locationId: null,
      athleticsEmail: "Ada@Athletics.wisc.edu",
    });

    expect(response.status).toBe(200);
    expect(updateData()).toEqual(expect.objectContaining({
      email: "new@example.com",
      phone: "(608) 555-0100",
      personalPhone: "(608) 555-0100",
      workPhone: null,
      workPhoneNotApplicable: true,
      primaryArea: "VIDEO",
      staffingType: "FT",
      locationId: null,
      athleticsEmail: "ada@athletics.wisc.edu",
    }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("builds the Wiscard number from the stored card number and a new issue code", async () => {
    await patch({ wiscardIssueCode: "2" });

    expect(updateData()).toEqual(expect.objectContaining({ wiscardCardNumber: "1234567890", wiscardIssueCode: "2", wiscardNumber: "12345678902" }));
  });

  it("clears the Wiscard number when either half is missing", async () => {
    await patch({ wiscardCardNumber: null });
    expect(updateData()).toEqual(expect.objectContaining({ wiscardCardNumber: null, wiscardNumber: null }));

    mocks.db.user.update.mockClear();
    await patch({ wiscardCardNumber: "1234567890" });
    expect(updateData()).toEqual(expect.objectContaining({ wiscardCardNumber: "1234567890", wiscardIssueCode: null, wiscardNumber: null }));
  });

  it("audits phones in a privacy-safe form and birthdays only as set", async () => {
    await patch({ personalPhone: "608-555-0100", birthdayMonth: 4, birthdayDay: 9 });

    const entry = mocks.audit.mock.calls[0]?.[0] as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(entry.before.birthdayMonth).toBeNull();
    expect(entry.after.birthdayMonth).toBe("[set]");
    expect(entry.after.birthdayDay).toBe("[set]");
    expect(JSON.stringify(entry.after)).not.toContain("555-0100");
  });

  it("stores profile fields and blanks the ones sent empty", async () => {
    await patch({
      title: null,
      startDate: "2026-08-24T05:00:00.000Z",
      gradYear: 2027,
      graduationTerm: null,
      studentYearOverride: null,
      topSize: "M",
      topSizeFit: "UNISEX",
      bottomSize: null,
      shoeSize: "10",
      shoeSizeSystem: "US_MENS",
    });

    expect(updateData()).toEqual(expect.objectContaining({
      title: null,
      startDate: new Date("2026-08-24T05:00:00.000Z"),
      gradYear: 2027,
      graduationTerm: null,
      studentYearOverride: null,
      topSize: "M",
      topSizeFit: "UNISEX",
      bottomSize: null,
      shoeSize: "10",
      shoeSizeSystem: "US_MENS",
    }));
  });

  describe("direct report", () => {
    it("links a manager and drops the typed name", async () => {
      mocks.db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === studentId) return student;
        if (where.id === managerId) return { id: managerId, directReportId: null };
        return null;
      });

      await patch({ directReportId: managerId });

      expect(updateData()).toEqual(expect.objectContaining({ directReportId: managerId, directReportName: null }));
    });

    it("stores a typed name and drops the linked manager", async () => {
      await patch({ directReportName: "  Coach Smith " });

      expect(updateData()).toEqual(expect.objectContaining({ directReportName: "Coach Smith", directReportId: null }));
    });

    it.each([
      ["themselves", studentId, () => undefined, "A user cannot report to themselves"],
      ["an unknown person", managerId, () => undefined, "Direct report user not found"],
      ["a cycle", managerId, () => mocks.db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === studentId) return student;
        return { id: managerId, directReportId: studentId };
      }), "Direct report assignment would create a reporting cycle"],
    ])("refuses %s", async (_label, target, arrange, message) => {
      arrange();

      const response = await patch({ directReportId: target });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(message);
    });

    it("refuses a chain deeper than 50", async () => {
      let hop = 0;
      mocks.db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === studentId) return student;
        hop += 1;
        return { id: where.id, directReportId: `cmchain${String(hop).padStart(18, "0")}` };
      });

      const response = await patch({ directReportId: managerId });

      expect((await response.json()).error).toBe("Direct report chain is too deep");
    });
  });

  describe("deactivation", () => {
    it("deactivates through the cleanup service and skips the plain update", async () => {
      const response = await patch({ active: false });

      expect(response.status).toBe(200);
      expect(mocks.deactivate).toHaveBeenCalledWith(expect.objectContaining({ targetUserId: studentId, actorId: "admin-1" }));
      expect(mocks.db.user.update).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    });

    it("refuses to deactivate alongside other changes", async () => {
      const response = await patch({ active: false, name: "Ada L." });

      expect(response.status).toBe(400);
      expect(mocks.deactivate).not.toHaveBeenCalled();
    });

    it("retries companion revocation for someone already inactive", async () => {
      mocks.db.user.findUnique.mockResolvedValue({ ...student, active: false });
      mocks.revoke.mockRejectedValueOnce(new Error("redis down"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect((await patch({ active: false })).status).toBe(503);
      expect((await patch({ active: false })).status).toBe(200);
      expect(mocks.revoke).toHaveBeenCalledTimes(2);
    });

    it("clears the inactive date on reactivation", async () => {
      mocks.db.user.findUnique.mockResolvedValue({ ...student, active: false });

      await patch({ active: true });

      expect(updateData()).toEqual({ active: true, deactivatedAt: null });
    });
  });

  it.each([
    [["athletics_email"], "That athletics email is already in use"],
    [["wiscard_card_number"], "That Wiscard value is already linked to another account"],
    [["email"], "A user with this email already exists"],
  ])("explains a %s clash", async (target, message) => {
    mocks.db.user.update.mockRejectedValueOnce(uniqueError(target));

    const response = await patch({ name: "Ada L." });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(message);
  });
});

describe("GET /api/users/[id]", () => {
  it("returns 404 for an unknown person", async () => {
    expect((await get("missing")).status).toBe(404);
  });

});
