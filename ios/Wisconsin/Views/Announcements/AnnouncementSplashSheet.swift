import SwiftUI

/// Loads and dismisses the announcement splash. One request on launch and one
/// on each foreground; no timers (same rule as the badge fetch). A dismiss that
/// fails to reach the server is fine: the splash simply shows again later.
@MainActor
@Observable
final class AnnouncementSplashStore {
    private(set) var current: ActiveAnnouncement?
    private var loading = false

    func reset() {
        current = nil
    }

    func load() async {
        guard current == nil, !loading else { return }
        loading = true
        defer { loading = false }
        // Splash chrome is additive: a failed read just means no splash this time.
        guard let next = try? await APIClient.shared.activeAnnouncement() else { return }
        guard current == nil else { return }
        current = next
    }

    /// Any close (button, CTA, swipe down) lands here. Records the dismissal,
    /// then pulls the next unseen announcement only when one is waiting.
    func dismissCurrent() {
        guard let announcement = current else { return }
        current = nil
        Task {
            try? await APIClient.shared.dismissAnnouncement(id: announcement.id)
            guard announcement.remaining > 0 else { return }
            // Let the sheet finish leaving before the next one rises.
            try? await Task.sleep(for: .milliseconds(450))
            await load()
        }
    }
}

extension View {
    /// Presents the announcement splash for an eligible signed-in user.
    /// Pass nil when the viewer should never see one (signed out, mid-setup,
    /// collaborator, role preview); a new key reloads for the new identity.
    func announcementSplash(eligibilityKey: String?) -> some View {
        modifier(AnnouncementSplashModifier(eligibilityKey: eligibilityKey))
    }
}

private struct AnnouncementSplashModifier: ViewModifier {
    let eligibilityKey: String?

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(AppState.self) private var appState
    @State private var store = AnnouncementSplashStore()

    func body(content: Content) -> some View {
        content
            .task(id: eligibilityKey) {
                store.reset()
                guard eligibilityKey != nil else { return }
                await store.load()
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, eligibilityKey != nil else { return }
                Task { await store.load() }
            }
            .sheet(item: Binding(
                get: { store.current },
                set: { newValue in
                    // Only a user swipe-down writes nil here; button paths clear it first.
                    if newValue == nil { store.dismissCurrent() }
                }
            )) { announcement in
                AnnouncementSplashSheet(
                    announcement: announcement,
                    onPrimary: { performPrimary(for: announcement) },
                    onClose: { store.dismissCurrent() }
                )
            }
    }

    private func performPrimary(for announcement: ActiveAnnouncement) {
        store.dismissCurrent()
        guard announcement.hasCta, let target = announcement.ctaUrl else { return }
        if target.hasPrefix("/") {
            // An app path goes to its native screen when the shared parser knows
            // it; anything else opens the same page on the website.
            let components = URLComponents(string: target)
            if let route = GearTrackerRouteParser.parsePath(
                components?.path ?? target,
                query: components?.queryItems ?? []
            ) {
                appState.apply(route)
            } else if let url = URL(string: target, relativeTo: AppEnvironment.baseURL)?.absoluteURL {
                openURL(url)
            }
        } else if let url = URL(string: target), url.scheme?.lowercased() == "https" {
            openURL(url)
        }
    }
}

struct AnnouncementSplashSheet: View {
    let announcement: ActiveAnnouncement
    let onPrimary: () -> Void
    let onClose: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var contentHeight: CGFloat = 0
    @State private var footerHeight: CGFloat = 0
    @ScaledMetric(relativeTo: .body) private var tileSize: CGFloat = 44
    @ScaledMetric(relativeTo: .body) private var checkSize: CGFloat = 20

    private var hasImages: Bool { !announcement.imageUrls.isEmpty }

