import Foundation

/// One destination map for custom URLs, universal links, App Intents,
/// Control Center, widgets, and every notification family.
///
/// Mutation query parameters are ignored. A tapped link, lock-screen action,
/// or Control never opens Extend, Cancel, or another write sheet.
enum GearTrackerRoute: Equatable {
    case scan
    case search
    case myGear
    case createReservation
    case schedule(myShifts: Bool)
    case booking(String)
    case event(String)
    case item(String)
    case user(String)
    case licenses
    case itemsSearch(String)
    case blast(String)
    case tradeBoard
    case inbox
}

enum GearTrackerRouteParser {
    static func parse(_ url: URL) -> GearTrackerRoute? {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let host = url.host?.lowercased() ?? ""
        let path = url.path

        switch url.scheme?.lowercased() {
        case "wisconsin":
            return parseWisconsin(host: host, path: path, query: query)
        case "https", "http":
            guard isAppHost(host) else { return nil }
            return parseWebPath(path, query: query)
        default:
            return nil
        }
    }

    static func parsePath(_ path: String, query: [URLQueryItem] = []) -> GearTrackerRoute? {
        parseWebPath(path, query: query)
    }

    /// Notification taps always land somewhere. Unknown families open the inbox
    /// instead of appearing to do nothing.
    static func parseNotification(
        userInfo: [AnyHashable: Any],
        type: String? = nil
    ) -> GearTrackerRoute {
        parseUserInfo(userInfo, type: type) ?? .inbox
    }

    static func parseNotification(
        payload: NotificationPayload?,
        type: String
    ) -> GearTrackerRoute {
        var userInfo: [AnyHashable: Any] = ["type": type]
        if let payload {
            if let value = payload.blastId { userInfo["blastId"] = value }
            if let value = payload.bookingId { userInfo["bookingId"] = value }
            if let value = payload.checkoutId { userInfo["checkoutId"] = value }
            if let value = payload.eventId { userInfo["eventId"] = value }
            if let value = payload.assetId { userInfo["assetId"] = value }
            if let value = payload.userId { userInfo["userId"] = value }
            if let value = payload.href { userInfo["href"] = value }
            if let value = payload.tradeId { userInfo["tradeId"] = value }
            if let value = payload.skuName { userInfo["skuName"] = value }
        }
        return parseNotification(userInfo: userInfo, type: type)
    }

    static func parseUserInfo(
        _ userInfo: [AnyHashable: Any],
        type: String? = nil
    ) -> GearTrackerRoute? {
        if let blastId = string(userInfo["blastId"]) {
            return .blast(blastId)
        }
        if let bookingId = string(userInfo["bookingId"]) ?? string(userInfo["checkoutId"]) {
            return .booking(bookingId)
        }
        if let eventId = string(userInfo["eventId"]) {
            return .event(eventId)
        }
        if let href = string(userInfo["href"]) ?? string(userInfo["url"]),
           let route = parseHref(href) {
            return route
        }
        if let assetId = string(userInfo["assetId"]) {
            return .item(assetId)
        }

        let resolvedType = type ?? string(userInfo["type"])
        if resolvedType == "badge_awarded", let userId = string(userInfo["userId"]) {
            return .user(userId)
        }
        if isLicenseType(resolvedType) || isLicenseType(string(userInfo["type"])) {
            return .licenses
        }
        if resolvedType == "low_stock", let skuName = string(userInfo["skuName"]) {
            return .itemsSearch(skuName)
        }
        if resolvedType?.hasPrefix("trade_") == true {
            return .tradeBoard
        }
        return nil
    }

