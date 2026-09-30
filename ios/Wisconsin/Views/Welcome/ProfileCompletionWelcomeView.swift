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

    @State private var currentStep: ProfileCompletionStep = .unknown
    @State private var direction = 1.0
    @State private var didHydrate = false
    @State private var draft = ProfileCompletionDraft()
    @State private var photoSelection: PhotosPickerItem?
    @State private var selectedPhoto: SelectedProfilePhoto?
    @State private var isLoadingPhoto = false
    @State private var photoLoadError: String?
    @FocusState private var focusedField: WelcomeFocusField?
    @AccessibilityFocusState private var headingFocused: Bool

    private var user: CurrentUser? { session.currentUser }
    private var data: ProfileCompletionResponse? { completionStore.response }
    private var profile: ProfileCompletionProfile? { data?.profile }
    private var visibleSteps: [ProfileCompletionStep] {
        ProfileCompletionStep.visibleSteps(for: profile?.role ?? user?.role ?? "STUDENT")
    }
    private var stepIndex: Int { max(0, visibleSteps.firstIndex(of: currentStep) ?? 0) }
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
                        onContinue: continuePastLoadFailure
                    )
                } else {
                    WelcomeLoadingView()
                }
            }
            .background(Color(.systemBackground))
            .navigationBarHidden(true)
        }
        .task(id: user?.id) {
            guard let user else { return }
            await completionStore.load(for: user)
            hydrateIfNeeded()
        }
        .onChange(of: completionStore.response) { _, _ in hydrateIfNeeded() }
        .task(id: currentStep) {
            do { try await Task.sleep(for: .milliseconds(360)) } catch { return }
            headingFocused = true
        }
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
                stepCount: visibleSteps.count
            )

            ZStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        WelcomeStepHeading(
                            symbol: stepSymbol,
                            title: stepTitle,
                            detail: stepDescription,
                            isOptional: isOptionalStep
                        )
                        .accessibilityFocused($headingFocused)

                        stepContent(data)

                        if let error = completionStore.error {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(Color.statusText(.red))
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.top)
                .id(currentStep)
                .transition(stepTransition)
            }
            .clipped()

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
            showsReminder: currentStep != .photo,
            showsBack: stepIndex > 0,
            primaryTitle: primaryFooterTitle,
            primaryEnabled: canUsePrimaryFooterAction,
            isSaving: completionStore.isSaving || isLoadingPhoto,
            onReminder: snooze,
            onBack: moveBack,
            onPrimary: performPrimaryFooterAction
        )
    }

    private var primaryFooterTitle: String {
        if isOptionalStep && !canContinue {
            return isLastStep ? "Finish" : "Skip"
        }
        return isLastStep ? "Finish" : "Continue"
    }

    private var canUsePrimaryFooterAction: Bool {
        canContinue || isOptionalStep
    }

    private var stepTitle: String {
        switch currentStep {
        case .email: return "Your team email"
        case .phones: return "Stay connected"
        case .wiscard: return "Your Wiscard"
        case .student: return "Your student details"
        case .apparel: return "Find your fit"
        case .photo: return "A familiar face"
        case .unknown: return currentStep.title
        }
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

    private var stepDescription: String {
        switch currentStep {
        case .email: "You’ll sign in with your campus email. Add your Athletics email for team communication."
        case .phones where hasSimplePhoneStep: "What’s the best number for day-of updates and quick questions?"
        case .phones: "Add your personal and work numbers so the team knows how to reach you. No work phone? Just say so below."
        case .wiscard: "Have your Wiscard handy. Its card number and issue code help identify you at the gear kiosk."
        case .student: "Choose your year and expected graduation. You can update these later in Profile."
        case .apparel: "Help us get team clothing and shoes in the right sizes."
        case .photo: "Help teammates recognize you on the roster, schedule, and at the gear kiosk."
        case .unknown: ""
        }
    }

    private var stepTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .offset(x: direction * 32).combined(with: .opacity),
            removal: .offset(x: direction * -24).combined(with: .opacity)
        )
    }

    private var isOptionalStep: Bool { currentStep == .apparel || currentStep == .photo }

    private var canContinue: Bool {
        guard let profile else { return false }
        return draft.canContinue(currentStep, profile: profile)
    }

    private func hydrateIfNeeded() {
        guard !didHydrate, let data else { return }
        draft.hydrate(from: data.profile)
        currentStep = ProfileCompletionStep.startingStep(
            for: data.profile.role, suggested: data.completion.firstIncompleteStep
        )
        didHydrate = true
    }

    private func move(to step: ProfileCompletionStep, direction: Double) {
        self.direction = direction
        completionStore.clearError()
        focusedField = nil
        headingFocused = false
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.34, extraBounce: 0)) {
            currentStep = step
        }
        Haptics.selection()
    }

    private func moveBack() {
        guard let prior = visibleSteps[safe: stepIndex - 1] else { return }
        move(to: prior, direction: -1)
    }

    private func continueFromCurrentStep() {
        guard canContinue, let user, let profile else { return }
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
            let nextStep = currentStep.nextStep(for: next.profile.role) ?? currentStep
            if nextStep != currentStep { move(to: nextStep, direction: 1) }
        }
    }

    private func performPrimaryFooterAction() {
        guard !completionStore.isSaving, !isLoadingPhoto else { return }
        focusedField = nil
        if isOptionalStep && !canContinue {
            skipOptionalStep()
        } else {
            continueFromCurrentStep()
        }
    }

    private func skipOptionalStep() {
        guard isOptionalStep else { return }
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
        guard let user else { return }
        completionStore.continueForSession(for: user.id)
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
