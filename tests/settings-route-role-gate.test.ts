import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

globalThis.React = React;

const testState = vi.hoisted(() => ({
  pathname: "/settings",
  currentUser: null as null | { role: string; canViewUsageAnalytics?: boolean },
  isLoading: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => testState.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({ data: testState.currentUser, isLoading: testState.isLoading }),
}));

import SettingsLayout from "@/app/(app)/settings/layout";
import {
  SETTINGS_SECTIONS,
  findSettingsSection,
  getSettingsRouteAccess,
} from "@/lib/nav-sections";

const restrictedChild = createElement("div", null, "RESTRICTED-CONTROL");
const TestableSettingsLayout = SettingsLayout as React.ComponentType<{
  children?: React.ReactNode;
}>;

function renderRoute(pathname: string, role: string | null, isLoading = false, ownerAccess = false) {
  testState.pathname = pathname;
  testState.currentUser = role ? { role, canViewUsageAnalytics: ownerAccess } : null;
  testState.isLoading = isLoading;

  return renderToStaticMarkup(createElement(TestableSettingsLayout, null, restrictedChild));
}

describe("Settings route role registry", () => {
  it("keeps every registered pathname unique", () => {
    const hrefs = SETTINGS_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("allows the overview for every authenticated role", () => {
    for (const role of ["STUDENT", "STAFF", "ADMIN"]) {
      expect(getSettingsRouteAccess("/settings", role)).toMatchObject({
        kind: "overview",
        allowed: true,
      });
    }
  });

  it("keeps personal Settings available to students, including nested paths", () => {
    expect(getSettingsRouteAccess("/settings/profile", "STUDENT").allowed).toBe(true);
    expect(getSettingsRouteAccess("/settings/security/sessions", "STUDENT")).toMatchObject({
      kind: "section",
      allowed: true,
      section: { href: "/settings/security", requiredRole: "STUDENT" },
    });
  });

  it("enforces STAFF and ADMIN thresholds", () => {
    expect(getSettingsRouteAccess("/settings/categories", "STUDENT").allowed).toBe(false);
    expect(getSettingsRouteAccess("/settings/categories", "STAFF").allowed).toBe(true);
    expect(getSettingsRouteAccess("/settings/data-export", "STAFF").allowed).toBe(false);
    expect(getSettingsRouteAccess("/settings/data-export", "ADMIN").allowed).toBe(true);
  });

  it("requires the separate owner allowlist for app activity", () => {
    expect(getSettingsRouteAccess("/settings/app-activity", "ADMIN").allowed).toBe(false);
    expect(getSettingsRouteAccess("/settings/app-activity", "ADMIN", true).allowed).toBe(true);
    expect(getSettingsRouteAccess("/settings/app-activity", "STAFF", true).allowed).toBe(false);
  });

  it("uses route boundaries and fails unknown Settings paths closed", () => {
    expect(findSettingsSection("/settings/profile-history")).toBeNull();
    expect(getSettingsRouteAccess("/settings/profile-history", "ADMIN")).toEqual({
      kind: "unknown",
      section: null,
      allowed: false,
    });
  });
});

describe("SettingsRouteContent", () => {
  it("does not render children while identity is loading or absent", () => {
    expect(renderRoute("/settings/data-export", null, true)).not.toContain("RESTRICTED-CONTROL");
    expect(renderRoute("/settings/data-export", null)).not.toContain("RESTRICTED-CONTROL");
  });

  it("does not render forbidden children for students or staff", () => {
    const studentHtml = renderRoute("/settings/categories", "STUDENT");
    const staffHtml = renderRoute("/settings/data-export", "STAFF");

    expect(studentHtml).toContain("Access denied");
    expect(studentHtml).not.toContain("RESTRICTED-CONTROL");
    expect(staffHtml).toContain("Access denied");
    expect(staffHtml).not.toContain("RESTRICTED-CONTROL");
  });

  it("renders allowed children for personal, STAFF, and ADMIN routes", () => {
    expect(renderRoute("/settings/profile", "STUDENT")).toContain("RESTRICTED-CONTROL");
    expect(renderRoute("/settings/categories", "STAFF")).toContain("RESTRICTED-CONTROL");
    expect(renderRoute("/settings/data-export/details", "ADMIN")).toContain("RESTRICTED-CONTROL");
  });

  it("keeps the app activity children hidden from role-only admins", () => {
    expect(renderRoute("/settings/app-activity", "ADMIN")).toContain("Access denied");
    expect(renderRoute("/settings/app-activity", "ADMIN")).not.toContain("RESTRICTED-CONTROL");
    expect(renderRoute("/settings/app-activity", "ADMIN", false, true)).toContain("RESTRICTED-CONTROL");
  });

  it("shows distinct recovery copy and no children for unknown routes", () => {
    const html = renderRoute("/settings/not-a-page", "ADMIN");

    expect(html).toContain("Settings page unavailable");
    expect(html).toContain("Back to Settings");
    expect(html).not.toContain("RESTRICTED-CONTROL");
  });
});
