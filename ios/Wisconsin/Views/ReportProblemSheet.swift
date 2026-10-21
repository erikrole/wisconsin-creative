import SwiftUI
import UIKit

/// "Report a Problem" from Settings. Sends what the person wrote with the app
/// version, device, current screen, and recent actions, and shows exactly what
/// is attached before it goes. Email stays available if sending fails.
struct ReportProblemSheet: View {
    let supportURL: URL

    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var sent = false
    @State private var showsAttachments = false
    @FocusState private var editorFocused: Bool

    /// Captured when the sheet opens, so what is shown is what is sent.
    @State private var snapshot = DiagnosticBreadcrumbs.shared.current

    private var trimmed: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Group {
                if sent {
                    sentConfirmation
                } else {
                    form
                }
            }
            .navigationTitle("Report a Problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !sent {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if isSending {
                            ProgressView()
                        } else {
                            Button("Send") { Task { await send() } }
                                .disabled(trimmed.count < 3)
                        }
                    }
                }
            }
        }
        .presentationDetents([.large])
    }

    private var form: some View {
        Form {
            Section {
                TextEditor(text: $message)
                    .frame(minHeight: 140)
                    .focused($editorFocused)
                    .accessibilityLabel("What happened?")
                    .overlay(alignment: .topLeading) {
                        if message.isEmpty {
                            Text("What were you doing, and what went wrong?")
                                .foregroundStyle(.tertiary)
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                    }
            } header: {
                Text("What happened?")
            }

            Section {
                DisclosureGroup(isExpanded: $showsAttachments) {
                    LabeledContent("Screen", value: snapshot.screen ?? "—")
                    LabeledContent("App version", value: appVersion)
                    LabeledContent("Device", value: device)
                    if snapshot.breadcrumbs.isEmpty {
                        Text("No recent actions")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(snapshot.breadcrumbs.suffix(12).enumerated()), id: \.offset) { _, crumb in
                            Text(crumb.message)
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                } label: {
                    Label("Attached automatically", systemImage: "paperclip")
                }
            } footer: {
                Text("Nothing you typed into the app, and no passwords, are included.")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                    Link("Email support instead", destination: supportURL)
                }
            }
        }
        .onAppear { editorFocused = true }
    }

    private var sentConfirmation: some View {
        ContentUnavailableView {
            Label("Thanks, we got it", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } description: {
            Text("Your report and the details above were sent. We'll follow up if we need more.")
        } actions: {
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    private var device: String {
        "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)"
    }

    private func send() async {
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        do {
            try await APIClient.shared.sendProblemReport(message: trimmed)
            sent = true
        } catch {
            errorMessage = "Couldn't send your report. Check your connection and try again."
        }
    }
}
