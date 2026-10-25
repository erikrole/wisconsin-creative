import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, Role } from "@prisma/client";
import { authUser, jsonRequest } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  userUpdate: vi.fn(),
  locationFindMany: vi.fn(),
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  requireKiosk: vi.fn(),
  verifyPassword: mocks.verifyPassword,
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUniqueOrThrow: mocks.userFindUniqueOrThrow, update: mocks.userUpdate },
    location: { findMany: mocks.locationFindMany },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.createAuditEntry }));
vi.mock("@/lib/companion-store", () => ({ revokeCompanionUser: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/profile/route";

const noParams = { params: Promise.resolve({}) };
const maya = { ...authUser(Role.STUDENT, "maya"), forcePasswordChange: false };

const stored = {
  id: "maya",
  name: "Maya",
  email: "maya@example.com",
  role: Role.STUDENT,
  affiliation: null,
  collaboratorProfile: null,
  title: null,
  avatarUrl: null,
  phone: "(608) 555-0100",
  personalPhone: "(608) 555-0100",
  workPhone: null,
  workPhoneNotApplicable: true,
  wiscardNumber: "90812345671",
  wiscardCardNumber: "9081234567",
  wiscardIssueCode: "1",
  slackHandle: null,
  slackProfileUrl: null,
  locationId: null,
  location: null,
  birthdayMonth: 4,
  birthdayDay: 12,
  birthYear: 2005,
};

const patch = (body: unknown) => PATCH(jsonRequest("/api/profile", "PATCH", body), noParams);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(maya);
  mocks.userFindUniqueOrThrow.mockResolvedValue(stored);
  mocks.userUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
  mocks.locationFindMany.mockResolvedValue([{ id: "cr", name: "Camp Randall" }]);
});

describe("GET /api/profile", () => {
  it("returns a student's own profile with the active locations", async () => {
    const body = await (await GET(jsonRequest("/api/profile", "GET"), noParams)).json();

    expect(body.data.user).toMatchObject({ id: "maya", wiscardCardNumber: "9081234567" });
    expect(body.data.locations).toEqual([{ id: "cr", name: "Camp Randall" }]);
    expect(mocks.userFindUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "maya" } }));
  });

  it("gives a collaborator only their identity, no Wiscard or locations", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR, "btn-1"), forcePasswordChange: false });

    const body = await (await GET(jsonRequest("/api/profile", "GET"), noParams)).json();

    expect(body.data.user).not.toHaveProperty("wiscardNumber");
    expect(body.data.user).not.toHaveProperty("slackHandle");
    expect(body.data.locations).toEqual([]);
    expect(mocks.locationFindMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/profile", () => {
  it("refuses a wrong current password without changing anything", async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    const res = await patch({ action: "change_password", currentPassword: "wrong-pass", newPassword: "new-password-1" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Current password is incorrect");
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it("blocks profile edits until a required password change is done", async () => {
    mocks.requireAuth.mockResolvedValue({ ...maya, forcePasswordChange: true });

    const res = await patch({ name: "Maya R." });

    expect(res.status).toBe(403);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("lets a collaborator change only their name", async () => {
    mocks.requireAuth.mockResolvedValue({ ...authUser(Role.COLLABORATOR, "btn-1"), forcePasswordChange: false });

    const refused = await patch({ name: "Sam", slackHandle: "sam" });
    expect(refused.status).toBe(403);
    expect(mocks.userUpdate).not.toHaveBeenCalled();

    const res = await patch({ name: "Sam" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("personalPhone");
  });

  it("keeps both phone columns in step and formats the number", async () => {
    await patch({ personalPhone: "1-608-555-0199" });

    expect(mocks.userUpdate.mock.calls[0]![0].data).toEqual({ personalPhone: "(608) 555-0199", phone: "(608) 555-0199" });
  });

  it("marks a cleared work phone as not applicable", async () => {
    await patch({ workPhone: "" });

    expect(mocks.userUpdate.mock.calls[0]![0].data).toEqual({ workPhone: null, workPhoneNotApplicable: true });
  });

  it("builds the full Wiscard number from a new issue code and the saved card number", async () => {
    await patch({ wiscardIssueCode: "2" });

    expect(mocks.userUpdate.mock.calls[0]![0].data).toEqual({
      wiscardCardNumber: "9081234567",
      wiscardIssueCode: "2",
      wiscardNumber: "90812345672",
    });
  });

  it("clears the full Wiscard number when half of it is removed", async () => {
    await patch({ wiscardCardNumber: null });

    expect(mocks.userUpdate.mock.calls[0]![0].data).toMatchObject({ wiscardCardNumber: null, wiscardNumber: null });
  });

  it("audits phones masked and Wiscard and birthday by presence only", async () => {
    await patch({ personalPhone: "608-555-0199", wiscardCardNumber: "1234567890", wiscardIssueCode: "2", birthYear: 2004, name: "Maya R." });

    const audit = mocks.createAuditEntry.mock.calls[0]![0];
    expect(audit.action).toBe("profile_update");
    expect(audit.before).toMatchObject({ personalPhone: "***0100", wiscardIssueCode: "[set]", wiscardNumber: "[set]", birthYear: "[set]", name: "Maya" });
    expect(audit.after).toMatchObject({ personalPhone: "***0199", wiscardIssueCode: "[updated]", wiscardNumber: "[updated]", birthYear: "[updated]", name: "Maya R." });
    expect(audit.after.wiscardCardNumber).toBe("[updated]");
    expect(JSON.stringify(audit)).not.toMatch(/9081234567|1234567890|2004/);
  });

  it("saves only the fields sent, clearing those sent as null", async () => {
    await patch({
      title: null,
      athleticsEmail: "Maya.R@Athletics.Wisc.edu",
      startDate: "2026-08-24T05:00:00.000Z",
      shoeSize: "9",
      shoeSizeSystem: "US_WOMENS",
      gradYear: 2028,
      locationId: null,
    });

    expect(mocks.userUpdate.mock.calls[0]![0].data).toEqual({
      title: null,
      athleticsEmail: "maya.r@athletics.wisc.edu",
      startDate: new Date("2026-08-24T05:00:00.000Z"),
      shoeSize: "9",
      shoeSizeSystem: "US_WOMENS",
      gradYear: 2028,
      locationId: null,
    });
  });

  it("writes no audit when nothing actually changed", async () => {
    await patch({ name: "Maya" });

    expect(mocks.createAuditEntry).not.toHaveBeenCalled();
  });

  it.each([
    [["wiscard_card_number"], "That Wiscard value is already linked to another account"],
    ["users_athletics_email_key", "That athletics email is already in use"],
  ])("explains a duplicate value (%s)", async (target, message) => {
    mocks.userUpdate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7", meta: { target } }));

    const res = await patch({ wiscardCardNumber: "1234567890" });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
  });

  it("joins validation messages into one 400", async () => {
    const res = await patch({ wiscardCardNumber: "123", wiscardIssueCode: "12" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Wiscard card number must be 10 digits, Wiscard issue code must be 1 digit");
  });
});
