import Foundation

enum ProfileCompletionStep: String, Codable, CaseIterable, Identifiable {
    case email = "EMAIL"
    case phones = "PHONES"
    case wiscard = "WISCARD"
    case student = "STUDENT"
    case apparel = "APPAREL"
    case photo = "PHOTO"
    case unknown = "UNKNOWN"

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = ProfileCompletionStep(rawValue: rawValue) ?? .unknown
    }

    static func visibleSteps(for role: String) -> [ProfileCompletionStep] {
        switch role {
        case "COLLABORATOR": [.photo]
        // Students aren't asked for an athletics email or work phone — the
        // email step has nothing left to fill in once athletics email drops
        // off, and phones already skips straight to a single personal number.
        case "STUDENT": [.phones, .wiscard, .student, .apparel, .photo]
        default: [.email, .phones, .wiscard, .apparel, .photo]
        }
    }

    /// A stale server hint must never introduce a step hidden for this role.
    static func startingStep(for role: String, suggested: ProfileCompletionStep?) -> ProfileCompletionStep {
        let steps = visibleSteps(for: role)
        if let suggested, steps.contains(suggested) { return suggested }
        return steps.first ?? .photo
    }

    /// Continue follows the displayed order, including after editing an earlier step.
    func nextStep(for role: String) -> ProfileCompletionStep? {
        let steps = Self.visibleSteps(for: role)
        guard let index = steps.firstIndex(of: self), index + 1 < steps.count else { return nil }
        return steps[index + 1]
    }

    var title: String {
        switch self {
        case .email: "Confirm your email addresses"
        case .phones: "Add your phone numbers"
        case .wiscard: "Link your Wiscard"
        case .student: "Add your student details"
        case .apparel: "Add your apparel sizes"
        case .photo: "Add a profile photo"
        case .unknown: "Complete your profile"
        }
    }
}

struct ProfileCompletionProfile: Decodable, Equatable {
    let id: String
    let name: String
    let role: String
    let email: String
    let athleticsEmail: String?
    let phone: String?
    let personalPhone: String?
    let workPhone: String?
    let workPhoneNotApplicable: Bool
    let wiscardCardNumber: String?
    let wiscardIssueCode: String?
    let studentYearOverride: String?
    let gradYear: Int?
    let graduationTerm: String?
    let topSizeFit: String?
    let topSize: String?
    let shoeSizeSystem: String?
    let shoeSize: String?
    let avatarUrl: String?
    let profilePromptSnoozedUntil: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, role, email, athleticsEmail, phone, personalPhone, workPhone
        case workPhoneNotApplicable, wiscardCardNumber, wiscardIssueCode
        case studentYearOverride, gradYear, graduationTerm, topSizeFit, topSize
        case shoeSizeSystem, shoeSize, avatarUrl, profilePromptSnoozedUntil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        role = try container.decode(String.self, forKey: .role)
        email = try container.decode(String.self, forKey: .email)
        athleticsEmail = try container.decodeIfPresent(String.self, forKey: .athleticsEmail)
        phone = try container.decodeIfPresent(String.self, forKey: .phone)
        personalPhone = try container.decodeIfPresent(String.self, forKey: .personalPhone)
        workPhone = try container.decodeIfPresent(String.self, forKey: .workPhone)
        workPhoneNotApplicable = try container.decodeIfPresent(Bool.self, forKey: .workPhoneNotApplicable) ?? false
        wiscardCardNumber = try container.decodeIfPresent(String.self, forKey: .wiscardCardNumber)
        wiscardIssueCode = try container.decodeIfPresent(String.self, forKey: .wiscardIssueCode)
        studentYearOverride = try container.decodeIfPresent(String.self, forKey: .studentYearOverride)
        gradYear = try container.decodeIfPresent(Int.self, forKey: .gradYear)
        graduationTerm = try container.decodeIfPresent(String.self, forKey: .graduationTerm)
        topSizeFit = try container.decodeIfPresent(String.self, forKey: .topSizeFit)
        topSize = try container.decodeIfPresent(String.self, forKey: .topSize)
        shoeSizeSystem = try container.decodeIfPresent(String.self, forKey: .shoeSizeSystem)
        shoeSize = try container.decodeIfPresent(String.self, forKey: .shoeSize)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        profilePromptSnoozedUntil = try container.decodeIfPresent(Date.self, forKey: .profilePromptSnoozedUntil)
    }
}

struct ProfileCompletionStatus: Decodable, Equatable {
    let operationalReady: Bool
    let profileComplete: Bool
    let isComplete: Bool
    let isSnoozed: Bool
    let shouldPrompt: Bool
    let snoozedUntil: Date?
    let completedCount: Int
    let totalCount: Int
    let missingFields: [String]
    let firstIncompleteStep: ProfileCompletionStep?
    let completeByField: [String: Bool]

