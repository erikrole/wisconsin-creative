import Foundation
import Observation

struct WelcomeFinish: Equatable {
    enum Outcome: Equatable {
        case complete
        /// They stopped before the last step; the screen says so.
        case later
    }

    let userId: String
    let outcome: Outcome
}

enum ProfileCompletionRoute: Equatable {
    case welcome
    case app
}

private struct ProfileCompletionHint: Codable {
    let userId: String
    let profileComplete: Bool
    let onboardingComplete: Bool?
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
            onboardingComplete: response.completion.onboardingComplete,
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
    let draft = ProfileCompletionDraft()
    private(set) var response: ProfileCompletionResponse?
    private(set) var isLoading = false
    private(set) var isSaving = false
    private(set) var error: String?
    private(set) var photoRefreshNeeded = false
    private(set) var saveStatus = "Saved to your account"
    private(set) var hasUnsavedChanges = false
    private(set) var hasConflicts = false
    private var dirty: Set<OnboardingGroup> = []
    private var conflicts: Set<OnboardingGroup> = []
    private var baseline: [OnboardingGroup: [String: OnboardingValue]] = [:]
    private var versions: [String: String] = [:]
    private var debounce: Task<Void, Never>?
    private var saveJob: Task<Bool, Never>?
    private var mutationEpoch = 0
    private var loadToken = UUID()

    /// Set when the last step is done or the user stops early. Holds the Welcome
    /// route open so the finish screen shows even after the server marks the
    /// profile complete or snoozed.
    private(set) var finish: WelcomeFinish?

    private var activeUserId: String?
    private var manuallyPresentedUserId: String?
    private var bypassedForSessionUserId: String?

