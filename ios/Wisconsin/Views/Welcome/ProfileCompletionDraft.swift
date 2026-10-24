import Foundation
import Observation

@MainActor
@Observable
final class ProfileCompletionDraft {
    var athleticsEmail = ""
    var legacyPhoneType = ""
    var personalPhone = ""
    var workPhone = ""
    var noWorkPhone = false
    var wiscardCardNumber = ""
    var wiscardIssueCode = ""
    var studentYear = ""
    var graduationTerm = ""
    var graduationYear = Calendar.current.component(.year, from: Date())
    var topSizeFit = ""
    var topSizeChoice = ""
    var topSizeOther = ""
    var shoeSizeSystem = ""
    var shoeSizeChoice = ""
    var shoeSizeOther = ""

    init(profile: ProfileCompletionProfile? = nil) {
        if let profile { hydrate(from: profile) }
    }

    var selectedTopSize: String {
        topSizeChoice == "OTHER" ? topSizeOther.trimmingCharacters(in: .whitespacesAndNewlines) : topSizeChoice
    }

    var selectedShoeSize: String {
        shoeSizeChoice == "OTHER" ? shoeSizeOther.trimmingCharacters(in: .whitespacesAndNewlines) : shoeSizeChoice
    }

    var apparelSummary: String? {
        guard let clothing = ProfileSizingOptions.apparelFits.first(where: { $0.0 == topSizeFit })?.1,
              let shoeSystem = ProfileSizingOptions.shoeSystems.first(where: { $0.0 == shoeSizeSystem })?.1,
              !selectedTopSize.isEmpty, !selectedShoeSize.isEmpty else { return nil }
        return "\(clothing) \(selectedTopSize) · US \(shoeSystem) \(selectedShoeSize)"
    }

