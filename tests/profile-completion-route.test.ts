import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const mock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return mock;
});

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { limit: 30, windowMs: 60_000 },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { createAuditEntryTx } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { GET, PATCH } from "@/app/api/me/profile-completion/route";

const actor = {
  id: "user-1",
  email: "person@wisc.edu",
  name: "Person",
  role: "STUDENT" as const,
  avatarUrl: null,
};

function storedProfile(overrides: Record<string, unknown> = {}) {
  return {
    role: "STUDENT",
    email: "person@wisc.edu",
    athleticsEmail: null,
    phone: "608-555-0100",
    personalPhone: null,
    workPhone: null,
    workPhoneNotApplicable: false,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    studentYearOverride: null,
    gradYear: null,
    graduationTerm: null,
    topSizeFit: null,
    topSize: null,
    shoeSizeSystem: null,
    shoeSize: null,
    profilePromptSnoozedUntil: null,
    ...overrides,
  };
}

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/me/profile-completion", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(actor);
  dbMock.user.findUnique.mockResolvedValue(storedProfile());
  dbMock.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const selected = storedProfile(data) as Record<string, unknown>;
    delete selected.wiscardNumber;
    return selected;
  });
  dbMock.$transaction.mockImplementation(async (operation: (tx: typeof dbMock) => Promise<unknown>) => operation(dbMock));
  vi.mocked(createAuditEntryTx).mockResolvedValue(undefined);
});

