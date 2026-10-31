import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// Read-and-copy list of department logins. Creating, editing, and archiving
/// stay on the website. A password is requested only when someone shows or
/// copies it, stays in memory for at most 30 seconds, and is never logged.
@MainActor
@Observable
final class SharedLoginsViewModel {
    private(set) var logins: [SoftwareLogin] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var refreshError: String?
    private(set) var revealed: [String: String] = [:]
    private(set) var pendingSecretIds: Set<String> = []
    private(set) var wifi: SharedWifi?
    var showWifiPassword = false
    var searchText = ""
    var toast: Toast?

    private var loadGeneration = 0
    private var revealGeneration: [String: Int] = [:]
    private var hideTasks: [String: Task<Void, Never>] = [:]

    var visibleLogins: [SoftwareLogin] {
        logins.filter { $0.isActive && $0.matches(query: searchText) }
    }

    func load(forceRefresh: Bool = false) async {
        if !forceRefresh, isLoading { return }
        loadGeneration += 1
        let generation = loadGeneration
        let hadLogins = !logins.isEmpty
        if !hadLogins { isLoading = true }
        if forceRefresh { refreshError = nil }

        do {
            // Wi-Fi is a bonus section: if it fails, the logins still show.
            async let wifiResult = try? await APIClient.shared.sharedWifi()
            let page = try await APIClient.shared.softwareLogins()
            let loadedWifi = await wifiResult
            guard generation == loadGeneration else { return }
            wifi = loadedWifi
            logins = page.filter(\.isActive)
            error = nil
            refreshError = nil
            clearSecrets()
        } catch is CancellationError {
            if generation == loadGeneration { isLoading = false }
            return
        } catch {
            guard generation == loadGeneration else { return }
            let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
            if logins.isEmpty {
                self.error = message
            } else {
                refreshError = message
            }
        }
        if generation == loadGeneration { isLoading = false }
    }

    func togglePassword(for login: SoftwareLogin) async {
        if revealed[login.id] != nil {
            hide(login.id)
            return
        }
        guard let password = await fetchPassword(for: login) else { return }
        revealed[login.id] = password
        scheduleHide(login.id)
    }

    func copyWifi(_ value: String, message: String) {
        copyToThisPhone(value)
        toast = Toast(message: message, icon: "doc.on.doc", role: .success)
        Haptics.success()
    }

    func copyEmail(_ login: SoftwareLogin) {
        copyToThisPhone(login.accountEmail)
        toast = Toast(message: "Login email copied", icon: "doc.on.doc", role: .success)
        Haptics.success()
    }

    func copyPassword(for login: SoftwareLogin) async {
        let password: String?
        if let held = revealed[login.id] {
            password = held
        } else {
            password = await fetchPassword(for: login)
        }
        guard let password else { return }
        copyToThisPhone(password)
        toast = Toast(message: "Password copied for 2 minutes", icon: "doc.on.doc", role: .success)
        Haptics.success()
    }

    /// Drops every password held on screen. Copied text still expires on its own.
    func clearSecrets() {
        for task in hideTasks.values { task.cancel() }
        hideTasks.removeAll()
        for id in Set(revealed.keys).union(revealGeneration.keys).union(pendingSecretIds) {
            revealGeneration[id, default: 0] += 1
        }
        revealed.removeAll()
        showWifiPassword = false
    }

    private func hide(_ id: String) {
        hideTasks[id]?.cancel()
        hideTasks[id] = nil
        revealGeneration[id, default: 0] += 1
        revealed.removeValue(forKey: id)
    }

    private func scheduleHide(_ id: String) {
        hideTasks[id]?.cancel()
        let generation = revealGeneration[id, default: 0]
        hideTasks[id] = Task { @MainActor in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, revealGeneration[id, default: 0] == generation else { return }
            revealed.removeValue(forKey: id)
            hideTasks[id] = nil
        }
    }

    private func fetchPassword(for login: SoftwareLogin) async -> String? {
        guard pendingSecretIds.insert(login.id).inserted else { return nil }
        let generation = revealGeneration[login.id, default: 0]
        defer { pendingSecretIds.remove(login.id) }
        do {
            let password = try await APIClient.shared.softwareLoginPassword(id: login.id)
            guard revealGeneration[login.id, default: 0] == generation else { return nil }
            return password
        } catch {
            guard revealGeneration[login.id, default: 0] == generation else { return nil }
            let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
            toast = Toast(message: message, icon: "exclamationmark.triangle", role: .error)
            Haptics.error()
            return nil
        }
    }

    /// Stays on this iPhone. Universal clipboard would carry a password to another device.
    private func copyToThisPhone(_ value: String) {
        UIPasteboard.general.setObjects(
            [value],
            localOnly: true,
            expirationDate: Date().addingTimeInterval(120)
        )
    }
}

