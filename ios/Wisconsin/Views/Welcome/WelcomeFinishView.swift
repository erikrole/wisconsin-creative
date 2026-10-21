import SwiftUI

/// Where a finish-screen row lands once the app shell appears.
private enum WelcomeNextStep: CaseIterable, Identifiable {
    case schedule
    case gear
    case guides

    var id: Self { self }

    var title: String {
        switch self {
        case .schedule: "Check the schedule"
        case .gear: "Find your gear"
        case .guides: "Read the guides"
        }
    }

    var detail: String {
        switch self {
        case .schedule: "See the events you’re on and the ones that need crew."
        case .gear: "Anything you check out shows up here, with its return time."
        case .guides: "How we shoot, where gear lives, and who to ask."
        }
    }

    var systemImage: String {
        switch self {
        case .schedule: "calendar"
        case .gear: "shippingbox"
        case .guides: "book.closed"
        }
    }
}

/// Calm closing screen after the last Welcome step, or after "Remind me tomorrow".
/// Mirrors the web `WelcomeDone` copy; collaborators get Continue only.
struct WelcomeFinishView: View {
    @Environment(AppState.self) private var appState

    let firstName: String
    let outcome: WelcomeFinish.Outcome
    let showsNextSteps: Bool
    let onContinue: () -> Void

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

                    if showsNextSteps {
                        VStack(spacing: 0) {
                            ForEach(WelcomeNextStep.allCases) { step in
                                Button { open(step) } label: { row(step) }
                                    .buttonStyle(.plain)
                                if step != WelcomeNextStep.allCases.last {
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
        switch step {
        case .schedule:
            appState.selectedTab = 4
        case .gear:
            appState.selectedTab = 1
        case .guides:
            appState.pendingBrowseDestination = "guides"
            appState.selectedTab = 2
        }
        onContinue()
    }
}

#if DEBUG
#Preview("Finish complete") {
    WelcomeFinishView(firstName: "Erik", outcome: .complete, showsNextSteps: true, onContinue: {})
        .environment(AppState())
}

#Preview("Finish later") {
    WelcomeFinishView(firstName: "Erik", outcome: .later, showsNextSteps: true, onContinue: {})
        .environment(AppState())
}

#Preview("Finish collaborator") {
    WelcomeFinishView(firstName: "Erik", outcome: .complete, showsNextSteps: false, onContinue: {})
        .environment(AppState())
}
#endif
