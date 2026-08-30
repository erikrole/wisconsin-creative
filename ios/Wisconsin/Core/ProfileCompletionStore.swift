import Foundation
import Observation

enum ProfileCompletionRoute: Equatable {
    case welcome
    case app
}

private struct ProfileCompletionHint: Codable {
    let userId: String
    let profileComplete: Bool
    let snoozedUntil: Date?
    let firstIncompleteStep: ProfileCompletionStep?

    private static func key(for userId: String) -> String {
        "WisconsinProfileCompletionHint.\(userId)"
    }

    static func load(for userId: String) -> ProfileCompletionHint? {
        guard let data = UserDefaults.standard.data(forKey: key(for: userId)) else { return nil }
        return try? JSONDecoder().decode(ProfileCompletionHint.self, from: data)
    }

    static func save(_ response: ProfileCompletionResponse) {
        let hint = ProfileCompletionHint(
            userId: response.profile.id,
            profileComplete: response.completion.profileComplete,
            snoozedUntil: response.completion.snoozedUntil,
            firstIncompleteStep: response.completion.firstIncompleteStep
        )
        guard let data = try? JSONEncoder().encode(hint) else { return }
        UserDefaults.standard.set(data, forKey: key(for: response.profile.id))
    }
}

@MainActor
@Observable
final class ProfileCompletionStore {
    private(set) var response: ProfileCompletionResponse?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var error: String?

    private var activeUserId: String?
    private var manuallyPresentedUserId: String?
    private var bypassedForSessionUserId: String?

    func route(for user: CurrentUser, optimisticSession: Bool) -> ProfileCompletionRoute {
        if bypassedForSessionUserId == user.id { return .app }
        if manuallyPresentedUserId == user.id { return .welcome }

        if let response, response.profile.id == user.id {
            return response.completion.shouldPrompt ? .welcome : .app
        }

        if let hint = ProfileCompletionHint.load(for: user.id) {
            if hint.profileComplete { return .app }
            if let snoozedUntil = hint.snoozedUntil, snoozedUntil > Date() { return .app }
            return .welcome
        }

        return optimisticSession ? .app : .welcome
    }

    func hasIncompleteProfile(for userId: String) -> Bool {
        if let response, response.profile.id == userId {
            return !response.completion.profileComplete
        }
        return ProfileCompletionHint.load(for: userId)?.profileComplete == false
    }

    func load(for user: CurrentUser, force: Bool = false) async {
        if activeUserId != user.id {
            activeUserId = user.id
            response = nil
            error = nil
            manuallyPresentedUserId = nil
            bypassedForSessionUserId = nil
        }
        if isLoading || isSaving { return }
        if !force, response?.profile.id == user.id { return }

        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let next = try await APIClient.shared.profileCompletion()
            guard activeUserId == user.id else { return }
            response = next
            ProfileCompletionHint.save(next)
            if next.completion.profileComplete {
                manuallyPresentedUserId = nil
            }
        } catch APIError.unauthorized {
            return
        } catch {
            guard activeUserId == user.id else { return }
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func save(_ update: ProfileCompletionUpdate, for user: CurrentUser) async -> ProfileCompletionResponse? {
        guard !isSaving else { return nil }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            let next = try await APIClient.shared.updateProfileCompletion(update)
            guard activeUserId == user.id else { return nil }
            response = next
            ProfileCompletionHint.save(next)
            if next.completion.profileComplete {
                manuallyPresentedUserId = nil
            }
            return next
        } catch APIError.unauthorized {
            return nil
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func uploadAvatar(_ jpegData: Data, for user: CurrentUser) async -> Bool {
        guard !isSaving else { return false }
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            _ = try await APIClient.shared.uploadProfileAvatar(userId: user.id, jpegData: jpegData)
            let next = try await APIClient.shared.profileCompletion()
            guard activeUserId == user.id else { return false }
            response = next
            ProfileCompletionHint.save(next)
            if next.completion.profileComplete {
                manuallyPresentedUserId = nil
            }
            return true
        } catch APIError.unauthorized {
            return false
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func snooze(for user: CurrentUser) async -> Bool {
        guard let next = await save(.snooze, for: user) else { return false }
        manuallyPresentedUserId = nil
        return next.completion.isSnoozed || !next.completion.shouldPrompt
    }

    func presentManually(for userId: String) {
        bypassedForSessionUserId = nil
        manuallyPresentedUserId = userId
        error = nil
    }

    func continueForSession(for userId: String) {
        bypassedForSessionUserId = userId
        manuallyPresentedUserId = nil
        error = nil
    }

    func clearError() {
        error = nil
    }

    func resetSession() {
        activeUserId = nil
        response = nil
        error = nil
        manuallyPresentedUserId = nil
        bypassedForSessionUserId = nil
        isLoading = false
        isSaving = false
    }
}
