import SwiftUI

/// Quiet restore state shown only while the app has no optimistic session
/// snapshot and is validating `/me`. Matches the system launch frame and
/// Home's grouped background so launch is continuity, not a splash. Progress
/// appears only when validation takes long enough to need an explanation.
struct LaunchView: View {
    /// The restore could not reach the server and there is no cached session
    /// to fall back on. Swaps the progress capsule for an explanation and
    /// two ways forward.
    var failed = false
    var onRetry: () -> Void = {}
    var onSignIn: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var restoreProgress: RestoreProgress = .hidden

    private enum RestoreProgress {
        case hidden
        case checking
        case stillChecking

        var label: String? {
            switch self {
            case .hidden: nil
            case .checking: "Checking your session"
            case .stillChecking: "Still checking your session"
            }
        }
    }

    private var accessibilityStatus: String {
        if failed { return "Can't reach Wisconsin Creative. Check your connection." }
        return restoreProgress.label ?? "Opening Wisconsin Creative"
    }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground)

            if failed {
                failureState
                    .transition(.opacity)
            } else if let progressLabel = restoreProgress.label {
                HStack(spacing: 9) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.secondary)
                        .accessibilityHidden(true)

                    Text(progressLabel)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 34)
                .background(.fill.tertiary, in: Capsule())
                .transition(.opacity)
                .accessibilityHidden(true)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: failed ? .contain : .ignore)
        .accessibilityLabel(accessibilityStatus)
        .task(id: failed) {
            restoreProgress = .hidden
            guard !failed else {
                AccessibilityNotification.Announcement(accessibilityStatus).post()
                return
            }
            do {
                try await Task.sleep(for: .milliseconds(650))
            } catch {
                return
            }
            revealProgress(.checking)
            AccessibilityNotification.Announcement("Checking your session").post()

            do {
                try await Task.sleep(for: .seconds(3.35))
            } catch {
                return
            }
            revealProgress(.stillChecking)
            AccessibilityNotification.Announcement("Still checking your session").post()
        }
    }

    private var failureState: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text("Can't reach Wisconsin Creative")
                    .font(.headline)
                Text("Check your connection and try again.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)

            VStack(spacing: 8) {
                Button(action: onRetry) {
                    Text("Try again")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                }
                .authButton(.primary, adaptive: true)

                Button("Sign in instead", action: onSignIn)
                    .authButton(.secondary, adaptive: true)
            }
            .frame(maxWidth: 280)
        }
        .padding(.horizontal, 24)
    }

    private func revealProgress(_ progress: RestoreProgress) {
        if reduceMotion {
            restoreProgress = progress
        } else {
            withAnimation(.easeIn(duration: 0.2)) {
                restoreProgress = progress
            }
        }
    }
}
