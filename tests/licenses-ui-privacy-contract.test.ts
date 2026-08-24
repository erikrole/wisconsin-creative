import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("licenses UI and privacy contracts", () => {
  it("redacts other holders' profile fields from student license responses", () => {
    const route = source("src/app/api/licenses/route.ts");

    expect(route).toContain("claim.userId === user.id");
    expect(route).toContain("userId: isOwnClaim ? claim.userId : null");
    expect(route).toContain("user: isOwnClaim ? claim.user : null");
    expect(route).toContain("occupantLabel: null");
  });

  it("keeps renewal controls behind the staff role gate", () => {
    const licenses = source("src/app/(app)/licenses/PhotoMechanicLicenses.tsx");

    expect(licenses).toContain("onRenew={isAdmin ? () => setShowRenew(true) : undefined}");
    expect(licenses).toContain("{isAdmin && allCodes.length > 0 && (");
    expect(licenses).toContain("Renew licenses");
  });

  it("shows explicit claim and inspect actions with active-use color semantics", () => {
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");

    expect(table).toMatch(/<Eye[\s\S]*?Inspect/);
    expect(table).toMatch(/<KeyRound[\s\S]*?Claim/);
    expect(table).toContain('code.status === "CLAIMED" && "bg-[var(--blue-bg)]');
    expect(table).not.toContain('code.status === "CLAIMED" && "bg-[var(--red-bg)]');
  });

  it("keeps Photo Mechanic license details actionable without a narrow-screen table", () => {
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");

    expect(table).toContain('className="grid gap-2 md:hidden" role="list"');
    expect(table).toContain('className="hidden overflow-x-auto rounded-md border md:block"');
    expect(table).toContain('className="text-xs font-medium text-muted-foreground">Capacity');
    expect(table).toContain('className="text-xs font-medium text-muted-foreground">Holders');
    expect(table).toContain('className="text-xs font-medium text-muted-foreground">Expires');
    expect(table).toContain('className="ml-auto h-10 w-24 rounded-md"');
    expect(table).toContain('className="ml-auto inline-flex min-h-10 items-center');
  });

  it("lets staff assign an open slot to an active user through the managed occupy route", () => {
    const sheet = source("src/app/(app)/licenses/AdminClaimSheet.tsx");
    const route = source("src/app/api/licenses/[id]/occupy/route.ts");
    const service = source("src/lib/services/licenses.ts");

    expect(sheet).toContain("Assign open slot");
    expect(sheet).toContain('body: JSON.stringify({ userId: selectedUserId })');
    expect(route).toContain("body.userId !== undefined");
    expect(route).toContain("assignCodeToUser(params.id, body.userId)");
    expect(route).toContain("assignedUserId: assignment.assignee?.id ?? null");
    expect(service).toContain('role: { in: ["ADMIN", "STAFF", "STUDENT"] }');
    expect(service).toContain("already has an active Photo Mechanic license");
  });

  it("uses the local calendar date for date-only expiry values across the license page", () => {
    const licenses = source("src/app/(app)/licenses/PhotoMechanicLicenses.tsx");
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");
    const banner = source("src/app/(app)/licenses/MyLicensePanel.tsx");
    const renew = source("src/app/(app)/licenses/BulkRenewDialog.tsx");
    const sheet = source("src/app/(app)/licenses/AdminClaimSheet.tsx");

    expect(licenses).toContain("licenseDaysUntilExpiry");
    expect(licenses).toContain("localDateKey");
    expect(table).toContain("formatLicenseExpiryDate");
    expect(table).toContain("licenseDaysUntilExpiry");
    expect(banner).toContain("isLicenseExpired");
    expect(renew).toContain("licenseDaysUntilExpiry");
    expect(sheet).toContain("licenseExpiryInputValue");
    expect(sheet).toContain("isLicenseExpired");
  });
});
