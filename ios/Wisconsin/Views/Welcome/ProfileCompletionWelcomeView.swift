import PhotosUI
import SwiftUI
import UIKit

private struct SelectedProfilePhoto: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct ProfileCompletionWelcomeView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var completionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var currentStep: ProfileCompletionStep = .unknown
    @State private var direction = 1.0
    @State private var didHydrate = false
    @State private var draft = ProfileCompletionDraft()
    @State private var photoSelection: PhotosPickerItem?
    @State private var selectedPhoto: SelectedProfilePhoto?
    @State private var isLoadingPhoto = false
    @State private var photoLoadError: String?
    @FocusState private var focusedField: WelcomeFocusField?

    private var user: CurrentUser? { session.currentUser }
    private var data: ProfileCompletionResponse? { completionStore.response }
    private var profile: ProfileCompletionProfile? { data?.profile }
    private var visibleSteps: [ProfileCompletionStep] {
        ProfileCompletionStep.visibleSteps(for: profile?.role ?? user?.role ?? "STUDENT")
    }
    private var stepIndex: Int { max(0, visibleSteps.firstIndex(of: currentStep) ?? 0) }
    private var isStudent: Bool { profile?.role == "STUDENT" }
    private var hasSimplePhoneStep: Bool { ProfileCompletionDraft.hasSimplePhoneStep(for: profile?.role ?? "") }
    private var isLastStep: Bool { stepIndex == visibleSteps.count - 1 }

    var body: some View {
        NavigationStack {
            Group {
                if let data, currentStep != .unknown {
                    wizard(data)
                } else if let error = completionStore.error {
                    WelcomeFailureView(
                        message: error,
                        onRetry: retryLoad,
                        onContinue: continuePastLoadFailure,
                        allowsContinue: user?.onboardingRequired != true,
                        onSignOut: { Task { await session.logout() } }
                    )
                } else {
                    WelcomeLoadingView()
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarHidden(true)
        }
        .task(id: user?.id) {
            guard let user else { return }
            await completionStore.load(for: user)
            hydrateIfNeeded()
        }
        .onChange(of: completionStore.response) { _, _ in hydrateIfNeeded() }
        .onChange(of: currentStep) { _, _ in scheduleInitialFocus() }
        .onChange(of: photoSelection) { _, item in
            guard let item else { return }
            Task { await loadPhoto(item) }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
        .sheet(item: $selectedPhoto, onDismiss: {
            selectedPhoto = nil
            photoSelection = nil
        }) { selected in
            ProfilePhotoCropView(
                image: selected.image,
                profileName: profile?.name ?? user?.name ?? "your",
                onSave: { data in
                    guard let user else { return false }
                    let saved = await completionStore.uploadAvatar(data, for: user)
                    if saved {
                        await session.refreshCurrentUser()
                    }
                    return saved
                }
            )
        }
    }

    private func wizard(_ data: ProfileCompletionResponse) -> some View {
        VStack(spacing: 0) {
            WelcomeHeaderView(
                name: data.profile.name,
                stepIndex: stepIndex,
                stepCount: visibleSteps.count,
                completedCount: data.completion.completedCount,
                totalCount: data.completion.totalCount
            )

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if isStudent && !data.profile.email.lowercased().hasSuffix("@wisc.edu") {
                        Label("Ask an administrator to change your login to your @wisc.edu address. You can save your other details now.", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        if !dynamicTypeSize.isAccessibilitySize {
                            HStack(spacing: 10) {
                                Image(systemName: stepSymbol)
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(Color.brandPrimary)
                                    .frame(width: 44, height: 44)
                                    .background(Color.brandPrimary.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                                    .accessibilityHidden(true)
                                Text(currentStep == .photo ? "MAKE IT YOU" : "YOUR PROFILE")
                                    .font(.gothamBold(size: 11, relativeTo: .caption2))
                                    .tracking(1.6)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Text(stepTitle)
                            .font(.gothamBlack(size: 30, relativeTo: .largeTitle))
                            .tracking(-0.6)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text(stepDescription)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .id("heading-\(currentStep.rawValue)")
                    .transition(stepTransition)

                    stepContent(data)
                        .id("body-\(currentStep.rawValue)")
                        .transition(stepTransition)

                    if let error = completionStore.error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    if completionStore.photoRefreshNeeded {
                        Button("Refresh setup", action: retryLoad)
                            .buttonStyle(.bordered)
                            .disabled(completionStore.isLoading || completionStore.isSaving)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 28)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
                .animation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.22), value: currentStep)
            }
            .scrollDismissesKeyboard(.interactively)

            footer
        }
    }

    @ViewBuilder
    private func stepContent(_ data: ProfileCompletionResponse) -> some View {
        switch currentStep {
        case .email:
            WelcomeEmailStepView(
                profile: data.profile,
                draft: draft,
                focus: $focusedField,
                onChange: completionStore.clearError,
                onSubmit: performPrimaryFooterAction
            )
        case .phones:
            WelcomePhonesStepView(
                profile: data.profile,
                draft: draft,
                focus: $focusedField,
                onChange: completionStore.clearError
            )
        case .wiscard:
            WelcomeWiscardStepView(
                draft: draft,
                focus: $focusedField,
                onChange: completionStore.clearError
            )
        case .student:
            WelcomeStudentStepView(draft: draft)
        case .apparel:
            WelcomeApparelStepView(draft: draft, focus: $focusedField)
        case .photo:
            WelcomePhotoStepView(
                profile: data.profile,
                photoSelection: $photoSelection,
                isLoading: isLoadingPhoto,
                isSaving: completionStore.isSaving,
                loadError: photoLoadError
            )
        case .unknown:
            EmptyView()
        }
    }

    private var footer: some View {
        WelcomeFooter(
            showsReminder: currentStep != .photo && !requiresSetup,
            showsBack: stepIndex > 0,
            primaryTitle: primaryFooterTitle,
            primaryEnabled: canUsePrimaryFooterAction,
            isSaving: completionStore.isSaving,
            onReminder: snooze,
            onBack: moveBack,
            onPrimary: performPrimaryFooterAction,
            onSignOut: requiresSetup ? { Task { await session.logout() } } : nil
        )
    }

    private var primaryFooterTitle: String {
        if isOptionalStep && !canContinue {
            return isLastStep ? "Finish" : "Skip"
        }
        return isLastStep ? "Finish" : "Continue"
    }

    private var canUsePrimaryFooterAction: Bool {
        (canContinue || isOptionalStep) && !(currentStep == .photo && requiresSetup)
    }

    private var stepSymbol: String {
        switch currentStep {
        case .email: "envelope"
        case .phones: "phone"
        case .wiscard: "person.text.rectangle"
        case .student: "graduationcap"
        case .apparel: "tshirt"
        case .photo: "person.crop.circle"
        case .unknown: "person"
        }
    }

    private var stepTitle: String {
        if currentStep == .phones && hasSimplePhoneStep { return "Add your phone number" }
        return currentStep.title
    }

    private var stepDescription: String {
        switch currentStep {
        case .email: "Your campus email is your site login. Add your required Athletics email."
        case .phones where hasSimplePhoneStep: "Add the personal phone number we should use to reach you."
        case .phones: "Identify any number already on your account, then add the other contact number."
        case .wiscard: "Type the card number and issue code printed on your card. This is used for kiosk identification."
        case .student: "Tell us your current year and when you expect to graduate."
        case .apparel: "Choose your clothing and shoe sizes for team orders."
        case .photo: "A clear photo helps teammates recognize you across the roster, schedule, and kiosk."
        case .unknown: ""
        }
    }

    private var stepTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .offset(y: direction * 8).combined(with: .opacity),
            removal: .offset(y: direction * -8).combined(with: .opacity)
        )
    }

    private var requiresSetup: Bool { data?.completion.requiresSetup == true || (user?.onboardingRequired == true && data?.completion.requiredComplete != true) }
    private var isOptionalStep: Bool { currentStep == .photo || (currentStep == .apparel && !requiresSetup) }

    private var canContinue: Bool {
        guard let profile else { return false }
        return draft.canContinue(currentStep, profile: profile)
    }

    private func hydrateIfNeeded() {
        guard !didHydrate, let data else { return }
        draft.hydrate(from: data.profile)
        currentStep = data.completion.firstIncompleteStep.flatMap { visibleSteps.contains($0) ? $0 : nil }
            ?? visibleSteps.first
            ?? .photo
        didHydrate = true
        scheduleInitialFocus()
    }

    private func move(to step: ProfileCompletionStep, direction: Double) {
        self.direction = direction
        completionStore.clearError()
        focusedField = nil
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.22)) {
            currentStep = step
        }
        Haptics.selection()
    }

    private func moveBack() {
        guard let prior = visibleSteps[safe: stepIndex - 1] else { return }
        move(to: prior, direction: -1)
    }

    private func continueFromCurrentStep() {
        guard !completionStore.isSaving, canContinue, let user, let profile else { return }
        if currentStep == .photo {
            completionStore.continueForSession(for: user.id)
            Haptics.success()
            return
        }

        guard let update = draft.update(for: currentStep, profile: profile) else { return }

        Task {
            guard let next = await completionStore.save(update, for: user) else {
                Haptics.error()
                return
            }
            Haptics.success()
            if next.completion.profileComplete { return }
            let nextStep = visibleSteps[safe: stepIndex + 1] ?? currentStep
            if nextStep != currentStep { move(to: nextStep, direction: 1) }
        }
    }

    private func performPrimaryFooterAction() {
        if isOptionalStep && !canContinue {
            skipOptionalStep()
        } else {
            continueFromCurrentStep()
        }
    }

    private func skipOptionalStep() {
        guard isOptionalStep, !(currentStep == .photo && requiresSetup) else { return }
        if currentStep == .photo {
            guard let user else { return }
            completionStore.continueForSession(for: user.id)
            Haptics.success()
        } else if let next = visibleSteps[safe: stepIndex + 1] {
            move(to: next, direction: 1)
        }
    }

    private func snooze() {
        guard let user else { return }
        Task {
            if await completionStore.snooze(for: user) {
                Haptics.success()
            } else {
                Haptics.error()
            }
        }
    }

    private func retryLoad() {
        guard let user else { return }
        Task {
            await completionStore.load(for: user, force: true)
            hydrateIfNeeded()
        }
    }

    private func continuePastLoadFailure() {
        guard let user, !user.onboardingRequired else { return }
        completionStore.continueForSession(for: user.id)
    }

    private func scheduleInitialFocus() {
        let step = currentStep
        let field: WelcomeFocusField? = switch step {
        case .email: .athleticsEmail
        case .phones: .personalPhone
        case .wiscard: .wiscardNumber
        case .apparel where draft.topSizeChoice == "OTHER": .topSizeOther
        case .apparel where draft.shoeSizeChoice == "OTHER": .shoeSizeOther
        default: nil
        }
        guard let field else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            guard currentStep == step else { return }
            focusedField = field
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem) async {
        isLoadingPhoto = true
        photoLoadError = nil
        completionStore.clearError()
        defer { isLoadingPhoto = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = await NativeImageProcessor.downsample(
                    data: data,
                    maxPixels: 2400,
                    scale: 1
                  ) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            selectedPhoto = SelectedProfilePhoto(image: image)
        } catch {
            photoSelection = nil
            photoLoadError = "That photo couldn’t be opened. Choose another photo and try again."
        }
    }

}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
