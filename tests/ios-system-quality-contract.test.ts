import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS system quality contracts", () => {
  it("parses guide Markdown once per article and gives blocks stable source identities", () => {
    const guides = source("ios/Wisconsin/Views/GuidesView.swift");
    const markdown = source("ios/Wisconsin/Views/GuideMarkdown.swift");

    // Parsed once in the article initializer, never per block on every draw.
    expect(guides).toContain("private let blocks: [GuideBlock]");
    expect(guides).toContain("init(markdown: String, title: String = \"\")");
    expect(guides).toContain("let parsed = GuideMarkdown.parse(markdown)");
    expect(guides).toContain("GuideMarkdown.omittingDuplicateLeadHeading");
    expect(guides).not.toContain("private var blocks: [GuideBlock]");

    // Source position is the block identity, so a document that repeats a block
    // verbatim still gets distinct, stable ForEach ids across reparses.
    expect(markdown).toContain("let id: Int");
    expect(markdown).toContain("let kind: Kind");
    expect(markdown).toContain(
      "kinds.enumerated().map { GuideBlock(id: $0.offset, kind: $0.element) }",
    );
    expect(guides).not.toContain("let id = UUID()");
    expect(markdown).not.toContain("let id = UUID()");
  });

  it("keeps the scanner inspector interactive only in debug builds", () => {
    const identity = source("ios/Wisconsin/Kiosk/KioskIdentityView.swift");

    expect(identity).toContain("#if DEBUG");
    expect(identity).toContain("Button { showInspector = true } label: { scannerStatusLabel }");
    expect(identity).toContain(".sheet(isPresented: $showInspector) { KioskFlowInspector() }");
    expect(identity).toContain("#else");
    expect(identity).toContain('accessibilityLabel("Scanner status: \\(store.scanner.statusText)")');
  });

  it("gives the identity roster complete loading, error, empty, and search states", () => {
    const identity = source("ios/Wisconsin/Kiosk/KioskIdentityView.swift");

    expect(identity).toContain('ProgressView("Loading roster")');
    expect(identity).toContain('Label("Couldn’t load the roster", systemImage: "wifi.exclamationmark")');
    expect(identity).toContain('Button("Retry") { Task { await loadRoster() } }');
    expect(identity).toContain('Label("No people available", systemImage: "person.2.slash")');
    expect(identity).toContain('Label("No matching people", systemImage: "magnifyingglass")');
    expect(identity).toContain('Button("Clear Search")');
    // The roster tile itself is now the shared `UserRow` the idle screen uses —
    // identity had a second implementation whose names hyphenated across three
    // lines. It still has to name the person and say what selecting does.
    expect(identity).toContain("UserRow(");
    expect(identity).toContain('accessibilityHintText: "Select \\(user.name)"');
    const roster = source("ios/Wisconsin/Kiosk/KioskIdleRoster.swift");
    expect(roster).toContain("accessibilityLabel(accessibilityLabel)");
    expect(roster).toContain("accessibilityHint(accessibilityHintText ??");
  });

  it("lets only the latest identity scan route the kiosk", () => {
    const identity = source("ios/Wisconsin/Kiosk/KioskIdentityView.swift");
    const identify = identity.slice(
      identity.indexOf("private func identify"),
      identity.indexOf("private func cancelIdentityFlow"),
    );
    const ownership = identity.slice(
      identity.indexOf("private func ownsIdentityRequest"),
      identity.indexOf("private func finishIdentityRequest"),
    );
    const cancellation = identity.slice(
      identity.indexOf("private func cancelIdentityRequest"),
      identity.indexOf("\n    }\n}", identity.indexOf("private func cancelIdentityRequest")),
    );

    expect(identity).toContain("@State private var identifyTask: Task<Void, Never>?");
    expect(identity).toContain("@State private var identifyRequests = LatestRequestGeneration()");
    expect(identify).toContain("let requestToken = identifyRequests.begin()");
    expect(identify).toContain("try Task.checkCancellation()");
    expect(identify.match(/guard ownsIdentityRequest\(requestToken\) else \{ return \}/g)).toHaveLength(3);
    expect(ownership).toContain("identifyRequests.owns(requestToken)");
    expect(ownership).toContain("store.scanner.owner == .identity");
    expect(ownership).toContain("case .identity = store.screen");
    expect(cancellation).toContain("identifyTask?.cancel()");
    expect(cancellation).toContain("identifyRequests.invalidate()");
  });

  it("cancels identity work and scanner ownership before Cancel leaves the screen", () => {
    const identity = source("ios/Wisconsin/Kiosk/KioskIdentityView.swift");
    const cancelFlow = identity.slice(
      identity.indexOf("private func cancelIdentityFlow"),
      identity.indexOf("private func choose"),
    );

    expect(identity).toContain('Button("Cancel") { cancelIdentityFlow() }');
    expect(cancelFlow).toContain("cancelIdentityRequest()");
    expect(cancelFlow).toContain("store.scanner.release(.identity)");
    expect(cancelFlow).toContain("store.screen = .idle");
    expect(cancelFlow.indexOf("cancelIdentityRequest()")).toBeLessThan(
      cancelFlow.indexOf("store.screen = .idle"),
    );
    expect(cancelFlow.indexOf("store.scanner.release(.identity)")).toBeLessThan(
      cancelFlow.indexOf("store.screen = .idle"),
    );
  });

  it("makes the full sleep surface a wake button and honors Reduce Motion", () => {
    const sleep = source("ios/Wisconsin/Kiosk/KioskSleepModeView.swift");

    expect(sleep).toContain("@Environment(\\.accessibilityReduceMotion) private var reduceMotion");
    expect(sleep).toContain("Button(action: onWake)");
    expect(sleep).toContain(".frame(maxWidth: .infinity, maxHeight: .infinity)");
    expect(sleep).toContain(".offset(reduceMotion ? .zero : pixelShiftOffset(for: context.date))");
    expect(sleep).toContain('.accessibilityHint("Wake the kiosk")');
    expect(sleep).not.toContain(".onTapGesture { onWake() }");
  });

  it("resets kiosk timers without republishing unchanged visible state on every touch", () => {
    const store = source("ios/Wisconsin/Kiosk/KioskStore.swift");
    const reset = store.slice(
      store.indexOf("func resetInactivity()"),
      store.indexOf("func dismissInactivityWarning()"),
    );

    expect(reset).toContain("if isDeviceIdle {");
    expect(reset).toContain("if inactivityWarningVisible {");
    expect(reset).toContain("if self.inactivityWarningVisible {");
  });

  it("routes dense native equipment and search thumbnails through the bounded downsampler", () => {
    const equipment = source(
      "ios/Wisconsin/Views/CreateBooking/CreateBookingEquipmentRows.swift",
    );
    const search = source("ios/Wisconsin/Views/Search/SearchResultRow.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
    const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
    const bookingDetail = source("ios/Wisconsin/Views/BookingDetailView.swift");
    const scanHero = source("ios/Wisconsin/Views/Search/ScanResultHeroCard.swift");
    const welcome = source(
      "ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift",
    );
    const zoom = source("ios/Wisconsin/Core/Brand.swift");
    const loader = source("ios/Wisconsin/Core/ThumbnailLoader.swift");

    expect(equipment.match(/CachedThumbnail\(url: url, size: size\)/g)).toHaveLength(2);
    expect(equipment).not.toContain("AsyncImage");
    expect(search).toContain(
      'CachedThumbnail(url: url, size: size, placeholderSystemImage: "shippingbox")',
    );
    expect(search).not.toContain("AsyncImage");
    expect(schedule).toContain("UserAvatarView(");
    expect(schedule).not.toContain("AsyncImage(");
    expect(itemDetail).toContain("CachedThumbnail(url: url, size: 124, contentMode: .fit)");
    expect(itemDetail).not.toContain("AsyncImage(");
    expect(bookingDetail).toContain("BookingBulkThumbnail(imageUrl: item.bulkSku.imageUrl");
    expect(bookingDetail).not.toContain("AsyncImage(");
    expect(scanHero).toContain("contentMode: .fit");
    expect(scanHero).not.toContain("AsyncImage(");
    expect(welcome).toContain("UserAvatarView(");
    expect(welcome).not.toContain("AsyncImage(");
    expect(loader).toContain("var contentMode: ContentMode = .fill");
    // Full-screen pinch zoom still needs the original pixels.
    expect(zoom).toContain("struct ZoomableImageViewer: View");
    expect(zoom).toContain("AsyncImage(url: url)");
  });
});
