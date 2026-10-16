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
    expect(view).toContain("License claimed. Use Copy Code when you’re ready.");
  });

  it("only calls release from the active-license path, not from arbitrary pool rows", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("func releaseActiveClaim()");
    expect(view).toContain("guard let activeClaim, pendingActionId == nil else { return }");
    expect(view).toContain("APIClient.shared.releaseLicense(id: activeClaim.id)");
    expect(view).not.toContain("releaseLicense(id: code.id)");
  });

  it("leads a holder with a hero license card and a person without one with a single claim prompt", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const hero = view.slice(view.indexOf("private struct LicenseHeroCard"), view.indexOf("private struct LicenseClaimPrompt"));

    expect(view).toContain("LicenseHeroCard(");
    expect(view).toContain("LicenseClaimPrompt(openSlotCount: openSlotCount)");
    expect(view).toContain('"\\(openSlotCount) \\(openSlotCount == 1 ? "slot" : "slots") ready to claim"');
    // The code is the largest thing on the card and the whole block copies it.
    expect(hero).toContain('.font(.system(.title2, design: .monospaced).weight(.semibold))');
    expect(hero).toContain("Tap to copy");
    expect(hero).toContain('Text("Copy Code")');
    expect(hero).toMatch(/Button\(action: onCopy\)[\s\S]*?\.buttonStyle\(\.borderedProminent\)/);
    // History and Return are quiet, and every control keeps a 44pt target.
    expect(hero).toContain("quietAction(");
    expect(hero).toContain('isStaffOrAdmin ? "Release" : "Return"');
    expect(hero).toContain("minHeight: 44");
    expect(view).toContain("APIClient.shared.myLicenseHistory()");
    expect(view).not.toContain('Button("Return License", role: .destructive)');
  });

  it("renders every code as a card with two slot seats and one status chip", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("private struct LicensePoolCard");
    expect(view).toContain("private struct LicenseSlotSeat");
    expect(view).toContain("ForEach(0..<2");
    expect(view).toContain('"Open slot"');
    expect(view).toContain('case .available: return ("Open", .green)');
    expect(view).toContain('case .partial: return ("1 slot left", .green)');
    expect(view).toContain('case .claimed: return ("Full", .gray)');
    expect(view).toContain('if isOwn { return ("Yours", .blue) }');
  });

  it("keeps holder names visible to students and never dims or hides a full card", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");
    const seat = view.slice(view.indexOf("private struct LicenseSlotSeat"), view.indexOf("private struct LicenseExpiryChip"));
    const card = view.slice(view.indexOf("private struct LicensePoolCard"), view.indexOf("private struct LicenseSlotSeat"));

    expect(seat).toContain("claim.user?.name");
    expect(seat).toContain("UserAvatarView(name: holderName");
    // Only staff see an occupant label for a claim without a linked user.
    expect(seat).toContain("if isStaffOrAdmin, let label = claim.occupantLabel");
    expect(card).toContain("opacity(isRetired ? 0.7 : 1)");
    expect(card).not.toContain(".claimed ? 0.");
    expect(card).not.toContain("slotCount");
  });

  it("masks codes for students: label or License N, own code revealed", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("(isStaffOrAdmin || isOwn) && !code.code.isEmpty");
    expect(view).toContain('trimmedLabel ?? "License \\(position)"');
    expect(view).not.toContain("Code hidden until claimed");
    expect(view).toContain("if revealsCode {");
  });

  it("shows filters and expiry chips to staff and admin only", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("if isStaffOrAdmin {\n                    ScrollView(.horizontal");
    expect(view).toContain("isStaffOrAdmin ? filter.matches(code) : true");
    expect(view).toContain('case .available: "Has open slot"');
    expect(view).toContain('case .expiring: "Expiring"');
    expect(view).toContain("let showsExpiry = isStaffOrAdmin && !isRetired && code.expiresAt != nil");
    expect(view).toContain("LicenseExpiryChip(raw: code.expiresAt)");
  });

  it("only offers Claim on an open card when the person holds no license", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("private var canClaim: Bool { claimable && activeClaim == nil }");
    expect(view).toContain('Text(isOwn ? "Your license" : "Return yours to switch")');
    expect(view).toMatch(/Button\("Claim"\)[\s\S]*?\.buttonStyle\(\.borderedProminent\)[\s\S]*?\.tint\(Color\.statusText\(\.green\)\)/);
  });

  it("lists retired codes for staff without offering a claim", () => {
    const view = source("ios/Wisconsin/Views/LicensesView.swift");

    expect(view).toContain("private var isRetired: Bool { code.status == .retired }");
    expect(view).toContain("(code.status == .available || code.status == .partial) && activeClaims.count < 2");
    expect(view).toContain("private var retiredCount: Int");
    expect(view).toContain("are listed for reference and are not counted as open.");
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
