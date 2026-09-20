import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("notifications support hardening contracts", () => {
  it("uses the lightweight no-store unread count endpoint for app shell badges", () => {
    const appShell = source("src/components/AppShell.tsx");
    const countRoute = source("src/app/api/notifications/count/route.ts");

    expect(appShell).toContain('fetch("/api/notifications/count"');
    expect(appShell).not.toContain("/api/notifications?limit=0&unread=true");
    expect(countRoute).toContain('import { ok } from "@/lib/http";');
    expect(countRoute).not.toContain("cachedOk");
    expect(countRoute).toContain("return ok({ unreadCount });");
  });

  it("styles all checkout due and overdue escalation notification types as urgent rows", () => {
    const page = source("src/app/(app)/notifications/page.tsx");

    expect(page).toContain('type.startsWith("checkout_due")');
    expect(page).toContain('type.startsWith("checkout_overdue")');
    expect(page).toContain('label: "Overdue"');
    expect(page).toContain('toneClass: "bg-[var(--orange-bg)] text-[var(--orange-text)]"');
  });

  it("keeps license inbox timestamps and category-gated outbound delivery aligned", () => {
    const licenses = source("src/lib/services/licenses.ts");

    expect(licenses).toContain('type: isExpired ? "license_expired" : "license_expiring_soon"');
    expect(licenses).toContain("sentAt: now");
    expect(licenses).toContain('payload: { type: "license_expiry", licenseCodeId: code.id, href: "/licenses" }');
    expect(licenses).toContain('category: "licenseExpiry"');
    expect(licenses).toContain('type: "license_held_2d"');
    expect(licenses).toContain("sentAt: new Date()");
  });

  it("keeps manual badge awards inbox-only unless a badge push contract is added", () => {
    const badges = source("src/lib/badges/queries.ts");

    expect(badges).toContain('type: "badge_awarded"');
    expect(badges).toContain("tx.notification.create");
    expect(badges).not.toContain("sendPushToUser");
  });
});
