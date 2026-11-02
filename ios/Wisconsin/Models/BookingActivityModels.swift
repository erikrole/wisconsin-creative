import Foundation

/// Booking history already returned by `GET /api/bookings/:id`.
///
/// The website renders `auditLogs` (newest 50) for students, staff, and admins.
/// Collaborator responses omit the field, and the phone does not ask. A row
/// with an unreadable time is skipped so the rest of the history still loads.
struct BookingActivityPage: Decodable {
    var auditLogs: [BookingActivityEntry]?
    var hasMoreAuditLogs: Bool?

    private enum CodingKeys: String, CodingKey {
        case auditLogs, hasMoreAuditLogs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        hasMoreAuditLogs = try container.decodeIfPresent(Bool.self, forKey: .hasMoreAuditLogs)
        // One unreadable row is dropped. A throw from the entry would reject the page.
        let wrapped = try container.decodeIfPresent([OptionalBookingActivityEntry].self, forKey: .auditLogs)
        auditLogs = wrapped?.compactMap(\.entry)
    }
}

/// Decodes one history row without letting that row fail the rest of the list.
private struct OptionalBookingActivityEntry: Decodable {
    var entry: BookingActivityEntry?

    init(from decoder: Decoder) throws {
        entry = try? BookingActivityEntry(from: decoder)
    }
}

struct BookingActivityActor: Decodable, Hashable {
    var id: String
    var name: String
    var avatarUrl: String?
}

struct BookingActivityEntry: Decodable, Identifiable {
    var id: String
    var action: String
    var createdAt: Date
    var actor: BookingActivityActor?
    var beforeJson: BookingActivityJSON?
    var afterJson: BookingActivityJSON?

    enum CodingKeys: String, CodingKey {
        case id, action, createdAt, actor, beforeJson, afterJson
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        // The app decoder's plain `.iso8601` strategy rejects fractional seconds
        // (`2026-10-18T14:58:00.123Z`) on some toolchains and would blank the list.
        let rawCreatedAt = try container.decode(String.self, forKey: .createdAt)
        guard let createdAt = BookingActivityDate.parse(rawCreatedAt) else {
            throw DecodingError.dataCorruptedError(
                forKey: .createdAt,
                in: container,
                debugDescription: "Activity time could not be read"
            )
        }
        self.createdAt = createdAt
        actor = try container.decodeIfPresent(BookingActivityActor.self, forKey: .actor)
        // A missing or non-object payload stays blank. `decode` throws for null,
        // and `try?` keeps that row instead of failing the whole history.
        beforeJson = try? container.decode(BookingActivityJSON.self, forKey: .beforeJson)
        afterJson = try? container.decode(BookingActivityJSON.self, forKey: .afterJson)
    }
}

/// A tolerant read of audit JSON. Unknown shapes are skipped so one odd field
/// cannot blank the whole history.
struct BookingActivityJSON: Decodable, Hashable {
    var strings: [String: String]
    var stringLists: [String: [String]]

    init(strings: [String: String], stringLists: [String: [String]]) {
        self.strings = strings
        self.stringLists = stringLists
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        var strings: [String: String] = [:]
        var stringLists: [String: [String]] = [:]
        for key in container.allKeys {
            if let value = try? container.decode(String.self, forKey: key) {
                strings[key.stringValue] = value
            } else if let value = try? container.decode([String].self, forKey: key) {
                stringLists[key.stringValue] = value
            } else if let value = try? container.decode(Int.self, forKey: key) {
                strings[key.stringValue] = String(value)
            }
        }
        self.strings = strings
        self.stringLists = stringLists
    }

    func string(_ key: String) -> String? {
        guard let value = strings[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        return value
    }
}

enum BookingActivityDate {
    /// Audit timestamps include fractional seconds (`2026-10-18T14:58:00.123Z`).
    /// A plain ISO-8601 parse rejects those on some toolchains.
    static func parse(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

private struct DynamicCodingKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        return nil
    }
}

enum BookingActivityAccess {
    /// Students, staff, and admins read the history embedded on the booking.
    /// Collaborators are omitted from that payload, so the phone does not ask.
    static func canRead(role: String?) -> Bool {
        role == "ADMIN" || role == "STAFF" || role == "STUDENT"
    }
}

enum BookingActivityFilter: String, CaseIterable, Identifiable {
    case all
    case booking
    case gear

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .booking: "Booking changes"
        case .gear: "Equipment changes"
        }
    }
}

