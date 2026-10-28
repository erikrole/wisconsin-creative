import SwiftUI

/// Staff view of every student's availability: a Mon–Sun day strip with week
/// arrows over a searchable student list. Each row shows that student's blocks
/// for the chosen day (venue time, America/Chicago). Read only; edits happen in
/// the student's own Availability screen.
struct TeamAvailabilityView: View {
    /// Preloaded students for previews and capture fixtures; skips the network.
    var fixture: [TeamAvailabilityStudent]?
    var initialDay: String?

    @State private var students: [TeamAvailabilityStudent] = []
    @State private var selectedDay = TeamAvailabilityDays.todayKey()
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var error: String?

    private var weekKeys: [String] { TeamAvailabilityDays.weekKeys(of: selectedDay) }

    private var filtered: [TeamAvailabilityStudent] {
        let q = searchText.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return students }
        return students.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        List {
            Section {
                weekHeader
                dayStrip
            }
            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Try Again") { Task { await load() } }
                        .tint(Color.brandPrimary)
                }
            }

            Section {
                if isLoading && students.isEmpty {
                    ProgressView().frame(maxWidth: .infinity)
                } else if filtered.isEmpty {
                    Text(searchText.isEmpty ? "No students yet." : "No students match “\(searchText)”.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filtered) { student in
                        NavigationLink {
                            TeamAvailabilityStudentView(student: student)
                        } label: {
                            TeamAvailabilityRow(student: student, dayKey: selectedDay)
                        }
                    }
                }
            } header: {
                Text(TeamAvailabilityDays.title(selectedDay))
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Team Availability")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search students")
        .task {
            if let initialDay { selectedDay = initialDay }
            await load()
        }
        .refreshable { await load() }
    }

    private var weekHeader: some View {
        HStack {
            Button {
                shiftWeek(-1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .accessibilityLabel("Previous week")
            Spacer()
            Text(TeamAvailabilityDays.weekRangeTitle(selectedDay))
                .font(.subheadline.weight(.semibold))
            Spacer()
            Button {
                shiftWeek(1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .accessibilityLabel("Next week")
        }
        .buttonStyle(.borderless)
        .tint(Color.brandPrimary)
    }

    private var dayStrip: some View {
        let today = TeamAvailabilityDays.todayKey()
        return HStack(spacing: 4) {
            ForEach(weekKeys, id: \.self) { key in
                let isSelected = key == selectedDay
                Button {
                    selectedDay = key
                    Haptics.selection()
                } label: {
                    VStack(spacing: 3) {
                        Text(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][TeamAvailabilityDays.weekday(key)])
                            .font(.caption2.weight(.medium))
                        Text("\(TeamAvailabilityDays.dayNumber(key))")
                            .font(.body.weight(isSelected ? .semibold : .regular))
                        Circle()
                            .fill(key == today ? (isSelected ? Color.white : Color.brandPrimary) : Color.clear)
                            .frame(width: 4, height: 4)
                    }
                    .foregroundStyle(isSelected ? Color.white : Color.primary)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(isSelected ? Color.brandPrimary : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(TeamAvailabilityDays.title(key))
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private func shiftWeek(_ delta: Int) {
        selectedDay = TeamAvailabilityDays.addDays(selectedDay, delta * 7)
        Haptics.selection()
    }

    private func load() async {
        if let fixture {
            students = fixture
            isLoading = false
            return
        }
        isLoading = true
        error = nil
        do {
            students = try await APIClient.shared.teamAvailability()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

private struct TeamAvailabilityRow: View {
    let student: TeamAvailabilityStudent
    let dayKey: String

    var body: some View {
        let dayBlocks = TeamAvailabilityDays.blocks(student.blocks, on: dayKey)
        HStack(alignment: .top, spacing: 12) {
            UserAvatarView(name: student.name, avatarUrl: student.avatarUrl, size: 36)
            VStack(alignment: .leading, spacing: 6) {
                Text(student.name)
                    .font(.body)
                if student.blocks.isEmpty {
                    Text("-").font(.subheadline).foregroundStyle(.secondary)
                } else if dayBlocks.isEmpty {
                    Text("Free").font(.subheadline).foregroundStyle(Color.statusText(.green))
                } else {
                    TeamAvailabilityChips(blocks: dayBlocks)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct TeamAvailabilityChips: View {
    let blocks: [AvailabilityBlock]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(blocks) { TeamAvailabilityChip(block: $0) }
        }
    }
}

private struct TeamAvailabilityChip: View {
    let block: AvailabilityBlock

    private var tone: StatusTone {
        switch block.normalizedIntent {
        case "PREFER": .green
        case "DISLIKE": .orange
        default: .red
        }
    }

    private var isPending: Bool { block.normalizedStatus == "PENDING" }

    var body: some View {
        let color = Color.statusText(tone)
        Text(block.chipText)
            .font(.caption.weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(isPending ? 0.04 : 0.14)))
            .overlay(
                Capsule().strokeBorder(
                    color.opacity(isPending ? 0.8 : 0),
                    style: StrokeStyle(lineWidth: 1, dash: isPending ? [3, 2] : [])
                )
            )
            .accessibilityLabel("\(block.intentMetadata.label), \(block.chipText)\(isPending ? ", pending" : "")")
    }
}

private extension AvailabilityBlock {
    var chipText: String {
        if normalizedAllDay { return "All day" }
        return "\(Self.short(startsAt))–\(Self.short(endsAt))"
    }

    static func short(_ hhmm: String) -> String {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return hhmm }
        let hour = p[0] % 12 == 0 ? 12 : p[0] % 12
        return "\(hour)\(p[1] == 0 ? "" : String(format: ":%02d", p[1]))\(p[0] < 12 ? "a" : "p")"
    }
}

/// Wrapping row of chips.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (i, origin) in result.origins.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for sub in subviews {
            let size = sub.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}

/// Read-only view of one student's saved availability. The editable screen is
/// the student's own; staff review here without risking edits.
struct TeamAvailabilityStudentView: View {
    let student: TeamAvailabilityStudent

    private let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    private var weekly: [AvailabilityBlock] { student.blocks.filter(\.isWeekly) }
    private var dated: [AvailabilityBlock] {
        student.blocks.filter(\.isDated).sorted { ($0.dateValue ?? "") < ($1.dateValue ?? "") }
    }

    var body: some View {
        List {
            if student.blocks.isEmpty {
                Section {
                    Text("\(student.name) hasn’t added any availability.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            // Monday first, matching the team grid.
            ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { day in
                let rows = weekly.filter { $0.dayOfWeek == day }.sorted { $0.startsAt < $1.startsAt }
                if !rows.isEmpty {
                    Section(dayNames[day]) { ForEach(rows) { row($0) } }
                }
            }
            if !dated.isEmpty {
                Section("Days away") { ForEach(dated) { row($0) } }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(student.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ block: AvailabilityBlock) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(block.primaryLine)
            Text(block.secondaryLine).font(.subheadline).foregroundStyle(.secondary)
            if let status = block.statusLine {
                Text(status).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