    enum CodingKeys: String, CodingKey {
        case operationalReady, profileComplete, isComplete, isSnoozed, shouldPrompt
        case snoozedUntil, completedCount, totalCount, missingFields
        case firstIncompleteStep, completeByField
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operationalReady = try container.decodeIfPresent(Bool.self, forKey: .operationalReady) ?? false
        profileComplete = try container.decodeIfPresent(Bool.self, forKey: .profileComplete) ?? false
        isComplete = try container.decodeIfPresent(Bool.self, forKey: .isComplete) ?? profileComplete
        isSnoozed = try container.decodeIfPresent(Bool.self, forKey: .isSnoozed) ?? false
        shouldPrompt = try container.decodeIfPresent(Bool.self, forKey: .shouldPrompt) ?? false
        snoozedUntil = try container.decodeIfPresent(Date.self, forKey: .snoozedUntil)
        completedCount = try container.decodeIfPresent(Int.self, forKey: .completedCount) ?? 0
        totalCount = try container.decodeIfPresent(Int.self, forKey: .totalCount) ?? 0
        missingFields = try container.decodeIfPresent([String].self, forKey: .missingFields) ?? []
        firstIncompleteStep = try container.decodeIfPresent(ProfileCompletionStep.self, forKey: .firstIncompleteStep)
        completeByField = try container.decodeIfPresent([String: Bool].self, forKey: .completeByField) ?? [:]
    }
}

struct ProfileCompletionResponse: Decodable, Equatable {
    let profile: ProfileCompletionProfile
    let completion: ProfileCompletionStatus
}

enum ProfileCompletionUpdate: Encodable {
    case email(athleticsEmail: String)
    case phones(personalPhone: String, workPhone: String?, workPhoneNotApplicable: Bool?)
    case wiscard(cardNumber: String, issueCode: String)
    case student(year: String, graduationTerm: String, gradYear: Int)
    case apparel(topSizeFit: String, topSize: String, shoeSizeSystem: String, shoeSize: String)
    case snooze

    private enum CodingKeys: String, CodingKey {
        case step, athleticsEmail, personalPhone, workPhone, workPhoneNotApplicable
        case wiscardCardNumber, wiscardIssueCode, studentYearOverride
        case graduationTerm, gradYear, topSizeFit, topSize, shoeSizeSystem, shoeSize
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .email(let athleticsEmail):
            try container.encode("EMAIL", forKey: .step)
            try container.encode(athleticsEmail, forKey: .athleticsEmail)
        case .phones(let personalPhone, let workPhone, let workPhoneNotApplicable):
            try container.encode("PHONES", forKey: .step)
            try container.encode(personalPhone, forKey: .personalPhone)
            try container.encodeIfPresent(workPhone, forKey: .workPhone)
            try container.encodeIfPresent(workPhoneNotApplicable, forKey: .workPhoneNotApplicable)
        case .wiscard(let cardNumber, let issueCode):
            try container.encode("WISCARD", forKey: .step)
            try container.encode(cardNumber, forKey: .wiscardCardNumber)
            try container.encode(issueCode, forKey: .wiscardIssueCode)
        case .student(let year, let graduationTerm, let gradYear):
            try container.encode("STUDENT", forKey: .step)
            try container.encode(year, forKey: .studentYearOverride)
            try container.encode(graduationTerm, forKey: .graduationTerm)
            try container.encode(gradYear, forKey: .gradYear)
        case .apparel(let topSizeFit, let topSize, let shoeSizeSystem, let shoeSize):
            try container.encode("APPAREL", forKey: .step)
            try container.encode(topSizeFit, forKey: .topSizeFit)
            try container.encode(topSize, forKey: .topSize)
            try container.encode(shoeSizeSystem, forKey: .shoeSizeSystem)
            try container.encode(shoeSize, forKey: .shoeSize)
        case .snooze:
            try container.encode("SNOOZE", forKey: .step)
        }
    }
}

enum ProfileSizingOptions {
    static let topSizes = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"]
    static let apparelFits = [("UNISEX", "Unisex"), ("WOMENS", "Women’s"), ("MENS", "Men’s")]
    static let shoeSystems = [("US_WOMENS", "Women’s"), ("US_MENS", "Men’s")]
    static let studentYears = [("FRESHMAN", "Freshman"), ("SOPHOMORE", "Sophomore"), ("JUNIOR", "Junior"), ("SENIOR", "Senior"), ("GRAD", "Grad")]
    static let graduationTerms = [("SPRING", "Spring"), ("SUMMER", "Summer"), ("FALL", "Fall"), ("WINTER", "Winter")]

    static func shoeSizes(system: String) -> [String] {
        let bounds = system == "US_MENS" ? (4, 18) : (5, 16)
        return (bounds.0 * 2...bounds.1 * 2).map { value in
            value.isMultiple(of: 2) ? String(value / 2) : String(format: "%.1f", Double(value) / 2)
        }
    }
}
