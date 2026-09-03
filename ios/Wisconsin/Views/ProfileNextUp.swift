import SwiftUI

/// A person's Next Up, in the shape Home already uses for your own.
///
/// Home's Next Up answers "what is coming for me". A profile asks the same
/// question about somebody else, so it gets the same card rather than a
/// different arrangement of the same facts: one chronological list of gear and
/// shifts, overdue pinned above it, each row coloured from the domain it
/// belongs to.
struct ProfileNextUpCard: View {
    let checkouts: [Booking]
    let reservations: [Booking]
    let shifts: [MyShift]
    let openBooking: (String) -> Void
    let openShift: (MyShift) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BrandSectionHeader(
                "Next Up",
                subtitle: "Upcoming pickups, reservations, shifts, and due work."
            )

            if entries.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    Text("Nothing coming up")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .combine)
            } else {
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        row(for: entry)
                        if entry.id != entries.last?.id {
                            // Inset to the title so the rail and glyph column
                            // read as one stack of kinds down the left edge.
                            Divider().padding(.leading, 46)
                        }
                    }
                }
            }
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
    }

    // MARK: - Entries

    /// Overdue first, then everything else by when it actually happens. Grouping
    /// by kind instead would put a Sunday shift above a checkout due Thursday,
    /// which reads as an ordering bug on a list whose whole job is "what's next".
    private var entries: [ProfileNextUpEntry] {
        let now = Date()
        var overdue: [ProfileNextUpEntry] = []
        var upcoming: [ProfileNextUpEntry] = []

        for booking in checkouts {
            if booking.status == .open && booking.endsAt < now {
                overdue.append(ProfileNextUpEntry(id: "overdue-\(booking.id)", sortsAt: booking.endsAt, kind: .booking(booking)))
            } else {
                upcoming.append(ProfileNextUpEntry(id: "gear-\(booking.id)", sortsAt: bookingSortDate(booking), kind: .booking(booking)))
            }
        }
        for booking in reservations {
            upcoming.append(ProfileNextUpEntry(id: "res-\(booking.id)", sortsAt: booking.startsAt, kind: .booking(booking)))
        }
        // Gear a shift already has is listed on its own row above; the shift row
        // states where to be, and nothing else.
        for shift in shifts {
            upcoming.append(ProfileNextUpEntry(id: "shift-\(shift.id)", sortsAt: shift.event.startsAt, kind: .shift(shift)))
        }

        overdue.sort { $0.sortsAt < $1.sortsAt }
        upcoming.sort { $0.sortsAt == $1.sortsAt ? $0.id < $1.id : $0.sortsAt < $1.sortsAt }
        return Array((overdue + upcoming).prefix(6))
    }

    /// A pickup sorts on when it can be collected; anything already out sorts on
    /// when it is due back.
    private func bookingSortDate(_ booking: Booking) -> Date {
        booking.status == .pendingPickup ? booking.startsAt : booking.endsAt
    }

    // MARK: - Rows

    @ViewBuilder
    private func row(for entry: ProfileNextUpEntry) -> some View {
        switch entry.kind {
        case .booking(let booking):
            ProfileNextUpRow(
                tone: bookingTone(booking),
                systemImage: "shippingbox.fill",
                title: booking.title,
                detail: bookingDetail(booking),
                meta: bookingMeta(booking),
                action: { openBooking(booking.id) }
            )
        case .shift(let shift):
            ProfileNextUpRow(
                tone: venueTone(isHome: shift.event.isHome),
                systemImage: "calendar",
                title: scheduleEventDisplayTitle(shift.asScheduleEvent),
                detail: shiftDetail(shift),
                meta: shift.event.startsAt.formatted(date: .omitted, time: .shortened),
                action: { openShift(shift) }
            )
        }
    }

    // MARK: - Row copy

    /// Booking rows read the status palette from `docs/COLOR_SYSTEM.md`: purple
    /// reserved, orange awaiting pickup, blue checked out, red overdue, with the
    /// sanctioned deadline ramp taking an open checkout orange on its due day.
    private func bookingTone(_ booking: Booking) -> StatusTone {
        if booking.status == .open && booking.endsAt < Date() { return .red }
        switch booking.status {
        case .booked: return booking.kind == .reservation ? .purple : .blue
        case .pendingPickup: return .orange
        case .open: return Calendar.current.isDateInToday(booking.endsAt) ? .orange : .blue
        default: return .gray
        }
    }

    private func bookingDetail(_ booking: Booking) -> String {
        let count = booking.serializedItems.count + booking.bulkItems.count
        var parts = [booking.location.name]
        if count > 0 { parts.append("\(count) item\(count == 1 ? "" : "s")") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func bookingMeta(_ booking: Booking) -> String {
        let now = Date()
        if booking.status == .pendingPickup {
            return booking.startsAt < now
                ? "Pickup \(booking.startsAt.lateLabel)"
                : "Pickup \(booking.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
        }
        if booking.kind == .reservation && booking.status == .booked {
            return booking.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        }
        if booking.status == .open && booking.endsAt < now {
            return booking.endsAt.overdueLabel
        }
        return "Due \(booking.endsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }

    /// The date, then the explicit Student report time. Staff assignments do
    /// not substitute the event time into the call-time position.
    private func shiftDetail(_ shift: MyShift) -> String {
        var parts = [shift.event.startsAt.formatted(.dateTime.weekday(.wide).month(.wide).day())]
        if shift.workerType == "ST", let callStartsAt = shift.callStartsAt {
            parts.append("Call time \(callStartsAt.formatted(date: .omitted, time: .shortened))")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Entry

private struct ProfileNextUpEntry: Identifiable {
    enum Kind {
        case booking(Booking)
        case shift(MyShift)
    }

    let id: String
    let sortsAt: Date
    let kind: Kind
}

// MARK: - Row

/// Same anatomy as Home's Next Up rows and the Bookings list: accent rail, kind
/// glyph, Gotham title, one supporting line, tone-coloured meta, chevron.
private struct ProfileNextUpRow: View {
    let tone: StatusTone
    let systemImage: String
    let title: String
    let detail: String
    let meta: String
    let action: () -> Void

    @State private var hapticTrigger = false

    var body: some View {
        Button {
            hapticTrigger.toggle()
            action()
        } label: {
            HStack(spacing: 12) {
                StatusRail(tone: tone)
                Image(systemName: systemImage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.statusText(tone))
                    .frame(width: 18)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !detail.isEmpty {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                Text(meta)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.statusText(tone))
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(detail), \(meta)")
    }
}
