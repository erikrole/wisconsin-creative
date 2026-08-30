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
        onAssigned: @escaping (WorkingScheduleEditor) -> Void
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
    }

    @Environment(\.dismiss) private var dismiss
    @State private var users: [AppUser] = []
    @State private var recommendations: [String: CandidateRecommendation] = [:]
    @State private var conflicts: [String: String] = [:]
    @State private var isLoading = true
    @State private var scoresLoading = false
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

    private var recommendedUsers: [AppUser] {
        guard !recommendations.isEmpty else { return rankedUsers }
        return rankedUsers.filter { user in
            guard let recommendation = recommendations[user.id] else { return false }
            return !recommendation.blockingConflict
                && (recommendation.bucket == "recommended" || recommendation.bucket == "good_fit")
        }
    }

    private var reviewUsers: [AppUser] {
        guard !recommendations.isEmpty else { return [] }
        let recommendedIds = Set(recommendedUsers.map(\.id))
        return rankedUsers.filter { !recommendedIds.contains($0.id) }
    }

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

            if !recommendedUsers.isEmpty {
                Section(recommendations.isEmpty ? "People" : "Best Fits") {
                    ForEach(recommendedUsers) { candidateRow($0) }
                }
            }

            if !reviewUsers.isEmpty {
                Section {
                    ForEach(reviewUsers) { candidateRow($0) }
                } header: {
                    Text("Review Before Assigning")
                } footer: {
                    Text("Unavailable people cannot be selected. Advisory conflicts can still be assigned after confirmation.")
                }
            }

            if hasMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .task(id: users.count) { await loadPage(reset: false) }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }

    private var assignmentContextCard: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.statusText(.purple))
                .frame(width: 4, height: 58)
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
        let warning = recommendations[user.id]?.warningContext
            ?? conflicts[user.id]
            ?? "This person has a scheduling warning. The assignment will still be checked by the server."
        return "\(action) \(warning)"
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
        isLoading = true
        loadError = nil
        scoresLoading = true

        let loadedRecommendations: [CandidateRecommendation]
        let fallbackConflicts: [String: String]
        if let workingCopyShiftGroupId {
            loadedRecommendations = (try? await APIClient.shared.workingScheduleCandidateScores(
                shiftGroupId: workingCopyShiftGroupId,
                slotKey: shiftId,
                workerType: targetWorkerType
            )) ?? []
            fallbackConflicts = [:]
        } else {
            async let scoresTask = try? APIClient.shared.shiftCandidateScores(shiftId: shiftId)
            async let conflictsTask = APIClient.shared.shiftConflicts(shiftId: shiftId)
            loadedRecommendations = (await scoresTask) ?? []
            fallbackConflicts = await conflictsTask
        }
        await loadPage(reset: true)

        recommendations = Dictionary(uniqueKeysWithValues: loadedRecommendations.map { ($0.userId, $0) })
        conflicts = fallbackConflicts.merging(
            Dictionary(uniqueKeysWithValues: loadedRecommendations.compactMap { item in
                item.advisoryConflictNote.map { (item.userId, $0) }
            }),
            uniquingKeysWith: { _, scored in scored }
        )
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
        do {
            let editor: WorkingScheduleEditor
            if let replacementWorkerType {
                editor = try await APIClient.shared.convertAndReplaceWorkingScheduleSlot(
                    shiftGroupId: workingCopyShiftGroupId,
                    expectedVersion: expectedWorkingVersion,
                    slotKey: shiftId,
                    workerType: replacementWorkerType,
                    userId: user.id
                )
            } else {
                editor = try await APIClient.shared.assignWorkingScheduleSlot(
                    shiftGroupId: workingCopyShiftGroupId,
                    expectedVersion: expectedWorkingVersion,
                    slotKey: shiftId,
                    userId: user.id
                )
            }
            Haptics.success()
            onAssigned(editor)
            dismiss()
        } catch {
            retryUser = user
            assignError = error.localizedDescription
            Haptics.warning()
        }
    }
}

private struct AssignmentCandidateRow: View {
    let user: AppUser
    let recommendation: CandidateRecommendation?
    let fallbackConflict: String?
    let isAssigning: Bool
    let shiftArea: String

    private var isPrimaryAreaMatch: Bool {
        user.primaryArea == shiftArea
    }

    private var warningText: String? {
        recommendation?.warningContext ?? fallbackConflict
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
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(user.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if let recommendation {
                        fitPill(recommendation)
                    }
                }

                Text(primaryContext)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let warningText {
                    Label(warningText, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.statusText(recommendation?.blockingConflict == true ? .red : .orange))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if isAssigning {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Assigning \(user.name)")
            } else if recommendation?.blockingConflict != true {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.statusText(.purple))
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "nosign")
                    .foregroundStyle(Color.statusText(.red))
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var primaryContext: String {
        if let context = recommendation?.primaryContext { return context }
        if let primaryArea = user.primaryArea, !primaryArea.isEmpty {
            return isPrimaryAreaMatch ? "Primary \(primaryArea.shiftAreaLabel)" : primaryArea.shiftAreaLabel
        }
        return user.email
    }

    @ViewBuilder
    private func fitPill(_ recommendation: CandidateRecommendation) -> some View {
        let tone: StatusTone = if recommendation.blockingConflict {
            .red
        } else if recommendation.bucket == "recommended" {
            .purple
        } else if recommendation.bucket == "good_fit" {
            .blue
        } else {
            .orange
        }
        StatusPill(
            label: recommendation.blockingConflict ? "Unavailable" : recommendation.fitLabel,
            tone: tone
        )
    }

    private var accessibilityLabel: String {
        var parts = [user.name, primaryContext]
        if let recommendation { parts.append(recommendation.fitLabel) }
        if let warningText { parts.append(warningText) }
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
