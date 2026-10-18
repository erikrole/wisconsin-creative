import Foundation

/// Booking history already returned by `GET /api/bookings/:id`.
///
/// The website renders `auditLogs` (newest 50) for students, staff, and admins.
/// Collaborator responses omit the field, and the phone does not ask. Optional
/// properties are `var` so synthesized decoding still reads them: a `let` with
/// a default is skipped.
struct BookingActivityPage: Decodable {
    var auditLogs: [BookingActivityEntry]?
    var hasMoreAuditLogs: Bool?
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
        createdAt = try container.decode(Date.self, forKey: .createdAt)
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
    ]

    /// Fields the website hides, plus addresses that do not belong on a phone row.
    static let hiddenFields: Set<String> = [
        "_actorRole", "_actorId", "_actorEmail", "_actorName",
        "updatedAt", "createdAt", "id", "organizationId",
        "requesterEmail",
    ]

    static func rows(_ entries: [BookingActivityEntry], filter: BookingActivityFilter) -> [BookingActivityEntry] {
        entries.filter { entry in
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
        default:
            return humanized(key)
        }
    }

    private static func gearCount(_ verb: String, _ json: BookingActivityJSON?) -> String {
        let count = json?.stringLists["serializedAssetIds"]?.count ?? 0
        if count == 1 { return "\(verb) 1 item" }
        if count > 1 { return "\(verb) \(count) items" }
        return "\(verb) gear"
    }

    private static func kioskPhrase(_ json: BookingActivityJSON?) -> String {
        if let name = json?.string("kioskName") {
            return " at \(name)"
        }
        return " at a kiosk"
    }

    private static func timestamp(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = withFraction.date(from: raw) ?? plain.date(from: raw) else { return nil }
        return date.gearShort
    }

    private static func humanized(_ raw: String) -> String {
        let cleaned = raw.replacingOccurrences(of: ".", with: " ").replacingOccurrences(of: "_", with: " ")
        guard let first = cleaned.first else { return "Updated details" }
        return first.uppercased() + cleaned.dropFirst()
    }
}
