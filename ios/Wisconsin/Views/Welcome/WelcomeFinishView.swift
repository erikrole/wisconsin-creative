import SwiftUI

/// Where a finish-screen row lands once the app shell appears.
private enum WelcomeNextStep: Identifiable {
    case availability
    case schedule(role: String)
    case gear
    case guides

    var id: String { title }

    /// Mirrors the web `welcomeNextSteps`, minus the iPhone app row and the
    /// staff Onboarding Status row (no native destination yet).
    static func steps(for role: String) -> [WelcomeNextStep] {
        switch role {
        case "COLLABORATOR": []
        case "STUDENT": [.availability, .schedule(role: role), .gear, .guides]
        default: [.schedule(role: role), .gear, .guides]
        }
    }

    var title: String {
        switch self {
        case .availability: "Add when you can’t work"
        case .schedule: "Check the schedule"
        case .gear: "Find your gear"
        case .guides: "Read the guides"
        }
    }

    var detail: String {
        switch self {
        case .availability: "Classes, a job, or days away, so you’re not scheduled then."
        case .schedule(let role):
            role == "STUDENT"
                ? "See the events you’re on and the ones that need crew."
                : "Build crews and see which events still need people."
        case .gear: "Anything you check out shows up here, with its return time."
        case .guides: "How we shoot, where gear lives, and who to ask."
        }
    }

    var systemImage: String {
        switch self {
        case .availability: "clock"
        case .schedule: "calendar"
        case .gear: "shippingbox"
        case .guides: "book.closed"
        }
    }

    var destination: StarterDestination {
        switch self {
        case .availability: .availability
        case .schedule: .schedule
        case .gear: .gear
        case .guides: .guides
        }
    }
}

/// Calm closing screen after the last Welcome step, or after "Remind me tomorrow".
/// Mirrors the web `WelcomeDone` copy; collaborators get Continue only.
struct WelcomeFinishView: View {
    @Environment(AppState.self) private var appState

    let firstName: String
    let outcome: WelcomeFinish.Outcome
    let role: String
    let onContinue: () -> Void

    private var steps: [WelcomeNextStep] { WelcomeNextStep.steps(for: role) }

    private var title: String {
        outcome == .complete ? "You’re all set, \(firstName)" : "Welcome, \(firstName)"
    }

    private var message: String {
        outcome == .complete
            ? "Your account is ready. Here’s where to start."
            : "Your account works. We’ll remind you tomorrow to finish your profile, and you can do it any time from Home."
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(title)
                            .font(.largeTitle.weight(.bold))
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text(message)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !steps.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(steps) { step in
                                Button { open(step) } label: { row(step) }
                                    .buttonStyle(.plain)
                                if step.id != steps.last?.id {
                                    Divider().padding(.leading, 64)
                                }
                            }
                        }
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
                .padding(24)
                .padding(.top, 24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }

            Button(action: onContinue) {
                Text("Continue")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .frame(maxWidth: 680)
        }
        .frame(maxWidth: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    private func row(_ step: WelcomeNextStep) -> some View {
        HStack(spacing: 14) {
            Image(systemName: step.systemImage)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title).font(.headline)
                Text(step.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private func open(_ step: WelcomeNextStep) {
        step.destination.open(in: appState)
        onContinue()
    }
}

#if DEBUG
#Preview("Finish complete") {
    WelcomeFinishView(firstName: "Erik", outcome: .complete, role: "STUDENT", onContinue: {})
        .environment(AppState())
}

#Preview("Finish later") {
    WelcomeFinishView(firstName: "Erik", outcome: .later, role: "STUDENT", onContinue: {})
        .environment(AppState())
}

#Preview("Finish collaborator") {
    WelcomeFinishView(firstName: "Erik", outcome: .complete, role: "COLLABORATOR", onContinue: {})
        .environment(AppState())
}
#endif
