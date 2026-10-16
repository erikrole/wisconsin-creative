import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("licenses UI and privacy contracts", () => {
  it("shows safe holder identity while keeping other account ids and labels private", () => {
    const route = source("src/app/api/licenses/route.ts");

    expect(route).toContain("claim.userId === user.id");
    expect(route).toContain("userId: isOwnClaim ? claim.userId : null");
    expect(route).toContain("name: claim.user.name");
    expect(route).toContain("avatarUrl: claim.user.avatarUrl");
    expect(route).toContain("occupantLabel: null");
  });

  it("keeps names masked for students while open and own cards remain claimable", () => {
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");

    expect(table).toContain("const showName = isAdmin || isOwn || claim.user !== null;");
    expect(table).toContain("const displayCode = isAdmin || isOwn ? code.code : MASKED_CODE;");
    expect(table).toContain("const adminCanInspect = isAdmin;");
    expect(table).toContain("if (!isClickable) return;");
  });

  it("keeps renewal controls behind the staff role gate", () => {
    const licenses = source("src/app/(app)/licenses/PhotoMechanicLicenses.tsx");

    expect(licenses).toContain("onRenew={isAdmin ? () => setShowRenew(true) : undefined}");
    expect(licenses).toContain("{isAdmin && allCodes.length > 0 && (");
    expect(licenses).toContain("Renew licenses");
  });

  it("shows explicit claim and inspect actions with active-use color semantics", () => {
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");

    expect(table).toMatch(/<Eye[\s\S]*?<KeyRound/);
    expect(table).toContain('code.status === "CLAIMED" && "bg-[var(--blue-bg)]');
    expect(table).not.toContain('code.status === "CLAIMED" && "bg-[var(--red-bg)]');
  });

  it("renders each code as a two-slot card instead of a table", () => {
    const table = source("src/app/(app)/licenses/LicenseTable.tsx");

    expect(table).not.toContain("<Table");
    expect(table).toContain("const MAX_SLOTS = 2;");
    expect(table).toContain("Open slot");
    expect(table).toContain("slots in use");
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