    /// Fits the sheet to its content; the system clamps it at full height and
    /// the body scrolls once Dynamic Type or a long message outgrows the screen.
    private var fittedHeight: CGFloat {
        contentHeight > 0 ? contentHeight + footerHeight + 28 : 560
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if hasImages {
                    AnnouncementMedia(urls: announcement.imageUrls, alt: announcement.imageAlt)
                }
                header
                bodyBlocks
                // Accessibility sizes: buttons scroll with the text instead of
                // a pinned bar that would leave almost no room to read.
                if typeSize.isAccessibilitySize { footer }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !typeSize.isAccessibilitySize { footer }
        }
        .background(alignment: .topLeading) {
            if !hasImages {
                RadialGradient(
                    colors: [Color.brandPrimary.opacity(0.14), .clear],
                    center: .topLeading,
                    startRadius: 0,
                    endRadius: 360
                )
                .allowsHitTesting(false)
            }
        }
        .presentationDetents([.height(fittedHeight), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(Color(.systemBackground))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            kindRow
            Text(announcement.title)
                .font(.title.weight(.semibold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, 24)
        .padding(.top, hasImages ? 20 : 28)
        .padding(.bottom, 14)
    }

    @ViewBuilder
    private var kindRow: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            Image(systemName: announcement.kindSymbol)
                .font(.title3.weight(.regular))
                .foregroundStyle(Color.brandPrimary)
                .frame(width: tileSize, height: tileSize)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(Color.brandPrimary.opacity(0.18), lineWidth: 1)
                }
                .accessibilityHidden(true)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(announcement.kindLabel.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(1.0)
                    .foregroundStyle(Color.brandPrimary)
                    .lineLimit(1)
                    .fixedSize()
                if let date = announcement.publishedDate {
                    Text("·").foregroundStyle(.tertiary)
                    Text(date, format: .dateTime.month(.abbreviated).day())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .accessibilityElement(children: .combine)

            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }

            if announcement.remaining > 0 {
                Text("\(announcement.remaining) more")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color(.tertiarySystemFill), in: Capsule())
            }
        }
    }

    private var bodyBlocks: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(announcement.blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    Text(text)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                case .list(let items):
                    VStack(alignment: .leading, spacing: 11) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Color.brandPrimary)
                                    .frame(width: checkSize, height: checkSize)
                                    .background(Color.brandPrimary.opacity(0.13), in: Circle())
                                    .accessibilityHidden(true)
                                Text(item)
                                    .font(.body)
                                    .foregroundStyle(.primary.opacity(0.88))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.bottom, 20)
    }

    private var footer: some View {
        VStack(spacing: 6) {
            Button(action: onPrimary) {
                Text(announcement.hasCta ? (announcement.ctaLabel ?? "Got it") : "Got it")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(.brandPrimary)

            if announcement.hasCta {
                Button("Close", action: onClose)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { footerHeight = $0 }
    }
}

/// A single banner, or several the viewer swipes between with page dots.
private struct AnnouncementMedia: View {
    let urls: [String]
    let alt: String?

    @State private var page = 0

    var body: some View {
        Group {
            if urls.count == 1 {
                AnnouncementImage(urlString: urls[0], index: 0)
            } else {
                TabView(selection: $page) {
                    ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                        AnnouncementImage(urlString: url, index: index).tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .interactive))
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(alt ?? "Announcement image")
        .accessibilityValue(urls.count > 1 ? "Image \(page + 1) of \(urls.count)" : "")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: page = min(page + 1, urls.count - 1)
            case .decrement: page = max(page - 1, 0)
            @unknown default: break
            }
        }
    }
}

private struct AnnouncementImage: View {
    let urlString: String
    let index: Int

    var body: some View {
        Group {
#if DEBUG
            if let art = AnnouncementFixtureArt(urlString: urlString) {
                art
            } else {
                remote
            }
#else
            remote
#endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    @ViewBuilder
    private var remote: some View {
        AsyncImage(url: URL(string: urlString)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure:
                placeholder(systemName: "photo")
            default:
                placeholder(systemName: nil)
            }
        }
    }

    private func placeholder(systemName: String?) -> some View {
        ZStack {
            Rectangle().fill(Color(.tertiarySystemFill))
            if let systemName {
                Image(systemName: systemName).font(.title).foregroundStyle(.tertiary)
            } else {
                ProgressView()
            }
        }
    }
}
