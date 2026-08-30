import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

function appTabViewShell() {
  return source("ios/Wisconsin/Views/AppTabView.swift").split("// MARK: - Profile")[0] ?? "";
}

describe("iOS native Licenses page", () => {
  it("uses the existing license API routes without inventing a native-only contract", () => {
    const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const route = source("src/app/api/licenses/route.ts");

    expect(apiClient).toContain("func licenses() async throws -> [LicenseCode]");
    expect(apiClient).toContain('request(path: "/api/licenses")');
    expect(apiClient).toContain("func myLicense() async throws -> ActiveLicenseClaim?");
    expect(apiClient).toContain('request(path: "/api/licenses/my")');
    expect(apiClient).toContain("func claimLicense(id: String) async throws -> LicenseClaimResult");
    expect(apiClient).toContain('request(path: "/api/licenses/\\(id)/claim", method: "POST")');
    expect(apiClient).toContain("func releaseLicense(id: String) async throws -> LicenseCode");
    expect(apiClient).toContain('request(path: "/api/licenses/\\(id)/release", method: "POST")');
    expect(apiClient).toContain("req.httpBody = Data()");

    expect(models).toContain("enum LicenseCodeStatus");
    expect(models).toContain("struct LicenseCode: Codable, Identifiable, Equatable");
    expect(models).toContain("let expiresAt: String?");
    expect(models).toContain('code = try container.decodeIfPresent(String.self, forKey: .code) ?? ""');
    expect(models).toContain("claims = try container.decodeIfPresent([LicenseCodeClaim].self, forKey: .claims) ?? []");

    expect(route).toContain('const isAdmin = user.role === "ADMIN" || user.role === "STAFF"');
    expect(route).toContain("const isHolder = code.claims.some((claim) => claim.userId === user.id)");
    expect(route).toContain('code: isHolder ? code.code : ""');
    expect(route).toContain("claim.userId === user.id");
    // Students can see the safe holder name/avatar, but not the other account id.
    expect(route).toContain("name: claim.user.name");
    expect(route).toContain("avatarUrl: claim.user.avatarUrl");
  });

  it("wires Licenses to native Settings and regular-width sidebar destinations", () => {
    const appTab = appTabViewShell();
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(appTab).toContain('Tab("Browse", systemImage: "square.grid.2x2", value: 2)');
    expect(appTab).toContain("BrowseView()");
    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
    expect(appTab).toContain('Tab("Licenses", systemImage: "key", value: 7)');
    expect(appTab).toContain("LicensesView()");
    expect(appTab).not.toContain("https://wisconsincreative.com/licenses");
    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
  });

  it("uses native list, refresh, empty, and confirmation patterns for self-service actions", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("NavigationStack { configuredContent }");
    expect(view).toContain("List {");
    expect(view).toContain(".listStyle(.insetGrouped)");
    expect(view).toContain(".refreshable { await vm.load(forceRefresh: true) }");
    expect(view).toContain("ContentUnavailableView");
    expect(view).toContain('"Claim Photo Mechanic license?"');
    expect(view).toContain("isPresented: claimConfirmBinding");
    expect(view).toContain('"Return Photo Mechanic license?"');
    expect(view).not.toContain("UIPasteboard.general.string = result.code");
    expect(view).toContain("UIPasteboard.general.setObjects(");
    expect(view).toContain("expirationDate: Date().addingTimeInterval(120)");
    expect(view).toContain("License claimed. Use Copy Code when you’re ready.");
  });

  it("only calls release from the active-license path, not from arbitrary pool rows", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("func releaseActiveClaim()");
    expect(view).toContain("guard let activeClaim, pendingActionId == nil else { return }");
    expect(view).toContain("APIClient.shared.releaseLicense(id: activeClaim.id)");
    expect(view).not.toContain("releaseLicense(id: code.id)");
  });

  it("keeps the screenshot state visually coherent when the user already has a license", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const activeButtons = view.slice(
      view.indexOf("private func activeLicenseButtons"),
      view.indexOf("private var licensePoolSection"),
    );

    expect(view).toContain("activeClaimId == nil && (code.status == .available || code.status == .partial)");
    expect(view).not.toContain('"Already claimed"');
    expect(activeButtons).toContain('Button("Copy Code")');
    expect(activeButtons).toContain('Button("Return License")');
    expect(activeButtons).not.toContain('Button("Return License", role: .destructive)');
    expect(activeButtons).not.toContain('Label("Copy Code"');
    expect(activeButtons).not.toContain('Label("Return License"');
    expect(activeButtons).toMatch(/Button\("Copy Code"\)[\s\S]*?\.buttonStyle\(\.bordered\)[\s\S]*?\.buttonBorderShape\(\.capsule\)[\s\S]*?\.controlSize\(\.small\)[\s\S]*?\.tint\(Color\.statusText\(\.blue\)\)/);
    expect(activeButtons).toMatch(/Button\("Return License"\)[\s\S]*?\.buttonStyle\(\.bordered\)[\s\S]*?\.buttonBorderShape\(\.capsule\)[\s\S]*?\.controlSize\(\.small\)/);
  });

  it("summarizes shared capacity and uses operational status colors", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("LicensePoolOverview(");
    expect(view).toContain('openSlotCount == 0 ? "All licenses are in use" : "Licenses are available"');
    expect(view).toContain('case .available: "2 open"');
    expect(view).toContain('case .partial: "1 open"');
    expect(view).toContain('case .claimed: "Full"');
    expect(view).toMatch(/case \.partial: StatusTone\.blue[\s\S]*?case \.claimed: StatusTone\.blue/);
    expect(view).not.toContain("case .claimed: StatusTone.red");
  });

  it("hides unclaimed pool codes from students even if a future payload includes them", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("canRevealUnclaimedCodes: isStaffOrAdmin");
    expect(view).toContain("private var canRevealCode: Bool");
    expect(view).toContain("canRevealUnclaimedCodes || isCurrentHolder");
    expect(view).toContain('canRevealCode && !code.code.isEmpty ? code.code : "Code hidden until claimed"');
  });

  it("renders Claim as a positive action instead of the destructive app accent", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const poolRow = view.slice(view.indexOf("private struct LicensePoolRow"));

    expect(view).toContain('Button("Claim License")');
    expect(view).toMatch(/Button\("Claim License"\)[\s\S]*?\.tint\(Color\.statusText\(\.green\)\)/);
    expect(poolRow).toMatch(/Button\("Claim"\)[\s\S]*?\.buttonStyle\(\.borderedProminent\)[\s\S]*?\.buttonBorderShape\(\.capsule\)[\s\S]*?\.controlSize\(\.small\)[\s\S]*?\.tint\(Color\.statusText\(\.green\)\)/);
    expect(poolRow).not.toContain('Label("Claim", systemImage: "plus.circle")');
  });

  it("does not repeat the holder's own code and expiry in the pool row", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const poolRow = view.slice(view.indexOf("private struct LicensePoolRow"));

    // The My License card above already shows the code, larger and selectable.
    expect(poolRow).toContain("private var showsCodeLine: Bool");
    expect(poolRow).toContain("!isRetired && !isCurrentHolder");
    expect(poolRow).toContain("if showsCodeLine {");

    // One verdict per row: a row you hold says "Yours", not "Yours" plus a
    // competing open-slot count.
    expect(poolRow).toContain('StatusPill(label: isCurrentHolder ? "Yours" : availabilityLabel,');
    expect(poolRow).toContain("tone: isCurrentHolder ? .blue : statusTone)");
    expect(poolRow).toContain('if isCurrentHolder { return "key.fill" }');
  });

  it("shows a pool row's expiry only once it is worth acting on", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const poolRow = view.slice(view.indexOf("private struct LicensePoolRow"));

    expect(poolRow).toContain("private var showsExpiry: Bool");
    expect(poolRow).toContain("guard !isRetired, !isCurrentHolder else { return false }");
    expect(poolRow).toContain("return daysLeft <= 30");
    expect(poolRow).toContain("if showsExpiry {");
    // The active-license card still states expiry unconditionally.
    expect(view).toContain('Label(expirySummary(activeClaim.expiresAt), systemImage: "calendar")');
  });

  it("does not present a retired code as claimable", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const poolRow = view.slice(view.indexOf("private struct LicensePoolRow"));

    expect(poolRow).toContain("private var isRetired: Bool");
    expect(poolRow).toContain("code.status == .retired");
    // Occupancy and the Claim button live behind the not-retired branch, so a
    // retired row never says "No one is using this code" or offers a claim.
    expect(poolRow).toContain("if !isRetired {");
    expect(poolRow).toContain("private var retiredSummary: String");
    expect(poolRow).toContain('return "\\(expirySummary(code.expiresAt)) · No longer claimable"');
    expect(poolRow).toContain("opacity(isRetired ? 0.7 : 1)");
  });

  it("reconciles the capacity summary with the rows actually listed", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    // Staff and admin receive retired codes the summary deliberately excludes.
    expect(view).toContain("private var retiredCount: Int");
    expect(view).toContain("vm.codes.filter { $0.status == .retired }.count");
    expect(view).toContain("The summary above counts live codes only.");
  });

  it("drops the per-row status wash so the claimed card stays the only tinted block", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).not.toContain("listRowBackground(rowBackground)");
    expect(view).not.toContain("private var rowBackground: Color");
    // The active-license card keeps its tint; it is the one thing that is yours.
    expect(view).toContain(".listRowBackground(Color.statusBackground(.blue))");
  });

  it("gives consequential license actions haptics and announces transient notices", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("UIAccessibility.post(notification: .announcement, argument: message)");
    const claim = view.slice(view.indexOf("func claim("), view.indexOf("func releaseActiveClaim()"));
    expect(claim).toContain("Haptics.success()");
    expect(claim).toContain("Haptics.error()");
    const release = view.slice(view.indexOf("func releaseActiveClaim()"), view.indexOf("func copyActiveCode()"));
    expect(release).toContain("Haptics.success()");
    expect(release).toContain("Haptics.error()");
    expect(view.slice(view.indexOf("func copyActiveCode()"))).toContain("Haptics.success()");
  });

  it("keeps admin management on web while exposing self-service to every role", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const browse = source("ios/Wisconsin/Views/BrowseView.swift");

    expect(view).toContain('private static let webManagementURL = AppEnvironment.url(path: "/licenses")');
    expect(view).toContain("if isStaffOrAdmin {");
    expect(view).toContain('title: "Manage on web"');
    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
    expect(browse).toContain('"Claim, copy, or return a Photo Mechanic license."');
  });
});
