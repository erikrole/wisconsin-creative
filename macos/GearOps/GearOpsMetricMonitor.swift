import Foundation
import MetricKit

/// Menu bar app crash, hang, and resource reports. MetricKit delivers them on
/// a later launch; each is uploaded with the companion credential and the API
/// calls from the runs before, so a crash can be tied to what the app was doing.
final class GearOpsMetricMonitor: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = GearOpsMetricMonitor()

    private let lock = NSLock()
    private var started = false

    func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
        DiagnosticBreadcrumbs.shared.record(.lifecycle, "Menu bar app launched")
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let reports = payloads.map { $0.jsonRepresentation() }
        Task {
            // Signed out means nobody to tie the report to; it is dropped.
            guard let credential = try? await CompanionCredentialStore().loadToken() else { return }
            let client = GearOpsClient()
            for report in reports {
                await client.uploadDiagnostics(report, credential: credential)
            }
        }
    }
}
