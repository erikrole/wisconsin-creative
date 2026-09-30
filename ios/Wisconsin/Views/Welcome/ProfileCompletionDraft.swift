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

    var graduationYears: [Int] {
        let current = Calendar.current.component(.year, from: Date())
        return Array(current...(current + 8))
    }

    func hydrate(from profile: ProfileCompletionProfile) {
        athleticsEmail = profile.athleticsEmail ?? ""
        personalPhone = profile.personalPhone ?? (profile.role == "STUDENT" ? profile.phone : nil) ?? ""
        workPhone = profile.workPhone ?? ""
        noWorkPhone = profile.workPhoneNotApplicable
        if let legacy = profile.phone {
            if legacy == profile.personalPhone { legacyPhoneType = "PERSONAL" }
            if legacy == profile.workPhone { legacyPhoneType = "WORK" }
        }
        wiscardCardNumber = profile.wiscardCardNumber ?? ""
        wiscardIssueCode = profile.wiscardIssueCode ?? ""
        studentYear = profile.studentYearOverride ?? ""
        graduationTerm = profile.graduationTerm ?? ""
        graduationYear = profile.gradYear ?? graduationYear
        topSizeFit = profile.topSizeFit ?? ""
        if let size = profile.topSize, ProfileSizingOptions.topSizes.contains(size) {
            topSizeChoice = size
        } else if let size = profile.topSize, !size.isEmpty {
            topSizeChoice = "OTHER"
            topSizeOther = size
        }
        shoeSizeSystem = profile.shoeSizeSystem ?? ""
        if let size = profile.shoeSize, ProfileSizingOptions.shoeSizes(system: shoeSizeSystem).contains(size) {
            shoeSizeChoice = size
        } else if let size = profile.shoeSize, !size.isEmpty {
            shoeSizeChoice = "OTHER"
            shoeSizeOther = size
        }
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
            return !studentYear.isEmpty && !graduationTerm.isEmpty
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
                personalPhone: personalPhone,
                workPhone: hasSimplePhoneStep || noWorkPhone ? nil : workPhone,
                workPhoneNotApplicable: hasSimplePhoneStep ? nil : noWorkPhone
            )
        case .wiscard:
            return .wiscard(
                cardNumber: Self.digits(wiscardCardNumber),
                issueCode: Self.digits(wiscardIssueCode)
            )
        case .student:
            return .student(year: studentYear, graduationTerm: graduationTerm, gradYear: graduationYear)
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
        var numbers = value.filter(\.isNumber)
        if numbers.count == 11, numbers.first == "1" { numbers.removeFirst() }
        let digits = String(numbers.prefix(10))
        if digits.count <= 3 { return digits }
        if digits.count <= 6 {
            return "(\(digits.prefix(3))) \(digits.dropFirst(3))"
        }
        return "(\(digits.prefix(3))) \(digits.dropFirst(3).prefix(3))-\(digits.dropFirst(6))"
    }

    static func digits(_ value: String) -> String {
        String(value.filter(\.isNumber))
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