enum BookingActivityCopy {
    static let equipmentActions: Set<String> = [
        "booking.items_added",
        "booking.items_removed",
        "booking.items_qty_changed",
        "booking.item_substituted",
        "checkout_item_added",
        "checkout_item_removed",
        "kiosk_checkout_item_added",
        "kiosk_checkout_item_removed",
        "kiosk_checkout_item_swapped",
        "scan_checkout",
        "scan_checkin",
    ]

    /// Fields the website hides, plus addresses that do not belong on a phone row.
    static let hiddenFields: Set<String> = [
        "_actorRole", "_actorId", "_actorEmail", "_actorName",
        "updatedAt", "createdAt", "id", "organizationId",
        "requesterEmail",
    ]

    static func rows(_ entries: [BookingActivityEntry], filter: BookingActivityFilter) -> [BookingActivityEntry] {
        let visible = entries.filter { entry in
            guard isVisible(entry) else { return false }
            switch filter {
            case .all:
                return true
            case .gear:
                return equipmentActions.contains(entry.action)
            case .booking:
                return !equipmentActions.contains(entry.action)
            }
        }
        return foldScanBursts(visible)
    }

    /// One person scanning a stack of gear is one row that names every item,
    /// like the website's `coalesceEntries`: same scanner, same direction,
    /// within a minute of the oldest scan already folded in. Newest first.
    static func foldScanBursts(_ entries: [BookingActivityEntry]) -> [BookingActivityEntry] {
        var out: [BookingActivityEntry] = []
        var oldestInRow: Date?
        for entry in entries {
            if var last = out.last, let oldest = oldestInRow,
               entry.action == "scan_checkout" || entry.action == "scan_checkin",
               last.action == entry.action,
               last.actor?.id == entry.actor?.id,
               abs(oldest.timeIntervalSince(entry.createdAt)) <= 60 {
                let names = last.afterJson?.stringLists["itemNames"] ?? [itemName(last.afterJson) ?? "an item"]
                var strings = last.afterJson?.strings ?? [:]
                strings["quantity"] = nil
                var lists = last.afterJson?.stringLists ?? [:]
                lists["itemNames"] = names + [itemName(entry.afterJson) ?? "an item"]
                last.afterJson = BookingActivityJSON(strings: strings, stringLists: lists)
                out[out.count - 1] = last
                oldestInRow = entry.createdAt
                continue
            }
            out.append(entry)
            oldestInRow = entry.createdAt
        }
        return out
    }

    static func isVisible(_ entry: BookingActivityEntry) -> Bool {
        guard entry.action == "updated" || entry.action == "update" else { return true }
        guard let after = entry.afterJson else { return true }
        return !visibleChanges(before: entry.beforeJson, after: after).isEmpty
    }

    static func actorName(_ entry: BookingActivityEntry) -> String {
        let name = entry.actor?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "System" : name
    }

