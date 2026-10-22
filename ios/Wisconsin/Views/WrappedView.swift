import SwiftUI

// MARK: - Models

/// `/api/wrapped`: locked until Dec 1, then one person's frozen recap. Admins
/// get a live preview before unlock.
struct WrappedResponse: Decodable, Sendable {
    let status: String
    let unlockAt: String?
    let preview: Bool?
    let frozen: Bool?
    let recap: WrappedRecap?
}

struct WrappedRecap: Decodable, Sendable {
    let windowLabel: String
    let person: WrappedPerson
    let cards: [WrappedCard]
    let team: [WrappedCard]
}

struct WrappedPerson: Decodable, Sendable {
    let userId: String
    let name: String
    let avatarUrl: String?
}

struct WrappedCard: Decodable, Sendable, Identifiable {
    let id: String
    let layout: String
    let tone: String
    let eyebrow: String
    let value: String
    let countTo: Int?
    let sentence: String
    let items: [WrappedCardItem]?
}

struct WrappedCardItem: Decodable, Sendable, Hashable {
    let label: String
    let value: String
    let userId: String?
    let avatarUrl: String?
    let share: Double?
}

/// One slide in the player: a card and whose story it belongs to.
struct WrappedSlide: Identifiable {
    let card: WrappedCard
    let isTeam: Bool
    var id: String { (isTeam ? "team-" : "you-") + card.id }

    var accessibilityLabel: String {
        let heading = "\(isTeam ? "The team. " : "")\(card.eyebrow): \(card.value). \(card.sentence)"
        let details = (card.items ?? []).map { "\($0.label): \($0.value)." }
        return ([heading] + details).joined(separator: " ")
    }
}

/// Mirrors `src/lib/wrapped/dates.ts`: the Scoreboard invites people in from
/// Dec 1 until mid-January; admins see a preview entry before that.
enum WrappedPromo {
    static let unlockAt = ISO8601DateFormatter().date(from: "2026-12-01T06:00:00Z")!
    static let promoEndsAt = ISO8601DateFormatter().date(from: "2027-01-16T06:00:00Z")!

    enum State: Equatable { case hidden, preview, open }

    /// Collaborators can see the Scoreboard but not Wrapped, so they get no door.
    static func state(now: Date = .now, role: String?) -> State {
        guard let role, role != "COLLABORATOR" else { return .hidden }
        let isAdmin = role == "ADMIN"
        if now >= unlockAt { return now < promoEndsAt ? .open : .hidden }
        return isAdmin ? .preview : .hidden
    }
}

/// Each tone is one bold field with one readable ink, matching the web player.
struct WrappedTone {
    let background: Color
    let foreground: Color
    let soft: Color
    let glow: Color

    static func named(_ name: String) -> WrappedTone {
        switch name {
        case "red": return .init(hex: 0xC5050C, ink: .white, glow: 0xFF6B5E)
        case "blue": return .init(hex: 0x3E63DD, ink: .white, glow: 0x8FB0FF)
        case "green": return .init(hex: 0x17784B, ink: .white, glow: 0x5FD49A)
        case "gold": return .init(hex: 0xF6C945, ink: Color(wrappedHex: 0x2B1D00), glow: 0xFFF1B8)
        case "violet": return .init(hex: 0x6E56CF, ink: .white, glow: 0xB9A8FF)
        default: return .init(hex: 0x111318, ink: .white, glow: 0x3E63DD)
        }
    }

    private init(hex: UInt32, ink: Color, glow: UInt32) {
        background = Color(wrappedHex: hex)
        foreground = ink
        soft = ink.opacity(0.74)
        self.glow = Color(wrappedHex: glow)
    }
}