struct SharedLoginsView: View {
    var wrapsInNavigationStack = true

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var vm = SharedLoginsViewModel()
    @State private var showWifiQR = false

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack { configuredContent }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        @Bindable var vm = vm
        return content
            .navigationTitle("Shared logins")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $vm.searchText, prompt: "Search shared logins")
            .refreshable { await vm.load(forceRefresh: true) }
            .task { await vm.load() }
            .onDisappear { vm.clearSecrets() }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { vm.clearSecrets() }
            }
            .toast($vm.toast)
            // On the screen, not the row: a List can drop an offscreen row and
            // its sheet with it.
            .sheet(isPresented: $showWifiQR) {
                if let wifi = vm.wifi { WifiQRSheet(wifi: wifi) }
            }
    }

    @ViewBuilder
    private var content: some View {
        if vm.isLoading && vm.logins.isEmpty {
            ProgressView("Loading shared logins")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = vm.error, vm.logins.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load shared logins", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if vm.visibleLogins.isEmpty && (vm.wifi == nil || !vm.searchText.isEmpty) {
            ContentUnavailableView {
                Label(
                    vm.searchText.isEmpty ? "No shared logins" : "No logins match",
                    systemImage: "lock.rectangle"
                )
            } description: {
                Text(vm.searchText.isEmpty
                    ? "Department logins are added on the website."
                    : "Try a different name or email.")
            }
        } else {
            List {
                if let refreshError = vm.refreshError {
                    Section {
                        VStack(alignment: .leading, spacing: Brand.Space.xs) {
                            Text("Couldn't refresh. This is the last list that loaded.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(refreshError)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Button("Retry") { Task { await vm.load(forceRefresh: true) } }
                        }
                    }
                }

                if let wifi = vm.wifi, vm.searchText.isEmpty {
                    Section {
                        wifiCard(wifi)
                    } header: {
                        Text("Wi-Fi")
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .textCase(nil)
                    }
                }

                ForEach(vm.visibleLogins) { login in
                    Section {
                        loginCard(login)
                    } header: {
                        Text(login.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .textCase(nil)
                    }
                }

                Section {
                    Text("Adding, editing, and archiving stay on the website.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder
    private func wifiCard(_ wifi: SharedWifi) -> some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            secretRow(
                title: "Network",
                value: wifi.ssid,
                isSecret: false,
                accessibilityValue: wifi.ssid
            ) {
                Button {
                    vm.copyWifi(wifi.ssid, message: "Network name copied")
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Copy Wi-Fi network name")
            }

            secretRow(
                title: "Password",
                value: vm.showWifiPassword ? wifi.password : "••••••••",
                isSecret: true,
                accessibilityValue: vm.showWifiPassword ? "Visible" : "Hidden"
            ) {
                Button {
                    vm.showWifiPassword.toggle()
                } label: {
                    Image(systemName: vm.showWifiPassword ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(vm.showWifiPassword ? "Hide Wi-Fi password" : "Show Wi-Fi password")

                Button {
                    vm.copyWifi(wifi.password, message: "Wi-Fi password copied for 2 minutes")
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Copy Wi-Fi password")
            }

            Button {
                showWifiQR = true
            } label: {
                Label("Show QR code", systemImage: "qrcode")
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, Brand.Space.xs)
    }

    @ViewBuilder
    private func loginCard(_ login: SoftwareLogin) -> some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack(spacing: Brand.Space.xs) {
                StatusPill(label: login.categoryLabel, tone: .gray)
                Image(systemName: "lock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Password protected")
            }
            Text("Shared with \(login.audiencePhrase).")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            secretRow(
                title: "Login email",
                value: login.accountEmail,
                isSecret: false,
                accessibilityValue: login.accountEmail
            ) {
                Button {
                    vm.copyEmail(login)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Copy \(login.name) login email")
            }

            secretRow(
                title: "Password",
                value: vm.revealed[login.id] ?? "••••••••",
                isSecret: true,
                accessibilityValue: vm.revealed[login.id] == nil ? "Hidden" : "Visible for 30 seconds"
            ) {
                if vm.pendingSecretIds.contains(login.id) {
                    ProgressView()
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Getting \(login.name) password")
                } else {
                    Button {
                        Task { await vm.togglePassword(for: login) }
                    } label: {
                        Image(systemName: vm.revealed[login.id] == nil ? "eye" : "eye.slash")
                    }
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel(vm.revealed[login.id] == nil
                        ? "Show \(login.name) password"
                        : "Hide \(login.name) password")

                    Button {
                        Task { await vm.copyPassword(for: login) }
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .buttonStyle(.borderless)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Copy \(login.name) password")
                }
            }

            if let url = login.safeWebsiteURL {
                Button {
                    openURL(url)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Open website")
                            Text(url.host ?? url.absoluteString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "arrow.up.right")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Open \(login.name) website")
            }
        }
        .padding(.vertical, Brand.Space.xs)
    }

    private func secretRow<Actions: View>(
        title: String,
        value: String,
        isSecret: Bool,
        accessibilityValue: String,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        HStack(alignment: .center, spacing: Brand.Space.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body.monospaced())
                    .textSelectable(isSecret && value != "••••••••")
                    .privacySensitive(isSecret)
                    .lineLimit(3)
                    .accessibilityLabel("\(title), \(accessibilityValue)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            actions()
        }
    }
}

private extension View {
    /// `textSelection` takes a distinct type for enabled and disabled, so the
    /// two cases cannot share a ternary.
    @ViewBuilder
    func textSelectable(_ selectable: Bool) -> some View {
        if selectable {
            textSelection(.enabled)
        } else {
            textSelection(.disabled)
        }
    }
}

/// Big code for someone else's camera: the standard Wi-Fi join string, drawn
/// with Core Image so it works offline.
private struct WifiQRSheet: View {
    let wifi: SharedWifi
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: Brand.Space.md) {
                if let image = Self.qrImage(wifi.qrPayload) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(Brand.Space.sm)
                        .background(.white, in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityLabel("QR code to join the \(wifi.ssid) Wi-Fi network")
                }
                Text(wifi.ssid)
                    .font(.title3.weight(.semibold))
            }
            .padding()
            .frame(maxWidth: 420)
            .navigationTitle("Join the Wi-Fi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private static func qrImage(_ payload: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cgImage = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