    static func sentence(_ entry: BookingActivityEntry) -> String {
        switch entry.action {
        case "created", "create", "booking.created":
            return "Created this booking"
        case "updated", "update":
            return updateSentence(entry)
        case "owner_transferred":
            if let name = entry.afterJson?.string("requesterName") {
                return "Transferred ownership to \(name)"
            }
            return "Transferred ownership"
        case "serialized_item_holder_changed":
            return "Changed who is holding an item"
        case "serialized_item_transferred_out":
            return "Moved an item to another checkout"
        case "serialized_item_transferred_in":
            return "Received an item from another checkout"
        case "events_updated":
            return "Updated linked events"
        case "extended", "extend":
            if let when = timestamp(entry.afterJson?.string("endsAt")) {
                return "Extended the checkout to \(when)"
            }
            return "Extended the checkout"
        case "cancelled", "cancel":
            return "Cancelled the booking"
        case "checkin_completed":
            return "Completed check-in"
        case "admin_force_completed_checkout":
            return "Closed the checkout without a scan"
        case "admin_force_checkout":
            return "Force-checked out the reservation without a kiosk scan"
        case "reservation_closed_remaining_released":
            return "Closed the reservation and released the gear that was never picked up"
        case "reservation_picked_items_moved_to_checkout":
            return "Moved picked-up gear onto its checkout"
        case "kiosk_pickup_appended":
            return "Added more pickup items to the checkout"
        case "kiosk_pickup_item_added":
            return "Added an extra item during pickup"
        case "completed_after_plan_edit":
            return "Completed the reservation after the remaining gear was removed"
        case "booking.item_substituted":
            return "Swapped a reserved item for the one scanned at pickup"
        case "cancelled_by_checkout_conversion":
            return "Converted the reservation to a checkout"
        case "booking.items_added":
            return gearCount("Added", entry.afterJson)
        case "booking.items_removed":
            return gearCount("Removed", entry.beforeJson)
        case "booking.items_qty_changed":
            return "Changed item quantities"
        case "kiosk_checkout":
            return "Checked out gear\(kioskPhrase(entry.afterJson))"
        case "kiosk_checkout_updated":
            return "Updated the checkout\(kioskPhrase(entry.afterJson))"
        case "kiosk_checkin":
            return "Checked in gear\(kioskPhrase(entry.afterJson))"
        case "kiosk_return":
            return "Returned gear\(kioskPhrase(entry.afterJson))"
        case "kiosk_pickup":
            return "Picked up gear\(kioskPhrase(entry.afterJson))"
        case "auto_completed_by_kiosk_checkin":
            return "Completed the booking by returning at a kiosk"
        case "auto_completed_by_bulk_checkin":
            return "Completed the booking by bulk return"
        case "auto_completed_by_partial_checkin":
            return "Completed the booking after a partial return"
        case "reservation_consolidated":
            return "Added gear to the existing reservation"
        case "reservations_merged":
            return "Combined matching reservations"
        case "merged_into_reservation":
            return "Combined this reservation into another gear plan"
        case "nudge_sent", "overdue_nudge_sent":
            return "Sent a reminder"
        case "items_returned":
            return "All items returned"
        case "items_returned_partial", "partial_return_recorded", "partial_checkin", "partial_bulk_checkin":
            return "Recorded a partial return"
        case "pending_pickup_expired":
            return "Pickup window expired"
        case "fulfilled_by_kiosk_pickup":
            return "Fulfilled by kiosk pickup"
        case "partially_fulfilled_by_kiosk_pickup":
            return "Recorded a partial kiosk pickup"
        // Item edits on an active checkout and every scan (web #721, #724).
        case "checkout_item_added":
            return "Added \(itemName(entry.afterJson) ?? "an item") to the active checkout"
        case "checkout_item_removed":
            return "Removed \(itemName(entry.beforeJson) ?? "an item") from the active checkout"
        case "auto_completed_by_item_removal":
            return "Checkout closed after its last item was removed"
        case "kiosk_checkout_item_added":
            return "Added \(itemName(entry.afterJson) ?? "an item")\(kioskPhrase(entry.afterJson))"
        case "kiosk_checkout_item_removed":
            return "Removed \(itemName(entry.beforeJson) ?? "an item")\(kioskPhrase(entry.beforeJson))"
        case "kiosk_checkout_item_swapped":
            if let from = itemName(entry.beforeJson), let to = itemName(entry.afterJson) {
                return "Swapped \(from) for \(to)\(kioskPhrase(entry.afterJson))"
            }
            return "Swapped an item\(kioskPhrase(entry.afterJson))"
        case "scan_checkout", "scan_checkin":
            let item = itemList(entry.afterJson) ?? itemName(entry.afterJson) ?? "an item"
            let quantity = entry.afterJson?.string("quantity").map { " ×\($0)" } ?? ""
            return entry.action == "scan_checkout"
                ? "Scanned out \(item)\(quantity)"
                : "Scanned in \(item)\(quantity)"
        case "admin_override":
            if let reason = entry.afterJson?.string("reason") {
                return "Overrode a scan check: \(reason)"
            }
            return "Overrode a scan check"
        case "custody_scope_changed":
            return "Changed who can hold this gear"
        case "kiosk_checkin_scan_undone":
            return "Undid a return scan at a kiosk"
        case "kiosk_pickup_scan_removed":
            return "Removed a scan at kiosk pickup"
        case "kiosk_quantity_returned":
            return "Returned a quantity at a kiosk"
        case "checkin_report_unit_damaged":
            return "Reported a unit damaged at return"
        case "checkin_report_unit_lost":
            return "Reported a unit lost at return"
        case "reservation_leftover_expired":
            return "Released gear that was never picked up"
        default:
            return humanized(entry.action)
        }
    }

