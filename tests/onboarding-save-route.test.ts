import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, requireAuth: vi.fn(), audit: vi.fn() };
});

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 30, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { PATCH } from "@/app/api/me/profile-completion/route";
import { onboardingVersions } from "@/lib/onboarding-versions";

const student = { id: "user-1", email: "new@wisc.edu", name: "New Student", role: "STUDENT" as const, avatarUrl: null };
const staff = { ...student, id: "staff-1", role: "STAFF" as const };

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: student.id,
    name: "New Student",
    role: "STUDENT",
    email: "new@wisc.edu",
    athleticsEmail: null,
    phone: null,
    personalPhone: null,
    workPhone: null,
    workPhoneNotApplicable: false,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    wiscardNumber: null,
    studentYearOverride: null,
    gradYear: null,
    graduationTerm: null,
    topSizeFit: null,
    topSize: null,
    shoeSizeSystem: null,
    shoeSize: null,
    avatarUrl: null,
    profilePromptSnoozedUntil: null,
    hiddenFromRoster: false,
    onboardingRequired: true,
    onboardingCompletedAt: null,
    ...overrides,
  };
}

const complete = {
  personalPhone: "(608) 555-0100",
  phone: "(608) 555-0100",
  studentYearOverride: "FRESHMAN",
  graduationTerm: "SPRING",
  gradYear: new Date().getFullYear() + 3,
  topSizeFit: "UNISEX",
  topSize: "M",
  shoeSizeSystem: "US_MENS",
  shoeSize: "10",
};

let stored: ReturnType<typeof profile>;