describe("/api/me/profile-completion", () => {
  it("returns server-derived missing fields for the signed-in user", async () => {
    const response = await GET(new Request("https://app.example.com/api/me/profile-completion"), noParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.completion.missingFields).toContain("personalPhone");
    expect(body.data.profile).not.toHaveProperty("wiscardNumber");
    expect(body.data.profile).not.toHaveProperty("hiddenFromRoster");
    expect(dbMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
  });

  it("does not prompt hidden smoke identities to complete campus profile details", async () => {
    dbMock.user.findUnique.mockResolvedValue(storedProfile({
      email: "admin@creative.local",
      hiddenFromRoster: true,
    }));

    const response = await GET(new Request("https://app.example.com/api/me/profile-completion"), noParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.completion.shouldPrompt).toBe(false);
    expect(body.data.completion.isComplete).toBe(true);
    expect(body.data.completion.missingFields).toEqual([]);
    expect(body.data.profile).not.toHaveProperty("hiddenFromRoster");
  });

  it("classifies phone data while keeping the legacy phone as the personal compatibility value", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...actor, role: "STAFF" });
    dbMock.user.findUnique.mockResolvedValue(storedProfile({ role: "STAFF" }));

    const response = await PATCH(patchRequest({
      step: "PHONES",
      personalPhone: "608-555-1111",
      workPhone: "608-555-2222",
      workPhoneNotApplicable: false,
    }), noParams);

    expect(response.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: "608-555-1111",
        personalPhone: "608-555-1111",
        workPhone: "608-555-2222",
      }),
    }));
    expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({
      action: "profile_completion_updated",
      before: {
        step: "PHONES",
        personalPhoneSet: false,
        workPhoneSet: false,
        workPhoneNotApplicable: false,
      },
      after: expect.objectContaining({
        step: "PHONES",
        personalPhoneSet: true,
        workPhoneSet: true,
      }),
    }));
    expect(JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0])).not.toContain("608-555");
  });

  it("saves only a personal phone for students and preserves any stored work-phone state", async () => {
    const response = await PATCH(patchRequest({
      step: "PHONES",
      personalPhone: "608-555-1111",
    }), noParams);

    expect(response.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        phone: "608-555-1111",
        personalPhone: "608-555-1111",
        profilePromptSnoozedUntil: null,
      },
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({
      after: expect.objectContaining({
        fieldsChanged: ["personalPhone", "phone"],
      }),
    }));
  });

  it("combines typed Wiscard number and issue code for existing kiosk lookup", async () => {
    const response = await PATCH(patchRequest({
      step: "WISCARD",
      wiscardCardNumber: "9070324812",
      wiscardIssueCode: "5",
    }), noParams);

    expect(response.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        wiscardCardNumber: "9070324812",
        wiscardIssueCode: "5",
        wiscardNumber: "90703248125",
      }),
    }));
    expect(JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0])).not.toContain("9070324812");
  });

  it("saves student year and anticipated graduation without auditing the values", async () => {
    const response = await PATCH(patchRequest({
      step: "STUDENT",
      studentYearOverride: "JUNIOR",
      graduationTerm: "SPRING",
      gradYear: 2027,
    }), noParams);

    expect(response.status).toBe(200);
    expect(dbMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        studentYearOverride: "JUNIOR",
        graduationTerm: "SPRING",
        gradYear: 2027,
      }),
    }));
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({
      before: {
        step: "STUDENT",
        studentYearSet: false,
        anticipatedGraduationSet: false,
      },
      after: expect.objectContaining({
        step: "STUDENT",
        studentYearSet: true,
        anticipatedGraduationSet: true,
      }),
    }));
    expect(JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0])).not.toContain("2027");
    expect(JSON.stringify(vi.mocked(createAuditEntryTx).mock.calls[0])).not.toContain("JUNIOR");
  });

  it("rejects student details for a non-student profile", async () => {
    dbMock.user.findUnique.mockResolvedValue(storedProfile({ role: "STAFF" }));

    const response = await PATCH(patchRequest({
      step: "STUDENT",
      studentYearOverride: "JUNIOR",
      graduationTerm: "SPRING",
      gradYear: 2027,
    }), noParams);

    expect(response.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("snoozes the prompt for one day without marking missing data complete", async () => {
    const before = Date.now();
    const response = await PATCH(patchRequest({ step: "SNOOZE" }), noParams);
    const update = dbMock.user.update.mock.calls[0]?.[0] as { data: { profilePromptSnoozedUntil: Date } };

    expect(response.status).toBe(200);
    expect(update.data.profilePromptSnoozedUntil.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1_000);
    expect(createAuditEntryTx).toHaveBeenCalledWith(dbMock, expect.objectContaining({ action: "profile_completion_snoozed" }));
  });

  it("rejects Athletics addresses outside the required domain", async () => {
    const response = await PATCH(patchRequest({ step: "EMAIL", athleticsEmail: "person@example.com" }), noParams);

    expect(response.status).toBe(400);
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects phone values without at least seven digits", async () => {
    const response = await PATCH(patchRequest({
      step: "PHONES",
      personalPhone: "call-me-now",
      workPhone: null,
      workPhoneNotApplicable: true,
    }), noParams);

    expect(response.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("still requires a work-phone answer from non-students", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...actor, role: "STAFF" });

    const response = await PATCH(patchRequest({
      step: "PHONES",
      personalPhone: "608-555-1111",
    }), noParams);

    expect(response.status).toBe(400);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns a specific conflict for duplicate Wiscard card numbers", async () => {
    dbMock.user.update.mockRejectedValueOnce({
      code: "P2002",
      meta: { target: ["wiscard_card_number"] },
    });

    const response = await PATCH(patchRequest({
      step: "WISCARD",
      wiscardCardNumber: "9070324812",
      wiscardIssueCode: "5",
    }), noParams);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "That Wiscard is already linked to another account." });
    expect(createAuditEntryTx).not.toHaveBeenCalled();
  });

  it("fails the transaction when the audit write fails", async () => {
    const auditError = new Error("audit unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(createAuditEntryTx).mockRejectedValueOnce(auditError);

    const response = await PATCH(patchRequest({
      step: "EMAIL",
      athleticsEmail: "person@athletics.wisc.edu",
    }), noParams);

    expect(response.status).toBe(500);
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(createAuditEntryTx).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(auditError);
    consoleError.mockRestore();
  });
});