    static func detail(_ entry: BookingActivityEntry) -> String? {
        guard entry.action == "updated" || entry.action == "update", let after = entry.afterJson else {
            return nil
        }
        let changes = visibleChanges(before: entry.beforeJson, after: after)
        guard changes.count > 1 else { return nil }
        return changes.map(fieldLabel).joined(separator: ", ")
    }

    static func when(_ date: Date, now: Date = .now) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }

    private static func updateSentence(_ entry: BookingActivityEntry) -> String {
        guard let after = entry.afterJson else { return "Updated details" }
        let changes = visibleChanges(before: entry.beforeJson, after: after)
        guard changes.count == 1, let field = changes.first else { return "Updated details" }
        switch field {
        case "title":
            if let title = after.string("title") {
                return "Updated the name to \(title)"
            }
            return "Updated the name"
        case "notes":
            return "Updated notes"
        case "endsAt":
            if let when = timestamp(after.string("endsAt")) {
                return "Changed the return time to \(when)"
            }
            return "Changed the return time"
        case "startsAt":
            if let when = timestamp(after.string("startsAt")) {
                return "Changed the pickup time to \(when)"
            }
            return "Changed the pickup time"
        case "requesterUserId":
            return "Changed the requester"
        default:
            return "Updated \(fieldLabel(field).lowercased())"
        }
    }

    private static func visibleChanges(before: BookingActivityJSON?, after: BookingActivityJSON) -> [String] {
        let keys = Set(after.strings.keys).union(after.stringLists.keys)
        return keys
            .filter { key in
                guard !hiddenFields.contains(key) else { return false }
                let next = after.strings[key] ?? after.stringLists[key]?.joined(separator: ",") ?? ""
                let previous = before?.strings[key] ?? before?.stringLists[key]?.joined(separator: ",") ?? ""
                return next != previous
            }
            .sorted()
    }

    private static func fieldLabel(_ key: String) -> String {
        switch key {
        case "title": "Name"
        case "notes": "Notes"
        case "startsAt": "Pickup"
        case "endsAt": "Return"
        case "locationId": "Location"
        case "requesterUserId": "Requester"
        default: humanized(key)
        }
    }

    private static func gearCount(_ verb: String, _ json: BookingActivityJSON?) -> String {
        let count = json?.stringLists["serializedAssetIds"]?.count ?? 0
        if count == 1 { return "\(verb) 1 item" }
        if count > 1 { return "\(verb) \(count) items" }
        return "\(verb) gear"
    }

    /// Same order as the website's `auditItemName`: name, then tag, then unit.
    private static func itemName(_ json: BookingActivityJSON?) -> String? {
        if let name = json?.string("itemName") ?? json?.string("tagName") { return name }
        if let unit = json?.string("unitNumber") { return "unit #\(unit)" }
        return nil
    }

    /// "ROAM2, SLOW1, and 3 more", the website's `formatAuditItemNames`.
    private static func itemList(_ json: BookingActivityJSON?) -> String? {
        let names = (json?.stringLists["itemNames"] ?? []).compactMap(\.nonBlankText)
        switch names.count {
        case 0: return nil
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        case 3: return "\(names[0]), \(names[1]), and \(names[2])"
        default: return "\(names.prefix(3).joined(separator: ", ")), and \(names.count - 3) more"
        }
    }

    private static func kioskPhrase(_ json: BookingActivityJSON?) -> String {
        if let name = json?.string("kioskName") {
            return " at \(name)"
        }
        return " at a kiosk"
    }

    private static func timestamp(_ raw: String?) -> String? {
        guard let raw, let date = BookingActivityDate.parse(raw) else { return nil }
        return date.gearShort
    }

    private static func humanized(_ raw: String) -> String {
        let cleaned = raw.replacingOccurrences(of: ".", with: " ").replacingOccurrences(of: "_", with: " ")
        guard let first = cleaned.first else { return "Updated details" }
        return first.uppercased() + cleaned.dropFirst()
    }
}
