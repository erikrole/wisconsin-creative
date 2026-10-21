import SwiftUI

/// STAFF/ADMIN candidate picker for one open shift. Candidate scoring is
/// advisory presentation; the assignment API remains authoritative.
struct AssignStudentSheet: View {
    let shiftId: String
    let workingCopyShiftGroupId: String?
    let expectedWorkingVersion: Int?
    let shiftArea: String
    let shiftWorkerType: String
    let shiftStartsAt: Date
    let shiftEndsAt: Date
    let eventTitle: String
    let sportCode: String?
    let replacementWorkerType: String?
    let replacingUserName: String?
    let onAssigned: (WorkingScheduleEditor) -> Void
    /// Reloads the crew after another session changed it and returns the new
    /// draft version, so a conflicted assignment retries once instead of
    /// failing the same way on every Retry.
    var refreshWorkingVersion: (() async -> Int?)?
    @State private var workingVersionOverride: Int?
#if DEBUG
    /// Review-capture data (`GT_ASSIGN_PICKER_FIXTURE`); skips the network.
    var fixture: (users: [AppUser], recommendations: [CandidateRecommendation])?
#endif

    init(
        shiftId: String,
        workingCopyShiftGroupId: String? = nil,
        expectedWorkingVersion: Int? = nil,
        shiftArea: String,
        shiftWorkerType: String,
        shiftStartsAt: Date,
        shiftEndsAt: Date,
        eventTitle: String,
        sportCode: String?,
        replacementWorkerType: String? = nil,
        replacingUserName: String? = nil,
        onAssigned: @escaping (WorkingScheduleEditor) -> Void,
        refreshWorkingVersion: (() async -> Int?)? = nil
    ) {
        self.shiftId = shiftId
        self.workingCopyShiftGroupId = workingCopyShiftGroupId
        self.expectedWorkingVersion = expectedWorkingVersion
        self.shiftArea = shiftArea
        self.shiftWorkerType = shiftWorkerType
        self.shiftStartsAt = shiftStartsAt
        self.shiftEndsAt = shiftEndsAt
        self.eventTitle = eventTitle
        self.sportCode = sportCode
        self.replacementWorkerType = replacementWorkerType
        self.replacingUserName = replacingUserName
        self.onAssigned = onAssigned
        self.refreshWorkingVersion = refreshWorkingVersion
    }

    @Environment(\.dismiss) private var dismiss
    @State private var users: [AppUser] = []
    @State private var recommendations: [String: CandidateRecommendation] = [:]
    @State private var conflicts: [String: String] = [:]
    @State private var isLoading = true
    @State private var scoresLoading = false
    @State private var scoresFailed = false
    @State private var loadError: String?
    @State private var search = ""
    @State private var assigningUserId: String?
    @State private var assignError: String?
    @State private var retryUser: AppUser?
    @State private var confirmationUser: AppUser?
    @State private var hasMore = true
    @State private var offset = 0
    @State private var searchTask: Task<Void, Never>?
    private let pageSize = 50

    private var targetWorkerType: String { replacementWorkerType ?? shiftWorkerType }

    private func workerType(for user: AppUser) -> String? {
        guard user.active != false else { return nil }
        if user.role == "COLLABORATOR" {
            let policy = user.collaboratorPolicy
            guard policy?.status == "ACTIVE",
                  policy?.capabilities?.contains("PUBLISHED_SCHEDULE_VIEW") == true else { return nil }
            return "FT"
        }
        return user.staffingType ?? (user.role == "STUDENT" ? "ST" : "FT")
    }

    private var eligibleUsers: [AppUser] {
        users.filter { workerType(for: $0) == targetWorkerType }
    }

