import Network
import Observation

@MainActor
@Observable
final class NetworkMonitor {
    var isConnected = true

    /// Incremented each time connectivity is restored after a real gap.
    ///
    /// Views observe this rather than `isConnected` so a refetch fires on the
    /// offline → online transition only. `NWPathMonitor` reports every path
    /// change, including interface swaps that keep the connection satisfied
    /// throughout; observing `isConnected` directly would refetch on those too.
    private(set) var reconnectionToken = 0

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.wisconsin.network-monitor")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let connected = path.status == .satisfied
                guard connected != self.isConnected else { return }
                self.isConnected = connected
                if connected { self.reconnectionToken += 1 }
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}
