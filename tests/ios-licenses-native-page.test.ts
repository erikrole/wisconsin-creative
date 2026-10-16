import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

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

    expect(browse).toContain("LicensesView(wrapsInNavigationStack: false)");
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
    // A successful claim copies the code itself instead of asking for a second tap.
    expect(view).toContain("[result.code]");
    expect(view).toContain("License claimed. Code copied for 2 minutes.");
  });

  it("only calls release from the active-license path, not from arbitrary pool rows", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("func releaseActiveClaim()");
    expect(view).toContain("guard let activeClaim, pendingActionId == nil else { return }");
    expect(view).toContain("APIClient.shared.releaseLicense(id: activeClaim.id)");
    expect(view).not.toContain("releaseLicense(id: code.id)");
  });

  it("gives a student without a license one Claim a code button over a slot meter", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const hero = view.slice(view.indexOf("private struct ClaimLicenseHero"), view.indexOf("private struct LicenseHoldersSection"));

    expect(view).toContain("ClaimLicenseHero(");
    expect(view).toContain("onClaim: { claimCandidate = bestCode }");
    expect(hero).toContain('"Get a license code"');
    expect(hero).toContain('"\\(openSlots) of \\(totalSlots) slots open"');
    expect(hero).toContain('Label("Claim a code"');
    expect(hero).toContain("LicenseSlotMeter(");
    expect(hero).toContain("minHeight: 44");
    // No per-code cards, filters, or expiry for students.
    expect(view).not.toContain("LicensePoolCard");
    expect(view).not.toContain("LicenseClaimPrompt");
  });

  it("auto-picks the code like the web: half-used first, then latest expiry, no expiry latest", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const pick = view.slice(view.indexOf("static func bestClaimableCode"), view.indexOf("struct LicensesView"));

    expect(pick).toContain("code.status == .partial ? 0 : 1");
    expect(pick).toContain("?? .distantFuture");
    expect(pick).toContain("($0.status == .available || $0.status == .partial)");
    expect(pick).toContain("activeClaims(of: $0).count < 2");
    expect(pick).toContain("expiry($0) > expiry($1)");
  });

  it("leads a holder with a hero license card and quiet History and Return", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const hero = view.slice(view.indexOf("private struct LicenseHeroCard"), view.indexOf("private struct LicenseExpiryChip"));

    expect(view).toContain("LicenseHeroCard(");
    expect(hero).toContain('.font(.system(.title2, design: .monospaced).weight(.semibold))');
    expect(hero).toContain("Tap to copy");
    expect(hero).toContain('Text("Copy Code")');
    expect(hero).toMatch(/Button\(action: onCopy\)[\s\S]*?\.buttonStyle\(\.borderedProminent\)/);
    expect(hero).toContain("quietAction(");
    expect(hero).toContain('isStaffOrAdmin ? "Release" : "Return"');
    expect(hero).toContain("minHeight: 44");
    expect(view).toContain("APIClient.shared.myLicenseHistory()");
    expect(view).not.toContain('Button("Return License", role: .destructive)');
  });

  it("lists who is using a license for students by name only, never a code string", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const holders = view.slice(view.indexOf("private struct LicenseHoldersSection"), view.indexOf("private struct LicenseStaffSummary"));

    expect(view).toContain("LicenseHoldersSection(codes: vm.codes");
    expect(holders).toContain('Text("In use now · \\(holders.count)")');
    expect(holders).toContain("UserAvatarView(name:");
    expect(holders).toContain("$0.user?.name.isEmpty == false");
    expect(holders).toContain("$0.status != .retired");
    expect(holders).not.toContain("code.code");
    expect(holders).not.toContain("expiresAt");
  });

  it("shows staff a status summary, filter chips, and a dense row per code with two seats", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const row = view.slice(view.indexOf("private struct LicenseCodeRow"), view.indexOf("private struct LicenseCodeSheet"));

    expect(view).toContain("LicenseStaffSummary(");
    expect(view).toContain('case .available: "Has open slot"');
    expect(view).toContain('case .full: "Full"');
    expect(view).toContain('case .expiring: "Expiring"');
    expect(view).toContain("filter.matches($0.element)");
    expect(view).toContain('Label("Claim for me"');
    expect(view).toContain("canClaimForMe: vm.activeClaim == nil && bestCode != nil");
    expect(row).toContain("ForEach(0..<2");
    expect(row).toContain("dash: [3, 2]");
    expect(row).toContain("LicenseExpiryChip(raw: code.expiresAt)");
    expect(row).toContain('Image(systemName: "chevron.right")');
    expect(row).toContain("minHeight: 44");
    // Tapping a row opens the detail sheet, which hands management to the web.
    expect(view).toContain("inspectedCode = item.element");
    expect(view).toContain("LicenseCodeSheet(");
  });

  it("lists retired codes for staff without counting them as open", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("vm.codes.filter { $0.status != .retired }");
    expect(view).toContain("private var retiredCount: Int");
    expect(view).toContain("are listed for reference and are not counted as open.");
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