    private var rankedUsers: [AppUser] {
        eligibleUsers.sorted { lhs, rhs in
            let lhsScore = recommendations[lhs.id]?.score ?? 0
            let rhsScore = recommendations[rhs.id]?.score ?? 0
            if lhsScore != rhsScore { return lhsScore > rhsScore }
            let lhsMatches = lhs.primaryArea == shiftArea
            let rhsMatches = rhs.primaryArea == shiftArea
            if lhsMatches != rhsMatches { return lhsMatches }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    private func users(in fit: CandidateFit) -> [AppUser] {
        guard !recommendations.isEmpty else { return fit == .suggested ? rankedUsers : [] }
        return rankedUsers.filter { CandidateFit(recommendations[$0.id]) == fit }
    }

    private var suggestedUsers: [AppUser] { users(in: .suggested) }
    private var checkFirstUsers: [AppUser] { users(in: .checkFirst) }
    private var unavailableUsers: [AppUser] { users(in: .unavailable) }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading && users.isEmpty {
                    AssignPeopleLoadingState()
                } else if let loadError, users.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load people", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(loadError)
                    } actions: {
                        Button("Retry") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                            .tint(Color.statusText(.purple))
                    }
                } else if rankedUsers.isEmpty {
                    ContentUnavailableView(
                        search.isEmpty ? "No people available" : "No matches",
                        systemImage: "person.2",
                        description: Text(search.isEmpty ? "No active people can be assigned to this shift." : "Try a different name.")
                    )
                } else {
                    peopleList
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(replacingUserName == nil ? "Assign Person" : "Replace Person")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(assigningUserId != nil)
                }
            }
            .searchable(text: $search, prompt: "Search people")
            .onChange(of: search) { _, _ in scheduleSearch() }
            .confirmationDialog(
                confirmationTitle,
                isPresented: Binding(
                    get: { confirmationUser != nil },
                    set: { if !$0 { confirmationUser = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Assign Anyway") {
                    guard let user = confirmationUser else { return }
                    confirmationUser = nil
                    Task { await assign(user: user) }
                }
                Button("Cancel", role: .cancel) { confirmationUser = nil }
            } message: {
                Text(confirmationMessage)
            }
            .task { await load() }
            .onDisappear { searchTask?.cancel() }
            .interactiveDismissDisabled(assigningUserId != nil)
        }
        .presentationDetents([.large])
    }

    private var peopleList: some View {
        List {
            assignmentContextCard
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if let assignError {
                Section {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.statusText(.red))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(retryUser.map { replacingUserName == nil ? "Couldn't assign \($0.name)" : "Couldn't replace with \($0.name)" } ?? "Couldn't assign person")
                                .font(.subheadline.weight(.semibold))
                            Text(assignError)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let retryUser {
                            Button("Retry") { Task { await assign(user: retryUser) } }
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
            }

            if scoresFailed && !scoresLoading {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundStyle(Color.statusText(.orange))
                            .accessibilityHidden(true)
                        Text("Couldn't rank, showing everyone")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await load() } }
                            .font(.caption.weight(.semibold))
                    }
                    .accessibilityElement(children: .combine)
                }
            }

            if scoresLoading {
                Section {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Ranking by availability, area, roster, and workload")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !suggestedUsers.isEmpty {
                Section(recommendations.isEmpty ? "People" : "Suggested") {
                    ForEach(suggestedUsers) { candidateRow($0) }
                }
            }

            if !checkFirstUsers.isEmpty {
                Section {
                    ForEach(checkFirstUsers) { candidateRow($0) }
                } header: {
                    Text("Check first")
                } footer: {
                    if unavailableUsers.isEmpty { unavailableFooter }
                }
            }

            if !unavailableUsers.isEmpty {
                Section {
                    ForEach(unavailableUsers) { candidateRow($0) }
                } header: {
                    Text("Unavailable")
                } footer: {
                    unavailableFooter
                }
            }

            if hasMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .task(id: users.count) {
#if DEBUG
                        if fixture != nil { return }
#endif
                        await loadPage(reset: false)
                    }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private var unavailableFooter: some View {
        Text("Unavailable people cannot be selected. Advisory conflicts can still be assigned after confirmation.")
    }

    private var assignmentContextCard: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(eventTitle)
                    .font(.headline)
                    .lineLimit(2)
                Text(contextLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.statusText(.purple))
                Text(callWindowText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func candidateRow(_ user: AppUser) -> some View {
        let recommendation = recommendations[user.id]
        let unavailable = recommendation?.blockingConflict == true
        return Button {
            select(user)
        } label: {
            AssignmentCandidateRow(
                user: user,
                recommendation: recommendation,
                fallbackConflict: conflicts[user.id],
                isAssigning: assigningUserId == user.id,
                shiftArea: shiftArea
            )
        }
        .buttonStyle(.plain)
        .disabled(assigningUserId != nil || unavailable)
        .opacity(unavailable ? 0.62 : 1)
        .accessibilityHint(unavailable ? "This person cannot be assigned during this call window" : "Assigns this person to the shift")
    }

    private var workerTypeLabel: String {
        targetWorkerType == "FT" ? "Staff slot" : "Student slot"
    }

    private var contextLabel: String {
        if let replacingUserName {
            return "Replace \(replacingUserName) · \(workerTypeLabel) · \(shiftArea.shiftAreaLabel)"
        }
        return "\(workerTypeLabel) · \(shiftArea.shiftAreaLabel)"
    }

    private var callWindowText: String {
        let calendar = Calendar.current
        let dateText: String
        if calendar.component(.year, from: shiftStartsAt) == calendar.component(.year, from: .now) {
            dateText = shiftStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        } else {
            dateText = shiftStartsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
        }
        return "\(dateText) · \(shiftStartsAt.formatted(date: .omitted, time: .shortened)) to \(shiftEndsAt.formatted(date: .omitted, time: .shortened))"
    }

    private var confirmationTitle: String {
        "Confirm Assignment?"
    }

    private var confirmationMessage: String {
        guard let user = confirmationUser else { return "Review the scheduling warning before assigning." }
        let action = replacingUserName.map { "Replace \($0) with \(user.name)." }
            ?? "Assign \(user.name) to this shift."
        var notes: [String] = []
        if let recommendation = recommendations[user.id] {
            if let note = recommendation.advisoryConflictNote, !note.isEmpty { notes.append(note) }
            for warning in recommendation.warnings where !notes.contains(warning.label) {
                notes.append(warning.label)
            }
        }
        if notes.isEmpty, let fallback = conflicts[user.id] { notes.append(fallback) }
        if notes.isEmpty {
            notes.append("This person has a scheduling warning. The assignment will still be checked by the server.")
        }
        return ([action] + notes.map { "• \($0)" }).joined(separator: "\n")
    }

    private func select(_ user: AppUser) {
        guard assigningUserId == nil else { return }
        let recommendation = recommendations[user.id]
        guard recommendation?.blockingConflict != true else { return }
        if recommendation?.advisoryConflict == true || conflicts[user.id] != nil {
            confirmationUser = user
            Haptics.warning()
        } else {
            Task { await assign(user: user) }
        }
    }

    private func load() async {
#if DEBUG
        if let fixture {
            users = fixture.users
            let mode = ProcessInfo.processInfo.environment["GT_ASSIGN_PICKER_FIXTURE"]
            if mode == "failed" {
                scoresFailed = true
            } else {
                recommendations = Dictionary(uniqueKeysWithValues: fixture.recommendations.map { ($0.userId, $0) })
            }
            if mode == "confirm" { confirmationUser = fixture.users.first { $0.id == "d" } }
            hasMore = false
            scoresLoading = false
            isLoading = false
            return
        }
#endif
        isLoading = true
        loadError = nil
        scoresLoading = true

        let loadedRecommendations: [CandidateRecommendation]
        let fallbackConflicts: [String: String]
        var failed = false
        if let workingCopyShiftGroupId {
            do {
                loadedRecommendations = try await APIClient.shared.workingScheduleCandidateScores(
                    shiftGroupId: workingCopyShiftGroupId,
                    slotKey: shiftId,
                    workerType: targetWorkerType
                )
            } catch {
                loadedRecommendations = []
                failed = true
            }
            fallbackConflicts = [:]
        } else {
            async let scoresTask = try? APIClient.shared.shiftCandidateScores(shiftId: shiftId)
            async let conflictsTask = APIClient.shared.shiftConflicts(shiftId: shiftId)
            let scored = await scoresTask
            failed = scored == nil
            loadedRecommendations = scored ?? []
            fallbackConflicts = await conflictsTask
        }
        scoresFailed = failed
        await loadPage(reset: true)

        recommendations = Dictionary(uniqueKeysWithValues: loadedRecommendations.map { ($0.userId, $0) })
        conflicts = fallbackConflicts.merging(
            Dictionary(uniqueKeysWithValues: loadedRecommendations.compactMap { item in
                item.advisoryConflictNote.map { (item.userId, $0) }
            }),
            uniquingKeysWith: { _, scored in scored }
        )
        // Scores cover everyone, but people page in 50 at a time. Pull the
        // rest in (bounded) so a strong fit on a later page is ranked into
        // Suggested instead of waiting for a scroll.
        if !loadedRecommendations.isEmpty && search.isEmpty {
            var extraPages = 0
            while hasMore && extraPages < 10 {
                await loadPage(reset: false)
                extraPages += 1
            }
        }
        scoresLoading = false
        isLoading = false
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await loadPage(reset: true)
        }
    }

    private func loadPage(reset: Bool) async {
        if reset {
            offset = 0
            hasMore = true
            loadError = nil
        } else if !hasMore {
            return
        }
        do {
            let response = try await APIClient.shared.users(
                search: search.trimmingCharacters(in: .whitespacesAndNewlines).nonBlankText,
                limit: pageSize,
                offset: offset
            )
            users = reset ? response.data : users + response.data
            offset += response.data.count
            hasMore = offset < response.total
        } catch is CancellationError {
            return
        } catch {
            if reset { loadError = error.localizedDescription }
            hasMore = false
        }
    }

    private func assign(user: AppUser) async {
        guard assigningUserId == nil else { return }
        assigningUserId = user.id
        assignError = nil
        retryUser = nil
        defer { assigningUserId = nil }
        guard let workingCopyShiftGroupId, let expectedWorkingVersion else {
            retryUser = user
            assignError = "Crew is unavailable. Refresh and try again."
            Haptics.warning()
            return
        }
        var version = workingVersionOverride ?? expectedWorkingVersion
        var canRetryConflict = refreshWorkingVersion != nil
        while true {
            do {
                let editor: WorkingScheduleEditor
                if let replacementWorkerType {
                    editor = try await APIClient.shared.convertAndReplaceWorkingScheduleSlot(
                        shiftGroupId: workingCopyShiftGroupId,
                        expectedVersion: version,
                        slotKey: shiftId,
                        workerType: replacementWorkerType,
                        userId: user.id
                    )
                } else {
                    editor = try await APIClient.shared.assignWorkingScheduleSlot(
                        shiftGroupId: workingCopyShiftGroupId,
                        expectedVersion: version,
                        slotKey: shiftId,
                        userId: user.id
                    )
                }
                Haptics.success()
                onAssigned(editor)
                dismiss()
                return
            } catch APIError.conflict(let message) {
                // Someone else edited the crew. Pick up the new version and
                // try this same person once more; a second conflict is real.
                if canRetryConflict, let refreshWorkingVersion,
                   let refreshed = await refreshWorkingVersion() {
                    canRetryConflict = false
                    version = refreshed
                    workingVersionOverride = refreshed
                    continue
                }
                retryUser = user
                assignError = message
                Haptics.warning()
                return
            } catch {
                retryUser = user
                assignError = error.localizedDescription
                Haptics.warning()
                return
            }
        }
    }
}

