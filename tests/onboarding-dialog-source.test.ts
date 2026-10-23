import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onboarding dialog source wiring", () => {
  it("presents one shared invite-first flow without temporary-password onboarding", () => {
    const source = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(source).toContain("Grant app access");
    expect(source).toContain('fetch("/api/allowed-emails"');
    expect(source).toContain("Max 50 per batch");
    expect(source).toContain("already allowlisted or registered");
    expect(source).toContain("Users set their own password the first time they sign in.");
    expect(source).toContain("Each new person was emailed their setup link.");
    expect(source).toContain("Upload CSV");
    expect(source).toContain('accept=".csv,text/csv"');
    expect(source).toContain("Retry failed invitations");
    expect(source).toContain("failedRows");
    expect(source).toContain('label="Failed"');
    expect(source).toContain("border-[var(--green)]/40 bg-[var(--green-bg)]");
    expect(source).not.toContain("border-green-200 bg-green-50");
    expect(source).not.toContain("Temporary password");
    expect(source).not.toContain("temporaryPassword");
    expect(source).not.toContain("Generate temporary password");
    expect(source).not.toContain("Download temporary password CSV");
    expect(source).not.toContain("Bulk create");
    expect(source).not.toContain('fetch("/api/users/bulk-create"');
    expect(source).not.toContain('url: "/api/users"');
  });

  it("lets a single student invitation carry a name and primary area", () => {
    const source = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(source).toContain('name="singleInvitationName"');
    expect(source).toContain('name="singleInvitationArea"');
    expect(source).toContain('inviteRole === "STUDENT" && singleName.trim() ? { preloadedName: singleName.trim() }');
    expect(source).toContain('inviteRole === "STUDENT" && singleArea ? { preloadedPrimaryArea: singleArea }');
    expect(source).toContain('useState<InviteMode>("single")');
  });

  it("previews bulk paste and CSV rows before saving invitations", () => {
    const source = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(source).toContain("previewInviteRows");
    expect(source).toContain("splitCsvLine");
    expect(source).toContain("Paste plain emails or CSV rows with `email, role`");
    expect(source).toContain("Fix these rows before saving.");
    expect(source).toContain("Duplicate in this paste");
    expect(source).toContain("Your role cannot invite this account role");
    expect(source).toContain("readyPreviewRows.map((row) => ({");
    expect(source).toContain("...inviteProfileFields(row.role, selectedPolicyId)");
    expect(source).toContain("Select an active affiliation");
    expect(source).toContain('fetch("/api/allowed-emails/preview"');
    expect(source).toContain("Authenticated preview checks existing users and invitations before commit.");
    expect(source).toContain("Review account status before saving invitations.");
    expect(source).toContain("serverBlockingRows.length > 0");
    expect(source).toContain("These invitations were not emailed.");
    expect(source).toContain("...(emailInviteNow ? { sendInvite: true } : {}),");
    expect(source).toContain("Nothing new to add");
    expect(source).toContain("requested: emails.length");
  });

  it("names onboarding form controls for browser and accessibility tooling", () => {
    const source = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(source).toContain('name="bulkInvitationRows"');
    expect(source).toContain('name="bulkInvitationRole"');
    expect(source).toContain('name="singleInvitationEmail"');
    expect(source).toContain('autoComplete="email"');
    expect(source).toContain('name="singleInvitationRole"');
    expect(source).not.toContain('name="bulkCreateRows"');
    expect(source).not.toContain('name="bulkCreateRole"');
    expect(source).not.toContain('name="bulkCreateLocationId"');
  });

  it("opens the shared onboarding surface from Users and Allowed Emails", () => {
    const usersSource = readFileSync("src/app/(app)/staff/page.tsx", "utf8");
    const allowedEmailsSource = readFileSync("src/app/(app)/settings/allowed-emails/page.tsx", "utf8");

    expect(usersSource).toContain("Add users");
    expect(usersSource).toContain("onInvitesChanged={() => reload()}");
    expect(usersSource).not.toContain("initialMode=\"invite\"");
    expect(usersSource).not.toContain("onCreated={() => reload()}");

    expect(allowedEmailsSource).toContain("OnboardingDialog");
    expect(allowedEmailsSource).toContain("Add users");
    expect(allowedEmailsSource).toContain('url: "/api/me"');
    expect(allowedEmailsSource).not.toContain('url: "/api/form-options"');
  });
});
