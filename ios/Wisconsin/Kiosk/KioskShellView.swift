import SwiftUI
import UIKit

struct KioskShellView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showSystemStatus = false
    @State private var statusRevealTask: Task<Void, Never>?

    /// One transition unit per logical screen. Keying by case (plus the
    /// identifying payload) means in-screen state changes never re-trigger the
    /// transition, while every real navigation cross-fades.
    private var screenKey: String {
        if store.isResuming { return "resuming" }
        switch store.screen {
        case .activation: return "activation"
        case .idle: return "idle"
        case .operatorHub(let user): return "hub-\(user.id)"
        case .identity: return "identity"
        case .checkout(let user): return "checkout-\(user.id)"
        case .pickup(let bookingId, _): return "pickup-\(bookingId)"
        case .return(let bookingId, _): return "return-\(bookingId)"
        case .success: return "success"
        }
    }

    /// Subliminal fade + 1.5% settle-in. Deliberately not a slide: it preserves
    /// spatial continuity and doesn't change when views mount/unmount relative
    /// to the bare switch, so HID scanner field semantics are untouched.
    private var screenTransition: AnyTransition {
        reduceMotion
            ? .opacity
            : .asymmetric(
                insertion: .opacity.combined(with: .scale(scale: 0.985)),
                removal: .opacity
            )
    }

    /// Flow screens own the top-left navigation affordance. The shell's
    /// device-status reveal lives there only on screens without a Back or
    /// Cancel control; otherwise its hit target sits over the flow header and
    /// makes the user's back tap ambiguous.
    private var showsSystemStatusButton: Bool {
        switch store.screen {
        case .success:
            // The redesigned receipt puts the person's portrait here.
            return false
        // Idle hosts the control in its own header.
        case .idle, .activation, .operatorHub, .identity, .checkout, .pickup, .return:
            return false
        }
    }

    /// Checkout details carries the keyboard tip inline under its field
    /// (redesign I6), so the centered popup stays off that screen.
    private var showsInlineKeyboardTip: Bool {
        if case .checkout = store.screen { return true }
        return false
    }

    /// Scan screens (checkout, pickup, return) state scanner readiness in their
    /// own work surface. The global pill there said it a second time and sat on
    /// top of the right rail's title. Identity and the operator hub put time and
    /// Back top-right (redesign), where the pill covered them, so it only
    /// appears on home.
    private var showsScannerStatusPill: Bool {
        switch store.screen {
        case .idle:
            return true
        case .identity, .operatorHub, .activation, .checkout, .pickup, .return, .success:
            return false
        }
    }

    /// What this person actually loses if the kiosk resets, in their words.
    ///
    /// The warning used to say "Tap to keep your scans" everywhere it appeared,
    /// including on the operator hub, where nothing has been scanned — so the
    /// one sentence explaining the stake named something that did not exist.
    /// Who the "Still here?" card is asking, when the screen knows.
    private var inactivityFirstName: String? {
        switch store.screen {
        case .checkout(let user), .operatorHub(let user):
            return user.name.split(separator: " ").first.map(String.init)
        default:
            return nil
        }
    }

    private var inactivityStake: String {
        let minutes = Int(KioskStore.cartRetention / 60)
        switch store.screen {
        case .checkout(let user):
            let count = store.cart(for: user.id).count
            if count > 0 {
                return "Nothing is checked out yet. If you step away, your \(count == 1 ? "scan waits" : "\(count) scans wait") \(minutes) minutes; tap your name to pick up where you left off."
            }
            return "Nothing is checked out yet. If you step away, this checkout closes."
        case .pickup, .return:
            return "Scans already recorded on this booking are kept. If you step away, this screen closes."
        case .operatorHub, .identity:
            return "If you step away, you'll be signed out of this kiosk."
        default:
            return "If you step away, this screen closes."
        }
    }

    var body: some View {
        ZStack {
            KioskBackdrop()

            Group {
                if store.isResuming {
                    KioskResumeSplash()
                } else {
                    switch store.screen {
                    case .activation:
                        KioskActivationView()
                    case .idle:
                        KioskIdleView()
                    case .operatorHub(let user):
                        KioskOperatorHubView(user: user)
                    case .identity:
                        KioskIdentityView()
                    case .checkout(let user):
                        KioskCheckoutView(user: user)
                    case .pickup(let bookingId, let userId):
                        KioskPickupView(bookingId: bookingId, userId: userId)
                    case .return(let bookingId, let userId):
                        KioskReturnView(bookingId: bookingId, userId: userId)
                    case .success(let info):
                        KioskSuccessView(info: info)
                    }
                }
            }
            .id(screenKey)
            // Checkout step 1 does not fit above the software keyboard, so
            // SwiftUI's keyboard avoidance overflowed it and pushed the header
            // off the top. The details step lifts its own "Something else"
            // field above the keys instead (`KioskCheckoutDetailsStep`).
            .ignoresSafeArea(.keyboard, edges: showsInlineKeyboardTip ? .bottom : [])
            .disabled(store.isProcessingHandoff)
            .transition(screenTransition)

            if store.inactivityWarningVisible {
                InactivityWarningOverlay(
                    firstName: inactivityFirstName,
                    atRisk: inactivityStake,
                    onStay: { store.dismissInactivityWarning() },
                    onFinish: { store.finishSessionNow() }
                )
                .transition(.opacity)
            }

            // One keyboard popup for the whole kiosk. Every text field already
            // reports focus through `scanner.setEditing`, so the shell can own
            // this instead of each field mounting its own copy.
            KioskKeyboardHint(isFieldFocused: store.scanner.isEditing && !showsInlineKeyboardTip)

            // Not during standby: see `KioskStore.isStandbyVisible`.
            if store.isActive, !store.isResuming, showsScannerStatusPill, !store.isStandbyVisible {
                KioskScannerStatusPill()
                    .padding(20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }

            if showsSystemStatusButton {
                Button {
                    revealSystemStatus()
                } label: {
                    Image(systemName: "info.circle")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.bordered)
                .tint(KioskText.secondary)
                .accessibilityLabel("Show device status")
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(20)
            }
        }
        .preferredColorScheme(.dark)
        .persistentSystemOverlays(showSystemStatus ? .visible : .hidden)
        .statusBarHidden(!showSystemStatus)
        // Restore an activated kiosk on cold launch without needing the
        // deeplink — a dedicated iPad always returns to kiosk mode.
        .task {
            store.resumeIfNeeded()
            store.scanner.startHardwareMonitoring()
        }
        // Kiosk iPads live plugged in on a counter — never let the screen
        // sleep while the kiosk shell is up; restore normal behavior on exit.
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .background(KioskActivityMonitor { store.resetInactivity() })
        .onChange(of: store.systemStatusRevealRequests) { _, _ in revealSystemStatus() }
        .animation(KioskMotion.screen(reduceMotion), value: store.inactivityWarningVisible)
        .animation(
            reduceMotion ? .easeInOut(duration: 0.15) : .easeOut(duration: 0.28),
            value: screenKey
        )
    }

    private func revealSystemStatus() {
        statusRevealTask?.cancel()
        showSystemStatus = true
        statusRevealTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled else { return }
            showSystemStatus = false
        }
    }
}

