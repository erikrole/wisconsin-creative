import Foundation

struct FormOption: Codable, Identifiable, Hashable, Equatable {
    let id: String
    let name: String
}

// Matches /api/form-options users payload. `email` was removed from the
// server response in the May 2026 API hardening pass -- a non-optional
// field here breaks decoding of the whole form-options response.
struct FormUser: Codable, Identifiable, Hashable, Equatable {
    let id: String
    let name: String
    let avatarUrl: String?
}

struct FormBulkSku: Codable, Identifiable, Hashable, Equatable {
    let id: String
    let name: String
    let category: String?
    let unit: String?
    let locationId: String?
    let binQrCodeValue: String?
    let trackByNumber: Bool
    let categoryName: String?
    let imageUrl: String?
    let currentQuantity: Int
    let availableQuantity: Int
}

struct FormOptions: Codable, Equatable {
    let locations: [FormOption]
    let users: [FormUser]
    let bulkSkus: [FormBulkSku]

    enum CodingKeys: String, CodingKey {
        case locations, users, bulkSkus
    }

    init(locations: [FormOption], users: [FormUser], bulkSkus: [FormBulkSku] = []) {
        self.locations = locations
        self.users = users
        self.bulkSkus = bulkSkus
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        locations = try container.decode([FormOption].self, forKey: .locations)
        users = try container.decode([FormUser].self, forKey: .users)
        bulkSkus = try container.decodeIfPresent([FormBulkSku].self, forKey: .bulkSkus) ?? []
    }
}

/// A named gameday kit the reservation composer can expand into cameras,
/// lenses, and batteries. `_count` is the list envelope; `contents` is the
/// product number shown in the picker.
struct BookingKitOption: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let sportCode: String?
    let gamedayRole: String?
    let contents: Int

    enum CodingKeys: String, CodingKey {
        case id, name, sportCode, gamedayRole, count = "_count"
    }

    private struct Count: Decodable {
        let members: Int?
        let bulkMembers: Int?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        sportCode = try container.decodeIfPresent(String.self, forKey: .sportCode)
        gamedayRole = try container.decodeIfPresent(String.self, forKey: .gamedayRole)
        let count = try container.decodeIfPresent(Count.self, forKey: .count)
        contents = (count?.members ?? 0) + (count?.bulkMembers ?? 0)
    }
}

func footballGamedayKitLabel(_ role: String?) -> String? {
    switch role {
    case "SLOW1": return "SLOW1"
    case "SLOW2": return "SLOW2"
    case "BENCH": return "BENCH"
    case "ROAM1": return "ROAM1"
    case "ROAM2": return "ROAM2"
    case "ROAM3": return "ROAM3"
    case "ROAM4": return "ROAM4"
    default: return nil
    }
}

func footballGamedayKitOrder(_ role: String?) -> Int {
    switch role {
    case "SLOW1": return 0
    case "SLOW2": return 1
    case "BENCH": return 2
    case "ROAM1": return 3
    case "ROAM2": return 4
    case "ROAM3": return 5
    case "ROAM4": return 6
    default: return 7
    }
}

func callingKitLabel(name: String, gamedayRole: String?, contents: Int) -> String {
    let job = footballGamedayKitLabel(gamedayRole)
    var extras: [String] = []
    if let job, name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != job.lowercased() {
        extras.append(name)
    }
    extras.append(contents > 0 ? "\(contents)" : "empty")
    let title = job ?? name
    return extras.isEmpty ? title : "\(title) · \(extras.joined(separator: " · "))"
}

struct BookingKitDetail: Decodable {
    let id: String
    let name: String
    let sportCode: String?
    let members: [Member]
    let bulkMembers: [BulkMember]

    struct Member: Decodable {
        let asset: AssetRef
        struct AssetRef: Decodable { let id: String }
    }

    struct BulkMember: Decodable {
        let quantity: Int
        let bulkSku: SkuRef
        struct SkuRef: Decodable { let id: String }
    }
}
