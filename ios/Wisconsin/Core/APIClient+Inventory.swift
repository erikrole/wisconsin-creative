import Foundation

// Resources and assets.

extension APIClient {
    // MARK: - Resources

    func guides(search: String? = nil, category: String? = nil) async throws -> [GuideListItem] {
        var items: [URLQueryItem] = []
        if let search, !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(.init(name: "q", value: search))
        }
        if let category, !category.isEmpty {
            items.append(.init(name: "category", value: category))
        }
        let resp: DataWrapper<[GuideListItem]> = try await perform(request(path: "/api/resources", queryItems: items))
        return resp.data
    }

    func guide(slug: String) async throws -> GuideListItem {
        let resp: DataWrapper<GuideListItem> = try await perform(request(path: "/api/resources/\(slug)"))
        return resp.data
    }

    /// `GET /api/resources/assets`. Read-only folder listing. Search uses
    /// `scope=all` so a logo can be found under the current folder.
    func brandAssets(folderId: String?, search: String?, sort: String) async throws -> BrandAssetLibraryPage {
        var items: [URLQueryItem] = [
            .init(name: "sort", value: sort),
        ]
        if let folderId, !folderId.isEmpty {
            items.append(.init(name: "folderId", value: folderId))
        }
        let trimmedSearch = search?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmedSearch.isEmpty {
            items.append(.init(name: "q", value: trimmedSearch))
            items.append(.init(name: "scope", value: "all"))
        }
        let response: DataWrapper<BrandAssetLibraryPage> = try await perform(
            request(path: "/api/resources/assets", queryItems: items)
        )
        return response.data
    }

    /// Authenticated version-specific download. The bytes stay in a temp file and
    /// are never a public Blob URL.
    func brandAssetFile(id: String, versionId: String, fallbackName: String) async throws -> BrandAssetDownload {
        let req = request(path: "/api/resources/assets/\(id)/download", queryItems: [.init(name: "versionId", value: versionId)])
        let requestBoundary = authSessionBoundary.capture()
        let temp: URL
        let response: URLResponse
        do {
            (temp, response) = try await fileSession.download(for: req)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw APIError.networkError(error)
        }

        guard authSessionBoundary.owns(requestBoundary) else {
            try? FileManager.default.removeItem(at: temp)
            throw APIError.sessionChanged
        }
        guard let http = response as? HTTPURLResponse else {
            try? FileManager.default.removeItem(at: temp)
            throw APIError.serverError("Invalid response")
        }
        guard (200...299).contains(http.statusCode) else {
            let data = (try? Data(contentsOf: temp)) ?? Data()
            try? FileManager.default.removeItem(at: temp)
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            if http.statusCode == 404 {
                throw APIError.notFound
            }
            let message = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error
                ?? "Couldn't open that file."
            throw APIError.httpError(statusCode: http.statusCode, message: message)
        }

        let filename = brandAssetDownloadName(
            header: http.value(forHTTPHeaderField: "Content-Disposition"),
            fallback: fallbackName
        )
        // A unique directory prevents another page/version from replacing a
        // file while PDFKit or a share extension is still reading it.
        let directory = BrandAssetDownload.directory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(filename)
        do {
            try FileManager.default.moveItem(at: temp, to: destination)
        } catch {
            try FileManager.default.copyItem(at: temp, to: destination)
            try? FileManager.default.removeItem(at: temp)
        }
        let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        return BrandAssetDownload(fileURL: destination, contentType: contentType)
    }

    // MARK: - Assets

    func assets(
        search: String? = nil,
        qr: String? = nil,
        statuses: Set<AssetComputedStatus> = [],
        categoryId: String? = nil,
        locationId: String? = nil,
        sort: String? = nil,
        favoritesOnly: Bool = false,
        includeAccessories: Bool = false,
        limit: Int = 30,
        offset: Int = 0
    ) async throws -> AssetsResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty { items.append(.init(name: "q", value: search)) }
        if let qr, !qr.isEmpty { items.append(.init(name: "qr", value: qr)) }
        for status in statuses {
            items.append(.init(name: "status", value: status.rawValue))
        }
        if let categoryId { items.append(.init(name: "category_id", value: categoryId)) }
        if let locationId, !locationId.isEmpty { items.append(.init(name: "location_id", value: locationId)) }
        if let sort, !sort.isEmpty { items.append(.init(name: "sort", value: sort)) }
        if favoritesOnly { items.append(.init(name: "favorites_only", value: "true")) }
        if includeAccessories { items.append(.init(name: "include_accessories", value: "true")) }
        return try await perform(request(path: "/api/assets", queryItems: items))
    }

    func asset(id: String) async throws -> AssetDetail {
        let req = request(path: "/api/assets/\(id)")
        let resp: DataWrapper<AssetDetail> = try await perform(req)
        return resp.data
    }

    /// Staff and admin item History. Same route as the website: `scope` is
    /// `all`, `asset`, or `booking`, and `cursor` loads the next older page.
    func assetActivity(
        assetId: String,
        scope: AssetActivityScope,
        cursor: String?
    ) async throws -> AssetActivityPage {
        var items: [URLQueryItem] = [
            .init(name: "scope", value: scope.rawValue),
        ]
        if let cursor, !cursor.isEmpty {
            items.append(.init(name: "cursor", value: cursor))
        }
        return try await perform(request(path: "/api/assets/\(assetId)/activity", queryItems: items))
    }

    func assetsLookup(rawScan: String) async throws -> String? {
        let resp = try await scannedAssets(rawScan: rawScan, limit: 5)
        return resp.data.first?.id
    }

    func scannedAssets(rawScan: String, limit: Int = 5) async throws -> AssetsResponse {
        // Old kiosk QR codes encoded the asset's CUID as bg://item/{id}.
        // Try direct ID lookup first; if 404, fall through to the qrCodeValue
        // search below (which handles bg://item/{assetTag} stored verbatim).
        if rawScan.hasPrefix("bg://item/") {
            let embedded = String(rawScan.dropFirst("bg://item/".count))
            if !embedded.isEmpty {
                do {
                    let found = try await asset(id: embedded).asAsset
                    return AssetsResponse(data: [found], bulkItems: Array(), total: 1, limit: limit, offset: 0)
                } catch APIError.notFound {
                    // Not a raw CUID — fall through to qrCodeValue search.
                }
            }
        }

        // Pass the full raw scan as ?qr= so the server can do exact qrCodeValue
        // and derived item-family unit matches. Strip URL-scheme prefixes only
        // for the ?q= general-text search.
        let stripped = rawScan
            .replacingOccurrences(of: "bg://item/", with: "")
            .replacingOccurrences(of: "bg://case/", with: "")
        let req = request(path: "/api/assets", queryItems: [
            .init(name: "q", value: stripped),
            .init(name: "qr", value: rawScan),
            .init(name: "limit", value: "\(limit)"),
        ])
        return try await perform(req)
    }

    func assetByQR(qrValue: String) async throws -> Asset? {
        let req = request(path: "/api/assets", queryItems: [
            .init(name: "qr", value: qrValue),
            .init(name: "limit", value: "1"),
        ])
        let resp: AssetsResponse = try await perform(req)
        return resp.data.first
    }
    /// The body is not read; success is the 2xx.
    private struct DamageCaseAck: Decodable, Sendable {}

    /// Closes a damage or missing-item case. Repaired, found and no issue release
    /// the item; replaced and written off retire it. Staff and admin only.
    func resolveDamageCase(reportId: String, resolution: DamageResolution, note: String) async throws {
        struct Body: Encodable {
            let resolution: String
            let note: String?
        }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        var req = request(path: "/api/damage-cases/\(reportId)/resolve", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(resolution: resolution.rawValue, note: trimmed.isEmpty ? nil : trimmed))
        let _: DataWrapper<DamageCaseAck> = try await perform(req)
    }

    /// The staff triage queue. `view` is `open` or `closed`.
    func damageCases(view: DamageCaseView) async throws -> DamageCaseList {
        let req = request(path: "/api/damage-cases", queryItems: [.init(name: "view", value: view.rawValue)])
        let resp: DataWrapper<DamageCaseList> = try await perform(req)
        return resp.data
    }

    /// Files a damage or missing report from the item page (multipart, optional JPEG).
    func reportAssetProblem(assetId: String, isMissing: Bool, description: String, jpegData: Data?) async throws {
        let boundary = "WisconsinReport-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("type", isMissing ? "LOST" : "DAMAGED")
        field("description", description)
        if let jpegData {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"report.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8))
            body.append(jpegData)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        var req = request(path: "/api/assets/\(assetId)/report", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let _: DataWrapper<DamageCaseAck> = try await perform(req)
    }


}
