import XCTest
@testable import Wisconsin

final class BrandAssetModelTests: XCTestCase {
    @MainActor
    func testConcurrentPreviewKeepsSVGSafetyAndRejectsOversizedFiles() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".svg")
        defer { try? FileManager.default.removeItem(at: url) }
        let data = Data(#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>"#.utf8)
        try data.write(to: url)
        let version = try XCTUnwrap(summary(kind: "LOGO", contentType: "image/svg+xml", sizeBytes: data.count).currentVersion)
        let preview = try await BrandAssetPreparedPreview.prepare(version: version, at: url)
        XCTAssertTrue(preview.canPreview)
        XCTAssertFalse(try XCTUnwrap(preview.svgHTML).contains("<script>"))

        try Data(repeating: 0, count: brandAssetSVGByteLimit + 1).write(to: url)
        let oversized = try await BrandAssetPreparedPreview.prepare(version: version, at: url)
        XCTAssertFalse(oversized.canPreview)
        XCTAssertNil(oversized.svgHTML)
    }

    func testLibraryPageDecodesTheListEnvelopeAndUnknownKinds() throws {
        let page = try decodePage("""
        {
          "folder": {"id":"root","name":"Brand assets","path":"brand-assets"},
          "breadcrumbs": [{"id":"root","name":"Brand assets","path":"brand-assets"}],
          "folders": [{"id":"logos","name":"Logos","path":"brand-assets/logos","assetCount":1}],
          "assets": [
            {
              "id": "asset-1",
              "name": "Motion W",
              "kind": "LOGO",
              "description": "Primary mark",
              "folderId": "logos",
              "folder": {"id":"logos","name":"Logos","path":"brand-assets/logos"},
              "isFavorite": true,
              "createdAt": "2026-10-16T18:00:00.000Z",
              "updatedAt": "2026-10-16T18:00:00.000Z",
              "versionCount": 3,
              "currentVersion": {
                "id": "ver-1",
                "versionNumber": 3,
                "originalName": "motion-w.svg",
                "contentType": "image/svg+xml",
                "sizeBytes": 2048,
                "etag": "abc",
                "versionNote": "Updated mark",
                "createdAt": "2026-10-16T18:00:00.000Z",
                "uploadedBy": {"id":"user-1","name":"Alex"}
              }
            },
            {
              "id": "asset-2",
              "name": "Mystery",
              "kind": "STICKER",
              "description": null,
              "folderId": "logos",
              "folder": {"id":"logos","name":"Logos","path":"brand-assets/logos"},
              "isFavorite": false,
              "createdAt": "2026-10-16T18:00:00Z",
              "updatedAt": "2026-10-16T18:00:00Z",
              "versionCount": 0,
              "currentVersion": null
            }
          ]
        }
        """)

        XCTAssertEqual(page.folder.path, "brand-assets")
        XCTAssertEqual(page.folders.first?.countLabel, "1 file")
        let logo = try XCTUnwrap(page.assets.first)
        XCTAssertEqual(logo.kind, .logo)
        XCTAssertEqual(logo.kind.label, "Logo")
        XCTAssertEqual(logo.rowDetail, "Logo · 2.0 KB")
        XCTAssertTrue(logo.opensInline)
        XCTAssertEqual(logo.currentVersion?.versionNote, "Updated mark")

        let unknown = try XCTUnwrap(page.assets.last)
        XCTAssertEqual(unknown.kind, .unknown)
        XCTAssertEqual(unknown.kind.label, "File")
        XCTAssertFalse(unknown.opensInline)
        XCTAssertEqual(unknown.rowDetail, "File")
    }

    func testPreviewKindAndInlineLimitFollowTheFile() {
        XCTAssertEqual(brandAssetPreviewKind("image/png"), .image)
        XCTAssertEqual(brandAssetPreviewKind("image/jpeg; charset=binary"), .image)
        XCTAssertEqual(brandAssetPreviewKind("image/svg+xml"), .svg)
        XCTAssertEqual(brandAssetPreviewKind("application/pdf"), .pdf)
        XCTAssertEqual(brandAssetPreviewKind("font/ttf"), .other)

        let pdf = summary(kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: 1200)
        XCTAssertTrue(pdf.opensInline)
        let huge = summary(kind: "DOCUMENT", contentType: "application/pdf", sizeBytes: brandAssetInlineByteLimit + 1)
        XCTAssertFalse(huge.opensInline)
        let font = summary(kind: "FONT", contentType: "font/ttf", sizeBytes: 1200)
        XCTAssertFalse(font.opensInline)
    }

    func testByteAndFolderLabelsStayQuiet() {
        XCTAssertEqual(brandAssetByteLabel(0), "0 B")
        XCTAssertEqual(brandAssetByteLabel(-4), "0 B")
        XCTAssertEqual(brandAssetByteLabel(999), "999 B")
        XCTAssertEqual(brandAssetByteLabel(1024), "1.0 KB")
        XCTAssertEqual(brandAssetByteLabel(1434), "1.4 KB")
        XCTAssertEqual(brandAssetByteLabel(10 * 1024), "10 KB")
        XCTAssertEqual(brandAssetByteLabel(1_048_576), "1.0 MB")
        XCTAssertEqual(brandAssetByteLabel(brandAssetInlineByteLimit), "40 MB")

        XCTAssertEqual(brandAssetFolderLabel("brand-assets"), "Brand assets")
        XCTAssertEqual(brandAssetFolderLabel("brand-assets/"), "Brand assets")
        XCTAssertEqual(brandAssetFolderLabel("brand-assets/logos"), "logos")
        XCTAssertEqual(brandAssetFolderLabel("brand-assets/logos/home"), "logos/home")
    }

    func testDatesAcceptFractionalAndPlainInternetTime() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let fractional = try XCTUnwrap(brandAssetDate("2026-10-16T18:00:00.000Z"))
        let plain = try XCTUnwrap(brandAssetDate("2026-10-16T18:00:00Z"))
        XCTAssertEqual(calendar.component(.year, from: fractional), 2026)
        XCTAssertEqual(calendar.component(.month, from: fractional), 10)
        XCTAssertEqual(calendar.component(.day, from: fractional), 16)
        XCTAssertEqual(fractional, plain)
        XCTAssertNil(brandAssetDate("not-a-date"))
        XCTAssertNotNil(brandAssetDateLabel("2026-10-16T18:00:00.000Z"))
    }

    func testDownloadNamesPreferTheEncodedHeaderAndDropPathSeparators() {
        XCTAssertEqual(brandAssetDownloadName(header: nil, fallback: "Logo.pdf"), "Logo.pdf")
        XCTAssertEqual(
            brandAssetDownloadName(header: "attachment; filename*=UTF-8''Motion%20W.svg", fallback: "logo.svg"),
            "Motion W.svg"
        )
        XCTAssertEqual(
            brandAssetDownloadName(header: "attachment; filename=\"../../Logo.pdf\"", fallback: "file"),
            "Logo.pdf"
        )
        XCTAssertEqual(brandAssetDownloadName(header: nil, fallback: "   "), "brand-asset")
        XCTAssertEqual(brandAssetSafeFileName("quote\".pdf"), "quote-.pdf")
    }

    func testSVGDocumentStripsActiveContentAndRefusesANonSVG() throws {
        let hostile = """
        <svg xmlns="http://www.w3.org/2000/svg">
          <script>alert(1)</script>
          <meta http-equiv="refresh" content="0;url=https://example.com">
          <foreignObject><div></div></foreignObject>
          <a href="javascript:alert(1)" onclick="alert(1)"><rect width="1" height="1"/></a>
          </body></html>
        </svg>
        """
        let html = try XCTUnwrap(brandAssetSVGDocument(from: Data(hostile.utf8)))
        XCTAssertTrue(html.contains("default-src 'none'"))
        XCTAssertTrue(html.contains("<rect"))
        XCTAssertFalse(html.lowercased().contains("<script"))
        XCTAssertFalse(html.lowercased().contains("foreignobject"))
        XCTAssertFalse(html.lowercased().contains("javascript:"))
        XCTAssertFalse(html.lowercased().contains("onclick"))
        XCTAssertFalse(html.lowercased().contains("http-equiv=\"refresh\""))
        XCTAssertEqual(html.lowercased().components(separatedBy: "</body>").count, 2)
        XCTAssertEqual(html.lowercased().components(separatedBy: "</html>").count, 2)
        XCTAssertNil(brandAssetSVGDocument(from: Data("not svg".utf8)))

        var oversized = Data("<svg></svg>".utf8)
        oversized.append(Data(count: 1_500_001))
        XCTAssertNil(brandAssetSVGDocument(from: oversized))
    }


    func testPreviewChecksActualBytesBeforeReadingIncludingSVGAndSharedPDF() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("file")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        for (type, limit) in [("application/pdf", brandAssetInlineByteLimit), ("image/svg+xml", brandAssetSVGByteLimit)] {
            let version = try XCTUnwrap(summary(kind: "DOCUMENT", contentType: type, sizeBytes: 10).currentVersion)
            try handle.truncate(atOffset: UInt64(limit))
            XCTAssertTrue(brandAssetCanPreview(version: version, at: url))
            try handle.truncate(atOffset: UInt64(limit + 1))
            XCTAssertFalse(brandAssetCanPreview(version: version, at: url))
        }
    }

    func testTemporaryDownloadIsRemovedWhenItsOwnerIsReleased() throws {
        let directory = BrandAssetDownload.directory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("private.pdf")
        try Data("private file".utf8).write(to: url)
        var owner: BrandAssetDownload? = BrandAssetDownload(fileURL: url, contentType: "application/pdf")
        XCTAssertEqual(owner?.fileURL, url)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        owner = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    private func summary(kind: String, contentType: String, sizeBytes: Int) -> BrandAssetSummary {
        let json = """
        {
          "id": "asset",
          "name": "File",
          "kind": "\(kind)",
          "description": null,
          "folderId": "folder",
          "folder": {"id":"folder","name":"Logos","path":"brand-assets/logos"},
          "createdAt": "2026-10-16T18:00:00Z",
          "updatedAt": "2026-10-16T18:00:00Z",
          "versionCount": 1,
          "currentVersion": {
            "id": "ver",
            "versionNumber": 1,
            "originalName": "file.bin",
            "contentType": "\(contentType)",
            "sizeBytes": \(sizeBytes),
            "versionNote": null,
            "createdAt": "2026-10-16T18:00:00Z",
            "uploadedBy": {"id":"user","name":"Alex"}
          }
        }
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(BrandAssetSummary.self, from: Data(json.utf8))
    }

    private func decodePage(_ json: String) throws -> BrandAssetLibraryPage {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(BrandAssetLibraryPage.self, from: Data(json.utf8))
    }
}