struct AssignmentCandidateRow: View {
    let user: AppUser
    let recommendation: CandidateRecommendation?
    let fallbackConflict: String?
    let isAssigning: Bool
    let shiftArea: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var fit: CandidateFit { CandidateFit(recommendation) }

    private var isPrimaryAreaMatch: Bool {
        user.primaryArea == shiftArea
    }

    private var dotColor: Color {
        switch fit {
        case .suggested: Color.statusText(.green)
        case .checkFirst: Color.statusText(.orange)
        case .unavailable: Color(.systemGray3)
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            UserAvatarView(
                name: user.name,
                avatarUrl: user.avatarUrl,
                size: 40,
                fallbackBackground: Color(.systemGray5),
                fallbackForeground: Color.secondary,
                showsBorder: false
            )
            .overlay(alignment: .bottomTrailing) {
                if recommendation != nil {
                    Circle()
                        .fill(dotColor)
                        .frame(width: 11, height: 11)
                        .overlay(Circle().stroke(Color(.secondarySystemGroupedBackground), lineWidth: 2))
                        .offset(x: 2, y: 2)
                }
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(user.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)

                Text(secondaryLine)
                    .font(.caption)
                    .foregroundStyle(recommendation != nil && fit == .checkFirst ? Color.statusText(.orange) : Color.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 2)

                // Large accessibility sizes stack the capsule under the text
                // so the name keeps its width.
                if dynamicTypeSize.isAccessibilitySize, !isAssigning {
                    capsuleView
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isAssigning {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Assigning \(user.name)")
            } else {
                if !dynamicTypeSize.isAccessibilitySize {
                    capsuleView
                }
                if fit == .unavailable {
                    Image(systemName: "nosign")
                        .foregroundStyle(Color.statusText(.red))
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundStyle(Color.statusText(.purple))
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    @ViewBuilder
    private var capsuleView: some View {
        if let capsule {
            Text(capsule.text)
                .font(.caption2.weight(.medium))
                .foregroundStyle(capsule.warn ? Color.statusText(.orange) : Color.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    capsule.warn ? Color.statusText(.orange).opacity(0.12) : Color(.tertiarySystemFill),
                    in: Capsule()
                )
                .lineLimit(1)
                .fixedSize()
        }
    }

    private var secondaryLine: String {
        if let summary = recommendation?.pickerSummary { return summary }
        if let fallbackConflict { return fallbackConflict }
        if let primaryArea = user.primaryArea, !primaryArea.isEmpty {
            return isPrimaryAreaMatch ? "Primary \(primaryArea.shiftAreaLabel)" : primaryArea.shiftAreaLabel
        }
        return user.email
    }

    private var capsule: (text: String, warn: Bool)? {
        guard let recommendation else { return nil }
        if recommendation.blockingConflict { return ("Unavailable", false) }
        guard let label = recommendation.workloadLabel else { return nil }
        let warn = recommendation.advisoryConflict || recommendation.bucket == "overloaded"
        return (label, warn)
    }

    private var statusText: String {
        switch fit {
        case .suggested: "Suggested"
        case .checkFirst: "Check first"
        case .unavailable: "Unavailable"
        }
    }

    private var accessibilityLabel: String {
        var parts = [user.name, secondaryLine]
        if recommendation != nil { parts.append(statusText) }
        if let label = recommendation?.workloadLabel, fit != .unavailable { parts.append(label) }
        if isAssigning { parts.append("Assigning") }
        return parts.joined(separator: ", ")
    }
}

private struct AssignPeopleLoadingState: View {
    var body: some View {
        VStack(spacing: 16) {
            RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous)
                .fill(Color.cardSurface)
                .frame(height: 96)

            VStack(spacing: 0) {
                ForEach(0..<6, id: \.self) { index in
                    HStack(spacing: 12) {
                        Circle().fill(Color(.systemGray5)).frame(width: 40, height: 40)
                        VStack(alignment: .leading, spacing: 7) {
                            RoundedRectangle(cornerRadius: 4).fill(Color(.systemGray5)).frame(width: 132, height: 14)
                            RoundedRectangle(cornerRadius: 4).fill(Color(.systemGray6)).frame(width: 190, height: 10)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 68)
                    if index < 5 { Divider().padding(.leading, 68) }
                }
            }
            .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        }
        .padding(16)
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading assignment candidates")
    }
}

#if DEBUG
extension AssignStudentSheet {
    /// Deterministic picker for light/dark/Dynamic Type captures.
    static func reviewFixture() -> AssignStudentSheet {
        func person(_ id: String, _ name: String) -> AppUser {
            AppUser(id: id, name: name, email: "\(id)@example.edu", role: "STUDENT", staffingType: "ST",
                    location: nil, avatarUrl: nil, primaryArea: "VIDEO", title: nil, active: true,
                    gradYear: 2027, studentYearOverride: nil, collaboratorPolicy: nil)
        }
        let users = [
            person("a", "Maya Johnson"), person("b", "Devon Park"), person("c", "Priya Nair"),
            person("d", "Jordan Ellis"), person("e", "Sam Okafor"), person("f", "Riley Chen"),
        ]
        func signal(_ code: String, _ label: String) -> CandidateScoreSignal { .init(code: code, label: label) }
        let recs = [
            CandidateRecommendation(userId: "a", bucket: "recommended", score: 92,
                reasons: [signal("area_match", "Primary video"), signal("history", "Worked 6 football games"), signal("role_fit", "Student slot")],
                workload: .init(weekAssignments: 0)),
            CandidateRecommendation(userId: "b", bucket: "good_fit", score: 81,
                reasons: [signal("availability", "Free all afternoon"), signal("role_fit", "Student slot")],
                workload: .init(weekAssignments: 2)),
            CandidateRecommendation(userId: "c", bucket: "warning", score: 55,
                warnings: [signal("class_overlap", "Class ends 30 min before call")],
                workload: .init(weekAssignments: 1)),
            CandidateRecommendation(userId: "d", bucket: "good_fit", score: 60,
                advisoryConflict: true, advisoryConflictNote: "Also on Women's Hockey the same evening",
                workload: .init(weekAssignments: 3)),
            CandidateRecommendation(userId: "e", bucket: "overloaded", score: 40,
                warnings: [signal("workload", "5 shifts already this week")],
                workload: .init(weekAssignments: 5)),
            CandidateRecommendation(userId: "f", bucket: "good_fit", score: 70,
                warnings: [signal("overlap", "Assigned to Camp Randall at the same time")],
                blockingConflict: true,
                workload: .init(weekAssignments: 2)),
        ]
        var sheet = AssignStudentSheet(
            shiftId: "fixture", workingCopyShiftGroupId: "fixture", expectedWorkingVersion: 1,
            shiftArea: "VIDEO", shiftWorkerType: "ST",
            shiftStartsAt: Date(timeIntervalSince1970: 1_792_000_000),
            shiftEndsAt: Date(timeIntervalSince1970: 1_792_014_400),
            eventTitle: "Wisconsin vs Minnesota", sportCode: "FB", onAssigned: { _ in }
        )
        sheet.fixture = (users, recs)
        return sheet
    }
}
#endif