private extension Color {
    init(wrappedHex hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

// MARK: - Entry

/// The Scoreboard's door into Creative Wrapped.
struct WrappedBanner: View {
    let state: WrappedPromo.State
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "gift.fill")
                    .font(.title3)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state == .preview ? "Preview Creative Wrapped" : "Your fall in Creative is here")
                        .font(.headline.weight(.heavy))
                    Text(state == .preview ? "Admins only until December 1." : "Tap through your Creative Wrapped.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.8))
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.subheadline.weight(.bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.white)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(wrappedHex: 0xC5050C), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Shown once, on the first launch after unlock: a small sheet that invites
/// people in, like the year-in-review prompts in Duolingo and Spotify.
struct WrappedInvitation: ViewModifier {
    let role: String?
    let isEnabled: Bool

    @AppStorage("wrapped.2026-fall.invited") private var invited = false
    @State private var showsInvite = false
    @State private var showsWrapped = false

    func body(content: Content) -> some View {
        content
            .task(id: role) {
                guard isEnabled, !invited, WrappedPromo.state(role: role) == .open else { return }
                // Let the app settle before asking for attention.
                try? await Task.sleep(for: .seconds(1.5))
                guard !Task.isCancelled else { return }
                invited = true
                showsInvite = true
            }
            .sheet(isPresented: $showsInvite) {
                VStack(spacing: 14) {
                    Image(systemName: "gift.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.white)
                        .frame(width: 76, height: 76)
                        .background(Color(wrappedHex: 0xC5050C), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .accessibilityHidden(true)
                    Text("Your fall in Creative is here")
                        .font(.title2.weight(.black))
                        .multilineTextAlignment(.center)
                    Text("Events, crew, gear and your style, July to November.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button {
                        showsInvite = false
                        showsWrapped = true
                    } label: {
                        Text("See my Wrapped")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(wrappedHex: 0xC5050C))
                    .padding(.top, 6)
                    Button("Not now") { showsInvite = false }
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .padding(24)
                .presentationDetents([.height(400)])
                .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $showsWrapped) {
                WrappedView()
            }
    }
}

// MARK: - Player

struct WrappedView: View {
    /// The fixture harness opens on a given card with auto-advance off so each
    /// card can be captured without tapping.
    var initialIndex = 0
    var allowsAutoPlay = true

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    @State private var response: WrappedResponse?
    @State private var loadError: String?

    var body: some View {
        ZStack {
            Color(wrappedHex: 0x0B0C10).ignoresSafeArea()
            if let response, let recap = response.recap {
                let slides = recap.cards.map { WrappedSlide(card: $0, isTeam: false) }
                    + recap.team.map { WrappedSlide(card: $0, isTeam: true) }
                if slides.isEmpty {
                    message(title: "Nothing to wrap yet", detail: "Once you work an event or check out gear, your story starts here.")
                } else {
                    WrappedPlayerView(
                        slides: slides,
                        person: recap.person,
                        initialIndex: initialIndex,
                        allowsAutoPlay: allowsAutoPlay,
                        onClose: { dismiss() }
                    )
                }
            } else if response?.status == "locked" {
                VStack(spacing: 10) {
                    Image(systemName: "gift.fill")
                        .font(.largeTitle)
                        .frame(width: 72, height: 72)
                        .background(Color(wrappedHex: 0xC5050C), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .accessibilityHidden(true)
                    Text("Creative Wrapped").font(.subheadline.weight(.bold)).foregroundStyle(.white.opacity(0.6))
                    Text("Opens December 1").font(.largeTitle.weight(.black))
                    Text("Your fall in Creative, told in cards.").foregroundStyle(.white.opacity(0.7))
                }
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding()
                closeOverlay
            } else if let loadError {
                message(title: "Wrapped didn't load", detail: loadError, retry: true)
            } else {
                ProgressView().tint(.white)
                closeOverlay
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .task { await load() }
    }

    private var closeOverlay: some View {
        VStack {
            HStack {
                Spacer()
                WrappedChromeButton(systemImage: "xmark", label: "Close") { dismiss() }
            }
            Spacer()
        }
        .padding()
    }

    private func message(title: String, detail: String, retry: Bool = false) -> some View {
        ZStack {
            VStack(spacing: 8) {
                Text(title).font(.title.weight(.black))
                Text(detail).foregroundStyle(.white.opacity(0.7))
                if retry {
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                        .tint(.white)
                        .foregroundStyle(.black)
                        .padding(.top, 8)
                }
            }
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding()
            closeOverlay
        }
    }

    private func load() async {
        loadError = nil
        do {
            // Admins preview live numbers before unlock; everyone else sees the countdown.
            response = try await APIClient.shared.wrapped(preview: session.currentUser?.role == "ADMIN")
        } catch {
            loadError = "Check your connection and try again."
        }
    }
}

private struct WrappedChromeButton: View {
    let systemImage: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.black.opacity(0.25), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct WrappedPlayerView: View {
    let slides: [WrappedSlide]
    let person: WrappedPerson
    let onClose: () -> Void
    private let allowsAutoPlay: Bool

    init(slides: [WrappedSlide], person: WrappedPerson, initialIndex: Int = 0, allowsAutoPlay: Bool = true, onClose: @escaping () -> Void) {
        self.slides = slides
        self.person = person
        self.onClose = onClose
        self.allowsAutoPlay = allowsAutoPlay
        _index = State(initialValue: max(0, min(slides.count - 1, initialIndex)))
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index = 0
    @State private var elapsed: Double = 0
    @State private var paused = false
    @State private var holding = false
    @State private var showsGrid = false

    private static let cardSeconds: Double = 6.5
    private var last: Int { slides.count - 1 }
    /// Auto-advance is motion; with Reduce Motion on, the reader sets the pace.
    private var autoPlay: Bool { allowsAutoPlay && !reduceMotion }

    var body: some View {
        let slide = slides[index]
        ZStack(alignment: .top) {
            WrappedCardView(card: slide.card, isTeam: slide.isTeam, person: person)
                .id(slide.id)
                .transition(reduceMotion ? .opacity : .asymmetric(
                    insertion: .move(edge: .trailing).combined(with: .opacity),
                    removal: .opacity
                ))
                .contentShape(Rectangle())
                .gesture(tapGesture)
                .simultaneousGesture(holdGesture)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(slide.accessibilityLabel)
                .accessibilityHint("Swipe up or down to change cards.")
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: go(index + 1)
                    case .decrement: go(index - 1)
                    @unknown default: break
                    }
                }

            chrome

            VStack {
                Spacer()
                bottomActions(for: slide)
            }
            .padding(.bottom, 12)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: index)
        .sheet(isPresented: $showsGrid) {
            WrappedGridSheet(slides: slides, current: index) { position in
                showsGrid = false
                go(position)
            }
            .presentationDetents([.large])
        }
        .task(id: index) { await tick() }
    }

    private var chrome: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(Array(slides.enumerated()), id: \.offset) { position, _ in
                    GeometryReader { proxy in
                        Capsule().fill(.white.opacity(0.3))
                            .overlay(alignment: .leading) {
                                Capsule().fill(.white).frame(width: proxy.size.width * progress(for: position))
                            }
                    }
                    .frame(height: 3)
                }
            }
            .accessibilityHidden(true)
            HStack {
                Text("\(index + 1) / \(slides.count)")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.black.opacity(0.25), in: Capsule())
                    .accessibilityLabel("Card \(index + 1) of \(slides.count)")
                Spacer()
                if autoPlay {
                    WrappedChromeButton(systemImage: paused ? "play.fill" : "pause.fill", label: paused ? "Play" : "Pause") {
                        paused.toggle()
                    }
                }
                WrappedChromeButton(systemImage: "square.grid.2x2", label: "All cards") { showsGrid = true }
                WrappedChromeButton(systemImage: "xmark", label: "Close", action: onClose)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    @ViewBuilder
    private func bottomActions(for slide: WrappedSlide) -> some View {
        if slide.card.layout == "summary" {
            let image = WrappedShareImage.render(card: slide.card, person: person)
            if let image {
                ShareLink(
                    item: image,
                    preview: SharePreview("My fall in Creative", image: image)
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 22)
                        .frame(height: 48)
                        .background(.white, in: Capsule())
                }
                .simultaneousGesture(TapGesture().onEnded { paused = true })
            }
        } else if index == last {
            Button {
                go(0)
            } label: {
                Label("Replay", systemImage: "arrow.counterclockwise")
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 22)
                    .frame(height: 48)
                    .background(.white, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    private var tapGesture: some Gesture {
        SpatialTapGesture().onEnded { value in
            // Left third goes back, the rest goes forward, like stories.
            let width = UIScreen.main.bounds.width
            if value.location.x < width * 0.3 { go(index - 1) } else { go(index + 1) }
        }
    }

    private var holdGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.25, maximumDistance: 30)
            .onChanged { _ in holding = true }
            .onEnded { _ in holding = false }
    }

    private func progress(for position: Int) -> CGFloat {
        if position < index { return 1 }
        if position > index { return 0 }
        return autoPlay ? CGFloat(min(1, elapsed / Self.cardSeconds)) : 1
    }

    private func go(_ next: Int) {
        let clamped = max(0, min(last, next))
        guard clamped != index else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.35)) {
            index = clamped
        }
        elapsed = 0
    }

    private func tick() async {
        guard autoPlay else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(50))
            if paused || holding || showsGrid { continue }
            elapsed += 0.05
            if elapsed >= Self.cardSeconds {
                if index < last { go(index + 1) }
                return
            }
        }
    }
}

// MARK: - Card

struct WrappedCardView: View {
    let card: WrappedCard
    let isTeam: Bool
    let person: WrappedPerson

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var rolled = 0

    private var tone: WrappedTone { .named(card.tone) }

    var body: some View {
        // Content stays inside the safe area so it clears the player chrome;
        // only the color and glows bleed to the screen edges.
        VStack(alignment: .leading, spacing: 18) {
            Text(((isTeam && card.layout != "summary") ? "The team · " : "") + card.eyebrow)
                .font(.footnote.weight(.bold))
                .tracking(1.6)
                .textCase(.uppercase)
                .foregroundStyle(tone.soft)
                .padding(.top, 64)
            Spacer(minLength: 0)
            content
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 28)
        .padding(.bottom, 76)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background {
            ZStack {
                tone.background
                Circle()
                    .fill(tone.glow.opacity(0.45))
                    .frame(width: 300, height: 300)
                    .blur(radius: 60)
                    .offset(x: 160, y: -300)
                    .scaleEffect(appeared || reduceMotion ? 1 : 0.6)
                Circle()
                    .fill(tone.glow.opacity(0.25))
                    .frame(width: 320, height: 320)
                    .blur(radius: 80)
                    .offset(x: -150, y: 300)
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
        }
        .onAppear {
            if reduceMotion {
                appeared = true
                rolled = card.countTo ?? 0
                return
            }
            withAnimation(.easeOut(duration: 0.9)) {
                appeared = true
                rolled = card.countTo ?? 0
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch card.layout {
        case "cover":
            VStack(alignment: .leading, spacing: 22) {
                UserAvatarView(
                    name: person.name,
                    avatarUrl: person.avatarUrl,
                    size: 92,
                    fallbackBackground: tone.foreground,
                    fallbackForeground: tone.background
                )
                .overlay(Circle().strokeBorder(tone.foreground.opacity(0.3), lineWidth: 4))
                Text(card.value)
                    .font(.system(size: 54, weight: .black))
                    .minimumScaleFactor(0.6)
                Text(card.sentence)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(tone.soft)
            }
            .rise(appeared, reduceMotion)
        case "summary":
            WrappedSummaryCard(card: card, person: person)
                .rise(appeared, reduceMotion)
        default:
            VStack(alignment: .leading, spacing: 18) {
                bigValue
                Text(card.sentence)
                    .font(.title3.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                if let items = card.items, !items.isEmpty {
                    if card.layout == "people" {
                        peopleList(items)
                    } else {
                        itemList(items)
                    }
                }
            }
            .rise(appeared, reduceMotion)
        }
    }

    private var bigValue: some View {
        let numeric = card.value.allSatisfy { $0.isNumber || "–.,%".contains($0) }
        let size: CGFloat = numeric ? 96 : (card.value.count <= 12 ? 56 : 42)
        return Group {
            if let countTo = card.countTo {
                Text(card.value.replacingOccurrences(of: String(countTo), with: String(rolled)))
                    .contentTransition(.numericText(value: Double(rolled)))
            } else {
                Text(card.value)
            }
        }
        .font(.system(size: size, weight: .black))
        .monospacedDigit()
        .minimumScaleFactor(0.5)
        .lineLimit(3)
        .accessibilityLabel(card.value)
    }

    private func peopleList(_ items: [WrappedCardItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(items, id: \.self) { item in
                HStack(spacing: 12) {
                    UserAvatarView(
                        name: item.label,
                        avatarUrl: item.avatarUrl,
                        size: 40,
                        fallbackBackground: tone.foreground,
                        fallbackForeground: tone.background
                    )
                    Text(item.label).font(.body.weight(.bold)).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(item.value).font(.subheadline.monospacedDigit()).foregroundStyle(tone.soft)
                }
            }
        }
    }

    private func itemList(_ items: [WrappedCardItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(items, id: \.self) { item in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(item.label).font(.subheadline).foregroundStyle(tone.soft)
                        Spacer(minLength: 12)
                        Text(item.value).font(.subheadline.weight(.heavy).monospacedDigit()).lineLimit(1)
                    }
                    if let share = item.share {
                        GeometryReader { proxy in
                            Capsule().fill(tone.foreground.opacity(0.22))
                                .overlay(alignment: .leading) {
                                    Capsule().fill(tone.foreground)
                                        .frame(width: proxy.size.width * (appeared ? max(share, 0.06) : 0))
                                }
                        }
                        .frame(height: 8)
                        .accessibilityHidden(true)
                    }
                }
            }
        }
    }
}

private extension View {
    func rise(_ appeared: Bool, _ reduceMotion: Bool) -> some View {
        opacity(appeared || reduceMotion ? 1 : 0)
            .offset(y: appeared || reduceMotion ? 0 : 14)
    }
}

/// The white share card: it sits on the summary slide and is what gets shared.
struct WrappedSummaryCard: View {
    let card: WrappedCard
    let person: WrappedPerson

    private let ink = Color(wrappedHex: 0x111318)
    private let muted = Color(wrappedHex: 0x5B616E)
    private let tile = Color(wrappedHex: 0xF3F4F6)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 44)
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.name).font(.subheadline.weight(.black)).foregroundStyle(ink).lineLimit(1)
                    Text("Creative Wrapped · Fall 2026").font(.caption).foregroundStyle(muted)
                }
            }
            Text("My style")
                .font(.caption.weight(.bold))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(muted)
                .padding(.top, 20)
            Text(card.value)
                .font(.system(size: 32, weight: .black))
                .foregroundStyle(Color(wrappedHex: 0xC5050C))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(card.items ?? [], id: \.self) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.value).font(.title3.weight(.black).monospacedDigit()).foregroundStyle(ink).lineLimit(1)
                        Text(item.label).font(.caption).foregroundStyle(muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(tile, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
            .padding(.top, 18)
            Text(card.sentence)
                .font(.caption2)
                .foregroundStyle(muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 14)
        }
        .padding(22)
        .background(.white, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: .black.opacity(0.3), radius: 24, y: 10)
    }
}

