import SwiftUI

/// Who gets the everyday "can't work" surfaces: student workers editing their
/// own times. Matches the web gate and the Schedule's `canManageAvailability`.
enum CantWorkAccess {
    static func isEnabled(for user: CurrentUser?) -> Bool {
        guard let user else { return false }
        return user.role == "STUDENT" && user.staffingType == "ST" && !user.isReadOnlyRolePreview
    }
}

struct CantWorkAway: Identifiable, Equatable {
    let id: String
    let title: String
    let when: String
}

struct CantWorkSummary: Equatable {
    var away: [CantWorkAway] = []
    var weekly: [String] = []

    /// Upcoming dated "cannot work" entries (soonest first) plus the names of
    /// weekly ones, matching `upcomingAway` / `groupWeekly` on the web.
    static func make(from blocks: [AvailabilityBlock], today: Date = Date(), calendar: Calendar = .current) -> CantWorkSummary {
        let startOfToday = calendar.startOfDay(for: today)
        let unavailable = blocks.filter { ($0.intent ?? "CANNOT_WORK") == "CANNOT_WORK" }

        let dated: [(from: Date, block: AvailabilityBlock, through: Date)] = unavailable.compactMap { block in
            guard (block.kind ?? "WEEKLY") == "AD_HOC",
                  let from = parseDay(block.date),
                  let through = parseDay(block.dateEndsOn) ?? Optional(from),
                  through >= startOfToday else { return nil }
            return (from, block, through)
        }
        .sorted { ($0.from, $0.block.startsAt) < ($1.from, $1.block.startsAt) }

        let away = dated.map { item in
            let dates = formatRange(item.from, item.through)
            let label = item.block.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let when = item.block.allDay == true
                ? dates
                : "\(dates) · \(clock(item.block.startsAt)) – \(clock(item.block.endsAt))"
            return CantWorkAway(id: item.block.id, title: label.isEmpty ? "Can’t work" : label, when: when)
        }

        var seen = Set<String>()
        let weekly = unavailable
            .filter { ($0.kind ?? "WEEKLY") != "AD_HOC" && $0.dayOfWeek != nil }
            .map { block -> String in
                let label = block.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return label.isEmpty ? "Weekly time" : label
            }
            .filter { seen.insert($0).inserted }

        return CantWorkSummary(away: away, weekly: weekly)
    }

    private static func parseDay(_ value: String?) -> Date? {
        guard let value, value.count >= 10 else { return nil }
        return CantWorkFormat.day.date(from: String(value.prefix(10)))
    }

    private static func formatRange(_ from: Date, _ through: Date) -> String {
        let first = CantWorkFormat.short.string(from: from)
        guard !Calendar.current.isDate(from, inSameDayAs: through) else { return first }
        return "\(first) – \(CantWorkFormat.short.string(from: through))"
    }

    private static func clock(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        let hour = parts.first ?? 0
        let minute = parts.count > 1 ? parts[1] : 0
        let display = hour % 12 == 0 ? 12 : hour % 12
        let suffix = hour >= 12 ? "PM" : "AM"
        return minute == 0 ? "\(display) \(suffix)" : "\(display):\(String(format: "%02d", minute)) \(suffix)"
    }
}

enum CantWorkFormat {
    static let day: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static let short: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return f
    }()

    static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

@MainActor
@Observable
final class CantWorkModel {
    private(set) var summary = CantWorkSummary()
    private(set) var isLoaded = false
    private(set) var failed = false

    func load(userId: String) async {
        do {
            let blocks = try await APIClient.shared.availabilityBlocks(userId: userId)
            summary = CantWorkSummary.make(from: blocks)
            failed = false
        } catch {
            failed = !isLoaded
        }
        isLoaded = true
    }
}

/// Home card: the days a student worker can't work, one tap from adding more.
struct CantWorkCard: View {
    @Environment(SessionStore.self) private var session

    @State private var model = CantWorkModel()
    @State private var showAdd = false
    @State private var showAll = false

    private static let previewCount = 3
    private var userId: String { session.currentUser?.id ?? "" }

