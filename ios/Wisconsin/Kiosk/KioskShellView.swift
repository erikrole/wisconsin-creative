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

    /// What this person actually loses if the kiosk resets, in their words.
    ///
    /// The warning used to say "Tap to keep your scans" everywhere it appeared,
    /// including on the operator hub, where nothing has been scanned — so the
    /// one sentence explaining the stake named something that did not exist.
    private var inactivityStake: String {
        switch store.screen {
        case .checkout(let user):
            let count = store.cart(for: user.id).count
            if count > 0 {
                return "Your \(count) scanned item\(count == 1 ? "" : "s") will be kept for a moment, but this screen will close."
            }
            return "This checkout will close without saving."
        case .pickup, .return:
            return "Your scan progress on this booking will be lost."
        case .operatorHub, .identity:
            return "You'll be signed out of this kiosk session."
        default:
            return "This screen will close."
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
            .transition(screenTransition)

            if store.inactivityWarningVisible {
                InactivityWarningOverlay(
                    atRisk: inactivityStake,
                    onStay: { store.dismissInactivityWarning() },
                    onFinish: { store.finishSessionNow() }
                )
                .transition(.opacity)
            }

            // One keyboard popup for the whole kiosk. Every text field already
            // reports focus through `scanner.setEditing`, so the shell can own
            // this instead of each field mounting its own copy.
            KioskKeyboardHint(isFieldFocused: store.scanner.isEditing)

            // Not during standby: see `KioskStore.isStandbyVisible`.
            if store.isActive, !store.isResuming, store.screen != .activation, !store.isStandbyVisible {
                KioskScannerStatusPill()
                    .padding(20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }

            if store.screen != .activation && !showSystemStatus {
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
                .padding(.leading, 20)
                .padding(.top, 20)
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
        .animation(.easeInOut(duration: 0.2), value: store.inactivityWarningVisible)
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

/// Brief splash shown while a cold-launch session restore is in flight, so the
/// kiosk never flashes the activation numpad to a returning device.
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

private struct InactivityWarningOverlay: View {
    let atRisk: String
    let onStay: () -> Void
    let onFinish: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            KioskScrim.modal.ignoresSafeArea()
            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .fill(Color.kioskRed.opacity(0.14))
                        .frame(width: 64, height: 64)
                    Image(systemName: "clock.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(Color.kioskRed)
                }
                .accessibilityHidden(true)
                Text("Still here?")
                    .font(.title2.bold())
                    .foregroundStyle(KioskText.primary)
                Text(atRisk)
                    .font(.subheadline)
                    .foregroundStyle(KioskText.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
                InactivityCountdown(reduceMotion: reduceMotion)
                    .padding(.horizontal, 30)
                VStack(spacing: 10) {
                    Button {
                        onStay()
                    } label: {
                        Text("Keep going")
                            .font(.headline)
                            .foregroundStyle(KioskText.primary)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(
                                LinearGradient(
                                    colors: [Color.kioskRed, Color.kioskRed.opacity(0.85)],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ),
                                in: RoundedRectangle(cornerRadius: KioskRadius.lg)
                            )
                    }
                    .buttonStyle(.plain)

                    // The counter has a queue. Someone who is finished should
                    // not have to wait out thirty seconds or walk away from a
                    // screen still holding their name for the next person.
                    Button("I'm done", action: onFinish)
                        .font(KioskType.chip)
                        .kioskButtonRole(.secondary)
                        .controlSize(.large)
                        .accessibilityLabel("I'm done — return to the home screen now")
                }
                .padding(.horizontal, 30)
            }
            .padding(40)
            .frame(maxWidth: 460)
            .kioskCard(KioskSurface.modal, radius: KioskRadius.modal, stroke: KioskStroke.strong)
            .shadow(radius: 30)
        }
    }
}

/// The 30 seconds the warning stays up before the kiosk resets, made visible:
/// a draining brand-red capsule, or a plain numeric countdown under Reduce
/// Motion. Purely decorative — the copy above already states the timeout, so
/// this is hidden from accessibility.
private struct InactivityCountdown: View {
    let reduceMotion: Bool
    @State private var appeared = Date()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = max(0, 30 - Int(context.date.timeIntervalSince(appeared).rounded()))
            if reduceMotion {
                Text("\(remaining)s")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(KioskText.secondary)
                    .contentTransition(.numericText())
            } else {
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(KioskStroke.divider)
                    GeometryReader { geo in
                        Capsule()
                            .fill(Color.kioskRed)
                            .frame(width: geo.size.width * CGFloat(remaining) / 30)
                            .animation(.linear(duration: 1), value: remaining)
                    }
                }
                .frame(height: 4)
            }
        }
        .accessibilityHidden(true)
    }
}
