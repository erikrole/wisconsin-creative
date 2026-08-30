import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("GearOps macOS menu bar contracts", () => {
  it("stays a separate menu-only macOS target", () => {
    const project = source("macos/project.yml");
    const app = source("macos/GearOps/GearOpsApp.swift");
    const plist = source("macos/GearOps/Supporting/Info.plist");

    expect(project).toContain('platform: macOS');
    expect(project).toContain('deploymentTarget: "15.0"');
    expect(project).not.toContain("../ios/Wisconsin/Views");
    expect(project).not.toContain("../ios/Wisconsin/Core");
    expect(app).toContain("MenuBarExtra");
    expect(app).toContain(".menuBarExtraStyle(.window)");
    expect(app).toContain("Image(systemName: model.menuBarSymbol)");
    expect(project).toContain("PRODUCT_NAME: Wisconsin Creative");
    expect(project).toContain("../ios/Wisconsin/Assets.xcassets");
    expect(project).toContain("GearOps/Supporting/AppIcon.icns");
    expect(project).toContain("ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon");
    expect(plist).toMatch(/<key>CFBundleIconFile<\/key>\s*<string>AppIcon<\/string>/);
    expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
  });

  it("resolves the shared app icon from the bundle instead of the generic placeholder", () => {
    const icon = source("macos/GearOps/WisconsinCreativeIcon.swift");
    const view = source("macos/GearOps/MenuBarContentView.swift");
    const login = source("macos/GearOps/LoginView.swift");

    // `applicationIconImage` and `icon(forFile:)` substitute Apple's generic
    // application icon when resolution fails, so an LSUIElement bundle silently
    // renders a foreign placeholder. Both bundle lookups below return nil.
    expect(icon).not.toContain("NSApplication.shared.applicationIconImage");
    expect(icon).not.toContain("NSWorkspace.shared.icon(forFile:");
    expect(icon).toContain('bundle.image(forResource: "AppIcon")');
    expect(icon).toContain('bundle.url(forResource: "AppIcon", withExtension: "icns")');

    // Vector fallback keeps Wisconsin Creative branding even on a bundle whose
    // icon resources failed to compile.
    expect(icon).toContain("struct BlockWMark: Shape");
    expect(icon).toContain("BlockW 2.svg");
    expect(icon).toContain("viewBox = CGSize(width: 371.04, height: 305.88)");

    expect(view).toContain("WisconsinCreativeIcon(size: 30)");
    expect(source("macos/GearOps/BrandScene.swift")).toContain("WisconsinCreativeIcon(size: 56)");
    expect(login).toContain("BrandSplashLockup(subtitle:");
  });

  it("treats an idle kiosk heartbeat as normal rather than a fault", () => {
    const health = source("macos/GearOps/Health.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");
    const view = source("macos/GearOps/MenuBarContentView.swift");

    // A kiosk between five minutes and 24 hours since its last heartbeat is
    // simply unused. Only the 24-hour boundary is a fault.
    expect(health).toContain("var isFault: Bool { self == .offline }");
    expect(health).toContain('case .stale: "Idle"');
    expect(health).toContain('parts.append("\\(stale) idle")');
    expect(health).not.toContain("Heartbeat stale");

    expect(model).toContain("$0.connectionState().isFault");
    expect(model).not.toContain("$0.connectionState() == .stale");
    expect(view).toContain("case .stale: .secondary");
    expect(view).not.toContain("case .stale: .orange");

    // Idle must not outrank a kiosk that is actually in use.
    expect(model).toMatch(/case \.offline: 0\s*\n\s*case \.online: 1\s*\n\s*case \.stale: 2/);
  });

  it("lets the user choose which booking changes alert", () => {
    const settings = source("macos/GearOps/NotificationSettings.swift");
    const notifications = source("macos/GearOps/BookingNotifications.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");
    const view = source("macos/GearOps/SettingsView.swift");
    const app = source("macos/GearOps/GearOpsApp.swift");
    const menu = source("macos/GearOps/MenuBarContentView.swift");

    expect(settings).toContain("enum BookingChangeCategory");
    expect(settings).toContain("func allows(_ category: BookingChangeCategory) -> Bool");

    // Classification travels with the change so filtering never re-parses copy.
    expect(notifications).toContain("let category: BookingChangeCategory");
    expect(notifications).toContain("case .pendingPickup: .pickupReady");
    expect(notifications).toContain("category = .timeChange");

    // Filtering happens at delivery, after the baseline is installed, so a
    // muted category cannot replay once it is switched back on.
    expect(model).toContain("for change in changes where notificationSettings.allows(change.category)");
    expect(model).toContain("knownBookingActivity = Dictionary(");
    expect(model.indexOf("knownBookingActivity = Dictionary("))
      .toBeLessThan(model.indexOf("for change in changes where"));

    expect(app).toContain("GearOpsSettingsView(model: model)");

    // An accessory (LSUIElement) app never activates itself, so a `Settings`
    // scene opens its window behind everything and reads as a dead menu item.
    // The SDK has no `SettingsLink(preAction:)` to fix that, so the window is
    // explicit and the menu activates the app before ordering it in.
    expect(app).toContain('Window("Wisconsin Creative Settings", id: GearOpsWindow.settings)');
    expect(app).not.toContain("Settings {");
    expect(menu).not.toContain("SettingsLink");
    expect(menu).toContain('Button("Settings…") { openSettings() }');
    expect(menu).toContain("NSApplication.shared.activate()");
    expect(menu.indexOf("NSApplication.shared.activate()"))
      .toBeLessThan(menu.indexOf("openWindow(id: GearOpsWindow.settings)"));

    // Visibility is the activation boundary. Updating settings while the user
    // is in another app must not repeatedly steal focus.
    expect(view).toContain("private struct SettingsWindowActivator: NSViewRepresentable");
    expect(view).toContain("private final class SettingsWindowActivationProbe: NSView");
    expect(view).toContain("window.makeKeyAndOrderFront(nil)");
    expect(view).not.toContain("func updateNSView(_ nsView: SettingsWindowActivator");
    expect(view).toContain("formStyle(.grouped)");
    expect(view).toContain("model.openSystemNotificationSettings()");
  });

  it("exposes startup, menu bar, and alert-sound preferences", () => {
    const prefs = source("macos/GearOps/AppPreferences.swift");
    const view = source("macos/GearOps/SettingsView.swift");
    const app = source("macos/GearOps/GearOpsApp.swift");
    const notifications = source("macos/GearOps/BookingNotifications.swift");
    const settings = source("macos/GearOps/NotificationSettings.swift");

    // Login items use the supported ServiceManagement API, and macOS holding a
    // registration for user approval is a normal state rather than a failure.
    expect(prefs).toContain("import ServiceManagement");
    expect(prefs).toContain("try service.register()");
    expect(prefs).toContain("try service.unregister()");
    expect(prefs).toContain("case .requiresApproval: .requiresApproval");
    expect(prefs).toContain("var isOn: Bool { self == .enabled || self == .requiresApproval }");
    expect(prefs).toContain("var canChange: Bool { self != .unavailable }");
    expect(prefs).toContain("SMAppService.openSystemSettingsLoginItems()");

    expect(view).toContain('Toggle("Open at login"');
    expect(view).toContain('Toggle("Show open booking count"');
    expect(app).toContain("model.appPreferences.showsMenuBarCount");

    // Silence stays the default; sound is an explicit opt-in carried to delivery.
    expect(settings).toContain("var playsSound: Bool");
    expect(settings).toContain("playsSound = false");
    expect(notifications).toContain("content.sound = playsSound ? .default : nil");
    expect(view).toContain('Toggle("Play a sound"');
    expect(view).toContain("@Environment(\\.scenePhase)");
  });

  it("groups system health into one panel with actionable rows", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");

    // Health and kiosk rows point at real pages, so they behave as controls.
    expect(view).toContain("action: model.kioskAccess == .available ? { model.openKioskDevices() } : nil");
    expect(view).toContain("KioskRow(device: device, now: now) { model.openKioskDevices() }");
    expect(view).toContain(".accessibilityAddTraits(.isButton)");
    expect(view).toContain(".background(Color.primary.opacity(0.045), in: .rect(cornerRadius: 10))");
    expect(view).toContain("private var rowSeparator: some View");
  });

  it("gives sign-in the shared Wisconsin Creative login design", () => {
    const scene = source("macos/GearOps/BrandScene.swift");
    const login = source("macos/GearOps/LoginView.swift");

    // Values are lifted from the web `.login-bg` and `.login-card` rules.
    expect(scene).toContain("struct BrandSplashScene");
    expect(scene).toContain("struct BrandSplashLockup");
    expect(scene).toContain("struct BrandLoginCard");
    expect(scene).toContain("static let crimson = Color(red: 0.769, green: 0.071, blue: 0.188)");
    expect(scene).toContain("environment(\\.colorScheme, .light)");

    // Native password managers need the semantic username and password fields
    // mounted together so one Universal Autofill action can populate the pair.
    expect(login).toContain("private var credentialFields");
    expect(login).toContain("TextField(\"you@wisc.edu\", text: $email)");
    expect(login).toContain("SecureField(\"Enter your password\", text: $password)");
    expect(login).toContain(".textContentType(.username)");
    expect(login).toContain(".textContentType(.password)");
    expect(login.indexOf("TextField(\"you@wisc.edu\", text: $email)"))
      .toBeLessThan(login.indexOf("SecureField(\"Enter your password\", text: $password)"));
    expect(login).toContain('Text(primaryTitle)');
    expect(login).toContain('showPassword ? "eye.slash" : "eye"');

    // Enrollment stays the only Neon-backed call.
    expect(login).not.toContain("discoverAuth");
    expect(login).not.toContain("/api/");
  });

  it("keeps one popover width and unambiguous footer controls", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");
    const login = source("macos/GearOps/LoginView.swift");

    expect(view).toContain("static let popoverWidth: CGFloat = 380");
    expect(view).toContain(".frame(width: GearOpsLayout.popoverWidth)");
    expect(login).toContain(".frame(width: GearOpsLayout.popoverWidth)");
    expect(view).not.toContain(".frame(width: 360)");

    // A borderless Menu renders its own disclosure chevron next to the
    // ellipsis glyph, which reads as two separate controls.
    expect(view).toContain(".menuIndicator(.hidden)");
    expect(view).toContain('.keyboardShortcut("r", modifiers: .command)');
    expect(view).toContain('.keyboardShortcut("q", modifiers: .command)');
    expect(view).toContain('Button("Sign Out", role: .destructive)');
  });

  it("surfaces overdue custody and hover affordances in the popover", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");

    expect(model).toContain("func overdueBookingCount(at now: Date = .now) -> Int");
    expect(model).toContain("openBookings.filter { $0.isOverdue(at: now) }.count");
    expect(view).toContain("overdueBadge(at: now)");
    expect(view).toContain("model.overdueBookingCount(at: now)");

    // Every interactive row carries hover feedback: two booking row types
    // (glass and fallback branches), the health rows, and the kiosk rows.
    expect(view.match(/\.onHover \{ isHovering = \$0 \}/g)).toHaveLength(6);
    expect(view).toContain(".onHover { isHoveringRefresh = $0 }");
    expect(view).toContain("snapshot.freshnessLabel(at: now)");
  });

  it("uses only the external companion projection after explicit enrollment", () => {
    const client = source("macos/GearOps/GearOpsClient.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");
    const projectionReadStart = client.lastIndexOf("func companionProjection");
    const projectionRead = client.slice(
      projectionReadStart,
      client.indexOf("func registerCompanionDevice", projectionReadStart),
    );

    expect(client).toContain('path: "/api/companion/projection"');
    expect(projectionRead).toContain('makeRequest(path: "/api/companion/projection")');
    expect(projectionRead).not.toContain('method: "POST"');
    expect(client).not.toContain("refreshFromSource");
    expect(client).toContain('makeRequest(path: "/api/companion/devices", method: "POST")');
    expect(client).toContain("companion: true");
    expect(client).not.toContain('/api/dashboard/stats');
    expect(client).not.toContain('/api/kiosk-devices');
    expect(client).not.toContain('/api/me');
    expect(client).not.toContain('/api/checkouts');
    expect(client).not.toContain('/api/bookings/changes');
    expect(client).not.toContain('/api/db-diagnostics');
    expect(model).toContain("try await credentialStore.loadToken()");
    expect(model).toContain("client.companionProjection(");
    expect(model).toContain("Saved session is temporarily unavailable");
    expect(model).toContain("repeated missing reads keep the last projection visible");
    expect(model).not.toContain("confirmMissingCredential");
    expect(model).toContain("shouldRetryCredentialRestore");
    expect(source("macos/GearOps/MenuBarContentView.swift")).toContain(
      "await model.restoreSession()"
    );
    expect(model).not.toContain("fromSource");
    expect(model).not.toContain("Task.sleep(for: .seconds(60))");
    expect(model).toContain("no timer or polling loop");
    expect(model).toContain("retryPendingRevocations()");
    expect(model).toContain("await self?.restoreSession()");
    expect(model).not.toContain("startPolling");
    expect(model).not.toContain('method: "PATCH"');
    expect(source("macos/GearOps/MenuBarContentView.swift")).toContain("await model.refresh()");
  });

  it("recovers the enrolled identity from Keychain when a crash loses preferences", () => {
    const model = source("macos/GearOps/GearOpsModel.swift");
    const credentials = source("macos/GearOps/CompanionCredentialStore.swift");

    expect(credentials).toContain('private let userAccount = "projection-user"');
    expect(credentials).toContain("func loadUser() throws -> GearOpsUser?");
    expect(credentials).toContain("func saveUser(_ user: GearOpsUser) throws");
    expect(credentials).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(model).toContain("let storedUser = try await credentialStore.loadUser()");
    expect(model).toContain("if user == nil, let storedUser");
    expect(model).toContain("try await credentialStore.saveUser(response.user)");
    expect(model).not.toMatch(/guard user != nil else \{ return \}\s*let generation = sessionGeneration/);
  });

  it("renews the companion lease without waking Neon or losing the old credential", () => {
    const client = source("macos/GearOps/GearOpsClient.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");
    const route = source("src/app/api/companion/session/route.ts");
    const store = source("src/lib/companion-store.ts");

    expect(client).toContain("func renewCompanion(token: String) async throws -> String");
    expect(client).toContain('makeRequest(path: "/api/companion/session", method: "POST")');
    expect(model).toContain("requestToken = try await renewCredential(");
    expect(model).toContain("try await credentialStore.saveToken(renewedToken)");
    expect(model).toContain("await discardIssuedCredential(token)");
    expect(model).toContain("Renewal is best-effort while the current credential is");
    expect(route).toContain("renewCompanionSession(req)");
    expect(route).toContain("companion:session:ip:");
    expect(route).not.toContain("@/lib/db");
    expect(store).toContain("export async function renewCompanionSession(req: Request)");
    expect(store).toContain("return issueCompanionSession(");
  });

  it("keeps every automatic companion read outside Neon", () => {
    const projectionRoute = source("src/app/api/companion/projection/route.ts");
    const deviceRoute = source("src/app/api/companion/devices/route.ts");
    const store = source("src/lib/companion-store.ts");
    const publisher = source("src/lib/services/companion-projection.ts");
    const contract = source("src/lib/companion-projection-contract.ts");
    const api = source("src/lib/api.ts");
    const app = source("macos/GearOps/GearOpsApp.swift");
    const pushBridge = source("macos/GearOps/CompanionPushBridge.swift");
    const entitlements = source("macos/GearOps/Supporting/GearOps.entitlements");

    expect(projectionRoute).toContain("withHandler");
    expect(projectionRoute).not.toContain("withAuth");
    expect(projectionRoute).not.toContain("@/lib/db");
    expect(projectionRoute).not.toContain("refreshCompanionProjection");
    expect(projectionRoute).not.toContain("export const POST");
    expect(projectionRoute).toContain('@/lib/api-handler');
    expect(projectionRoute).toContain('@/lib/companion-projection-contract');
    expect(contract).not.toContain("@/lib/db");
    expect(deviceRoute).toContain("requireCompanion(req)");
    expect(deviceRoute).not.toContain("@/lib/db");
    expect(store).toContain("UPSTASH_REDIS_REST_URL");
    expect(store).toContain('createHmac("sha256"');
    expect(store).toContain('decoded["revision"]');
    expect(store).toContain(">= tonumber(ARGV[2])");
    expect(publisher).toContain("writeCompanionProjection(projection)");
    expect(publisher).toContain("if (!installed)");
    expect(publisher).toContain("sendCompanionInvalidation(");
    expect(api).toContain("deferCompanionProjectionRefresh(req, response)");
    expect(app).toContain("@NSApplicationDelegateAdaptor(GearOpsAppDelegate.self)");
    expect(pushBridge).toContain("case sessionBecameActive");
    expect(pushBridge).toContain("NSWorkspace.sessionDidBecomeActiveNotification");
    expect(pushBridge).toContain("applicationDidBecomeActive");
    expect(entitlements).toContain("com.apple.developer.aps-environment");
  });

  it("publishes kiosk heartbeats only after the existing database touch commits", () => {
    const auth = source("src/lib/auth.ts");
    const deferredActivity = auth.slice(
      auth.indexOf("after(async () =>"),
      auth.indexOf("return kioskContext;", auth.indexOf("after(async () =>"))
    );

    expect(deferredActivity).toContain("await db.kioskDevice.update");
    expect(deferredActivity).toContain("await refreshCompanionProjection({ notify: true })");
    expect(deferredActivity.indexOf("await db.kioskDevice.update"))
      .toBeLessThan(deferredActivity.indexOf("await refreshCompanionProjection"));
  });

  it("renders open bookings then conditional pickups before health without summary cards", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");

    expect(view.indexOf("openBookingsList")).toBeLessThan(view.indexOf("systemHealth"));
    expect(view.indexOf("pendingPickupsList")).toBeLessThan(view.indexOf("systemHealth"));
    expect(view).toContain('sectionTitle("Open bookings")');
    expect(view).toContain('sectionTitle("Waiting for pickup")');
    expect(view).toContain("OpenBookingRow(booking: booking, now: now)");
    expect(view).toContain("PickupBookingRow(booking: booking, now: now)");
    expect(view).not.toContain("MetricCard");
  });

  it("keeps the popover compact without multiplying timeline or layout work", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");

    expect(view).toContain("onGeometryChange(for: CGFloat.self");
    expect(view).toContain("maximumContentHeight: CGFloat = 500");
    expect(view).not.toContain(".frame(height: 500)");
    expect(view.match(/TimelineView\(/g)).toHaveLength(1);
    expect(view).toContain("LazyVStack(spacing: 8)");
  });

  it("uses interactive Liquid Glass only for booking actions with a fallback", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");

    expect(view).toContain("#available(macOS 26.0, *)");
    expect(view).toContain("GlassEffectContainer(spacing: 8)");
    expect(view).toContain(".glassEffect(");
    expect(view).toContain(".interactive()");
    expect(view).toContain(".regular.tint(Color.red.opacity(0.12)).interactive()");
    expect(view).not.toContain("Color.blue.opacity(0.08)");
    expect(view).toContain("Color.primary.opacity(0.045)");
  });

  it("shows requester profile images with an initials fallback", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");
    const avatar = source("macos/GearOps/UserAvatarView.swift");
    const models = source("macos/GearOps/Models.swift");

    expect(view.match(/UserAvatarView\(/g)).toHaveLength(2);
    expect(view).toContain("avatarUrl: booking.requester.avatarUrl");
    expect(avatar).not.toContain("AsyncImage(");
    expect(avatar).toContain("CGImageSourceCreateThumbnailAtIndex");
    expect(avatar).toContain("NSCache<NSString, NSImage>");
    expect(avatar).toContain(".returnCacheDataElseLoad");
    expect(avatar).toContain("initialsCircle");
    expect(avatar).toContain(".clipShape(Circle())");
    expect(models).toContain("let avatarUrl: String?");
  });

  it("never falls through from the external projection to Neon-backed reads", () => {
    const model = source("macos/GearOps/GearOpsModel.swift");
    const refresh = model.slice(model.indexOf("func refresh("), model.indexOf("func openDashboard()"));
    const pickupDerivation = model.slice(
      model.indexOf("func pendingPickupBookings"),
      model.indexOf("func restoreSession")
    );

    expect(refresh).toContain("client.companionProjection(");
    expect(refresh).not.toContain("dashboardStats");
    expect(refresh).not.toContain("openBookings()");
    expect(refresh).not.toContain("activeBookingActivity()");
    expect(refresh).not.toContain("kioskDevices()");
    expect(model).toContain("Showing the last confirmed data");
    expect(model).toContain("activeBookingActivity = sortedActivity");
    expect(pickupDerivation).not.toContain(".sorted(");
  });

  it("places aggregate severity with health and prioritizes kiosk heartbeat age", () => {
    const view = source("macos/GearOps/MenuBarContentView.swift");

    expect(view).toContain("WisconsinCreativeIcon(size: 30)");
    expect(view).toContain("Label(model.healthLabel, systemImage: model.healthSeverity.symbol)");
    expect(view).toContain('title: model.kioskAccess == .available ? "Kiosks" : "Kiosk access"');
    expect(view).toContain('return "\\(device.location.name) · Last seen');
    expect(view).toContain("device.pendingPickupCount");
    expect(view).toContain("device.openCheckoutCount");
    expect(view).toContain("freshnessLabel(at: now)");
    expect(view).toContain('title: "Companion data"');
    expect(view).toContain(".help(buildHelp)");
  });

  it("delivers visible booking change notifications, silent unless opted in", () => {
    const notifications = source("macos/GearOps/BookingNotifications.swift");
    const model = source("macos/GearOps/GearOpsModel.swift");
    const settings = source("macos/GearOps/NotificationSettings.swift");

    expect(notifications).toContain("content.interruptionLevel = .active");
    // Silence remains the default; sound is carried per delivery from an
    // explicit user opt-in rather than being hardcoded either way.
    expect(notifications).toContain("content.sound = playsSound ? .default : nil");
    expect(settings).toContain("playsSound = false");
    expect(model).toContain("playsSound: notificationSettings.playsSound");
    expect(notifications).toContain("let bookingTitle: String");
    expect(notifications).toContain("let statusLabel: String");
    expect(notifications).toContain("let requesterName: String");
    expect(notifications).toContain("timestamp: current.updatedAt");
    expect(notifications).toContain("timestamp.formatted(date: .abbreviated, time: .shortened)");
    expect(notifications).toContain('content.title = change.bookingTitle');
    expect(notifications).toContain('content.body = change.summary');
    expect(notifications).toContain('content.threadIdentifier = "booking-\\(change.bookingID)"');
    expect(notifications).toContain('case .open: "Checked Out"');
    expect(notifications).toContain('case .completed: "Checked In"');
    expect(notifications).toContain('statusLabel = "Extended"');
    expect(notifications).toContain('"bookingKind": change.bookingKind.rawValue');
    expect(notifications).toContain("BookingDeepLink.notificationURL");
    expect(model).toContain("CompanionPushBridge.shared.events");
    expect(model).toContain("case .projectionChanged:");
    expect(model).toContain("case .sessionBecameActive:");
    expect(model).toContain("startAutomaticRefresh()");
    expect(model).toContain("await self.retryPendingRevocations()");
    expect(model).toContain("clearPrivateNotifications()");
    expect(notifications).toContain("options: [.alert, .sound]");
    expect(model).toContain("knownBookingActivity");
  });

  it("keeps active checkouts and handoff lanes aligned with the external projection", () => {
    const projection = source("src/lib/services/companion-projection.ts");
    const models = source("macos/GearOps/Models.swift");

    expect(projection).toContain("booking.kind === BookingKind.CHECKOUT");
    expect(projection).toContain("booking.status === BookingStatus.OPEN");
    expect(projection).toContain("pendingPickupTotal: pendingPickups.length");
    expect(models).toContain("let checkedOut: Int");
    expect(models).toContain("let pendingPickupTotal: Int");
  });

  it("preserves cached truth and exact kiosk heartbeat thresholds", () => {
    const model = source("macos/GearOps/GearOpsModel.swift");
    const health = source("macos/GearOps/Health.swift");
    const models = source("macos/GearOps/Models.swift");

    expect(model).toContain("persistCache()");
    expect(model).toContain("Failure preserves the last trusted");
    expect(model).toContain("KioskAccessState(rawValue:");
    expect(health).toContain("if age <= 5 * 60 { return .online }");
    expect(health).toContain("if age <= 24 * 60 * 60 { return .stale }");
    expect(health).toContain('.caseInsensitiveCompare("Sim iPad")');
    expect(model).toContain(".filter(\\.isIncludedInMonitoring)");
    expect(model).toContain("cached.isTrustworthy");
    expect(model).toContain("try projection.validate()");
    expect(model).toContain("uniquingKeysWith:");
    expect(models).toContain("guard version == 1");
    expect(models).toContain("openBookings.count <= 1_000");
  });

  it("keeps signed-out surfaces private and failure states visible", () => {
    const model = source("macos/GearOps/GearOpsModel.swift");
    const login = source("macos/GearOps/LoginView.swift");
    const menu = source("macos/GearOps/GearOpsApp.swift");
    const avatar = source("macos/GearOps/UserAvatarView.swift");

    expect(model).toContain("stageTokenForRevocation(tokenToRevoke)");
    expect(model).toContain("retryPendingRevocations()");
    expect(model).toContain("clearPrivateNotifications()");
    expect(model).toContain("GearOpsAvatarCache.removeAll()");
    expect(model).toContain("var custodyCount: Int? { snapshot?.stats.checkedOut }");
    expect(menu).toContain("model.custodyCount");

    expect(login).toContain("if let errorMessage = model.statusMessage");
    expect(login).toContain("password = \"\"");
    expect(login).toContain("showPassword = false");
    expect(login).toContain("accessibilityAddTraits(.updatesFrequently)");
    expect(avatar).toContain('scheme == "https"');
    expect(avatar).toContain("maxResponseBytes = 2_000_000");
  });
});
