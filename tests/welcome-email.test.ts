import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildWelcomeEmail } from "@/lib/services/welcome-email";

describe("welcome email", () => {
  it("greets by first name and points to the first places to look", () => {
    const { subject, text } = buildWelcomeEmail({ name: "Maya Chen" });

    expect(subject).toBe("You're set up on Wisconsin Creative");
    expect(text).toContain("You're all set, Maya");
    expect(text).toContain("Check the schedule");
    expect(text).toContain("Install the iPhone app");
  });

  it("works without a name", () => {
    expect(buildWelcomeEmail({ name: null }).text).toContain("You're all set");
  });

  it("is sent once, only after setup finishes, from both completion paths", () => {
    const service = readFileSync("src/lib/services/welcome-email.ts", "utf8");
    const patch = readFileSync("src/app/api/me/profile-completion/route.ts", "utf8");
    const avatar = readFileSync("src/app/api/users/[id]/avatar/route.ts", "utf8");
    const migration = readFileSync("prisma/migrations/0199_user_welcome_email/migration.sql", "utf8");

    expect(service).toContain("welcomeEmailSentAt: null }");
    expect(service).toContain("profileComplete");
    expect(service).toContain('user.role === "COLLABORATOR"');
    expect(patch).toContain("sendWelcomeEmailIfDone(user.id)");
    expect(avatar).toContain("sendWelcomeEmailIfDone(id)");
    // Existing accounts are marked sent so the rollout does not email everyone.
    expect(migration).toContain('SET "welcome_email_sent_at" = NOW()');
  });
});

describe("sendWelcomeEmailIfDone", () => {
  async function run(user: Record<string, unknown> | null, claimCount = 1, delivered = true) {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const findUnique = vi.fn().mockResolvedValue(user);
    const updateMany = vi.fn().mockResolvedValue({ count: claimCount });
    const sendEmail = vi.fn().mockResolvedValue(delivered);
    vi.doMock("@/lib/db", () => ({ db: { user: { findUnique, updateMany } } }));
    vi.doMock("@/lib/email", async () => ({ ...(await vi.importActual<object>("@/lib/email")), sendEmail }));
    const { sendWelcomeEmailIfDone } = await import("@/lib/services/welcome-email");
    await sendWelcomeEmailIfDone("u1");
    return { updateMany, sendEmail };
  }
  const complete = {
    id: "u1", name: "Maya Chen", email: "maya@wisc.edu", role: "STUDENT", athleticsEmail: null, phone: "6085550142",
    personalPhone: "(608) 555-0142", workPhone: null, workPhoneNotApplicable: false, wiscardCardNumber: "1234567890",
    wiscardIssueCode: "1", studentYearOverride: "SOPHOMORE", gradYear: null, graduationTerm: null, topSizeFit: "UNISEX",
    topSize: "M", shoeSizeSystem: "US_WOMENS", shoeSize: "8", avatarUrl: "https://x/y.png", profilePromptSnoozedUntil: null,
    active: true, hiddenFromRoster: false, welcomeEmailSentAt: null,
  };

  it("sends once for a finished student without graduation details", async () => {
    const { sendEmail, updateMany } = await run(complete);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not send when already sent, unfinished, or a collaborator", async () => {
    expect((await run({ ...complete, welcomeEmailSentAt: new Date() })).sendEmail).not.toHaveBeenCalled();
    expect((await run({ ...complete, avatarUrl: null })).sendEmail).not.toHaveBeenCalled();
    expect((await run({ ...complete, role: "COLLABORATOR" })).sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when another save already claimed it", async () => {
    expect((await run(complete, 0)).sendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim when delivery fails so a later save can retry", async () => {
    const { updateMany } = await run(complete, 1, false);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
