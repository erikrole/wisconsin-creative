import Foundation

/// One page of `GET /api/assets/:id/activity`.
///
/// Staff and admin only. The website History tab uses the same route, with
/// `scope` of `all`, `asset` (item updates), or `booking`. A row that cannot
/// be read is skipped so one odd audit payload does not blank the screen.
struct AssetActivityPage: Decodable, Sendable {
    let entries: [AssetActivityEntry]
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey {
        case data
        case nextCursor
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rows = try container.decodeIfPresent([LenientAssetActivityRow].self, forKey: .data) ?? []
        entries = rows.compactMap(\.entry)
        nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
    }
}

enum AssetActivityScope: String, CaseIterable, Identifiable {
    case all
    case asset
    case booking

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .asset: "Item updates"
        case .booking: "Bookings"
        }
    }
}

struct AssetActivityEntry: Identifiable, Equatable, Sendable {
    let id: String
    let action: String
    let entityType: String
    let entityId: String
    let createdAt: Date
    let actorName: String?
    let hasAfter: Bool
    let before: [String: AuditJSON]
    let after: [String: AuditJSON]
    let entityLabel: String?
    let entityKind: String?

    var actorLabel: String {
        if let actorName { return actorName }
        if ItemActivityCopy.systemActions.contains(action) { return "System" }
        return "Unknown user"
    }

    var linksToBooking: Bool {
        entityType == "booking" && !entityId.isEmpty
    }
}

extension AssetActivityEntry: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id
        case action
        case entityType
        case entityId
        case createdAt
        case actor
        case beforeJson
        case afterJson
        case entity
    }

    private struct ActivityActor: Decodable {
        let name: String?
    }

    private struct ActivityEntity: Decodable {
        let label: String?
        let kind: String?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        entityType = try container.decode(String.self, forKey: .entityType)
        entityId = try container.decode(String.self, forKey: .entityId)
        let rawDate = try container.decode(String.self, forKey: .createdAt)
        guard let createdAt = ItemActivityDate.parse(rawDate) else {
            throw DecodingError.dataCorruptedError(
                forKey: .createdAt,
                in: container,
                debugDescription: "Activity createdAt is not an ISO-8601 date"
            )
        }
        self.createdAt = createdAt
        let actor = (try? container.decodeIfPresent(ActivityActor.self, forKey: .actor)) ?? nil
        actorName = actor?.name?.nonBlankText
        let beforePayload = (try? container.decodeIfPresent(AuditJSON.self, forKey: .beforeJson)) ?? nil
        before = beforePayload?.object ?? [:]
        let afterPayload = (try? container.decodeIfPresent(AuditJSON.self, forKey: .afterJson)) ?? nil
        if let afterPayload, afterPayload != .null {
            hasAfter = true
            after = afterPayload.object ?? [:]
        } else {
            hasAfter = false
            after = [:]
        }
        let entity = (try? container.decodeIfPresent(ActivityEntity.self, forKey: .entity)) ?? nil
        entityLabel = entity?.label?.nonBlankText
        entityKind = entity?.kind?.nonBlankText
    }
}

private struct LenientAssetActivityRow: Decodable {
    let entry: AssetActivityEntry?

    init(from decoder: Decoder) throws {
        entry = try? AssetActivityEntry(from: decoder)
    }
}

indirect enum AuditJSON: Decodable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AuditJSON])
    case array([AuditJSON])
    case null

    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var object: [String: AuditJSON]? {
        if case .object(let value) = self { return value }
        return nil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([AuditJSON].self) {
            self = .array(value)
            return
        }
        if let value = try? container.decode([String: AuditJSON].self) {
            self = .object(value)
            return
        }
        self = .null
    }
}

enum ItemActivityDate {
    static func parse(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        return ISO8601DateFormatter().date(from: raw)
    }
}

struct ItemActivityDay: Identifiable {
    let id: String
    let title: String
    var entries: [AssetActivityEntry]
}

/// Sentences for the item History tab. The website builds the same lines in
/// `describeAction` (`src/lib/activity-timeline.ts`) with an item context.
enum ItemActivityCopy {
    static let systemActions: Set<String> = [
        "auto_escalation",
        "cron_notification",
        "auto_complete",
    ]

