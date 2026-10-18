import SwiftUI

/// Read-only history for one reservation or checkout. Extend stays the booking's
/// main action. Collaborators never reach this screen.
@MainActor
@Observable
final class BookingActivityModel {
    var page: BookingActivityPage?
    var isLoading = false
    var error: String?

    @ObservationIgnored private var loads = LatestRequestGeneration()

    func load(bookingId: String, force: Bool) async {
        if !force, page != nil, error == nil {
            return
        }
        let token = loads.begin()
        if page == nil {
            isLoading = true
        }
        error = nil
        defer {
            if loads.owns(token) {
                isLoading = false
            }
        }
        do {
            let next = try await APIClient.shared.bookingActivity(id: bookingId)
            guard loads.owns(token), !Task.isCancelled else { return }
            page = next
            self.error = nil
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            guard loads.owns(token), !Task.isCancelled else { return }
            if page == nil {
                self.error = "Couldn't load activity."
            }
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            if page == nil {
                self.error = "Couldn't load activity."
            } else {
                self.error = "Couldn't refresh. The list is unchanged."
            }
        }
    }
}

struct BookingActivityView: View {
    let bookingId: String

    @State private var model = BookingActivityModel()
    @State private var filter: BookingActivityFilter = .all

    var body: some View {
        Group {
            if model.isLoading && model.page == nil {
                ProgressView("Loading activity")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let message = model.error, model.page == nil {
                ContentUnavailableView {
                    Label("Couldn't load activity", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Retry") { Task { await model.load(bookingId: bookingId, force: true) } }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                activityList
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Show", selection: $filter) {
                        ForEach(BookingActivityFilter.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                } label: {
                    Label(filter.title, systemImage: "line.3.horizontal.decrease")
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Activity filter, \(filter.title)")
            }
        }
        .task { await model.load(bookingId: bookingId, force: false) }
        .refreshable { await model.load(bookingId: bookingId, force: true) }
    }

    private var rows: [BookingActivityEntry] {
        BookingActivityCopy.rows(model.page?.auditLogs ?? [], filter: filter)
    }

    private var activityList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Brand.Space.sm) {
                if let message = model.error, model.page != nil {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                activityCard
                if model.page?.hasMoreAuditLogs == true {
                    Text("Older activity stays on the website.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.vertical, Brand.Space.sm)
        }
    }

    private var activityCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            if rows.isEmpty {
                Text(filter == .all ? "No activity yet" : "No matching activity.")
                    .font(.body)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                    activityRow(entry)
                    if index < rows.count - 1 {
                        Divider()
                    }
                }
            }
        }
        .brandCard()
    }

    private func activityRow(_ entry: BookingActivityEntry) -> some View {
        HStack(alignment: .center, spacing: Brand.Space.sm) {
            UserAvatarView(
                name: BookingActivityCopy.actorName(entry),
                avatarUrl: entry.actor?.avatarUrl,
                size: 36,
                fallbackBackground: Color(.secondarySystemFill),
                fallbackForeground: .secondary,
                showsBorder: false
            )
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: Brand.Space.sm) {
                    Text(BookingActivityCopy.actorName(entry))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Spacer(minLength: Brand.Space.sm)
                    Text(BookingActivityCopy.when(entry.createdAt))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text(BookingActivityCopy.sentence(entry))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = BookingActivityCopy.detail(entry) {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
