import Foundation

// Shapes of `/api/signatures/*` (src/lib/services/signatures.ts). These routes
// return bare JSON, not the `{ data }` envelope most iOS endpoints use.

struct SignatureCaptureSettings: Decodable, Equatable, Sendable {
    let strokeColor: String
    let strokeWidth: Double
    let cropPadding: Double
    let maxWidth: Int
    let maxHeight: Int
}

struct SignatureCompleteness: Decodable, Equatable, Sendable {
    let complete: Int
    let required: Int
    let percent: Int
}

struct SignatureStaffCompleteness: Decodable, Equatable, Sendable {
    let complete: Int
    let total: Int
}

struct SignatureCollectionSummary: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let sportCode: String
    let season: String
    let status: String
    let activeMemberCount: Int
    let completeness: SignatureCompleteness
    var staffCompleteness: SignatureStaffCompleteness?

    var title: String { SignatureSport.title(for: sportCode) }
    var isOpen: Bool { status == "OPEN" }
}

struct SignatureCollectionListResponse: Decodable, Sendable {
    let collections: [SignatureCollectionSummary]
}

struct SignatureArtifactSummary: Decodable, Equatable, Sendable {
    let id: String
    var width: Int?
    var height: Int?
}

struct SignatureRosterMember: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let jerseyNumber: Int?
    let title: String?
    let roleGroup: String
    let required: Bool
    let active: Bool
    let artifact: SignatureArtifactSummary?

    var isSigned: Bool { artifact != nil }
}

struct SignatureCollectionDetail: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let sportCode: String
    let season: String
    let status: String
    var completeness: SignatureCompleteness?
    var staffCompleteness: SignatureStaffCompleteness?
    let members: [SignatureRosterMember]

    var title: String { SignatureSport.title(for: sportCode) }
    var isOpen: Bool { status == "OPEN" }
}

struct SignatureCaptureBootstrap: Decodable, Equatable, Sendable {
    struct Collection: Decodable, Equatable, Sendable {
        let id: String
        let season: String
        let status: String
    }

    struct Member: Decodable, Equatable, Sendable {
        let id: String
        let name: String
        let jerseyNumber: Int?
        let title: String?
        let roleGroup: String
        let active: Bool
        let captureVersion: Int
        let settingsVersion: Int
        let captureSettings: SignatureCaptureSettings
        let artifact: SignatureArtifactSummary?
    }

    let collection: Collection
    let member: Member
}

struct SignatureCaptureRequest: Encodable, Sendable {
    let requestId: String
    let expectedCaptureVersion: Int
    let settingsVersion: Int
    let strokes: [SignatureStrokePayload]
}

struct SignatureCaptureResult: Decodable, Equatable, Sendable {
    let status: String
    let captureVersion: Int
}

enum SignatureSport {
    /// Mirrors `SIGNATURE_SPORT_REGISTRY` labels in src/lib/signatures/types.ts.
    static func title(for sportCode: String) -> String {
        switch sportCode {
        case "MBB": "Men’s Basketball"
        case "FB": "Football"
        case "VB": "Volleyball"
        case "MHKY": "Men’s Hockey"
        case "WHKY": "Women’s Hockey"
        case "WBB": "Women’s Basketball"
        case "WRES": "Wrestling"
        case "CREATIVE": "Creative Staff"
        case "ADMIN": "Administration"
        case "ADHOC": "Ad-hoc signatures"
        default: sportCode
        }
    }

    /// Team rosters show the readiness header and the group filter; standalone
    /// staff and ad-hoc rosters do not (web `teamRoster`).
    static func isTeamRoster(_ sportCode: String) -> Bool {
        !["CREATIVE", "ADMIN", "ADHOC"].contains(sportCode)
    }

    static func groupTitle(for roleGroup: String) -> String {
        switch roleGroup {
        case "PLAYER": "Student-Athletes"
        case "COACHING_STAFF": "Coaching Staff"
        case "SUPPORT_STAFF": "Support Staff"
        case "CREATIVE_STAFF": "Creative Staff"
        default: roleGroup.capitalized
        }
    }
}
