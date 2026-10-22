import Foundation

private func profileDate<Key: CodingKey>(_ container: KeyedDecodingContainer<Key>, _ key: Key) throws -> Date? {
    guard let value = try container.decodeIfPresent(String.self, forKey: key) else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) { return date }
    throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "Invalid account date")
}

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
    var avatarUrl: String?
    let profilePromptSnoozedUntil: Date?
    let onboardingCompletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, role, email, athleticsEmail, phone, personalPhone, workPhone
        case workPhoneNotApplicable, wiscardCardNumber, wiscardIssueCode
        case studentYearOverride, gradYear, graduationTerm, topSizeFit, topSize
        case shoeSizeSystem, shoeSize, avatarUrl, profilePromptSnoozedUntil, onboardingCompletedAt
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
        profilePromptSnoozedUntil = try profileDate(container, .profilePromptSnoozedUntil)
        onboardingCompletedAt = try profileDate(container, .onboardingCompletedAt)
    }
}

struct ProfileCompletionStatus: Decodable, Equatable {
    let operationalReady: Bool
    let requiredComplete: Bool
    let requiresSetup: Bool
    let onboardingComplete: Bool
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
        case operationalReady, requiredComplete, requiresSetup, onboardingComplete, profileComplete, isComplete, isSnoozed, shouldPrompt
        case snoozedUntil, completedCount, totalCount, missingFields
        case firstIncompleteStep, completeByField
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operationalReady = try container.decodeIfPresent(Bool.self, forKey: .operationalReady) ?? false
        requiredComplete = try container.decodeIfPresent(Bool.self, forKey: .requiredComplete) ?? false
        requiresSetup = try container.decodeIfPresent(Bool.self, forKey: .requiresSetup) ?? false
        profileComplete = try container.decodeIfPresent(Bool.self, forKey: .profileComplete) ?? false
        onboardingComplete = try container.decodeIfPresent(Bool.self, forKey: .onboardingComplete) ?? profileComplete
        isComplete = try container.decodeIfPresent(Bool.self, forKey: .isComplete) ?? profileComplete
        isSnoozed = try container.decodeIfPresent(Bool.self, forKey: .isSnoozed) ?? false
        shouldPrompt = try container.decodeIfPresent(Bool.self, forKey: .shouldPrompt) ?? false
        snoozedUntil = try profileDate(container, .snoozedUntil)
        completedCount = try container.decodeIfPresent(Int.self, forKey: .completedCount) ?? 0
        totalCount = try container.decodeIfPresent(Int.self, forKey: .totalCount) ?? 0
        missingFields = try container.decodeIfPresent([String].self, forKey: .missingFields) ?? []
        firstIncompleteStep = try container.decodeIfPresent(ProfileCompletionStep.self, forKey: .firstIncompleteStep)
        completeByField = try container.decodeIfPresent([String: Bool].self, forKey: .completeByField) ?? [:]
    }
}

struct ProfileCompletionResponse: Decodable, Equatable {
    var profile: ProfileCompletionProfile
    let completion: ProfileCompletionStatus
    let versions: [String: String]

    enum CodingKeys: String, CodingKey { case profile, completion, versions }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        profile = try container.decode(ProfileCompletionProfile.self, forKey: .profile)
        completion = try container.decode(ProfileCompletionStatus.self, forKey: .completion)
        versions = try container.decodeIfPresent([String: String].self, forKey: .versions) ?? [:]
    }
}

enum OnboardingGroup: String, CaseIterable {
    case email = "EMAIL", personalPhone = "PERSONAL_PHONE", workPhone = "WORK_PHONE"
    case wiscard = "WISCARD", student = "STUDENT", graduation = "GRADUATION"
    case clothing = "CLOTHING", shoes = "SHOES"