/// Tracks kiosk activity without adding SwiftUI gestures to the screen tree.
/// The recognizers are non-cancelling and allow simultaneous recognition, so
/// UIKit controls such as calendars, wheels, text fields, and menus keep their
/// own touch handling.
private struct KioskActivityMonitor: UIViewRepresentable {
    let onActivity: () -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.onActivity = onActivity
        DispatchQueue.main.async {
            context.coordinator.install(on: view.window)
        }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onActivity: onActivity)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onActivity: () -> Void
        private weak var window: UIWindow?
        private var lastActivityAt = Date.distantPast

        private lazy var tapRecognizer: UITapGestureRecognizer = {
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(tapActivity(_:)))
            configure(recognizer)
            return recognizer
        }()

        private lazy var panRecognizer: UIPanGestureRecognizer = {
            let recognizer = UIPanGestureRecognizer(target: self, action: #selector(panActivity(_:)))
            configure(recognizer)
            return recognizer
        }()

        init(onActivity: @escaping () -> Void) {
            self.onActivity = onActivity
        }

        func install(on window: UIWindow?) {
            guard let window, self.window !== window else { return }
            uninstall()
            window.addGestureRecognizer(tapRecognizer)
            window.addGestureRecognizer(panRecognizer)
            self.window = window
        }

        func uninstall() {
            window?.removeGestureRecognizer(tapRecognizer)
            window?.removeGestureRecognizer(panRecognizer)
            window = nil
        }

        private func configure(_ recognizer: UIGestureRecognizer) {
            recognizer.cancelsTouchesInView = false
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            recognizer.delegate = self
        }

        @objc private func tapActivity(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended else { return }
            recordActivity()
        }

        @objc private func panActivity(_ recognizer: UIPanGestureRecognizer) {
            guard recognizer.state == .began else { return }
            recordActivity()
        }

        private func recordActivity() {
            let now = Date()
            guard now.timeIntervalSince(lastActivityAt) > 0.5 else { return }
            lastActivityAt = now
            onActivity()
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}

/// Brief restore state shown while a cold-launch session restore is in flight,
/// so the kiosk never flashes the activation numpad to a returning device. The
/// shell backdrop is already the first-screen color; this only explains the wait.
private struct KioskResumeSplash: View {
    var body: some View {
        VStack(spacing: 18) {
            ProgressView()
                .controlSize(.large)
                .tint(KioskText.primary)
            Text("Resuming kiosk…")
                .font(.headline)
                .foregroundStyle(KioskText.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Resuming kiosk")
    }
}

/// Canvas I4 "Still here?": a countdown ring that drains over the warning
/// window, who it's asking, what waits for them, and two answers. Two gentle
/// pings play once when it appears; the ring is their visible twin.
private struct InactivityWarningOverlay: View {
    let firstName: String?
    let atRisk: String
    let onStay: () -> Void
    let onFinish: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            KioskScrim.modal.ignoresSafeArea()
            VStack(spacing: 18) {
                InactivityCountdownRing(total: KioskStore.inactivityWarningSeconds, reduceMotion: reduceMotion)
                Text(firstName.map { "Still here, \($0)?" } ?? "Still here?")
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(KioskText.primary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(atRisk)
                    .font(KioskType.body)
                    .foregroundStyle(KioskText.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    // The counter has a queue. Someone who is finished should
                    // not have to wait out the countdown with their name up.
                    Button(action: onFinish) {
                        Text("I'm done for now")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    .kioskButtonRole(.secondary)
                    .accessibilityLabel("I'm done for now. Return to the home screen")
                    Button(action: onStay) {
                        Text("I'm here")
                            .font(.system(size: 17, weight: .heavy))
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    .kioskButtonRole(.primary)
                }
            }
            .padding(32)
            .frame(width: 520)
            .kioskCard(KioskSurface.modal, radius: KioskRadius.modal, stroke: KioskStroke.strong)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
        .onAppear { KioskFeedbackSound.play(.warning) }
    }
}

/// The seconds left before the kiosk resets, as a ring that drains smoothly
/// with the number in the middle. No flashing; under Reduce Motion the ring
/// steps once a second without animating.
private struct InactivityCountdownRing: View {
    let total: Int
    let reduceMotion: Bool
    @State private var appeared = Date()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = max(0, total - Int(context.date.timeIntervalSince(appeared).rounded()))
            ZStack {
                Circle()
                    .stroke(KioskStroke.standard, lineWidth: 6)
                Circle()
                    .trim(from: 0, to: CGFloat(remaining) / CGFloat(max(total, 1)))
                    .stroke(KioskText.primary, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .linear(duration: 1), value: remaining)
                Text("\(remaining)")
                    .font(.system(size: 26, weight: .bold).monospacedDigit())
                    .foregroundStyle(KioskText.primary)
                    .contentTransition(.numericText())
            }
            .frame(width: 96, height: 96)
        }
        .accessibilityHidden(true)
    }
}
