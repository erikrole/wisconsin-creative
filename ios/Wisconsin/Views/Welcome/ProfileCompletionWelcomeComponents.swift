import PhotosUI
import SwiftUI

enum WelcomeFocusField: Hashable {
    case athleticsEmail
    case personalPhone
    case workPhone
    case wiscardNumber
    case wiscardIssueCode
    case topSizeOther
    case shoeSizeOther
}

struct WelcomeHeaderView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let name: String
    let stepIndex: Int
    let stepCount: Int
    let completedCount: Int
    let totalCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 12) {
                Image("Badgers")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 88, height: 34)
                    .accessibilityHidden(true)
                Spacer(minLength: 12)
                Text("CREATIVE")
                    .font(.gothamBold(size: 11, relativeTo: .caption2))
                    .tracking(2)
                    .foregroundStyle(.secondary)
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) { progressLabels }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text("Welcome, \(firstName)")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    stepLabel
                }
            }
            HStack(spacing: 6) {
                ForEach(0..<max(stepCount, 1), id: \.self) { index in
                    Capsule()
                        .fill(index <= stepIndex ? Color.brandPrimary : Color.primary.opacity(0.09))
                        .frame(height: 4)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Welcome progress")
            .accessibilityValue("Step \(stepIndex + 1) of \(stepCount). \(completedCount) of \(totalCount) details complete")
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 20)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var progressLabels: some View {
        Text("Welcome, \(firstName)").font(.subheadline.weight(.semibold))
        stepLabel
    }

    private var stepLabel: some View {
        Text("Step \(stepIndex + 1) of \(stepCount)")
            .font(.caption.weight(.medium).monospacedDigit())
            .foregroundStyle(.secondary)
    }

    private var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }
}

struct WelcomeFooter: View {
    let showsReminder: Bool
    let showsBack: Bool
    let primaryTitle: String
    let primaryEnabled: Bool
    let isSaving: Bool
    let onReminder: () -> Void
    let onBack: () -> Void
    let onPrimary: () -> Void
    var onSignOut: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) {
                    if showsBack { backButton }
                    primaryButton
                }
                VStack(spacing: 10) {
                    primaryButton
                    if showsBack { backButton }
                }
            }
            if showsReminder || onSignOut != nil {
                HStack {
                    if showsReminder {
                        Button("Remind tomorrow", action: onReminder)
                    }
                    if let onSignOut { Button("Sign out", action: onSignOut) }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
                .disabled(isSaving)
            }

        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .frame(maxWidth: 680)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    private var backButton: some View {
        Button(action: onBack) {
            Label("Back", systemImage: "chevron.left")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 8)
                .frame(minHeight: 52)
        }
        .buttonStyle(.plain)
        .disabled(isSaving)
    }

    private var primaryButton: some View {
        Button(action: onPrimary) {
            HStack(spacing: 10) {
                if isSaving { ProgressView().tint(.white) }
                Text(primaryTitle).font(.headline)
                if !isSaving {
                    Image(systemName: primaryTitle == "Finish" ? "checkmark" : "arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Capsule())
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(.brandPrimary)
        .background(Color.primary.opacity(primaryEnabled ? 0 : 0.06), in: Capsule())
        .disabled(!primaryEnabled || isSaving)
    }
}

/// Shared native field surface; focus and input behavior stay with each field.
private struct WelcomeInputStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.09), lineWidth: 1))
    }
}

struct WelcomeFormCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(20)
            .background(
                Color(.secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
    }
}

struct WelcomeFieldLabel: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let title: String
    var detail: String?

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    if let detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    if let detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

