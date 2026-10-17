import PDFKit
import SwiftUI
import WebKit

struct BrandAssetFolderRoute: Hashable {
    let id: String
}

@MainActor
@Observable
final class BrandAssetFolderModel {
    var folderName: String
    var folders: [BrandAssetChildFolder] = []
    var assets: [BrandAssetSummary] = []
    var isLoading = false
    var error: String?
    var query = ""
    var sort: BrandAssetSort = .name
    private(set) var showingSearchResults = false

    let folderId: String?
    private var loads = LatestRequestGeneration()

    init(folderId: String?) {
        self.folderId = folderId
        folderName = folderId == nil ? "Brand assets" : "Folder"
    }

    func setQuery(_ query: String) {
        guard query != self.query else { return }
        self.query = query
        loads.invalidate()
    }

    func setSort(_ sort: BrandAssetSort) {
        guard sort != self.sort else { return }
        self.sort = sort
        loads.invalidate()
    }

    func load() async {
        let token = loads.begin()
        let requestQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestSort = sort
        isLoading = true
        defer {
            if loads.owns(token) { isLoading = false }
        }
        do {
            let page = try await APIClient.shared.brandAssets(
                folderId: folderId,
                search: requestQuery.isEmpty ? nil : requestQuery,
                sort: requestSort.rawValue
            )
            guard loads.owns(token), !Task.isCancelled else { return }
            folderName = page.folder.name.isEmpty ? "Brand assets" : page.folder.name
            folders = page.folders
            assets = page.assets
            showingSearchResults = !requestQuery.isEmpty
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

@MainActor
@Observable
final class BrandAssetFileModel {
    let asset: BrandAssetSummary
    private var downloadedFile: BrandAssetDownload?
    var fileURL: URL? { downloadedFile?.fileURL }
    var canPreview = false
    var previewImage: UIImage?
    var svgHTML: String?
    var isLoading = false
    var error: String?
    private var loads = LatestRequestGeneration()

    init(asset: BrandAssetSummary) {
        self.asset = asset
    }

    func loadIfNeeded() async {
        guard asset.opensInline, fileURL == nil else { return }
        await download()
    }

    func download() async {
        guard let version = asset.currentVersion, !isLoading else { return }
        let token = loads.begin()
        isLoading = true
        error = nil
        defer {
            if loads.owns(token) { isLoading = false }
        }
        do {
            let download = try await APIClient.shared.brandAssetFile(
                id: asset.id,
                versionId: version.id,
                fallbackName: version.originalName
            )
            guard loads.owns(token), !Task.isCancelled else { return }
            downloadedFile = download
            preparePreview(at: download.fileURL)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    private func preparePreview(at url: URL) {
        guard let version = asset.currentVersion else { return }
        canPreview = brandAssetCanPreview(version: version, at: url)
        guard canPreview else { return }
        switch brandAssetPreviewKind(version.contentType) {
        case .image:
            previewImage = brandAssetPreviewImage(at: url)
        case .svg:
            if let data = try? Data(contentsOf: url) {
                svgHTML = brandAssetSVGDocument(from: data)
            }
        case .pdf, .other:
            break
        }
    }
}

struct BrandAssetsView: View {
    var wrapsInNavigationStack = true

    @State private var navigationPath = NavigationPath()
    @Environment(AppState.self) private var appState

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack(path: $navigationPath) { root }
        } else {
            root
        }
    }

    private var root: some View {
        BrandAssetFolderPage(folderId: nil)
            .navigationDestination(for: BrandAssetFolderRoute.self) { route in
                BrandAssetFolderPage(folderId: route.id)
            }
            .navigationDestination(for: BrandAssetSummary.self) { asset in
                BrandAssetFilePage(asset: asset)
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
            }
    }
}

private struct BrandAssetFolderPage: View {
    let folderId: String?

    @State private var model: BrandAssetFolderModel
    @State private var searchText = ""
    @State private var searchTask: Task<Void, Never>?

    init(folderId: String?) {
        self.folderId = folderId
        _model = State(initialValue: BrandAssetFolderModel(folderId: folderId))
    }

    var body: some View {
        content
            .navigationTitle(model.folderName)
            .navigationBarTitleDisplayMode(folderId == nil ? .large : .inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search brand assets"
            )
            .onChange(of: searchText) { _, newValue in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    model.setQuery(newValue)
                    await model.load()
                }
            }
            .refreshable { await model.load() }
            .task { await model.load() }
            .onDisappear { searchTask?.cancel() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort", selection: sortBinding) {
                            ForEach(BrandAssetSort.allCases) { sort in
                                Text(sort.label).tag(sort)
                            }
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                    .listControlTint(isActive: model.sort != .name)
                    .accessibilityLabel(model.sort == .name ? "Sort" : "Sort, \(model.sort.label)")
                }
            }
    }

    private var sortBinding: Binding<BrandAssetSort> {
        Binding(
            get: { model.sort },
            set: { sort in
                model.setSort(sort)
                Task { await model.load() }
            }
        )
    }

    @ViewBuilder
    private var content: some View {
        if model.folders.isEmpty, model.assets.isEmpty, model.isLoading {
            ProgressView("Loading files")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.folders.isEmpty, model.assets.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load brand assets", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await model.load() } }
            }
        } else if model.folders.isEmpty, model.assets.isEmpty {
            ContentUnavailableView {
                Label(
                    model.showingSearchResults ? "No matching files" : "This folder is empty",
                    systemImage: model.showingSearchResults ? "magnifyingglass" : "folder"
                )
            } description: {
                Text(model.showingSearchResults
                    ? "Try a different name."
                    : "Files added on the web show up here.")
            }
        } else {
            List {
                if let error = model.error {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(error)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Button("Try again") { Task { await model.load() } }
                                .buttonStyle(.bordered)
                        }
                    }
                }

                if !model.showingSearchResults, !model.folders.isEmpty {
                    Section {
                        ForEach(model.folders) { folder in
                            NavigationLink(value: BrandAssetFolderRoute(id: folder.id)) {
                                BrandAssetFolderRow(folder: folder)
                            }
                        }
                    } header: {
                        Text("Folders")
                    }
                }

                if !model.assets.isEmpty {
                    Section {
                        ForEach(model.assets) { asset in
                            NavigationLink(value: asset) {
                                BrandAssetFileRow(
                                    asset: asset,
                                    folderLabel: model.showingSearchResults ? brandAssetFolderLabel(asset.folder.path) : nil
                                )
                            }
                        }
                    } header: {
                        Text(model.showingSearchResults ? "Search results" : "Files")
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }
}

private struct BrandAssetFolderRow: View {
    let folder: BrandAssetChildFolder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "folder")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 36, height: 40)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(folder.name)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                if let countLabel = folder.countLabel {
                    Text(countLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct BrandAssetFileRow: View {
    let asset: BrandAssetSummary
    var folderLabel: String?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: asset.kind.systemImage)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 36, height: 40)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(asset.name)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        guard let folderLabel, folderLabel != "Brand assets" else { return asset.rowDetail }
        return "\(asset.rowDetail) · \(folderLabel)"
    }
}

