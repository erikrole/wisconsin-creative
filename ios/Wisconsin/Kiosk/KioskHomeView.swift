import SwiftUI

// MARK: - Home (redesign frames A1–A4, D1)
//
// Game day (A3): a today event with linked pickups or checkouts, or crew
// without gear, gets its own card at the top -- pickups first, then what's
// out, then a "Crew without gear" line. Anything not linked to an event falls
// through to the ordinary sections below it.
//
// Clock band on top; sectioned custody cards on the left (overdue, due back
// today, out and due later); Today tiles and the Everyone grid on the right.
// Status stays hidden while healthy -- only a real problem (offline) shows in
// the clock band. Pure presentation: `KioskIdleView` owns loading, scanning,
// sheets, and standby.

struct KioskHomeView: View {
    @Environment(\.today) private var today
    let locationName: String?
    let checkouts: [KioskActiveCheckout]
    var pickups: [KioskDashboard.HomePickup] = []
    var events: [KioskEvent] = []
    var serverToday: [KioskDashboard.TodayTile] = []
    /// Checkouts nudged on this iPad since the last refresh.
    var nudgedIds: Set<String> = []
    let users: [KioskUser]
    let isLoaded: Bool
    /// When the last refresh succeeded, if refreshes are failing now.
    let offlineSince: Date?
    let lastLoadedAt: Date?
    let nextUp: String?
    let onOpenCheckout: (KioskActiveCheckout) -> Void
    var onNudge: ((KioskActiveCheckout) -> Void)?
    let onSelectUser: (KioskUser) -> Void
    let onRevealStatus: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            clockBand
            HStack(spacing: 0) {
                custodyPanel
                    .frame(width: 500)
                    .frame(maxHeight: .infinity, alignment: .top)
                Rectangle().fill(KioskStroke.divider).frame(width: 1)
                peoplePanel
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: Clock band

    private var clockBand: some View {
        HStack(alignment: .top, spacing: 20) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 4) {
                    clock(context.date)
                    Text(dateLine(context.date))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(KioskText.secondary)
                }
                .accessibilityElement(children: .combine)
            }
            // Staff reach device status with a long press on the clock; the
            // band itself stays quiet while everything is healthy.
            .onLongPressGesture(minimumDuration: 0.8, perform: onRevealStatus)
            Spacer(minLength: 16)
            if let offlineSince {
                offlineNotice(since: offlineSince)
            }
        }
        .padding(.horizontal, KioskSpacing.xl)
        .padding(.top, KioskSpacing.screenTop)
        .frame(height: 132, alignment: .top)
    }

    private func clock(_ date: Date) -> some View {
        let parts = date.kioskClockParts()
        let seconds = String(parts.seconds.dropFirst())
        let time = Text(parts.time).font(KioskType.displayClock).foregroundStyle(KioskText.primary)
        let colon = Text(":").font(KioskType.displayClock).foregroundStyle(Color.white)
        let secs = Text(seconds).font(KioskType.displayClockSeconds).foregroundStyle(KioskText.primary)
        let meridiem = Text(" \(parts.meridiem)").font(KioskType.displayClockMeridiem).foregroundStyle(KioskText.tertiary)
        return Text("\(time)\(colon)\(secs)\(meridiem)")
            .lineLimit(1)
            .accessibilityLabel(Text(date, format: .dateTime.hour().minute()))
    }

    private func dateLine(_ date: Date) -> String {
        let day = date.formatted(.dateTime.weekday(.wide).month(.wide).day())
        guard let locationName, !locationName.isEmpty else { return day }
        return "\(day) · \(locationName)"
    }

    private func offlineNotice(since: Date) -> some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let minutes = max(1, Int(context.date.timeIntervalSince(since) / 60))
            VStack(alignment: .trailing, spacing: 2) {
                Text("Offline for \(minutes) min")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(KioskStatus.problem)
                if let lastLoadedAt {
                    Text("Showing what was true at \(lastLoadedAt.formatted(.dateTime.hour().minute()))")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .kioskCard(KioskSection.problem.stageFill, radius: KioskRadius.xl, stroke: KioskSection.problem.stageStroke)
            .accessibilityElement(children: .combine)
        }
        .padding(.top, 10)
    }

    // MARK: Custody panel

    private struct CustodySection: Identifiable {
        let id: String
        let title: String
        let rows: [KioskActiveCheckout]
    }

    private struct EventGroup: Identifiable {
        let event: KioskEvent
        let pickups: [KioskDashboard.HomePickup]
        let checkouts: [KioskActiveCheckout]
        /// "Wes H. (call 9:00)"; call time comes from the event's assignments.
        let crew: [String]
        var id: String { event.id }
    }

    /// Today's events that have something to show, in start order.
    private var eventGroups: [EventGroup] {
        let now = Date()
        return events
            .filter { Calendar.current.dayOffset(of: $0.startsAt, from: today) == 0 }
            .sorted { $0.startsAt < $1.startsAt }
            .compactMap { event in
                let linkedPickups = pickups.filter { $0.eventId == event.id }.sorted { $0.readyAt < $1.readyAt }
                let linkedCheckouts = checkouts
                    .filter { $0.eventId == event.id && !($0.isOverdue || $0.endsAt < now) }
                    .sorted { $0.endsAt < $1.endsAt }
                let calls = Dictionary(event.assignedUsers.map { ($0.id, $0.callStartsAt) }, uniquingKeysWith: { first, _ in first })
                let crew = event.crewWithoutGear.map { member -> String in
                    let name = homePersonName(member.name)
                    guard let call = calls[member.id] ?? nil else { return name }
                    return "\(name) (call \(call.formatted(.dateTime.hour().minute())))"
                }
                guard !linkedPickups.isEmpty || !linkedCheckouts.isEmpty || !crew.isEmpty else { return nil }
                return EventGroup(event: event, pickups: linkedPickups, checkouts: linkedCheckouts, crew: crew)
            }
    }

    private var sections: [CustodySection] {
        sections(excluding: [])
    }

    private func sections(excluding grouped: Set<String>) -> [CustodySection] {
        let now = Date()
        let calendar = Calendar.current
        let sorted = checkouts.filter { !grouped.contains($0.id) }.sorted { $0.endsAt < $1.endsAt }
        let overdue = sorted.filter { $0.isOverdue || $0.endsAt < now }
        let dueToday = sorted.filter { !$0.isOverdue && $0.endsAt >= now && calendar.dayOffset(of: $0.endsAt, from: today) == 0 }
        let later = sorted.filter { !$0.isOverdue && $0.endsAt >= now && calendar.dayOffset(of: $0.endsAt, from: today) != 0 }
        return [
            CustodySection(id: "overdue", title: "Overdue", rows: overdue),
            CustodySection(id: "today", title: "Due back today", rows: dueToday),
            CustodySection(id: "later", title: "Out, due later", rows: later),
        ].filter { !$0.rows.isEmpty }
    }

    @ViewBuilder
    private var custodyPanel: some View {
        let groups = eventGroups
        let sections = sections(excluding: Set(groups.flatMap { $0.checkouts.map(\.id) }))
        let groupedPickupIds = Set(groups.flatMap { $0.pickups.map(\.id) })
        let pickups = pickups.filter { !groupedPickupIds.contains($0.id) }
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(groups) { group in eventCard(group) }
                if isLoaded && groups.isEmpty && sections.isEmpty && pickups.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Everything is in.")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(KioskText.primary)
                        if let nextUp {
                            Text("Next up: \(nextUp).")
                                .font(KioskType.meta)
                                .foregroundStyle(KioskText.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .kioskCard()
                }
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 6) {
                        KioskSectionHeader(title: section.title, count: "\(section.rows.count)")
                        VStack(spacing: 0) {
                            ForEach(section.rows) { checkout in
                                HomeCustodyRow(
                                    checkout: checkout,
                                    isNudged: checkout.nudgedToday == true || nudgedIds.contains(checkout.id),
                                    onNudge: section.id == "overdue" && checkout.custodyScope != "SHARED" ? onNudge.map { nudge in { nudge(checkout) } } : nil
                                ) { onOpenCheckout(checkout) }
                            }
                        }
                        .padding(.vertical, 6)
                        .kioskCard()
                    }
                    if section.id == "today", !pickups.isEmpty { pickupSection(pickups) }
                }
                if !pickups.isEmpty && !sections.contains(where: { $0.id == "today" }) { pickupSection(pickups) }
            }
            .padding(.leading, KioskSpacing.xl)
            .padding(.trailing, KioskSpacing.lg)
            .padding(.top, 4)
            .padding(.bottom, KioskSpacing.screenBottom)
        }
        .scrollIndicators(.hidden)
    }

    private func eventCard(_ group: EventGroup) -> some View {
        let time = group.event.displayAllDay ? "All day" : group.event.startsAt.formatted(.dateTime.hour().minute())
        var counts: [String] = []
        if !group.pickups.isEmpty { counts.append("\(group.pickups.count) pickup\(group.pickups.count == 1 ? "" : "s")") }
        if !group.checkouts.isEmpty { counts.append("\(group.checkouts.count) out") }
        return VStack(alignment: .leading, spacing: 6) {
            KioskSectionHeader(title: "\(group.event.title) · \(time)", count: counts.joined(separator: " · "))
            VStack(spacing: 0) {
                ForEach(group.pickups) { pickup in
                    HomePickupRow(pickup: pickup, showsHolderFirst: true) { selectPickupHolder(pickup) }
                }
                ForEach(group.checkouts) { checkout in
                    HomeCustodyRow(checkout: checkout, showsHolderFirst: true) { onOpenCheckout(checkout) }
                }
                if !group.crew.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Crew without gear")
                            .font(KioskType.chipStrong)
                            .foregroundStyle(KioskStatus.attention)
                        Text(group.crew.joined(separator: " · "))
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.vertical, 6)
            .kioskCard()
        }
    }

    private func selectPickupHolder(_ pickup: KioskDashboard.HomePickup) {
        if let id = pickup.requester?.id, let user = users.first(where: { $0.id == id }) {
            onSelectUser(user)
        }
    }

    private func pickupSection(_ pickups: [KioskDashboard.HomePickup]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            KioskSectionHeader(title: "Ready for pickup", count: "\(pickups.count)")
            VStack(spacing: 0) {
                ForEach(pickups) { pickup in
                    HomePickupRow(pickup: pickup) { selectPickupHolder(pickup) }
                }
            }
            .padding(.vertical, 6)
            .kioskCard()
        }
    }

    // MARK: People panel

    /// People with something happening today: overdue or a return due today.
    private var todayPeople: [(user: KioskUser, reason: String, section: KioskSection)] {
        let byId = Dictionary(users.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        var result: [(KioskUser, String, KioskSection)] = []
        let now = Date()
        for checkout in checkouts.sorted(by: { $0.endsAt < $1.endsAt }) where checkout.custodyScope != "SHARED" {
            guard let id = checkout.requesterId, let user = byId[id], !seen.contains(id) else { continue }
            if checkout.isOverdue || checkout.endsAt < now {
                result.append((user, "Overdue", .problem)); seen.insert(id)
            } else if Calendar.current.dayOffset(of: checkout.endsAt, from: today) == 0 {
                result.append((user, "Returning today", .comingBack)); seen.insert(id)
            }
        }
        return result.sorted { ($0.2 == .problem ? 0 : 1) < ($1.2 == .problem ? 0 : 1) }
    }

    private var serverTodayPeople: [(user: KioskUser, reason: String, section: KioskSection)] {
        let byId = Dictionary(users.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return serverToday.compactMap { tile in
            guard let user = byId[tile.userId] else { return nil }
            var parts: [String] = []
            var section: KioskSection = .comingBack
            for reason in tile.reasons {
                switch reason {
                case "overdue": parts.append("Overdue"); section = .problem
                case "pickup":
                    parts.append(tile.pickupAt.map { "Pickup at \($0.formatted(.dateTime.hour().minute()))" } ?? "Pickup ready")
                    if section != .problem { section = .pickingUp }
                case "return_due": parts.append(parts.isEmpty ? "Returning today" : "returning today")
                case "shift_soon":
                    parts.append(tile.callAt.map { "Call at \($0.formatted(.dateTime.hour().minute())) · no gear yet" } ?? "Shift soon · no gear yet")
                    if parts.count == 1 { section = .takingOut }
                default: break
                }
            }
            return (user, parts.joined(separator: " · "), section)
        }
    }

    private var peoplePanel: some View {
        let todayEntries = Array((serverToday.isEmpty ? todayPeople : serverTodayPeople).prefix(6))
        let labels = homeShortNames(for: users)
        let showsPhotos = users.count <= 24
        return VStack(alignment: .leading, spacing: 16) {
            if !todayEntries.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    KioskSectionHeader(title: "Today")
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 2), spacing: 8) {
                        ForEach(todayEntries, id: \.user.id) { entry in
                            HomeTodayTile(user: entry.user, label: labels[entry.user.id] ?? entry.user.name, reason: entry.reason, section: entry.section) {
                                onSelectUser(entry.user)
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("EVERYONE")
                        .font(KioskType.overline)
                        .tracking(KioskType.overlineTracking)
                        .foregroundStyle(KioskText.tertiary)
                    Text("\(users.count)")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.muted)
                }
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: showsPhotos ? 4 : 5), spacing: 6) {
                        ForEach(users) { user in
                            HomePersonTile(user: user, label: labels[user.id] ?? user.name, showsPhoto: showsPhotos) {
                                onSelectUser(user)
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(.leading, KioskSpacing.lg)
        .padding(.trailing, KioskSpacing.xl)
        .padding(.top, 4)
        .padding(.bottom, KioskSpacing.screenBottom)
    }
}

/// "Avery N." -- first name and last initial, the canvas's roster label.
/// First names stay unique enough at this fleet size; the initial settles ties.
func homeShortNames(for users: [KioskUser]) -> [String: String] {
    var labels: [String: String] = [:]
    for user in users {
        let parts = user.name.split(separator: " ")
        guard let first = parts.first else { labels[user.id] = user.name; continue }
        if parts.count > 1, let initial = parts.last?.first {
            labels[user.id] = "\(first) \(initial)."
        } else {
            labels[user.id] = String(first)
        }
    }
    return labels
}

private func homePersonName(_ full: String) -> String {
    let parts = full.split(separator: " ")
    guard let first = parts.first else { return full }
    if parts.count > 1, let initial = parts.last?.first { return "\(first) \(initial)." }
    return String(first)
}

// MARK: - Rows and tiles

private struct HomeCustodyRow: View {
    @Environment(\.today) private var today
    let checkout: KioskActiveCheckout
    /// Inside an event card the event is the heading, so the row leads with
    /// the person: "Imani B. · 3 items".
    var showsHolderFirst: Bool = false
    var isNudged: Bool = false
    var onNudge: (() -> Void)?
    let action: () -> Void

    private var isOverdue: Bool { checkout.isOverdue || checkout.endsAt < Date() }
    private var isToday: Bool { Calendar.current.dayOffset(of: checkout.endsAt, from: today) == 0 }

    private var dotColor: Color {
        if isOverdue { return KioskSection.problem.accent }
        if isToday { return KioskSection.comingBack.accent }
        if checkout.custodyScope == "SHARED" { return KioskSection.shared.accent }
        return KioskStatus.neutralDot
    }

    private var trailing: (String, Color) {
        if isOverdue {
            let days = Calendar.current.dateComponents([.day], from: checkout.endsAt, to: Date()).day ?? 0
            if days >= 1 { return ("\(days) day\(days == 1 ? "" : "s")", KioskSection.problem.text) }
            let hours = max(1, Int(Date().timeIntervalSince(checkout.endsAt) / 3600))
            return ("\(hours) hr", KioskSection.problem.text)
        }
        if isToday {
            return (checkout.endsAt.formatted(.dateTime.hour().minute()), KioskSection.comingBack.text)
        }
        return (checkout.endsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute()), KioskText.secondary)
    }

    private var holder: String {
        checkout.custodyScope == "SHARED" ? "Shared" : homePersonName(checkout.requesterName)
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle().fill(dotColor).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(showsHolderFirst ? "\(holder) · \(checkout.itemCount) item\(checkout.itemCount == 1 ? "" : "s")" : checkout.title)
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    Text(showsHolderFirst ? (isToday ? "Due \(trailing.0)" : "Due back \(trailing.0)") : "\(holder) · \(checkout.itemCount) item\(checkout.itemCount == 1 ? "" : "s")")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if !showsHolderFirst {
                    Text(trailing.0)
                        .font(KioskType.chipStrong)
                        .foregroundStyle(trailing.1)
                        .lineLimit(1)
                }
                if let onNudge {
                    Button(action: onNudge) {
                        Text(isNudged ? "Nudged" : "Nudge")
                            .font(KioskType.chipStrong)
                            .foregroundStyle(isNudged ? KioskText.muted : KioskSection.problem.text)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 34)
                            .background(isNudged ? Color.clear : Color(red: 0x2A / 255, green: 0x14 / 255, blue: 0x16 / 255), in: Capsule())
                            .overlay(Capsule().stroke(isNudged ? KioskStroke.standard : KioskSection.problem.stageStroke, lineWidth: 1))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isNudged)
                    .accessibilityLabel(isNudged ? "Already nudged today" : "Nudge \(holder) to bring back \(checkout.title)")
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KioskText.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(KioskPressStyle())
        .padding(.horizontal, 6)
        .accessibilityLabel("\(checkout.title), \(holder), \(trailing.0). Open to return or view.")
    }
}

private struct HomeTodayTile: View {
    let user: KioskUser
    let label: String
    let reason: String
    let section: KioskSection
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 42)
                    .overlay(Circle().stroke(KioskSurface.base, lineWidth: 2))
                    .padding(2)
                    .overlay(Circle().stroke(section.accent, lineWidth: 2))
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    Text(reason)
                        .font(KioskType.chip)
                        .foregroundStyle(section.text)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(height: 68)
            .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.lg, stroke: KioskStroke.standard)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityLabel("\(user.name), \(reason)")
    }
}