    var body: some View {
        Group {
            if CantWorkAccess.isEnabled(for: session.currentUser) { card }
        }
        .task(id: userId) {
            guard CantWorkAccess.isEnabled(for: session.currentUser) else { return }
            await model.load(userId: userId)
        }
    }

    private var card: some View {
        let away = model.summary.away
        let weekly = model.summary.weekly
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                FlatSectionTitle("Can’t work")
                Spacer(minLength: 8)
                Button("All times") { showAll = true }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
            }
            if model.failed {
                Text("Couldn’t load the days you can’t work.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if model.isLoaded && away.isEmpty {
                Label("Away for a trip, an exam or another job? Add it so you aren’t scheduled then.", systemImage: "calendar.badge.minus")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(away.prefix(Self.previewCount)) { row in
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 2).fill(Color.orange).frame(width: 3)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.title).font(.subheadline.weight(.bold)).lineLimit(1)
                            Text(row.when).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                }
                if away.count > Self.previewCount {
                    Text("+\(away.count - Self.previewCount) more")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if !weekly.isEmpty {
                Text("Every week: \(weekly.joined(separator: ", "))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Button {
                showAdd = true
            } label: {
                Label("Add days you can’t work", systemImage: "calendar.badge.plus")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showAdd) {
            CantWorkQuickSheet(userId: userId, initialDate: Date()) {
                Task { await model.load(userId: userId) }
            }
        }
        .sheet(isPresented: $showAll, onDismiss: { Task { await model.load(userId: userId) } }) {
            NavigationStack {
                AvailabilityView(userId: userId)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showAll = false }
                        }
                    }
            }
        }
    }
}

/// The quick, everyday way in: one dated "cannot work" entry. The full
/// editor in My Availability stays for weekly times and preferences.
struct CantWorkQuickSheet: View {
    let userId: String
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var from: Date
    @State private var through: Date
    @State private var multipleDays = false
    @State private var allDay = true
    @State private var starts = Calendar.current.date(from: DateComponents(hour: 9)) ?? Date()
    @State private var ends = Calendar.current.date(from: DateComponents(hour: 17)) ?? Date()
    @State private var label = ""
    @State private var isSaving = false
    @State private var error: String?

    init(userId: String, initialDate: Date, onSaved: @escaping () -> Void) {
        self.userId = userId
        self.onSaved = onSaved
        _from = State(initialValue: initialDate)
        _through = State(initialValue: initialDate)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("From", selection: $from, displayedComponents: .date)
                    Toggle("Multiple days", isOn: $multipleDays)
                    if multipleDays {
                        DatePicker("Through", selection: $through, in: from..., displayedComponents: .date)
                    }
                    Toggle("All day", isOn: $allDay)
                    if !allDay {
                        DatePicker("Starts", selection: $starts, displayedComponents: .hourAndMinute)
                        DatePicker("Ends", selection: $ends, displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    Text("A trip, an exam, another job. We won’t schedule you then.")
                }
                Section {
                    TextField("Reason (optional), e.g. Family trip", text: $label)
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }
            }
            .navigationTitle("Can’t work some days?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Add") { Task { await save() } }
                    }
                }
            }
            .onChange(of: from) { _, newValue in
                if through < newValue { through = newValue }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        guard allDay || CantWorkFormat.hhmm(starts) < CantWorkFormat.hhmm(ends) else {
            error = "Start time must be before end time"
            Haptics.warning()
            return
        }
        isSaving = true
        error = nil
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try await APIClient.shared.createAvailabilityBlock(
                userId: userId,
                kind: "AD_HOC",
                intent: "CANNOT_WORK",
                dayOfWeek: Calendar.current.component(.weekday, from: from) - 1,
                date: CantWorkFormat.day.string(from: from),
                dateEndsOn: CantWorkFormat.day.string(from: multipleDays ? through : from),
                allDay: allDay,
                startsAt: allDay ? "00:00" : CantWorkFormat.hhmm(starts),
                endsAt: allDay ? "23:59" : CantWorkFormat.hhmm(ends),
                label: trimmed.isEmpty ? nil : trimmed
            )
            Haptics.success()
            onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            Haptics.error()
            isSaving = false
        }
    }
}