    var graduationYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array(current...(current + 8))
    }

    func hydrate(from profile: ProfileCompletionProfile) {
        for group in OnboardingGroup.allCases { apply(group, from: profile) }
        if let legacy = profile.phone {
            if legacy == profile.personalPhone { legacyPhoneType = "PERSONAL" }
            if legacy == profile.workPhone { legacyPhoneType = "WORK" }
        }
    }

    func apply(_ group: OnboardingGroup, from profile: ProfileCompletionProfile) {
        switch group {
        case .email: athleticsEmail = profile.athleticsEmail ?? ""
        case .personalPhone: personalPhone = profile.personalPhone ?? (profile.role == "STUDENT" ? profile.phone : nil) ?? ""
        case .workPhone:
            workPhone = profile.workPhone ?? ""
            noWorkPhone = profile.workPhoneNotApplicable
        case .wiscard:
            wiscardCardNumber = profile.wiscardCardNumber ?? ""
            wiscardIssueCode = profile.wiscardIssueCode ?? ""
        case .student: studentYear = profile.studentYearOverride ?? ""
        case .graduation:
            graduationTerm = profile.graduationTerm ?? ""
            graduationYear = profile.gradYear ?? Calendar.current.component(.year, from: Date())
        case .clothing:
            topSizeFit = profile.topSizeFit ?? ""
            let size = profile.topSize ?? ""
            topSizeChoice = size.isEmpty || ProfileSizingOptions.topSizes.contains(size) ? size : "OTHER"
            topSizeOther = topSizeChoice == "OTHER" ? size : ""
        case .shoes:
            shoeSizeSystem = profile.shoeSizeSystem ?? ""
            let size = profile.shoeSize ?? ""
            shoeSizeChoice = size.isEmpty || ProfileSizingOptions.shoeSizes(system: shoeSizeSystem).contains(size) ? size : "OTHER"
            shoeSizeOther = shoeSizeChoice == "OTHER" ? size : ""
        }
    }

    /// Observed as a whole, so coupled selections are saved together. These
    /// private values remain in memory until the account acknowledges them.
    var autosaveValues: [String: OnboardingValue] {
        func text(_ value: String) -> OnboardingValue {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? .null : .string(trimmed)
        }
        return [
            "athleticsEmail": text(athleticsEmail.lowercased()),
            "personalPhone": text(Self.formatPhone(personalPhone)),
            "workPhone": noWorkPhone ? .null : text(Self.formatPhone(workPhone)),
            "workPhoneNotApplicable": .bool(noWorkPhone),
            "wiscardCardNumber": text(Self.digits(wiscardCardNumber)),
            "wiscardIssueCode": text(Self.digits(wiscardIssueCode)),
            "studentYearOverride": text(studentYear),
            "graduationTerm": text(graduationTerm),
            "gradYear": graduationTerm.isEmpty ? .null : .number(graduationYear),
            "topSizeFit": text(topSizeFit), "topSize": text(selectedTopSize),
            "shoeSizeSystem": text(shoeSizeSystem), "shoeSize": text(selectedShoeSize),
        ]
    }

    func values(for group: OnboardingGroup) -> [String: OnboardingValue] {
        autosaveValues.filter { group.fields.contains($0.key) }
    }

    func validValues(for group: OnboardingGroup) -> [String: OnboardingValue]? {
        switch group {
        case .email:
            if !athleticsEmail.isEmpty && !Self.isEmail(athleticsEmail, inDomain: "athletics.wisc.edu") { return nil }
        case .personalPhone:
            if !personalPhone.isEmpty && Self.digits(personalPhone).count != 10 { return nil }
        case .workPhone:
            if !noWorkPhone && !workPhone.isEmpty && Self.digits(workPhone).count != 10 { return nil }
        case .wiscard:
            if !wiscardCardNumber.isEmpty && Self.digits(wiscardCardNumber).count != 10 { return nil }
            if !wiscardIssueCode.isEmpty && Self.digits(wiscardIssueCode).count != 1 { return nil }
        case .clothing:
            if selectedTopSize.count > 40 || (topSizeChoice == "OTHER" && selectedTopSize.isEmpty) { return nil }
        case .shoes:
            if selectedShoeSize.count > 40 || (shoeSizeChoice == "OTHER" && selectedShoeSize.isEmpty) { return nil }
            if !selectedShoeSize.isEmpty && shoeSizeSystem.isEmpty { return nil }
        case .student, .graduation: break
        }
        return values(for: group)
    }

    /// Students and collaborators get a single personal-phone field — no work
    /// phone, no legacy-number classification.
    static func hasSimplePhoneStep(for role: String) -> Bool {
        role == "STUDENT" || role == "COLLABORATOR"
    }

    func needsLegacyClassification(for profile: ProfileCompletionProfile) -> Bool {
        !Self.hasSimplePhoneStep(for: profile.role)
            && !legacyPhone(for: profile).isEmpty
            && profile.personalPhone == nil
            && profile.workPhone == nil
    }

    func canContinue(_ step: ProfileCompletionStep, profile: ProfileCompletionProfile) -> Bool {
        let isStudent = profile.role == "STUDENT"
        let hasSimplePhoneStep = Self.hasSimplePhoneStep(for: profile.role)
        switch step {
        case .email:
            return Self.isEmail(profile.email, inDomain: "wisc.edu")
                && (isStudent || Self.isEmail(athleticsEmail, inDomain: "athletics.wisc.edu"))
        case .phones:
            return Self.digits(personalPhone).count == 10
                && (hasSimplePhoneStep || ((!needsLegacyClassification(for: profile) || !legacyPhoneType.isEmpty)
                    && (noWorkPhone || Self.digits(workPhone).count == 10)))
        case .wiscard:
            return Self.digits(wiscardCardNumber).count == 10
                && Self.digits(wiscardIssueCode).count == 1
        case .student:
            return !studentYear.isEmpty
        case .apparel:
            return !topSizeFit.isEmpty
                && !selectedTopSize.isEmpty
                && !shoeSizeSystem.isEmpty
                && !selectedShoeSize.isEmpty
        case .photo:
            return profile.avatarUrl != nil
        case .unknown:
            return false
        }
    }

    func update(for step: ProfileCompletionStep, profile: ProfileCompletionProfile) -> ProfileCompletionUpdate? {
        switch step {
        case .email:
            return .email(athleticsEmail: athleticsEmail.trimmingCharacters(in: .whitespacesAndNewlines))
        case .phones:
            let hasSimplePhoneStep = Self.hasSimplePhoneStep(for: profile.role)
            return .phones(
                personalPhone: Self.formatPhone(personalPhone),
                workPhone: hasSimplePhoneStep || noWorkPhone ? nil : Self.formatPhone(workPhone),
                workPhoneNotApplicable: hasSimplePhoneStep ? nil : noWorkPhone
            )
        case .wiscard:
            return .wiscard(
                cardNumber: Self.digits(wiscardCardNumber),
                issueCode: Self.digits(wiscardIssueCode)
            )
        case .student:
            let hasTerm = !graduationTerm.isEmpty
            return .student(
                year: studentYear,
                graduationTerm: hasTerm ? graduationTerm : nil,
                gradYear: hasTerm ? graduationYear : nil
            )
        case .apparel:
            return .apparel(
                topSizeFit: topSizeFit,
                topSize: selectedTopSize,
                shoeSizeSystem: shoeSizeSystem,
                shoeSize: selectedShoeSize
            )
        case .photo, .unknown:
            return nil
        }
    }

    func classifyLegacyPhone(as type: String, profile: ProfileCompletionProfile) {
        guard type == "PERSONAL" || type == "WORK" else { return }
        let legacy = Self.formatPhone(legacyPhone(for: profile))
        if type == "PERSONAL" {
            personalPhone = legacy
            if workPhone == legacy { workPhone = "" }
        } else {
            workPhone = legacy
            noWorkPhone = false
            if personalPhone == legacy { personalPhone = "" }
        }
    }

    func resetShoeSizeIfSystemChanged(from oldValue: String, to newValue: String) {
        guard oldValue != newValue else { return }
        shoeSizeChoice = ""
        shoeSizeOther = ""
    }

    static func formatPhone(_ value: String) -> String {
        let digits = String(Self.digits(value).prefix(10))
        if digits.count <= 3 { return digits }
        if digits.count <= 6 {
            return "(\(digits.prefix(3))) \(digits.dropFirst(3))"
        }
        return "(\(digits.prefix(3))) \(digits.dropFirst(3).prefix(3))-\(digits.dropFirst(6))"
    }

    static func digits(_ value: String) -> String {
        let digits = String(value.filter(\.isNumber))
        return digits.count == 11 && digits.hasPrefix("1") ? String(digits.dropFirst()) : digits
    }

    private func legacyPhone(for profile: ProfileCompletionProfile) -> String {
        profile.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func isEmail(_ value: String, inDomain domain: String) -> Bool {
        let parts = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && parts[1] == Substring(domain)
    }
}