    func route(for user: CurrentUser, optimisticSession: Bool) -> ProfileCompletionRoute {
        if let response, response.profile.id == user.id, response.completion.requiresSetup { return .welcome }
        if user.onboardingRequired && response?.completion.onboardingComplete != true { return .welcome }
        if finish?.userId == user.id { return .welcome }
        if bypassedForSessionUserId == user.id { return .app }
        if manuallyPresentedUserId == user.id { return .welcome }

        if let response, response.profile.id == user.id {
            return response.completion.shouldPrompt ? .welcome : .app
        }

        if let hint = ProfileCompletionHint.load(for: user.id) {
            if hint.onboardingComplete == true || hint.profileComplete { return .app }
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
            resetSession()
            activeUserId = user.id
            response = nil
            error = nil
            photoRefreshNeeded = false
            manuallyPresentedUserId = nil
            bypassedForSessionUserId = nil
            finish = nil
        }
        if isLoading || isSaving { return }
        if !force, response?.profile.id == user.id { return }

        isLoading = true
        error = nil
        let token = UUID()
        loadToken = token
        let epoch = mutationEpoch
        defer { if loadToken == token { isLoading = false } }
        do {
            let next = try await APIClient.shared.profileCompletion()
            guard activeUserId == user.id, mutationEpoch == epoch, !isSaving, !Task.isCancelled else { return }
            accept(next)
            photoRefreshNeeded = false
            ProfileCompletionHint.save(next)
            if next.completion.onboardingComplete {
                manuallyPresentedUserId = nil
            }
        } catch APIError.unauthorized {
            return
        } catch {
            guard activeUserId == user.id, mutationEpoch == epoch, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    private func accept(_ next: ProfileCompletionResponse) {
        guard next.profile.id == activeUserId else { return }
        for group in OnboardingGroup.allCases {
            let saved = next.profile.values(for: group)
            let version = next.versions[group.rawValue]
            if !dirty.contains(group) {
                baseline[group] = saved
                versions[group.rawValue] = version
                draft.apply(group, from: next.profile)
            } else if versions[group.rawValue] != version {
                if draft.validValues(for: group) == saved {
                    dirty.remove(group)
                    conflicts.remove(group)
                    baseline[group] = saved
                    versions[group.rawValue] = version
                } else { conflicts.insert(group) }
            }
        }
        response = next
        ProfileCompletionHint.save(next)
        updateSaveStatus()
    }

    private func updateSaveStatus() {
        hasUnsavedChanges = !dirty.isEmpty
        hasConflicts = !conflicts.isEmpty
        saveStatus = hasConflicts ? "Answers changed elsewhere. Your edits are still here."
            : hasUnsavedChanges ? "Changes waiting to save" : "Saved to your account"
    }

    func draftChanged(for user: CurrentUser) {
        guard activeUserId == user.id, !versions.isEmpty else { return }
        let groups = ProfileCompletionStep.visibleSteps(for: user.role)
            .flatMap { OnboardingGroup.groups(for: $0, role: user.role) }
        for group in groups where draft.values(for: group) != baseline[group] { dirty.insert(group) }
        updateSaveStatus()
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            _ = await self?.flush(for: user)
        }
    }

    @discardableResult
    func flush(for user: CurrentUser) async -> Bool {
        debounce?.cancel()
        guard activeUserId == user.id else { return false }
        if let saveJob { return await saveJob.value }
        guard !isSaving else { return false }
        let job = Task { [weak self] in await self?.saveDraft(for: user) ?? false }
        saveJob = job
        let saved = await job.value
        guard activeUserId == user.id else { return false }
        saveJob = nil
        if !saved, conflicts.isEmpty, error == nil,
           dirty.contains(where: { draft.validValues(for: $0) != nil && draft.values(for: $0) != baseline[$0] }) {
            debounce = Task { [weak self] in _ = await self?.flush(for: user) }
        }
        return saved
    }

    private func saveDraft(for user: CurrentUser) async -> Bool {
        isSaving = true
        error = nil
        defer { if activeUserId == user.id { isSaving = false } }
        for group in OnboardingGroup.allCases {
            guard activeUserId == user.id, !Task.isCancelled else { return false }
            guard dirty.contains(group), !conflicts.contains(group),
                  let values = draft.validValues(for: group),
                  let version = versions[group.rawValue] else { continue }
            if values == baseline[group] { dirty.remove(group); continue }
            saveStatus = "Saving…"
            mutationEpoch += 1
            do {
                let next = try await APIClient.shared.updateProfileCompletion(.save(group: group.rawValue, expectedVersion: version, values: values))
                guard activeUserId == user.id, !Task.isCancelled else { return false }
                mutationEpoch += 1
                baseline[group] = next.profile.values(for: group)
                versions[group.rawValue] = next.versions[group.rawValue]
                if draft.validValues(for: group) == values { dirty.remove(group) }
                accept(next)
            } catch APIError.unauthorized { return false }
            catch APIError.sessionChanged { return false }
            catch APIError.conflict {
                guard activeUserId == user.id else { return false }
                conflicts.insert(group)
                if let next = try? await APIClient.shared.profileCompletion(), activeUserId == user.id { accept(next) }
                updateSaveStatus()
                return false
            } catch {
                guard activeUserId == user.id else { return false }
                // A disconnected response does not prove the write failed.
                if let next = try? await APIClient.shared.profileCompletion(), activeUserId == user.id,
                   next.profile.values(for: group) == values {
                    baseline[group] = values
                    versions[group.rawValue] = next.versions[group.rawValue]
                    if draft.validValues(for: group) == values { dirty.remove(group) }
                    accept(next)
                    continue
                }
                self.error = "Couldn’t save your answers. Keep this screen open and retry."
                saveStatus = "Not saved yet"
                return false
            }
        }
        updateSaveStatus()
        if !dirty.isEmpty && conflicts.isEmpty {
            if !dirty.contains(where: { draft.validValues(for: $0) != nil && draft.values(for: $0) != baseline[$0] }) {
                saveStatus = "Complete the field to save your answer"
            }
        }
        return dirty.isEmpty
    }

    func useSavedAnswers(for user: CurrentUser) async {
        guard activeUserId == user.id, !isSaving else { return }
        do {
            let next = try await APIClient.shared.profileCompletion()
            guard activeUserId == user.id else { return }
            for group in conflicts {
                dirty.remove(group)
                draft.apply(group, from: next.profile)
            }
            conflicts.removeAll()
            accept(next)
            error = nil
        } catch { if activeUserId == user.id { self.error = "Couldn’t refresh saved answers. Your edits are still here." } }
    }

    func keepMyAnswers(for user: CurrentUser) async {
        guard activeUserId == user.id, !isSaving else { return }
        do {
            let next = try await APIClient.shared.profileCompletion()
            guard activeUserId == user.id else { return }
            for group in conflicts {
                baseline[group] = next.profile.values(for: group)
                versions[group.rawValue] = next.versions[group.rawValue]
            }
            conflicts.removeAll()
            _ = await flush(for: user)
        } catch { if activeUserId == user.id { self.error = "Couldn’t refresh saved answers. Your edits are still here." } }
    }

    @discardableResult
    func save(_ update: ProfileCompletionUpdate, for user: CurrentUser) async -> ProfileCompletionResponse? {
        guard !isSaving, activeUserId == user.id else { return nil }
        isSaving = true
        error = nil
        mutationEpoch += 1
        defer { if activeUserId == user.id { isSaving = false } }
        do {
            let next = try await APIClient.shared.updateProfileCompletion(update)
            guard activeUserId == user.id else { return nil }
            mutationEpoch += 1
            accept(next)
            photoRefreshNeeded = false
            ProfileCompletionHint.save(next)
            if next.completion.onboardingComplete {
                manuallyPresentedUserId = nil
                if case .snooze = update {} else { finish = WelcomeFinish(userId: user.id, outcome: .complete) }
            }
            return next
        } catch APIError.unauthorized {
            return nil
        } catch {
            guard activeUserId == user.id else { return nil }
            self.error = error.localizedDescription
            return nil
        }
    }

    func uploadAvatar(_ jpegData: Data, expectedAvatarURL: String?, for user: CurrentUser) async -> Bool {
        guard !isSaving, activeUserId == user.id, let prior = response else { return false }
        isSaving = true
        error = nil
        mutationEpoch += 1
        defer { if activeUserId == user.id { isSaving = false } }
        do {
            let avatarURL = try await APIClient.shared.uploadProfileAvatar(userId: user.id, jpegData: jpegData, expectedAvatarURL: expectedAvatarURL)
            guard activeUserId == user.id else { return false }
            mutationEpoch += 1
            var confirmed = response ?? prior
            confirmed.profile.avatarUrl = avatarURL
            accept(confirmed)
            do {
                let next = try await APIClient.shared.profileCompletion()
                guard activeUserId == user.id else { return false }
                accept(next)
                photoRefreshNeeded = false
                ProfileCompletionHint.save(next)
                if next.completion.profileComplete { manuallyPresentedUserId = nil }
            } catch {
                guard activeUserId == user.id else { return false }
                photoRefreshNeeded = true
                self.error = "Your photo was saved, but setup couldn’t refresh. Try refreshing setup."
            }
            return true
        } catch APIError.unauthorized {
            return false
        } catch {
            guard activeUserId == user.id else { return false }
            self.error = error.localizedDescription
            return false
        }
    }

    func removeAvatar(for user: CurrentUser) async -> Bool {
        guard !isSaving, activeUserId == user.id, let prior = response,
              let avatarURL = prior.profile.avatarUrl else { return false }
        isSaving = true
        error = nil
        mutationEpoch += 1
        defer { if activeUserId == user.id { isSaving = false } }
        do {
            try await APIClient.shared.removeProfileAvatar(userId: user.id, expectedAvatarURL: avatarURL)
            guard activeUserId == user.id else { return false }
            mutationEpoch += 1
            var confirmed = response ?? prior
            confirmed.profile.avatarUrl = nil
            accept(confirmed)
            do {
                let next = try await APIClient.shared.profileCompletion()
                guard activeUserId == user.id else { return false }
                accept(next)
                photoRefreshNeeded = false
            } catch { photoRefreshNeeded = true }
            return true
        } catch {
            guard activeUserId == user.id else { return false }
            self.error = error.localizedDescription
            return false
        }
    }

    func snooze(for user: CurrentUser) async -> Bool {
        guard await flush(for: user) else { return false }
        guard let next = await save(.snooze, for: user) else { return false }
        manuallyPresentedUserId = nil
        let stopped = next.completion.isSnoozed || !next.completion.shouldPrompt
        if stopped { finish = WelcomeFinish(userId: user.id, outcome: .later) }
        return stopped
    }

    /// The last step was finished or skipped.
    func finishSetup(for user: CurrentUser) async -> Bool {
        guard await flush(for: user), activeUserId == user.id, !isSaving else { return false }
        isSaving = true
        error = nil
        mutationEpoch += 1
        defer { if activeUserId == user.id { isSaving = false } }
        do {
            let next = try await APIClient.shared.updateProfileCompletion(.finish(expectedUserId: user.id))
            guard activeUserId == user.id else { return false }
            accept(next)
        } catch {
            guard activeUserId == user.id else { return false }
            guard let next = try? await APIClient.shared.profileCompletion(), activeUserId == user.id,
                  next.completion.onboardingComplete else {
                self.error = "Couldn’t confirm setup is finished. Your saved answers are safe. Try again."
                return false
            }
            accept(next)
        }
        finish = WelcomeFinish(userId: user.id, outcome: .complete)
        manuallyPresentedUserId = nil
        return true
    }

    /// Leaves the finish screen for the app shell.
    func dismissFinish(for userId: String) {
        finish = nil
        continueForSession(for: userId)
    }

    func presentManually(for userId: String) {
        bypassedForSessionUserId = nil
        manuallyPresentedUserId = userId
        error = nil
    }

    func continueForSession(for userId: String) {
        guard response?.completion.requiresSetup != true else { return }
        bypassedForSessionUserId = userId
        manuallyPresentedUserId = nil
        error = nil
    }

    func clearError() {
        error = nil
    }

    func resetSession() {
        mutationEpoch += 1
        loadToken = UUID()
        debounce?.cancel()
        saveJob?.cancel()
        debounce = nil
        saveJob = nil
        dirty.removeAll()
        conflicts.removeAll()
        baseline.removeAll()
        versions.removeAll()
        hasUnsavedChanges = false
        hasConflicts = false
        saveStatus = "Saved to your account"
        activeUserId = nil
        response = nil
        error = nil
        photoRefreshNeeded = false
        manuallyPresentedUserId = nil
        bypassedForSessionUserId = nil
        finish = nil
        isLoading = false
        isSaving = false
    }
}
