import Foundation

/// Removes the SwiftData "GearCache" store that earlier builds wrote.
///
/// Nothing reads that cache any more (Bookings and Schedule refetch instead
/// of showing stale rows), but installs that already have the files would
/// otherwise keep a previous account's bookings and assets on disk. Runs once
/// per install and is safe to call on every launch.
enum LegacyGearCache {
    private static let purgedKey = "WisconsinLegacyGearCachePurged"

    static func purgeIfNeeded(
        defaults: UserDefaults = .standard,
        directory: URL? = nil
    ) {
        guard !defaults.bool(forKey: purgedKey) else { return }
        let fileManager = FileManager.default
        guard let root = directory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let names = try? fileManager.contentsOfDirectory(atPath: root.path)
        else {
            defaults.set(true, forKey: purgedKey)
            return
        }
        // The store plus its SQLite -shm and -wal companions. The fallback
        // configuration was in memory only and never wrote files.
        for name in names where name.hasPrefix("GearCache") {
            try? fileManager.removeItem(at: root.appendingPathComponent(name))
        }
        defaults.set(true, forKey: purgedKey)
    }
}