    enum Tone {
        case neutral
        case caution
        case problem
    }

    static func tone(for action: String) -> Tone {
        switch action {
        case "cancelled", "cancel", "deleted", "retired", "retire":
            return .problem
        case "marked_maintenance", "items_returned_partial", "partial_return_recorded",
             "partial_checkin", "partial_bulk_checkin", "accessory_detached",
             "image_deleted", "asset_image_removed", "bulk_sku_image_removed":
            return .caution
        default:
            return .neutral
        }
    }

    static func isPhantom(_ entry: AssetActivityEntry) -> Bool {
        guard diffActions.contains(entry.action), entry.hasAfter else { return false }
        return changes(for: entry).isEmpty
    }

    static func sentence(for entry: AssetActivityEntry, itemName: String) -> String {
        let target = itemName.nonBlankText ?? "this item"
        switch entry.action {
        case "created", "create", "booking.created", "asset_created":
            if entry.entityType == "booking" {
                return "Created \(bookingPhrase(entry, fallback: "a booking"))"
            }
            return "Created this item"
        case "updated", "update":
            return "Updated details"
        case "edit":
            return entry.entityType == "booking" ? "Updated booking" : "Updated details"
        case "owner_transferred":
            if let name = text(entry.after, "requesterName") {
                return "Transferred ownership to \(name)"
            }
            return "Transferred ownership"
        case "events_updated":
            return "Updated linked events"
        case "extended", "extend":
            let what = bookingPhrase(entry, fallback: "the checkout")
            if let raw = text(entry.after, "endsAt"), let when = formatWhen(raw) {
                return "Extended \(what) to \(when)"
            }
            return "Extended \(what)"
        case "cancelled", "cancel":
            return "Cancelled \(bookingPhrase(entry, fallback: "the booking"))"
        case "deleted":
            return "Deleted \(target)"
        case "retired", "retire":
            return "Retired \(target)"
        case "checkin_completed":
            return "Completed check-in"
        case "checkin_items":
            return "Checked in items"
        case "checkout_completed":
            return "Completed checkout"
        case "checkout_scan_completed", "scan_completed":
            return "Completed scan"
        case "cancelled_by_checkout_conversion":
            return "Converted reservation to checkout"
        case "items_returned":
            return "All items returned"
        case "items_returned_partial":
            return "Some items returned"
        case "partial_return_recorded", "partial_checkin", "partial_bulk_checkin":
            return "Recorded partial return"
        case "auto_completed_by_partial_checkin":
            return "Auto-completed after partial check-in"
        case "auto_completed_by_kiosk_checkin":
            return "Booking completed by the kiosk return"
        case "auto_completed_by_bulk_checkin":
            return "Booking completed by the bulk return"
        case "marked_maintenance":
            return "Marked as needs maintenance"
        case "cleared_maintenance":
            return "Cleared maintenance status"
        case "duplicated", "duplicate":
            return "Duplicated \(target)"
        case "qr_generated":
            return "Generated new QR code"
        case "admin_override":
            return "Admin override"
        case "auto_escalation":
            return "System auto-escalated overdue notification"
        case "cron_notification":
            return "System sent scheduled notification"
        case "auto_complete":
            return "System auto-completed"
        case "booking.items_added":
            if let counts = equipmentCounts(entry.after) {
                return "Added \(counts)"
            }
            return "Added items"
        case "booking.items_removed":
            if let counts = equipmentCounts(entry.before) {
                return "Removed \(counts)"
            }
            return "Removed items"
        case "booking.items_qty_changed":
            return "Changed item quantities"
        case "booking.item_substituted":
            return "Swapped a reserved item for the one scanned at pickup"
        case "bulk_move_location":
            return "Moved location"
        case "accessory_attached":
            if let name = text(entry.after, "name") ?? text(entry.after, "accessoryName") {
                return "Attached item \"\(name)\""
            }
            return "Attached an item"
        case "accessory_detached":
            if let name = text(entry.before, "name") ?? text(entry.before, "accessoryName") {
                return "Detached item \"\(name)\""
            }
            return "Detached an item"
        case "accessory_moved":
            if let name = text(entry.after, "name") ?? text(entry.after, "accessoryName") {
                return "Moved attachment \"\(name)\" to another item"
            }
            return "Moved an attachment to another item"
        case "image_uploaded", "asset_image_uploaded", "bulk_sku_image_uploaded":
            return "Uploaded a photo"
        case "image_deleted", "asset_image_removed", "bulk_sku_image_removed":
            return "Removed the photo"
        case "asset_image_set", "bulk_sku_image_set":
            return "Set the photo"
        case "favorite_added":
            return "Added to favorites"
        case "favorite_removed":
            return "Removed from favorites"
        case "reactivated":
            return "Reactivated \(target)"
        case "csv_import":
            return "Imported via CSV"
        case "convert_to_numbered":
            return "Converted to numbered units"
        case "adjust":
            return "Adjusted stock quantity"
        case "add_units":
            return "Added units"
        case "mark_labels_printed":
            return "Marked labels as printed"
        case "bulk_units_auto_lost":
            return "System marked overdue units as lost"
        case "repair_stale_checked_out":
            return "Repaired stale checked-out units"
        case "kiosk_pickup":
            return "Picked up \(bookingPhrase(entry, fallback: "gear")) at a kiosk"
        case "kiosk_checkout":
            return "Checked out \(bookingPhrase(entry, fallback: "gear")) at a kiosk"
        case "kiosk_checkin":
            let gear = itemNames(entry.after) ?? bookingPhrase(entry, fallback: "gear")
            return "Returned \(gear) at \(kioskPhrase(entry.after))"
        case "kiosk_checkout_updated":
            return "Updated the checkout at a kiosk"
        case "kiosk_checkout_item_added":
            return "Added \(auditItemName(entry.after) ?? "an item") at \(kioskPhrase(entry.after))"
        case "kiosk_checkout_item_removed":
            return "Removed \(auditItemName(entry.before) ?? "an item") at \(kioskPhrase(entry.before))"
        case "checkout_item_added":
            return "Added \(auditItemName(entry.after) ?? "an item") to the active checkout"
        case "checkout_item_removed":
            return "Removed \(auditItemName(entry.before) ?? "an item") from the active checkout"
        case "auto_completed_by_item_removal":
            return "Checkout closed after its last item was removed"
        case "pending_pickup_expired":
            return "Pickup window expired"
        case "fulfilled_by_kiosk_pickup":
            return "Fulfilled by kiosk pickup"
        case "partially_fulfilled_by_kiosk_pickup":
            return "Recorded partial kiosk pickup"
        case "admin_force_completed_checkout":
            return "Closed the checkout without a scan"
        case "admin_force_checkout":
            return "Force-checked out the reservation without a kiosk scan"
        case "reservation_closed_remaining_released":
            return "Closed the reservation and released the gear that was never picked up"
        case "completed_after_plan_edit":
            return "Completed the reservation after the remaining gear was removed"
        case "scan_checkout":
            return "Scanned out for \(bookingPhrase(entry, fallback: "a checkout"))"
        case "scan_checkin":
            return "Scanned back in from \(bookingPhrase(entry, fallback: "a return"))"
        case "kiosk_checkout_item_swapped":
            if let from = auditItemName(entry.before), let to = auditItemName(entry.after) {
                return "Swapped \(from) for \(to) at \(kioskPhrase(entry.after))"
            }
            return "Swapped an item at \(kioskPhrase(entry.after))"
        case "nudge_sent", "overdue_nudge_sent":
            return "Sent a reminder"
        default:
            return humanize(entry.action)
        }
    }