/// Renders the share card on a red field at 1080×1350, the same frame as the
/// web image, without a network round trip.
enum WrappedShareImage {
    @MainActor
    static func render(card: WrappedCard, person: WrappedPerson) -> Image? {
        let content = VStack(alignment: .leading, spacing: 14) {
            Text("Creative Wrapped · Fall 2026")
                .font(.footnote.weight(.bold))
                .tracking(1.6)
                .textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.8))
            WrappedSummaryCard(card: card, person: person)
        }
        .padding(24)
        .frame(width: 360, height: 450)
        .background(Color(wrappedHex: 0xC5050C))
        .environment(\.colorScheme, .light)

        let renderer = ImageRenderer(content: content)
        renderer.scale = 3
        guard let uiImage = renderer.uiImage else { return nil }
        return Image(uiImage: uiImage)
    }
}

private struct WrappedGridSheet: View {
    let slides: [WrappedSlide]
    let current: Int
    let onPick: (Int) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(Array(slides.enumerated()), id: \.offset) { position, slide in
                        let tone = WrappedTone.named(slide.card.tone)
                        Button {
                            onPick(position)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Spacer(minLength: 0)
                                Text((slide.isTeam ? "Team · " : "") + slide.card.eyebrow)
                                    .font(.caption2.weight(.bold))
                                    .textCase(.uppercase)
                                    .foregroundStyle(tone.soft)
                                Text(slide.card.value)
                                    .font(.headline.weight(.black))
                                    .foregroundStyle(tone.foreground)
                                    .lineLimit(2)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, minHeight: 150, alignment: .bottomLeading)
                            .background(tone.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay {
                                if position == current {
                                    RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white, lineWidth: 2)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .navigationTitle("All cards")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
