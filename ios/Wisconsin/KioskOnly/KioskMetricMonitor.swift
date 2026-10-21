import Foundation
import MetricKit

/// Kiosk crash, hang, and resource reports. MetricKit delivers them on the
/// next launch, at most once a day; each is uploaded to the kiosk's own
/// diagnostics endpoint with the screens and API calls from the runs before.
final class KioskMetricMonitor: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = KioskMetricMonitor()

    private let lock = NSLock()
    private var started = false

    func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
        DiagnosticBreadcrumbs.shared.record(.lifecycle, "Kiosk launched")
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let reports = payloads.map { $0.jsonRepresentation() }
        Task {
            for report in reports {
                await KioskAPI.shared.kioskUploadDiagnostics(report)
            }
        }
    }
}
