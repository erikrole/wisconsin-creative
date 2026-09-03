import SwiftUI

struct TradePostCandidate: Identifiable, Hashable {
    let id: String
    let area: String
    let eventTitle: String
    let startsAt: Date
    let endsAt: Date
    let ownerName: String
    let isCurrentUser: Bool

    init(shift: MyShift) {
        id = shift.id
        area = shift.area
        eventTitle = shift.event.summary
        let event = shift.asScheduleEvent
        if shift.workerType == "ST", event.venue == .away || event.venue == .neutral {
            startsAt = event.startsAt
            endsAt = event.endsAt
        } else {
            startsAt = shift.callStartsAt ?? shift.startsAt
            endsAt = shift.callEndsAt ?? shift.endsAt
        }
        ownerName = "You"
        isCurrentUser = true
    }

    init(
        assignment: ShiftAssignmentRecord,
        shift: EventShift,
        eventTitle: String,
        currentUserId: String?,
        event: ScheduleEvent? = nil
    ) {
        id = assignment.id
        area = shift.area
        self.eventTitle = eventTitle
        if shift.workerType == "ST", let event, event.venue == .away || event.venue == .neutral,
           shift.callStartsAt == nil {
            startsAt = event.startsAt
            endsAt = event.endsAt
        } else {
            startsAt = shift.callStartsAt ?? shift.startsAt
            endsAt = shift.callEndsAt ?? shift.endsAt
        }
        ownerName = assignment.user.name
        isCurrentUser = assignment.user.id == currentUserId
    }
}

struct PostTradeSheet: View {
    let candidates: [TradePostCandidate]
    let initiallySelectedId: String?
    let wrapsInNavigationStack: Bool
    let onPosted: (TradePostCandidate) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedId: String?
    @State private var notes = ""
    @State private var isPosting = false
    @State private var error: String?
    @State private var showDiscardConfirm = false

    init(
        myShifts: [MyShift],
        wrapsInNavigationStack: Bool = true,
        onPosted: @escaping (TradePostCandidate) -> Void
    ) {
        let now = Date()
        let candidates = myShifts
            .filter { $0.startsAt > now && $0.statusValue == .active }
            .map { TradePostCandidate(shift: $0) }
            .sorted { $0.startsAt < $1.startsAt }
        self.candidates = candidates
        initiallySelectedId = candidates.count == 1 ? candidates.first?.id : nil
        self.wrapsInNavigationStack = wrapsInNavigationStack
        self.onPosted = onPosted
        _selectedId = State(initialValue: initiallySelectedId)
    }

    init(
        candidate: TradePostCandidate,
        wrapsInNavigationStack: Bool = true,
        onPosted: @escaping (TradePostCandidate) -> Void
    ) {
        candidates = [candidate]
        initiallySelectedId = candidate.id
        self.wrapsInNavigationStack = wrapsInNavigationStack
        self.onPosted = onPosted
        _selectedId = State(initialValue: candidate.id)
    }

    private var selectedCandidate: TradePostCandidate? {
        candidates.first { $0.id == selectedId }
    }