async function save(body: Record<string, unknown>) {
  const response = await PATCH(new Request("https://app.example.com/api/me/profile-completion", {
    method: "PATCH",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

function saveGroup(group: string, values: Record<string, unknown>, expectedVersion?: string) {
  return save({
    step: "SAVE",
    group,
    values,
    expectedVersion: expectedVersion ?? onboardingVersions(stored)[group as keyof ReturnType<typeof onboardingVersions>],
  });
}

function updatedData() {
  return mocks.db.user.update.mock.calls[0]?.[0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SESSION_SECRET", "onboarding-save-test-only-session-secret");
  stored = profile();
  mocks.requireAuth.mockResolvedValue(student);
  mocks.db.user.findUnique.mockImplementation(async () => stored);
  mocks.db.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stored, ...data }));
  mocks.db.$transaction.mockImplementation(async (run: (tx: typeof mocks.db) => unknown) => run(mocks.db));
  mocks.audit.mockResolvedValue(undefined);
});

describe("PATCH /api/me/profile-completion SAVE", () => {
  it("saves one group, mirrors the phone and clears the reminder", async () => {
    const { response, body } = await saveGroup("PERSONAL_PHONE", { personalPhone: "608-555-0100" });

    expect(response.status).toBe(200);
    expect(updatedData()).toEqual({ personalPhone: "(608) 555-0100", phone: "(608) 555-0100", profilePromptSnoozedUntil: null });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      action: "profile_completion_updated",
      after: { group: "PERSONAL_PHONE", fieldsChanged: ["personalPhone", "phone"], saved: true },
    }));
    expect(body.data.profile).not.toHaveProperty("wiscardNumber");
    expect(body.data.profile).not.toHaveProperty("hiddenFromRoster");
    expect(body.data.versions.PERSONAL_PHONE).toMatch(/^[a-f0-9]{64}$/);
  });

  it("joins the Wiscard number and issue code for kiosk lookup, and clears it when both are empty", async () => {
    await saveGroup("WISCARD", { wiscardCardNumber: "1234567890", wiscardIssueCode: "2" });
    expect(updatedData().wiscardNumber).toBe("12345678902");

    stored = profile({ wiscardCardNumber: "1234567890", wiscardIssueCode: "2", wiscardNumber: "12345678902" });
    mocks.db.user.update.mockClear();
    await saveGroup("WISCARD", { wiscardCardNumber: null, wiscardIssueCode: null });
    expect(updatedData().wiscardNumber).toBeNull();
  });

  it("clears the work phone when staff say they have none", async () => {
    mocks.requireAuth.mockResolvedValue(staff);
    stored = profile({ id: staff.id, role: "STAFF", workPhone: "(608) 555-0199" });

    await saveGroup("WORK_PHONE", { workPhone: "608-555-0199", workPhoneNotApplicable: true });

    expect(updatedData()).toEqual(expect.objectContaining({ workPhone: null, workPhoneNotApplicable: true }));
  });

  it("treats a repeated save as already done, even with an old version", async () => {
    stored = profile({ personalPhone: "(608) 555-0100", phone: "(608) 555-0100" });

    const { response } = await saveGroup("PERSONAL_PHONE", { personalPhone: "608-555-0100" }, "0".repeat(64));

    expect(response.status).toBe(200);
    expect(mocks.db.user.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("refuses an edit made against details that changed elsewhere", async () => {
    const { response, body } = await saveGroup("PERSONAL_PHONE", { personalPhone: "608-555-0100" }, "0".repeat(64));

    expect(response.status).toBe(409);
    expect(body.error).toBe("Your saved details changed elsewhere. Review them before saving your edits.");
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a work phone from a student", "STUDENT", "WORK_PHONE", { workPhone: null, workPhoneNotApplicable: true }],
    ["graduation from staff", "STAFF", "GRADUATION", { graduationTerm: null, gradYear: null }],
    ["anything from a collaborator", "COLLABORATOR", "PERSONAL_PHONE", { personalPhone: "608-555-0100" }],
  ])("refuses %s", async (_label, role, group, values) => {
    stored = profile({ role });

    const { response, body } = await saveGroup(group, values);

    expect(response.status).toBe(400);
    expect(body.error).toBe("This field is not part of your setup.");
  });

  it("asks for an admin when the login email is not a campus address", async () => {
    stored = profile({ email: "someone@gmail.com" });

    const { response } = await saveGroup("EMAIL", { athleticsEmail: "someone@athletics.wisc.edu" });

    expect(response.status).toBe(409);
  });

  it("explains a half-filled group", async () => {
    const { response, body } = await saveGroup("GRADUATION", { graduationTerm: "SPRING", gradYear: null });

    expect(response.status).toBe(400);
    expect(body.error).toBe("Choose both graduation fields");
  });
});

describe("PATCH /api/me/profile-completion FINISH", () => {
  it("finishes setup once every required field is saved, photo optional", async () => {
    stored = profile(complete);

    const { response, body } = await save({ step: "FINISH", expectedUserId: student.id });

    expect(response.status).toBe(200);
    expect(updatedData()).toEqual({ onboardingCompletedAt: expect.any(Date), onboardingRequired: false, profilePromptSnoozedUntil: null });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.objectContaining({
      action: "onboarding_completed",
      after: { onboardingComplete: true, photoAdded: false },
    }));
    expect(body.data.completion.requiresSetup).toBe(false);
  });

  it("replays safely after setup is already finished", async () => {
    stored = profile({ ...complete, onboardingRequired: false, onboardingCompletedAt: new Date("2026-10-24T15:00:00.000Z") });

    const { response } = await save({ step: "FINISH", expectedUserId: student.id });

    expect(response.status).toBe(200);
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it("refuses to finish while a required field is missing", async () => {
    stored = profile({ ...complete, shoeSize: null });

    const { response, body } = await save({ step: "FINISH", expectedUserId: student.id });

    expect(response.status).toBe(409);
    expect(body.error).toBe("Save your required details before finishing setup.");
    expect(mocks.db.user.update).not.toHaveBeenCalled();
  });

  it("stops when a different person is now signed in", async () => {
    const { response, body } = await save({ step: "FINISH", expectedUserId: "someone-else" });

    expect(response.status).toBe(409);
    expect(body.error).toBe("Your sign-in changed. Reload to continue.");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