struct WelcomeEmailStepView: View {
    let profile: ProfileCompletionProfile
    @Bindable var draft: ProfileCompletionDraft
    let focus: FocusState<WelcomeFocusField?>.Binding
    let onChange: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        WelcomeFormCard {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(title: "Campus email", detail: "Site login")
                    Text(profile.email)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .allowsTightening(true)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(
                            Color(.secondarySystemFill),
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                        )
                }

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(title: "Athletics email")
                    TextField("name@athletics.wisc.edu", text: $draft.athleticsEmail)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .athleticsEmail)
                        .submitLabel(.continue)
                        .onSubmit(onSubmit)
                        .onChange(of: draft.athleticsEmail) { _, _ in onChange() }
                    Text("Required address ending in @athletics.wisc.edu")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if !profile.email.lowercased().hasSuffix("@wisc.edu") {
                    Label(
                        "Your login is not a @wisc.edu address. Ask an administrator to correct it before continuing.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.footnote)
                    .foregroundStyle(Color.statusText(.red))
                }
            }
        }
    }
}

struct WelcomePhonesStepView: View {
    let profile: ProfileCompletionProfile
    @Bindable var draft: ProfileCompletionDraft
    let focus: FocusState<WelcomeFocusField?>.Binding
    let onChange: () -> Void

    private var hasSimplePhoneStep: Bool { ProfileCompletionDraft.hasSimplePhoneStep(for: profile.role) }