private struct BrandAssetFilePage: View {
    let asset: BrandAssetSummary

    @State private var model: BrandAssetFileModel

    init(asset: BrandAssetSummary) {
        self.asset = asset
        _model = State(initialValue: BrandAssetFileModel(asset: asset))
    }

    var body: some View {
        List {
            Section {
                preview
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: asset.currentVersion == nil ? 120 : 280)
                    .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
            }

            if let version = asset.currentVersion {
                Section {
                    LabeledContent("Kind", value: asset.kind.label)
                    LabeledContent("Size", value: brandAssetByteLabel(version.sizeBytes))
                    if let updated = brandAssetDateLabel(version.createdAt) {
                        LabeledContent("Updated", value: updated)
                    }
                    if version.versionNumber > 0 {
                        LabeledContent("Version", value: "\(version.versionNumber)")
                    }
                    LabeledContent("Folder", value: brandAssetFolderLabel(asset.folder.path))
                    if !version.uploadedBy.name.isEmpty {
                        LabeledContent("Added by", value: version.uploadedBy.name)
                    }
                }
                if let note = version.versionNote?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                    Section {
                        Text(note)
                            .font(.body)
                            .foregroundStyle(.primary)
                    } header: {
                        Text("Note")
                    }
                }
            }

            if let description = asset.description?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty {
                Section {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(.primary)
                } header: {
                    Text("About")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(asset.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                shareControl
            }
        }
        .task { await model.loadIfNeeded() }
    }

    @ViewBuilder
    private var preview: some View {
        if asset.currentVersion == nil {
            VStack(spacing: 8) {
                Image(systemName: "doc")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("No version yet")
                    .font(.body)
                Text("Uploading a version stays on the web.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 24)
        } else if model.isLoading, model.fileURL == nil {
            ProgressView("Opening")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.fileURL == nil {
            VStack(spacing: 12) {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Try again") { Task { await model.download() } }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let previewImage = model.previewImage {
            Image(uiImage: previewImage)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: 480)
                .accessibilityLabel(asset.name)
        } else if let svgHTML = model.svgHTML {
            BrandAssetSVGView(html: svgHTML)
                .frame(maxWidth: .infinity)
                .frame(height: 360)
                .accessibilityLabel(asset.name)
        } else if model.canPreview, let fileURL = model.fileURL, asset.currentVersion.map({ brandAssetPreviewKind($0.contentType) == .pdf }) == true {
            BrandAssetPDFView(url: fileURL)
                .frame(maxWidth: .infinity)
                .frame(height: 480)
                .accessibilityLabel(asset.name)
        } else {
            VStack(spacing: 8) {
                Image(systemName: asset.kind.systemImage)
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(unavailableCopy)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 24)
        }
    }

    private var unavailableCopy: String {
        guard let version = asset.currentVersion else { return "This file opens in another app." }
        if version.sizeBytes > brandAssetPreviewByteLimit(version.contentType) || (model.fileURL != nil && !model.canPreview),
           brandAssetPreviewKind(version.contentType) != .other {
            return "This file is too large to preview here. Share it to open it."
        }
        switch asset.kind {
        case .font:
            return "This font opens in another app. Sharing does not install it on this iPhone."
        case .video:
            return "This video opens in another app."
        default:
            return "This file opens in another app."
        }
    }

    @ViewBuilder
    private var shareControl: some View {
        if asset.currentVersion == nil {
            EmptyView()
        } else if let fileURL = model.fileURL {
            ShareLink(item: fileURL) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        } else {
            Button {
                Task { await model.download() }
            } label: {
                if model.isLoading {
                    ProgressView()
                } else {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            .disabled(model.isLoading)
            .accessibilityLabel("Share")
        }
    }
}

private struct BrandAssetPDFView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
    }
}

private struct BrandAssetSVGView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = false
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = preferences
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            let initialDocument = navigationAction.navigationType == .other
                && navigationAction.request.url?.absoluteString == "about:blank"
                && navigationAction.targetFrame?.isMainFrame == true
            decisionHandler(initialDocument ? .allow : .cancel)
        }
    }
}
