import Foundation

/// One person on an away game's travel roster.
///
/// `GET /api/calendar-events/:id/travel` returns `{ data: [...] }`. Extra
/// server fields (including `createdAt`) are ignored. Optional properties are
/// `var` so synthesized decoding still reads them: a `let` with a default is
/// skipped.
struct EventTravelUser: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var role: String
    var primaryArea: String?
    var avatarUrl: String?
}

struct EventTravelMember: Codable, Hashable, Identifiable {
    var id: String
    var notes: String?
    var user: EventTravelUser
}

/// Who may read the roster, matching the website card and the route.
///
/// The card renders only for an away game that has a sport. Students, staff,
/// and admins may read it. Collaborators are refused by the route, so the
/// phone does not ask.
enum EventTravelAccess {
    static func canRead(role: String?, event: ScheduleEvent) -> Bool {
        if role != "ADMIN" && role != "STAFF" && role != "STUDENT" {
            return false
        }
        if event.isHome != false {
            return false
        }
        if let sportCode = event.sportCode?.trimmingCharacters(in: .whitespacesAndNewlines), !sportCode.isEmpty {
            return true
        }
        return false
    }
}
