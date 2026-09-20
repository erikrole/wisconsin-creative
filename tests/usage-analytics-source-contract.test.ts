import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("usage analytics source contract", () => {
  it("keeps report access owner-specific and separate from role", () => {
    const access = source("src/lib/usage-analytics.ts");
    const route = source("src/app/api/reports/usage/route.ts");
    expect(access).toContain("USAGE_ANALYTICS_OWNER_EMAILS");
    expect(route).toContain("canViewUsageAnalytics(user)");
    expect(route).not.toContain("requirePermission");
    expect(route).not.toContain("requireRole");
  });

  it("counts normalized web and native surfaces without content fields", () => {
    const access = source("src/lib/usage-analytics.ts");
    const web = source("src/components/ProductUsageTracker.tsx");
    const api = source("src/app/api/product-events/route.ts");
    const native = source("ios/Wisconsin/Core/APIClient.swift");
    const report = source("src/lib/services/app-activity-report.ts");
    expect(web).toContain('platform: "web"');
    expect(web).toContain("installationKey");
    expect(web).toContain('releaseChannel: "web"');
    expect(native).toContain('platform: "ios"');
    expect(native).toContain('request(path: "/api/product-events"');
    expect(native).toContain("CFBundleVersion");
    expect(native).toContain("hw.machine");
    expect(native).toContain("releaseChannel");
    expect(native).toContain("appStoreReceiptURL");
    expect(api).not.toContain("searchQuery");
    expect(api).not.toContain("recordId");
    expect(api).not.toContain("pathname");
    expect(api).toContain("userAppInstallation.upsert");
    expect(api).toContain("installationHash");
    expect(access).toContain("pseudonymousInstallationKey");
    expect(report).toContain("IOS_LATEST_APP_BUILD");
    expect(report).toContain("staleIosInstallations");
  });
});