    private var hasUnsavedInput: Bool {
        selectedId != initiallySelectedId || !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack {
                postContent
            }
        } else {
            postContent
        }
    }

    private var postContent: some View {
            ScrollView {
                VStack(spacing: 16) {
                    if candidates.isEmpty {
                        emptyState
                    } else {
                        if candidates.count > 1 {
                            shiftSelectionCard
                        }
                        if let selectedCandidate {
                            selectedShiftCard(selectedCandidate)
                            consequenceCard(selectedCandidate)
                            notesCard
                        }
                    }

                    if let error {
                        postErrorCard(message: error)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Post to Trade Board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { attemptCancel() }
                        .disabled(isPosting)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !candidates.isEmpty {
                    Button {
                        Task { await post() }
                    } label: {
                        HStack(spacing: 8) {
                            if isPosting {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "arrow.left.arrow.right")
                            }
                            Text("Post to Trade Board")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.statusText(.purple))
                    .controlSize(.large)
                    .disabled(selectedCandidate == nil || isPosting)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.bar)
                }
            }
            .interactiveDismissDisabled(hasUnsavedInput || isPosting)
            .confirmationDialog(
                "Discard trade post?",
                isPresented: $showDiscardConfirm,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("Your selection and note will be lost.")
            }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var shiftSelectionCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Choose a Shift")
                .font(.headline)
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 8)

            ForEach(Array(candidates.enumerated()), id: \.element.id) { index, candidate in
                Button {
                    selectedId = candidate.id
                    error = nil
                    Haptics.selection()
                } label: {
                    TradeCandidateRow(
                        candidate: candidate,
                        isSelected: selectedId == candidate.id
                    )
                }
                .buttonStyle(.plain)

                if index < candidates.count - 1 {
                    Divider().padding(.leading, 60)
                }
            }
        }
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private func selectedShiftCard(_ candidate: TradePostCandidate) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.statusText(.orange))
                .frame(width: 4, height: 68)

            VStack(alignment: .leading, spacing: 4) {
                Text(candidate.eventTitle)
                    .font(.headline)
                    .lineLimit(2)
                Text("\(candidate.area.shiftAreaLabel) · \(candidate.ownerName)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(timeRange(candidate))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func consequenceCard(_ candidate: TradePostCandidate) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "person.crop.circle.badge.clock")
                .font(.title3)
                .foregroundStyle(Color.statusText(.purple))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(candidate.isCurrentUser ? "You stay assigned" : "\(candidate.ownerName) stays assigned")
                    .font(.subheadline.weight(.semibold))
                Text("The shift stays on the schedule until an Admin approves a claim.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color.statusBackground(.purple), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var notesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Note")
                .font(.headline)
            TextField("Optional context for the person claiming it", text: $notes, axis: .vertical)
                .lineLimit(2...4)
                .disabled(isPosting)
        }
        .padding(16)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.lg, style: .continuous))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No shifts to post", systemImage: "calendar.badge.exclamationmark")
        } description: {
            Text("Only active, upcoming shifts can be posted to the Trade Board.")
        }
        .frame(maxWidth: .infinity, minHeight: 360)
    }

    private func postErrorCard(message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.statusText(.red))
            VStack(alignment: .leading, spacing: 4) {
                Text("Couldn't post shift")
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Retry") { Task { await post() } }
                .font(.caption.weight(.semibold))
                .disabled(isPosting || selectedCandidate == nil)
        }
        .padding(14)
        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private func attemptCancel() {
        guard !isPosting else { return }
        if hasUnsavedInput {
            showDiscardConfirm = true
        } else {
            dismiss()
        }
    }

    private func timeRange(_ candidate: TradePostCandidate) -> String {
        let calendar = Calendar.current
        let date: String
        if calendar.component(.year, from: candidate.startsAt) == calendar.component(.year, from: .now) {
            date = candidate.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        } else {
            date = candidate.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
        }
        return "\(date) · \(candidate.startsAt.formatted(date: .omitted, time: .shortened)) to \(candidate.endsAt.formatted(date: .omitted, time: .shortened))"
    }

    private func post() async {
        guard let candidate = selectedCandidate, !isPosting else { return }
        isPosting = true
        error = nil
        defer { isPosting = false }
        do {
            let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await APIClient.shared.postShiftTrade(
                assignmentId: candidate.id,
                notes: trimmedNotes.isEmpty ? nil : trimmedNotes
            )
            Haptics.success()
            onPosted(candidate)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
        }
    }
}

private struct TradeCandidateRow: View {
    let candidate: TradePostCandidate
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: areaIcon)
                .frame(width: 28, height: 28)
                .foregroundStyle(Color.statusText(.purple))
                .background(Color.statusBackground(.purple), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(candidate.eventTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text("\(candidate.area.shiftAreaLabel) · \(candidate.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.statusText(.purple) : Color.secondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(candidate.area.shiftAreaLabel) shift, \(candidate.eventTitle)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var areaIcon: String {
        switch candidate.area {
        case "VIDEO": "video.fill"
        case "PHOTO": "camera.fill"
        case "GRAPHICS": "paintpalette.fill"
        case "SOCIAL": "person.2.fill"
        case "COMMS": "dot.radiowaves.left.and.right"
        default: "person.fill"
        }
    }
}