    static func detail(for entry: AssetActivityEntry) -> String? {
        let rows = changes(for: entry)
        guard !rows.isEmpty else { return nil }
        let shown = rows.prefix(3)
        var line = shown.joined(separator: " · ")
        let extra = rows.count - shown.count
        if extra > 0 {
            line += " · and \(extra) more"
        }
        return line
    }

    static func days(from entries: [AssetActivityEntry], now: Date = .now) -> [ItemActivityDay] {
        var result: [ItemActivityDay] = []
        for entry in entries {
            let title = dayTitle(for: entry.createdAt, now: now)
            if let index = result.indices.last, result[index].title == title {
                result[index].entries.append(entry)
            } else {
                result.append(ItemActivityDay(id: entry.id, title: title, entries: [entry]))
            }
        }
        return result
    }

    static func dayTitle(for date: Date, now: Date = .now) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = NotificationPrefsViewModel.appTimeZone
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        return date.formatted(dayStyle)
    }

    static func timeLabel(_ date: Date) -> String {
        date.formatted(timeStyle)
    }

    private static let diffActions: Set<String> = [
        "updated", "update", "owner_transferred", "profile_update", "profile_updated", "role_changed",
    ]

    private static let hiddenFields: Set<String> = [
        "_actorRole", "actorRole", "_actorId", "actorId", "_actorEmail", "actorEmail",
        "_actorName", "actorName", "updatedAt", "createdAt", "id", "organizationId",
        "sourcePayload", "cheqroomName", "fiscalYear", "fiscalYearPurchased",
        "consumable", "trackByNumber",
    ]

    private static let idFields: Set<String> = [
        "categoryId", "departmentId", "locationId", "requesterUserId", "parentAssetId",
    ]

    private static let dateKeys: Set<String> = [
        "startsAt", "endsAt", "purchaseDate", "warrantyDate", "startDate",
    ]

    private static let fieldLabels: [String: String] = [
        "title": "Title",
        "name": "Item name",
        "brand": "Brand",
        "model": "Model",
        "assetTag": "Asset tag",
        "serialNumber": "Serial number",
        "notes": "Notes",
        "status": "Status",
        "startsAt": "Start date",
        "endsAt": "End date",
        "locationId": "Location",
        "categoryId": "Category",
        "departmentId": "Department",
        "requesterUserId": "Requester",
        "parentAssetId": "Parent item",
        "purchasePrice": "Purchase price",
        "purchaseDate": "Purchase date",
        "warrantyDate": "Warranty date",
        "residualValue": "Residual value",
        "linkUrl": "Link",
        "qrCodeValue": "QR code",
        "availableForReservation": "Reservation availability",
        "availableForCheckout": "Checkout availability",
        "availableForCustody": "Custody availability",
        "imageUrl": "Image",
    ]

    private static let statusLabels: [String: String] = [
        "DRAFT": "Draft",
        "BOOKED": "Reserved",
        "PENDING_PICKUP": "Pending pickup",
        "OPEN": "Checked out",
        "COMPLETED": "Completed",
        "CANCELLED": "Cancelled",
        "AVAILABLE": "Available",
        "CHECKED_OUT": "Checked out",
        "MAINTENANCE": "Maintenance",
        "RESERVED": "Reserved",
        "RETIRED": "Retired",
    ]

    private static func changes(for entry: AssetActivityEntry) -> [String] {
        guard diffActions.contains(entry.action) else { return [] }
        return entry.after.keys.sorted().compactMap { key in
            fieldChange(key: key, before: entry.before[key], after: entry.after[key])
        }
    }

    private static func fieldChange(key: String, before: AuditJSON?, after: AuditJSON?) -> String? {
        if hiddenFields.contains(key) { return nil }
        if isCollection(before) || isCollection(after) { return nil }
        let label = fieldLabels[key] ?? key
        if idFields.contains(key) {
            let hadBefore = !isBlank(before)
            let hasAfter = !isBlank(after)
            if !hadBefore && hasAfter { return "\(label): set" }
            if hadBefore && !hasAfter { return "\(label): removed" }
            return "\(label): changed"
        }
        if let after, case .bool(let flag) = after {
            return "\(label): \(flag ? "enabled" : "disabled")"
        }
        if let raw = after?.string?.trimmingCharacters(in: .whitespacesAndNewlines),
           raw == "true" || raw == "false" {
            return "\(label): \(raw == "true" ? "enabled" : "disabled")"
        }
        let from = display(before, key: key)
        let to = display(after, key: key)
        if from.isEmpty && to.isEmpty { return nil }
        if from == to { return nil }
        if from.isEmpty { return "\(label): \(to)" }
        if to.isEmpty { return "\(label): \(from)" }
        return "\(label): \(from) → \(to)"
    }

    private static func display(_ value: AuditJSON?, key: String) -> String {
        guard let value else { return "" }
        switch value {
        case .null, .array, .object:
            return ""
        case .bool(let flag):
            return flag ? "enabled" : "disabled"
        case .number(let number):
            guard number.isFinite else { return "" }
            if number.rounded() == number { return String(Int(number)) }
            return String(number)
        case .string(let raw):
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty || looksLikeImport(trimmed) { return "" }
            if dateKeys.contains(key), let formatted = formatWhen(trimmed) { return formatted }
            if key == "status" { return statusLabels[trimmed] ?? trimmed }
            if trimmed.count > 80 { return String(trimmed.prefix(77)) + "…" }
            return trimmed
        }
    }

    private static func isCollection(_ value: AuditJSON?) -> Bool {
        switch value {
        case .array, .object: return true
        default: return false
        }
    }

    private static func isBlank(_ value: AuditJSON?) -> Bool {
        switch value {
        case nil, .null: return true
        case .string(let raw): return raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default: return false
        }
    }

    private static func looksLikeImport(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{") else { return false }
        return trimmed.contains("cheqroomName") || trimmed.contains("fiscalYear")
    }

    private static func bookingPhrase(_ entry: AssetActivityEntry, fallback: String) -> String {
        guard entry.entityType == "booking", let label = entry.entityLabel else { return fallback }
        let noun: String
        switch entry.entityKind {
        case "RESERVATION": noun = "reservation"
        case "CHECKOUT": noun = "checkout"
        default: noun = "booking"
        }
        return "\(noun) \"\(label)\""
    }

    private static func text(_ fields: [String: AuditJSON], _ key: String) -> String? {
        fields[key]?.string?.nonBlankText
    }

    private static func auditItemName(_ fields: [String: AuditJSON]) -> String? {
        if let name = text(fields, "itemName") { return name }
        if let tag = text(fields, "tagName") { return tag }
        if case .number(let value) = fields["unitNumber"], value.isFinite, value.rounded() == value {
            return "unit #\(Int(value))"
        }
        return nil
    }

    private static func itemNames(_ fields: [String: AuditJSON]) -> String? {
        guard case .array(let values) = fields["itemNames"] else { return nil }
        let names = values.compactMap { $0.string?.nonBlankText }
        if names.isEmpty { return nil }
        if names.count == 1 { return names[0] }
        if names.count == 2 { return "\(names[0]) and \(names[1])" }
        let visible = names.prefix(3)
        let remainder = names.count - visible.count
        if remainder > 0 {
            return "\(visible.joined(separator: ", ")), and \(remainder) more"
        }
        return "\(visible.dropLast().joined(separator: ", ")), and \(visible.last ?? "")"
    }

    private static func equipmentCounts(_ fields: [String: AuditJSON]) -> String? {
        var parts: [String] = []
        if case .array(let items) = fields["serializedAssetIds"] {
            let count = items.count
            parts.append("\(count) serialized item\(count == 1 ? "" : "s")")
        }
        if case .array(let items) = fields["bulkItems"] {
            let count = items.count
            parts.append("\(count) item famil\(count == 1 ? "y" : "ies")")
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private static func kioskPhrase(_ fields: [String: AuditJSON]) -> String {
        if let name = text(fields, "kioskName") { return "the \(name)" }
        return "a kiosk"
    }

    private static func formatWhen(_ raw: String) -> String? {
        guard let date = ItemActivityDate.parse(raw) else { return nil }
        return date.formatted(
            Date.FormatStyle(
                date: .abbreviated,
                time: .shortened,
                locale: Locale(identifier: "en_US"),
                timeZone: NotificationPrefsViewModel.appTimeZone
            )
        )
    }

    private static func humanize(_ action: String) -> String {
        let words = action.split { $0 == "." || $0 == "_" }.map(String.init).joined(separator: " ")
        guard let first = words.first else { return "Recorded an update" }
        return first.uppercased() + words.dropFirst()
    }

    private static var dayStyle: Date.FormatStyle {
        Date.FormatStyle(
            date: .long,
            time: .omitted,
            locale: Locale(identifier: "en_US"),
            timeZone: NotificationPrefsViewModel.appTimeZone
        )
    }

    private static var timeStyle: Date.FormatStyle {
        Date.FormatStyle(
            date: .omitted,
            time: .shortened,
            locale: Locale(identifier: "en_US"),
            timeZone: NotificationPrefsViewModel.appTimeZone
        )
    }
}
