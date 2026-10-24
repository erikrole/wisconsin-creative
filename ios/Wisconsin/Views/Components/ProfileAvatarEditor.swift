import PhotosUI
import SwiftUI

private struct AvatarPhotoSelection: Identifiable {
    let id = UUID()
    let image: UIImage
    let expectedAvatarURL: String?
    let userId: String
}

/// The account's photo remains editable after optional onboarding is finished.
struct ProfileAvatarEditor: View {
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var completion
    @State private var selection: PhotosPickerItem?
    @State private var photo: AvatarPhotoSelection?
    @State private var isLoading = false
    @State private var confirmRemoval = false
    @State private var error: String?

    var body: some View {
        let photoTitle = completion.response?.profile.avatarUrl == nil ? "Add photo" : "Change photo"
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                PhotosPicker(selection: $selection, matching: .images) {
                    Label(photoTitle, systemImage: "photo")
                }
                .disabled(isLoading || completion.isSaving || completion.isLoading || completion.response?.profile.id != session.currentUser?.id)
                if completion.response?.profile.avatarUrl != nil {
                    Button("Remove", role: .destructive) { confirmRemoval = true }
                        .disabled(isLoading || completion.isSaving)
                }
                if isLoading || completion.isSaving { ProgressView() }
            }
            .buttonStyle(.bordered)
            if let error = error ?? completion.error {
                Text(error).font(.footnote).foregroundStyle(Color.statusText(.red))
            }
            if completion.photoRefreshNeeded || completion.response == nil {
                Button("Refresh profile") {
                    guard let user = session.currentUser else { return }
                    Task { await completion.load(for: user, force: true); await session.refreshCurrentUser() }
                }.disabled(completion.isLoading || completion.isSaving)
            }
        }
        .onChange(of: selection) { _, item in
            guard let item, let user = session.currentUser else { return }
            Task {
                isLoading = true; error = nil
                defer { isLoading = false }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self),
                          let image = await NativeImageProcessor.downsample(data: data, maxPixels: 2400, scale: 1)
                    else { throw CocoaError(.fileReadCorruptFile) }
                    guard session.currentUser?.id == user.id, selection == item else { return }
                    photo = AvatarPhotoSelection(image: image, expectedAvatarURL: completion.response?.profile.avatarUrl, userId: user.id)
                } catch { self.error = "That photo couldn’t be opened. Choose another photo."; selection = nil }
            }
        }
        .sheet(item: $photo, onDismiss: { selection = nil }) { selected in
            ProfilePhotoCropView(image: selected.image, profileName: session.currentUser?.name ?? "your", saveFailureMessage: { completion.error }) { data in
                guard let user = session.currentUser, user.id == selected.userId else { return false }
                let saved = await completion.uploadAvatar(data, expectedAvatarURL: selected.expectedAvatarURL, for: user)
                if saved {
                    session.applyConfirmedAvatar(completion.response?.profile.avatarUrl, for: user.id)
                    await session.refreshCurrentUser()
                }
                else { error = completion.error }
                return saved
            }
        }
        .confirmationDialog("Remove your profile photo?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) {
                guard let user = session.currentUser else { return }
                Task {
                    if await completion.removeAvatar(for: user) {
                        session.applyConfirmedAvatar(nil, for: user.id)
                        await session.refreshCurrentUser()
                    }
                    else { error = completion.error }
                }
            }
        } message: { Text("Your initials will appear until you add another photo.") }
        .task(id: session.currentUser?.id) {
            guard let user = session.currentUser else { return }
            await completion.load(for: user, force: true)
        }
    }
}
