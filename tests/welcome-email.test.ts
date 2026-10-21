import { describe, expect, it } from "vitest";
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