    var fields: [String] {
        switch self {
        case .email: ["athleticsEmail"]
        case .personalPhone: ["personalPhone"]
        case .workPhone: ["workPhone", "workPhoneNotApplicable"]
        case .wiscard: ["wiscardCardNumber", "wiscardIssueCode"]
        case .student: ["studentYearOverride"]
        case .graduation: ["graduationTerm", "gradYear"]
        case .clothing: ["topSizeFit", "topSize"]
        case .shoes: ["shoeSizeSystem", "shoeSize"]
        }
    }

    static func groups(for step: ProfileCompletionStep, role: String) -> [Self] {
        switch step {
        case .email: [.email]
        case .phones: role == "STUDENT" ? [.personalPhone] : [.personalPhone, .workPhone]
        case .wiscard: [.wiscard]
        case .student: [.student, .graduation]
        case .apparel: [.clothing, .shoes]
        default: []
        }
    }
}

enum OnboardingValue: Encodable, Equatable {
    case string(String), number(Int), bool(Bool), null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    static func text(_ value: String?) -> Self { value.map(Self.string) ?? .null }
}

extension ProfileCompletionProfile {
    func values(for group: OnboardingGroup) -> [String: OnboardingValue] {
        let all: [String: OnboardingValue] = [
            "athleticsEmail": .text(athleticsEmail), "personalPhone": .text(personalPhone),
            "workPhone": .text(workPhone), "workPhoneNotApplicable": .bool(workPhoneNotApplicable),
            "wiscardCardNumber": .text(wiscardCardNumber), "wiscardIssueCode": .text(wiscardIssueCode),
            "studentYearOverride": .text(studentYearOverride), "graduationTerm": .text(graduationTerm),
            "gradYear": gradYear.map(OnboardingValue.number) ?? .null,
            "topSizeFit": .text(topSizeFit), "topSize": .text(topSize),
            "shoeSizeSystem": .text(shoeSizeSystem), "shoeSize": .text(shoeSize),
        ]
        return all.filter { group.fields.contains($0.key) }
    }
}

enum ProfileCompletionUpdate: Encodable {
    case email(athleticsEmail: String)
    case phones(personalPhone: String, workPhone: String?, workPhoneNotApplicable: Bool?)
    case wiscard(cardNumber: String, issueCode: String)
    case student(year: String, graduationTerm: String?, gradYear: Int?)
    case apparel(topSizeFit: String, topSize: String, shoeSizeSystem: String, shoeSize: String)
    case snooze
    case save(group: String, expectedVersion: String, values: [String: OnboardingValue])
    case finish(expectedUserId: String)

    private enum CodingKeys: String, CodingKey {
        case step, athleticsEmail, personalPhone, workPhone, workPhoneNotApplicable
        case wiscardCardNumber, wiscardIssueCode, studentYearOverride
        case graduationTerm, gradYear, topSizeFit, topSize, shoeSizeSystem, shoeSize
        case group, expectedVersion, values, expectedUserId
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
            // Graduation is never required; the server saves it only when both arrive.
            try container.encodeIfPresent(graduationTerm, forKey: .graduationTerm)
            try container.encodeIfPresent(gradYear, forKey: .gradYear)
        case .apparel(let topSizeFit, let topSize, let shoeSizeSystem, let shoeSize):
            try container.encode("APPAREL", forKey: .step)
            try container.encode(topSizeFit, forKey: .topSizeFit)
            try container.encode(topSize, forKey: .topSize)
            try container.encode(shoeSizeSystem, forKey: .shoeSizeSystem)
            try container.encode(shoeSize, forKey: .shoeSize)
        case .snooze:
            try container.encode("SNOOZE", forKey: .step)
        case .save(let group, let expectedVersion, let values):
            try container.encode("SAVE", forKey: .step)
            try container.encode(group, forKey: .group)
            try container.encode(expectedVersion, forKey: .expectedVersion)
            try container.encode(values, forKey: .values)
        case .finish(let expectedUserId):
            try container.encode("FINISH", forKey: .step)
            try container.encode(expectedUserId, forKey: .expectedUserId)
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
