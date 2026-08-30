import Foundation
import GameController
import Observation
import OSLog

enum KioskFlowAction: String, Codable, CaseIterable { case checkout, pickup, `return`, manage }
enum KioskFlowSource: String, Codable, CaseIterable { case scan, event, person, reservation, activeCheckout }

struct KioskIntentEvent: Equatable { let id: String; let title: String; let endsAt: Date? }
struct KioskIntentBooking: Equatable { let id: String; let title: String; let startsAt: Date?; let endsAt: Date? }
enum KioskIntentAmbiguity: Equatable { case none; case unresolved(String) }

struct KioskFlowIntent: Equatable {
    var action: KioskFlowAction
    var source: KioskFlowSource
    var identifiedUser: KioskUser?
    var expectedRequester: KioskUser?
    var selectedEvent: KioskIntentEvent?
    var targetBooking: KioskIntentBooking?
    var pendingScanValues: [String]
    let createdAt: Date
    var ambiguity: KioskIntentAmbiguity

    var heroTitle: String {
        let verb = switch action {
        case .checkout: "Checking out"
        case .pickup: "Picking up"
        case .return: "Returning gear"
        case .manage: "Managing checkout"
        }
        return (selectedEvent?.title ?? targetBooking?.title).map { "\(verb) for \($0)" } ?? verb
    }
}

enum KioskIntentCleanupReason: String { case cancel, timeout, success, deactivation, deletedTarget }

enum KioskFlowIntentReducer {
    static func identify(_ user: KioskUser, in intent: KioskFlowIntent) -> KioskFlowIntent {
        var next = intent; next.identifiedUser = user; next.ambiguity = .none; return next
    }
    static func canIdentify(_ user: KioskUser, for intent: KioskFlowIntent) -> Bool {
        intent.expectedRequester?.id == nil || intent.expectedRequester?.id == user.id
    }
    static func consumePendingScans(in intent: KioskFlowIntent) -> (intent: KioskFlowIntent, scans: [String]) {
        var next = intent; let scans = next.pendingScanValues; next.pendingScanValues.removeAll(); return (next, scans)
    }
}

enum KioskScannerOwner: String, CaseIterable { case none, home, identity, operatorHub, checkout, pickup, `return`, detail }
/// `disconnected` means no HID keyboard is attached at all — the scanner is
/// off, asleep, or out of Bluetooth range. `reconnecting` means hardware is
/// present but the hidden sink does not currently hold first responder.
enum KioskScannerConnectionState: String { case ready, reconnecting, disconnected }

@Observable @MainActor
final class KioskScannerCoordinator {
    private static let logger = Logger(subsystem: "com.erikrole.WisconsinKiosk", category: "FlowRouting")
    var owner: KioskScannerOwner = .none
    /// Set from `GCKeyboard` connect/disconnect. A Bluetooth barcode scanner in
    /// its normal HID mode enumerates as a hardware keyboard, so this is the
    /// only signal iPadOS gives us that the gun is actually paired and awake.
    var hardwareConnected = false
    var isEditing = false
    var lastScanAt: Date?
    var notice: String?
    @ObservationIgnored private var scanHandler: ((String) -> Void)?
    @ObservationIgnored private var isMonitoringHardware = false

    /// Derived, not stored. This was a stored property fixed at `.ready` that
    /// nothing ever wrote, so "Scanner reconnecting" could not appear and the
    /// kiosk claimed a scanner was ready with nothing plugged in.
    var connectionState: KioskScannerConnectionState {
        hardwareConnected ? .ready : .disconnected
    }

    var statusText: String {
        if isEditing { return "Scanner paused while editing" }
        switch connectionState {
        case .disconnected: return "No scanner connected"
        case .reconnecting: return "Scanner reconnecting"
        case .ready: return "Scanner ready"
        }
    }
    var statusSymbol: String {
        if isEditing { return "pause.circle.fill" }
        switch connectionState {
        case .disconnected: return "barcode.viewfinder"
        case .reconnecting: return "arrow.triangle.2.circlepath"
        case .ready: return "barcode.viewfinder"
        }
    }
    /// Deliberately NOT gated on `connectionState`. Hardware detection is a
    /// display signal, not an authorization one: the camera fallback and typed
    /// entry also route through `receive`, and a scanner that reports itself
    /// oddly must never cause a real scan to be dropped on the floor. If bytes
    /// arrive, something scanned them.
    var acceptsScans: Bool { owner != .none && !isEditing }

    /// True when the scanner has nothing to report. The global shell pill hides
    /// itself in this state: a permanent "Scanner ready" badge is noise on a
    /// counter iPad, and it duplicated the per-screen readiness badge that scan
    /// screens already own. Problems still surface everywhere, immediately.
    var isNominal: Bool { !isEditing && connectionState == .ready }

    /// Starts watching for HID keyboard connect/disconnect. Safe to call more
    /// than once; the observers are registered a single time.
    func startHardwareMonitoring() {
        guard !isMonitoringHardware else { return }
        isMonitoringHardware = true
        hardwareConnected = GCKeyboard.coalesced != nil

        let center = NotificationCenter.default
        center.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.hardwareConnected = true
                Self.logger.notice("scanner hardware connected")
            }
        }
        center.addObserver(forName: .GCKeyboardDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.hardwareConnected = GCKeyboard.coalesced != nil
                Self.logger.notice("scanner hardware disconnected")
            }
        }
    }

    func claim(_ owner: KioskScannerOwner, handler: @escaping (String) -> Void) {
        self.owner = owner; scanHandler = handler
        Self.logger.debug("scanner owner=\(owner.rawValue, privacy: .public)")
    }
    func release(_ owner: KioskScannerOwner) {
        guard self.owner == owner else { return }
        self.owner = .none; scanHandler = nil
        Self.logger.debug("scanner released owner=\(owner.rawValue, privacy: .public)")
    }
    func receive(_ value: String) {
        guard acceptsScans else { return }
        lastScanAt = Date(); Self.logger.info("scan received owner=\(self.owner.rawValue, privacy: .public)"); scanHandler?(value)
    }
    func setEditing(_ editing: Bool) { isEditing = editing }
    func rejectEditingBurst() { notice = "Finish editing before scanning"; Self.logger.notice("scanner burst rejected during editing") }
}