private struct HomePersonTile: View {
    let user: KioskUser
    let label: String
    let showsPhoto: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if showsPhoto {
                    KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 28)
                }
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: 44)
            .kioskCard(radius: KioskRadius.md)
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityLabel(user.name)
    }
}

private struct HomePickupRow: View {
    let pickup: KioskDashboard.HomePickup
    var showsHolderFirst: Bool = false
    let action: () -> Void

    private var holder: String {
        pickup.custodyScope == "SHARED" ? "Shared" : homePersonName(pickup.requester?.name ?? "")
    }

    private var readyText: String {
        pickup.readyAt <= Date() ? "ready now" : "from \(pickup.readyAt.formatted(.dateTime.hour().minute()))"
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle()
                    .fill(pickup.custodyScope == "SHARED" ? KioskSection.shared.accent : KioskSection.pickingUp.accent)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(showsHolderFirst ? "\(pickup.title) · \(holder)" : pickup.title)
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    Text(showsHolderFirst
                         ? (pickup.custodyScope == "SHARED" ? "Shared · pickup \(readyText)" : "Pickup \(readyText)")
                         : "\(holder) · \(pickup.itemCount) item\(pickup.itemCount == 1 ? "" : "s")")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                }
                Spacer(minLength: 8)
                if !showsHolderFirst {
                    Text(readyText)
                        .font(KioskType.chipStrong)
                        .foregroundStyle(KioskSection.pickingUp.text)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KioskText.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(KioskPressStyle())
        .padding(.horizontal, 6)
        .accessibilityLabel("\(pickup.title), \(holder), \(readyText)")
    }
}