    static func wisconsinURL(for route: GearTrackerRoute) -> URL? {
        switch route {
        case .scan:
            return URL(string: "wisconsin://scan")
        case .search:
            return URL(string: "wisconsin://search")
        case .myGear:
            return URL(string: "wisconsin://bookings")
        case .createReservation:
            return URL(string: "wisconsin://reserve")
        case .schedule(let myShifts):
            var components = URLComponents()
            components.scheme = "wisconsin"
            components.host = "schedule"
            if myShifts {
                components.queryItems = [URLQueryItem(name: "myShifts", value: "true")]
            }
            return components.url
        case .booking(let id):
            return URL(string: "wisconsin://booking/\(id)")
        case .event(let id):
            return URL(string: "wisconsin://schedule/\(id)")
        case .item(let id):
            return URL(string: "wisconsin://item/\(id)")
        case .user(let id):
            return URL(string: "wisconsin://user/\(id)")
        case .licenses:
            return URL(string: "wisconsin://licenses")
        case .itemsSearch(let query):
            var components = URLComponents()
            components.scheme = "wisconsin"
            components.host = "items"
            components.queryItems = [URLQueryItem(name: "search", value: query)]
            return components.url
        case .blast:
            return URL(string: "wisconsin://")
        case .tradeBoard:
            return URL(string: "wisconsin://schedule?myShifts=true")
        case .inbox:
            return URL(string: "wisconsin://notifications")
        }
    }

    private static func parseWisconsin(host: String, path: String, query: [URLQueryItem]) -> GearTrackerRoute? {
        let remainder = trimmedPath(path)
        switch host {
        case "scan":
            return .scan
        case "search":
            return .search
        case "bookings":
            return remainder.isEmpty ? .myGear : .booking(remainder)
        case "booking":
            return remainder.isEmpty ? nil : .booking(remainder)
        case "schedule":
            if remainder.isEmpty {
                return .schedule(myShifts: boolQuery(query, "myShifts"))
            }
            return .event(remainder)
        case "event", "events":
            return remainder.isEmpty ? .schedule(myShifts: false) : .event(remainder)
        case "item", "items":
            if remainder.isEmpty {
                if let search = stringQuery(query, "search") { return .itemsSearch(search) }
                return .search
            }
            return .item(remainder)
        case "reserve", "reservation":
            return .createReservation
        case "licenses":
            return .licenses
        case "user", "users":
            return remainder.isEmpty ? nil : .user(remainder)
        case "notifications":
            return .inbox
        default:
            return nil
        }
    }

    private static func parseWebPath(_ path: String, query: [URLQueryItem]) -> GearTrackerRoute? {
        let parts = trimmedPath(path)
            .split(separator: "/")
            .map(String.init)
        guard let head = parts.first else { return nil }
        let rest = Array(parts.dropFirst())
        let id = rest.first ?? ""

        switch head {
        case "search":
            return boolQuery(query, "scan") ? .scan : .search
        case "bookings":
            return id.isEmpty ? .myGear : .booking(id)
        case "reservations":
            if id.isEmpty || id == "new" { return .createReservation }
            return .booking(id)
        case "checkouts":
            return id.isEmpty ? .myGear : .booking(id)
        case "schedule":
            return .schedule(myShifts: boolQuery(query, "myShifts"))
        case "events":
            return id.isEmpty ? .schedule(myShifts: false) : .event(id)
        case "items":
            if id.isEmpty {
                if let search = stringQuery(query, "search") { return .itemsSearch(search) }
                return .search
            }
            return .item(id)
        case "users":
            return id.isEmpty ? nil : .user(id)
        case "licenses":
            return .licenses
        case "notifications":
            return .inbox
        default:
            return nil
        }
    }

    private static func parseHref(_ href: String) -> GearTrackerRoute? {
        if href.hasPrefix("/") {
            let components = URLComponents(string: "https://\(AppEnvironment.canonicalHost)\(href)")
            return parseWebPath(components?.path ?? href, query: components?.queryItems ?? [])
        }
        guard let url = URL(string: href) else { return nil }
        return parse(url)
    }

    private static func isAppHost(_ host: String) -> Bool {
        host == AppEnvironment.canonicalHost
            || host == AppEnvironment.legacyHost
            || host == AppEnvironment.appReviewHost
    }

    private static func trimmedPath(_ path: String) -> String {
        path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func string(_ value: Any?) -> String? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func stringQuery(_ query: [URLQueryItem], _ name: String) -> String? {
        string(query.first(where: { $0.name == name })?.value)
    }

    private static func boolQuery(_ query: [URLQueryItem], _ name: String) -> Bool {
        guard let value = stringQuery(query, name)?.lowercased() else { return false }
        return value == "1" || value == "true" || value == "yes"
    }

    private static func isLicenseType(_ type: String?) -> Bool {
        guard let type else { return false }
        return type.hasPrefix("license_") || type == "license_expiry" || type == "license_nag"
    }
}