    var body: some View {
        WelcomeFormCard {
            VStack(alignment: .leading, spacing: 18) {
                if draft.needsLegacyClassification(for: profile) {
                    VStack(alignment: .leading, spacing: 8) {
                        WelcomeFieldLabel(title: "We already have \(profile.phone ?? ""). Which number is it?")
                        Picker("Existing phone type", selection: $draft.legacyPhoneType) {
                            Text("Personal").tag("PERSONAL")
                            Text("Work").tag("WORK")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: draft.legacyPhoneType) { _, value in
                            draft.classifyLegacyPhone(as: value, profile: profile)
                            onChange()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(title: "Personal phone")
                    TextField("(XXX) XXX-XXXX", text: $draft.personalPhone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .personalPhone)
                        .onChange(of: draft.personalPhone) { _, _ in onChange() }
                }

                if !hasSimplePhoneStep {
                    VStack(alignment: .leading, spacing: 8) {
                        WelcomeFieldLabel(title: "Work phone")
                        TextField("(XXX) XXX-XXXX", text: $draft.workPhone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .modifier(WelcomeInputStyle())
                            .focused(focus, equals: .workPhone)
                            .disabled(draft.noWorkPhone)
                            .onChange(of: draft.workPhone) { _, value in
                                if !value.isEmpty { draft.noWorkPhone = false }
                                onChange()
                            }
                    }

                    Toggle("I don’t have a work phone", isOn: $draft.noWorkPhone)
                        .onChange(of: draft.noWorkPhone) { _, value in
                            if value {
                                draft.workPhone = ""
                                if focus.wrappedValue == .workPhone { focus.wrappedValue = nil }
                            }
                            onChange()
                        }
                }
            }
        }
    }
}

struct WelcomeWiscardStepView: View {
    @Bindable var draft: ProfileCompletionDraft
    let focus: FocusState<WelcomeFocusField?>.Binding
    let onChange: () -> Void

    var body: some View {
        WelcomeFormCard {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(
                        title: "Wiscard number",
                        detail: "\(ProfileCompletionDraft.digits(draft.wiscardCardNumber).count)/10 digits"
                    )
                    TextField("XXXXXXXXXX", text: $draft.wiscardCardNumber)
                        .keyboardType(.numberPad)
                        .textContentType(.none)
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .wiscardNumber)
                        .onChange(of: draft.wiscardCardNumber) { _, value in
                            draft.wiscardCardNumber = String(value.filter(\.isNumber).prefix(10))
                            if ProfileCompletionDraft.digits(draft.wiscardCardNumber).count == 10,
                               focus.wrappedValue == .wiscardNumber {
                                focus.wrappedValue = .wiscardIssueCode
                            }
                            onChange()
                        }
                }
                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(
                        title: "Issue code",
                        detail: "\(ProfileCompletionDraft.digits(draft.wiscardIssueCode).count)/1 digit"
                    )
                    TextField("X", text: $draft.wiscardIssueCode)
                        .keyboardType(.numberPad)
                        .textContentType(.none)
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .wiscardIssueCode)
                        .onChange(of: draft.wiscardIssueCode) { _, value in
                            draft.wiscardIssueCode = String(value.filter(\.isNumber).prefix(1))
                            onChange()
                        }
                }
                Label(
                    "The issue code is in the bottom-right corner of your Wiscard. Wisconsin Creative combines both values for kiosk lookup.",
                    systemImage: "info.circle"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}

struct WelcomeStudentStepView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @Bindable var draft: ProfileCompletionDraft

    var body: some View {
        WelcomeFormCard {
            VStack(alignment: .leading, spacing: 18) {
                WelcomePickerRow(
                    title: "Year",
                    selection: $draft.studentYear,
                    placeholder: "Select year",
                    options: ProfileSizingOptions.studentYears
                )
                VStack(alignment: .leading, spacing: 8) {
                    WelcomeFieldLabel(title: "Anticipated graduation")
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(spacing: 12) {
                            graduationFields
                        }
                    } else {
                        HStack(spacing: 12) {
                            graduationFields
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var graduationFields: some View {
        WelcomeSelectionField(
            title: "Graduation term",
            prompt: "Term",
            selection: $draft.graduationTerm,
            options: ProfileSizingOptions.graduationTerms
        )
        WelcomeSelectionField(
            title: "Graduation year",
            prompt: "Year",
            selection: $draft.graduationYear,
            options: draft.graduationYears.map { ($0, String($0)) }
        )
    }
}

struct WelcomeApparelStepView: View {
    @Bindable var draft: ProfileCompletionDraft
    let focus: FocusState<WelcomeFocusField?>.Binding

    var body: some View {
        WelcomeFormCard {
            VStack(alignment: .leading, spacing: 18) {
                WelcomePickerRow(
                    title: "Clothing sizing",
                    selection: $draft.topSizeFit,
                    placeholder: "Men’s or Women’s",
                    options: ProfileSizingOptions.apparelFits.filter { $0.0 != "UNISEX" },
                    selectedLabelOverride: draft.topSizeFit == "UNISEX" ? "Unisex (saved)" : nil
                )
                WelcomePickerRow(
                    title: "Top size",
                    selection: $draft.topSizeChoice,
                    placeholder: draft.topSizeFit.isEmpty ? "Choose clothing sizing first" : "Select size",
                    options: ProfileSizingOptions.topSizes.map { ($0, $0) } + [("OTHER", "Other")]
                )
                .disabled(draft.topSizeFit.isEmpty)
                if draft.topSizeChoice == "OTHER" {
                    TextField("Other top size", text: $draft.topSizeOther)
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .topSizeOther)
                        .submitLabel(.next)
                }

                Divider()

                WelcomePickerRow(
                    title: "US shoe sizing",
                    selection: Binding(get: { draft.shoeSizeSystem }, set: { value in
                        draft.resetShoeSizeIfSystemChanged(from: draft.shoeSizeSystem, to: value)
                        draft.shoeSizeSystem = value
                    }),
                    placeholder: "Men’s or Women’s",
                    options: ProfileSizingOptions.shoeSystems
                )
                WelcomePickerRow(
                    title: "Shoe size",
                    selection: $draft.shoeSizeChoice,
                    placeholder: draft.shoeSizeSystem.isEmpty ? "Choose shoe sizing first" : "Select size",
                    options: ProfileSizingOptions.shoeSizes(system: draft.shoeSizeSystem).map { ($0, $0) } + [("OTHER", "Other")]
                )
                .disabled(draft.shoeSizeSystem.isEmpty)
                if draft.shoeSizeChoice == "OTHER" {
                    TextField("Other shoe size", text: $draft.shoeSizeOther)
                        .modifier(WelcomeInputStyle())
                        .focused(focus, equals: .shoeSizeOther)
                        .submitLabel(.done)
                        .onSubmit { focus.wrappedValue = nil }
                }

                if let summary = draft.apparelSummary {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your sizes for team orders")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(summary)
                            .font(.subheadline.weight(.medium))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

struct WelcomePhotoStepView: View {
    let profile: ProfileCompletionProfile
    @Binding var photoSelection: PhotosPickerItem?
    let isLoading: Bool
    let isSaving: Bool
    let loadError: String?

    var body: some View {
        WelcomeFormCard {
            VStack(spacing: 18) {
                avatarPreview
                PhotosPicker(selection: $photoSelection, matching: .images) {
                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                    } else {
                        Label(profile.avatarUrl == nil ? "Choose photo" : "Change photo", systemImage: "camera")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isLoading || isSaving)

                if let loadError {
                    Label(loadError, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Text("Choose a clear photo. You can zoom, move, and crop it before saving, or add one later from Profile.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var avatarPreview: some View {
        UserAvatarView(
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            size: 128,
            fallbackBackground: Color.brandPrimary.opacity(0.08),
            fallbackForeground: Color.brandPrimary,
            showsBorder: false
        )
        .overlay(Circle().stroke(Color.primary.opacity(0.12), lineWidth: 1))
        .accessibilityLabel(profile.avatarUrl == nil ? "No profile photo" : "Current profile photo")
    }
}

struct WelcomeLoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text("Getting your profile ready…")
                .font(.headline)
            Text("This should only take a moment.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

struct WelcomeFailureView: View {
    let message: String
    let onRetry: () -> Void
    let onContinue: () -> Void
    var allowsContinue = true
    var onSignOut: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label("Couldn’t load Welcome", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
            if allowsContinue {
                Button("Continue for now", action: onContinue)
                    .buttonStyle(.bordered)
            }
            if let onSignOut { Button("Sign out", action: onSignOut).buttonStyle(.bordered) }
        }
    }
}

struct WelcomePickerRow: View {
    let title: String
    @Binding var selection: String
    let placeholder: String
    let options: [(String, String)]
    var selectedLabelOverride: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WelcomeFieldLabel(title: title)
            WelcomeSelectionField(
                title: title,
                prompt: placeholder,
                selection: $selection,
                options: options,
                selectedLabelOverride: selectedLabelOverride
            )
        }
    }
}

struct WelcomeSelectionField<Value: Hashable>: View {
    let title: String
    let prompt: String
    @Binding var selection: Value
    let options: [(Value, String)]
    var selectedLabelOverride: String? = nil

    @State private var isPresented = false

    private var selectedLabel: String? {
        options.first { $0.0 == selection }?.1 ?? selectedLabelOverride
    }

    var body: some View {
        Button {
            isPresented = true
        } label: {
            HStack(spacing: 8) {
                Text(selectedLabel ?? prompt)
                    .foregroundStyle(selectedLabel == nil ? .secondary : .primary)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .padding(.horizontal, 12)
            .background(
                Color(.tertiarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
        }
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selectedLabel == nil ? Color.primary.opacity(0.09) : Color.brandPrimary.opacity(0.25), lineWidth: 1))
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(selectedLabel ?? "Not selected")
        .sheet(isPresented: $isPresented) {
            WelcomeSelectionSheet(
                title: title,
                selection: $selection,
                options: options
            )
        }
    }
}

private struct WelcomeSelectionSheet<Value: Hashable>: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    @Binding var selection: Value
    let options: [(Value, String)]

    var body: some View {
        NavigationStack {
            List(options, id: \.0) { option in
                Button {
                    selection = option.0
                    Haptics.selection()
                    dismiss()
                } label: {
                    HStack {
                        Text(option.1)
                            .foregroundStyle(.primary)
                        Spacer()
                        if selection == option.0 {
                            Image(systemName: "checkmark")
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.brandPrimary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

#if DEBUG
private struct WelcomeStepPreviewHost: View {
    let profile: ProfileCompletionProfile
    let step: ProfileCompletionStep
    @State private var draft: ProfileCompletionDraft
    @FocusState private var focus: WelcomeFocusField?
    @State private var photoSelection: PhotosPickerItem?

    init(profile: ProfileCompletionProfile, step: ProfileCompletionStep) {
        self.profile = profile
        self.step = step
        _draft = State(initialValue: ProfileCompletionDraft(profile: profile))
    }

    var body: some View {
        VStack(spacing: 0) {
            WelcomeHeaderView(
                name: profile.name,
                stepIndex: max(0, ProfileCompletionStep.visibleSteps(for: profile.role).firstIndex(of: step) ?? 0),
                stepCount: ProfileCompletionStep.visibleSteps(for: profile.role).count,
                completedCount: 3,
                totalCount: profile.role == "STUDENT" ? 9 : 8
            )
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text(step.title)
                        .font(.title2.weight(.bold))
                    previewStep
                }
                .padding(24)
            }
            WelcomeFooter(
                showsReminder: step != .photo,
                showsBack: step != .email,
                primaryTitle: step == .photo ? "Finish" : "Continue",
                primaryEnabled: true,
                isSaving: false,
                onReminder: {},
                onBack: {},
                onPrimary: {}
            )
        }
        .background(Color(.systemGroupedBackground))
    }

    @ViewBuilder
    private var previewStep: some View {
        switch step {
        case .email:
            WelcomeEmailStepView(profile: profile, draft: draft, focus: $focus, onChange: {}, onSubmit: {})
        case .phones:
            WelcomePhonesStepView(profile: profile, draft: draft, focus: $focus, onChange: {})
        case .wiscard:
            WelcomeWiscardStepView(draft: draft, focus: $focus, onChange: {})
        case .student:
            WelcomeStudentStepView(draft: draft)
        case .apparel:
            WelcomeApparelStepView(draft: draft, focus: $focus)
        case .photo:
            WelcomePhotoStepView(
                profile: profile,
                photoSelection: $photoSelection,
                isLoading: false,
                isSaving: false,
                loadError: nil
            )
        case .unknown:
            EmptyView()
        }
    }
}

private enum WelcomePreviewFixtures {
    static let student = profile(
        """
        {"id":"student-preview","name":"Alex Rivera","role":"STUDENT","email":"alex.rivera.demo@wisc.edu"}
        """
    )
    static let staff = profile(
        """
        {"id":"staff-preview","name":"Jordan Lee","role":"STAFF","email":"jordan.lee.demo@wisc.edu","phone":"(608) 555-0100"}
        """
    )

    private static func profile(_ json: String) -> ProfileCompletionProfile {
        try! JSONDecoder().decode(ProfileCompletionProfile.self, from: Data(json.utf8))
    }
}

#Preview("Student Welcome") {
    WelcomeStepPreviewHost(profile: WelcomePreviewFixtures.student, step: .email)
}

#Preview("Staff Welcome") {
    WelcomeStepPreviewHost(profile: WelcomePreviewFixtures.staff, step: .phones)
}

#Preview("Welcome loading") {
    WelcomeLoadingView()
        .background(Color(.systemGroupedBackground))
}

#Preview("Welcome failure") {
    WelcomeFailureView(message: "The profile service is unavailable.", onRetry: {}, onContinue: {})
        .background(Color(.systemGroupedBackground))
}

#Preview("Accessibility layout") {
    WelcomeStepPreviewHost(profile: WelcomePreviewFixtures.student, step: .wiscard)
        .dynamicTypeSize(.accessibility3)
}
#endif
