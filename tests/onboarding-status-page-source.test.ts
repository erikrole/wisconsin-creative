import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onboarding status page source wiring", () => {
  it("renders a dedicated onboarding status route from invitation and account readiness truth", () => {
    const source = readFileSync("src/app/(app)/staff/onboarding-status/page.tsx", "utf8");

    expect(source).toContain("Onboarding Status");
    expect(source).toContain('url: "/api/users/onboarding-readiness"');
    expect(source).toContain("const STALE_DAYS = 14");
    expect(source).toContain("Stale pending");
    expect(source).toContain("Pending");
    expect(source).toContain("Claimed");
    expect(source).toContain("Operationally ready");
    expect(source).toContain("Profile complete");
    expect(source).toContain("Setup needed");
    expect(source).toContain("OperationalMetricCard");
    expect(source).toContain('name="onboardingStatusSearch"');
    expect(source).toContain('aria-label="Onboarding status filter"');
    expect(source).toContain('if (status === "claimed") return <Badge variant="gray">Claimed</Badge>;');
    expect(source).toContain("createdBy.name");
    expect(source).toContain("claimedBy.name");
    expect(source).toContain("Copy app login link");
    expect(source).toContain("Remove pending invite");
    expect(source).toContain("navigator.clipboard.writeText(`${window.location.origin}${loginPath()}`)");
    expect(source).toContain("row.collaboratorPolicy?.affiliation.badgeLabel");
    expect(source).not.toContain('params.set("profile", "btn")');
    expect(source).toContain("fetch(`/api/allowed-emails/${row.id}`, { method: \"DELETE\" })");
  });

  it("lets staff nudge signed-in accounts that have not finished setup", () => {
    const source = readFileSync("src/app/(app)/staff/onboarding-status/page.tsx", "utf8");

    expect(source).toContain("`/api/users/${account.id}/setup-reminder`");
    expect(source).toContain("!account.profileComplete");
    expect(source).toContain("Nudge to finish setup");
  });

  it("keeps old invitation links as a compatibility redirect into app login", () => {
    const source = readFileSync("src/app/register/page.tsx", "utf8");

    expect(source).toContain("redirect(target)");
    expect(source).toContain("/login?email=");
    expect(source).not.toContain("useState");
  });

  it("links the status page from onboarding entry points", () => {
    const users = readFileSync("src/app/(app)/staff/page.tsx", "utf8");
    const allowedEmails = readFileSync("src/app/(app)/settings/allowed-emails/page.tsx", "utf8");
    const dialog = readFileSync("src/components/onboarding/OnboardingDialog.tsx", "utf8");

    expect(users).toContain('href="/staff/onboarding-status"');
    expect(users).toContain("Onboarding");
    expect(allowedEmails).toContain('href="/staff/onboarding-status"');
    expect(allowedEmails).toContain("Status");
    expect(allowedEmails).toContain('name="allowedEmailStatusFilter"');
    expect(allowedEmails).toContain('id="allowed-email-status-filter"');
    expect(allowedEmails).toContain('aria-label="Allowed email status filter"');
    expect(allowedEmails).toContain('className="flex flex-wrap items-center gap-2"');
    expect(dialog).toContain('href="/staff/onboarding-status"');
    expect(dialog).toContain("View status");
  });
});
