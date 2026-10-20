@preconcurrency import ActivityKit
import Foundation

@MainActor
final class CheckoutReturnLiveActivityManager {
    static let shared = CheckoutReturnLiveActivityManager()

    private let defaultLeadTime: TimeInterval = 30 * 60
    private let maxNextNeedLeadTime: TimeInterval = 60 * 60
    private var isReconciling = false
    private var observerGeneration = LatestRequestGeneration()
    private var activeObserverGeneration: UUID?
    private var pushToStartObserverTask: Task<Void, Never>?
    private var activityUpdatesObserverTask: Task<Void, Never>?
    private var activityPushTokenObserverTasks: [String: Task<Void, Never>] = [:]
    private var observedActivityIds: Set<String> = []

    private init() {}

    func prepareRemoteStartRegistration() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              PushTokenStorage.registrationAllowed else {
            return
        }
        let generation = beginObserverGenerationIfNeeded()
        observeExistingActivities(generation: generation)
        observePushToStartTokens(generation: generation)
        observeActivityUpdates(generation: generation)
    }

    func reconcileCurrentUserCheckouts(requesterId: String?) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        guard let requesterId else {
            cancelObserverWork()
            await endAll()
            return
        }
        guard PushTokenStorage.registrationAllowed, !isReconciling else { return }
        let generation = beginObserverGenerationIfNeeded()
        isReconciling = true
        defer {
            if observerGeneration.owns(generation) {
                isReconciling = false
            }
        }

        do {
            // `sort: endsAt` so this 5-row window is the soonest due rather than
            // the most recently started — the activity counts down to a return.
            let result = try await APIClient.shared.checkouts(activeOnly: false, status: .open, requesterId: requesterId, sort: "endsAt", limit: 5, offset: 0)
            guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
            let openCheckouts = result.data.filter { $0.kind == .checkout }
            guard !openCheckouts.isEmpty else {
                await endAllAsReturned()
                return
            }

            let candidates = await buildCandidates(from: openCheckouts)
            guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
            guard let selected = candidates.sorted(by: candidateSort).first else {
                await endAllAsReturned()
                return
            }
            await upsertActivity(for: selected, generation: generation)
        } catch {
            // Live Activities are a secondary surface. Leave any existing
            // activity alone on transient network failures.
        }
    }

    /// Stops every long-lived ActivityKit sequence before logout cleanup ends
    /// activities. Generation invalidation also makes already-enqueued
    /// credential writes no-ops if they have not started yet.
    func cancelObserverWork() {
        observerGeneration.invalidate()
        activeObserverGeneration = nil
        isReconciling = false

        pushToStartObserverTask?.cancel()
        pushToStartObserverTask = nil
        activityUpdatesObserverTask?.cancel()
        activityUpdatesObserverTask = nil
        for task in activityPushTokenObserverTasks.values {
            task.cancel()
        }
        activityPushTokenObserverTasks.removeAll()
        observedActivityIds.removeAll()
    }

    func endAll() async {
        for activity in Activity<CheckoutReturnActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Ends any existing activities with a brief green "Returned" confirmation
    /// instead of dismissing immediately, matching the push-driven end path
    /// (`endCheckoutReturnLiveActivityTokens`). Used when the local reconciler
    /// discovers the user's checkout is no longer open (i.e. it was returned
    /// while the app was active), as opposed to logout or stale-activity
    /// housekeeping, which stay `.immediate`.
    private func endAllAsReturned() async {
        let now = Date()
        for activity in Activity<CheckoutReturnActivityAttributes>.activities {
            let returnedState = CheckoutReturnActivityAttributes.ContentState(
                endsAt: activity.content.state.endsAt,
                now: now,
                nextNeedAt: nil,
                allowsExtend: false,
                urgency: .returned
            )
            await activity.end(
                ActivityContent(state: returnedState, staleDate: nil),
                dismissalPolicy: .after(now.addingTimeInterval(120))
            )
        }
    }

    func needsReturnInsight(endsAt: Date, now: Date) -> Bool {
        endsAt <= now.addingTimeInterval(maxNextNeedLeadTime)
    }

    private func buildCandidates(from bookings: [Booking]) async -> [CheckoutReturnCandidate] {
        var output: [CheckoutReturnCandidate] = []
        let now = Date()

        for booking in bookings {
            guard !Task.isCancelled else { return [] }
            // Even the longest smart lead cannot display this checkout yet.
            // Avoid an availability query for gear due hours or days from now.
            guard needsReturnInsight(endsAt: booking.endsAt, now: now) else { continue }
            let insight = await APIClient.shared.checkoutReturnInsight(for: booking)
            let nextNeedAt = insight.nextNeedAt
            let nextNeedGap = nextNeedAt.map { $0.timeIntervalSince(booking.endsAt) }
            let smartLead = nextNeedGap.map { gap in
                gap > 0 ? min(max(gap, defaultLeadTime), maxNextNeedLeadTime) : defaultLeadTime
            } ?? defaultLeadTime
            let startsAt = booking.endsAt.addingTimeInterval(-smartLead)
            guard now >= startsAt || booking.endsAt <= now else { continue }

            output.append(CheckoutReturnCandidate(
                booking: booking,
                nextNeedAt: nextNeedAt,
                allowsExtend: !insight.hasUpcomingNeed,
                leadStartsAt: startsAt
            ))
        }

        return output
    }

    private func candidateSort(lhs: CheckoutReturnCandidate, rhs: CheckoutReturnCandidate) -> Bool {
        let now = Date()
        let lhsOverdue = lhs.booking.endsAt <= now
        let rhsOverdue = rhs.booking.endsAt <= now
        if lhsOverdue != rhsOverdue { return lhsOverdue }
        return lhs.booking.endsAt < rhs.booking.endsAt
    }

    private func upsertActivity(
        for candidate: CheckoutReturnCandidate,
        generation: UUID
    ) async {
        guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
        let attributes = CheckoutReturnActivityAttributes(
            bookingId: candidate.booking.id,
            bookingTitle: candidate.booking.title,
            requesterName: candidate.booking.requester.name,
            requesterInitials: initials(for: candidate.booking.requester.name),
            requesterAvatarUrl: candidate.booking.requester.avatarUrl,
            returnTimeText: "Return \(candidate.booking.endsAt.gearTime)"
        )
        let content = ActivityContent(
            state: contentState(for: candidate),
            staleDate: candidate.booking.endsAt.addingTimeInterval(6 * 60 * 60)
        )

        for activity in Activity<CheckoutReturnActivityAttributes>.activities where activity.attributes.bookingId != candidate.booking.id {
            stopObservingPushToken(for: activity.id)
            await activity.end(nil, dismissalPolicy: .immediate)
            guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
        }

        if let existing = Activity<CheckoutReturnActivityAttributes>.activities.first(where: { $0.attributes.bookingId == candidate.booking.id }) {
            let existingId = existing.id
            await existing.update(content)
            guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
            if let updated = Activity<CheckoutReturnActivityAttributes>.activities.first(where: { $0.id == existingId }) {
                observePushToken(
                    for: updated,
                    bookingId: candidate.booking.id,
                    generation: generation
                )
            }
            return
        }

        guard ownsObserverGeneration(generation), !Task.isCancelled else { return }
        do {
            let activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
            guard ownsObserverGeneration(generation), !Task.isCancelled else {
                await activity.end(nil, dismissalPolicy: .immediate)
                return
            }
            observePushToken(
                for: activity,
                bookingId: candidate.booking.id,
                generation: generation
            )
        } catch {
            // Best-effort only. The app still has normal due/overdue surfaces.
        }
    }

    private func observeExistingActivities(generation: UUID) {
        for activity in Activity<CheckoutReturnActivityAttributes>.activities {
            observePushToken(
                for: activity,
                bookingId: activity.attributes.bookingId,
                generation: generation
            )
        }
    }

    private func observePushToStartTokens(generation: UUID) {
        guard pushToStartObserverTask == nil else { return }

        pushToStartObserverTask = Task { [weak self] in
            guard let self else { return }
            for await tokenData in Activity<CheckoutReturnActivityAttributes>.pushToStartTokenUpdates {
                guard !Task.isCancelled, self.ownsObserverGeneration(generation) else { break }
                let token = self.hexToken(from: tokenData)
                self.enqueueCredentialRegistration(generation: generation) {
                    try await APIClient.shared.registerCheckoutReturnLiveActivityStartToken(token)
                }
            }
            if self.observerGeneration.owns(generation) {
                self.pushToStartObserverTask = nil
            }
        }
    }

    private func observeActivityUpdates(generation: UUID) {
        guard activityUpdatesObserverTask == nil else { return }

        activityUpdatesObserverTask = Task { [weak self] in
            guard let self else { return }
            for await activity in Activity<CheckoutReturnActivityAttributes>.activityUpdates {
                guard !Task.isCancelled, self.ownsObserverGeneration(generation) else { break }
                self.observePushToken(
                    for: activity,
                    bookingId: activity.attributes.bookingId,
                    generation: generation
                )
            }
            if self.observerGeneration.owns(generation) {
                self.activityUpdatesObserverTask = nil
            }
        }
    }

    private func contentState(for candidate: CheckoutReturnCandidate) -> CheckoutReturnActivityAttributes.ContentState {
        let now = Date()
        return CheckoutReturnActivityAttributes.ContentState(
            endsAt: candidate.booking.endsAt,
            now: now,
            nextNeedAt: candidate.nextNeedAt,
            allowsExtend: candidate.allowsExtend,
            urgency: urgency(for: candidate.booking, now: now)
        )
    }

    private func urgency(for booking: Booking, now: Date) -> CheckoutReturnActivityAttributes.ContentState.Urgency {
        if booking.endsAt <= now { return .overdue }
        let remaining = booking.endsAt.timeIntervalSince(now)
        if remaining <= 10 * 60 { return .critical }
        if remaining <= 30 * 60 { return .warning }
        return .normal
    }

    private func initials(for name: String) -> String {
        let parts = name.split(separator: " ")
        let letters = parts.prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    private func hexToken(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func observePushToken(
        for activity: Activity<CheckoutReturnActivityAttributes>,
        bookingId: String,
        generation: UUID
    ) {
        guard ownsObserverGeneration(generation) else { return }
        guard observedActivityIds.insert(activity.id).inserted else { return }
        if let tokenData = activity.pushToken {
            let token = hexToken(from: tokenData)
            enqueueCredentialRegistration(generation: generation) {
                try await APIClient.shared.registerCheckoutReturnLiveActivity(
                    bookingId: bookingId,
                    token: token
                )
            }
        }
        let activityId = activity.id
        activityPushTokenObserverTasks[activityId] = Task { [weak self] in
            guard let self else { return }
            for await tokenData in activity.pushTokenUpdates {
                guard !Task.isCancelled, self.ownsObserverGeneration(generation) else { break }
                let token = self.hexToken(from: tokenData)
                self.enqueueCredentialRegistration(generation: generation) {
                    try await APIClient.shared.registerCheckoutReturnLiveActivity(
                        bookingId: bookingId,
                        token: token
                    )
                }
            }
            if self.observerGeneration.owns(generation) {
                self.activityPushTokenObserverTasks[activityId] = nil
                self.observedActivityIds.remove(activityId)
            }
        }
    }

    private func beginObserverGenerationIfNeeded() -> UUID {
        if let activeObserverGeneration,
           observerGeneration.owns(activeObserverGeneration) {
            return activeObserverGeneration
        }
        let generation = observerGeneration.begin()
        activeObserverGeneration = generation
        return generation
    }

    private func ownsObserverGeneration(_ generation: UUID) -> Bool {
        PushTokenStorage.registrationAllowed && observerGeneration.owns(generation)
    }

    private func enqueueCredentialRegistration(
        generation: UUID,
        _ operation: @escaping @MainActor () async throws -> Void
    ) {
        guard ownsObserverGeneration(generation) else { return }
        pushCredentialMutations.enqueue { [weak self] in
            guard let self, self.ownsObserverGeneration(generation) else { return }
            try? await operation()
        }
    }

    private func stopObservingPushToken(for activityId: String) {
        activityPushTokenObserverTasks.removeValue(forKey: activityId)?.cancel()
        observedActivityIds.remove(activityId)
    }
}

private struct CheckoutReturnCandidate {
    let booking: Booking
    let nextNeedAt: Date?
    let allowsExtend: Bool
    let leadStartsAt: Date
}
