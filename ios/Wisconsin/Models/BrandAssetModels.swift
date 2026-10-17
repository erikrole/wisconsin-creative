import Foundation
import UIKit

/// Files the phone will open in place. Anything larger is shared instead of
/// decoded into memory on a venue network.
let brandAssetInlineByteLimit = 40 * 1024 * 1024

enum BrandAssetKind: String, Codable, Hashable {
    case logo = "LOGO"
    case font = "FONT"
    case graphicElement = "GRAPHIC_ELEMENT"
    case template = "TEMPLATE"
    case colorReference = "COLOR_REFERENCE"
    case photo = "PHOTO"
    case video = "VIDEO"
    case document = "DOCUMENT"
    case other = "OTHER"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = BrandAssetKind(rawValue: rawValue) ?? .unknown
    }

    var label: String {
        switch self {
        case .logo: "Logo"
        case .font: "Font"
        case .graphicElement: "Graphic element"
        case .template: "Template"
        case .colorReference: "Color and reference"
        case .photo: "Photography"
        case .video: "Video"
        case .document: "Document"
        case .other: "Other"
        case .unknown: "File"
        }
    }

    var systemImage: String {
        switch self {
        case .logo, .photo: "photo"
        case .font: "textformat"
        case .graphicElement: "square.on.square"
        case .template: "doc.on.doc"
        case .colorReference: "paintpalette"
        case .video: "film"
        case .document: "doc.text"
        case .other, .unknown: "doc"
        }
    }
}

enum BrandAssetSort: String, CaseIterable, Identifiable {
    case name
    case updated
    case type

    var id: String { rawValue }

    var label: String {
        switch self {
        case .name: "Name"
        case .updated: "Recent"
        case .type: "Type"
        }
    }
}

enum BrandAssetPreviewKind: Equatable {
    case image
    case svg
    case pdf
    case other
}

struct BrandAssetFolderRef: Decodable, Hashable {
    let id: String
    let name: String
    let path: String
}

struct BrandAssetChildFolder: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let path: String
    let assetCount: Int

    var countLabel: String? {
        switch assetCount {
        case 0: nil
        case 1: "1 file"
        default: "\(assetCount) files"
        }
    }
}

struct BrandAssetPerson: Decodable, Hashable {
    let id: String
    let name: String
}

struct BrandAssetVersion: Decodable, Hashable {
    let id: String
    let versionNumber: Int
    let originalName: String
    let contentType: String
    let sizeBytes: Int
    let versionNote: String?
    let createdAt: String
    let uploadedBy: BrandAssetPerson
}

struct BrandAssetSummary: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let kind: BrandAssetKind
    let description: String?
    let folderId: String
    let folder: BrandAssetFolderRef
    let createdAt: String
    let updatedAt: String
    let versionCount: Int
    let currentVersion: BrandAssetVersion?

    var rowDetail: String {
        var parts = [kind.label]
        if let currentVersion {
            parts.append(brandAssetByteLabel(currentVersion.sizeBytes))
        }
        return parts.joined(separator: " · ")
    }

    var opensInline: Bool {
        guard let currentVersion, currentVersion.sizeBytes <= brandAssetInlineByteLimit else { return false }
        switch brandAssetPreviewKind(currentVersion.contentType) {
        case .image, .svg, .pdf: return true
        case .other: return false
        }
    }
}

struct BrandAssetLibraryPage: Decodable, Equatable {
    let folder: BrandAssetFolderRef
    let folders: [BrandAssetChildFolder]
    let assets: [BrandAssetSummary]
}

struct BrandAssetDownload: Equatable {
    let fileURL: URL
    let contentType: String
}

func brandAssetPreviewKind(_ contentType: String) -> BrandAssetPreviewKind {
    let type = contentType
        .split(separator: ";", maxSplits: 1)
        .first
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() } ?? ""
    if type == "image/svg+xml" { return .svg }
    if type.hasPrefix("image/") { return .image }
    if type == "application/pdf" { return .pdf }
    return .other
}

func brandAssetByteLabel(_ bytes: Int) -> String {
    let magnitude = max(bytes, 0)
    if magnitude < 1024 { return "\(magnitude) B" }
    let units = ["KB", "MB", "GB"]
    var size = Double(magnitude) / 1024
    var unitIndex = 0
    while size >= 1024, unitIndex < units.count - 1 {
        size /= 1024
        unitIndex += 1
    }
    let unit = units[unitIndex]
    if size < 10 {
        let tenths = Int((size * 10).rounded())
        return "\(tenths / 10).\(abs(tenths % 10)) \(unit)"
    }
    return "\(Int(size.rounded())) \(unit)"
}

func brandAssetFolderLabel(_ path: String) -> String {
    let trimmed = path.replacingOccurrences(
        of: #"^brand-assets/?"#,
        with: "",
        options: .regularExpression
    )
    return trimmed.isEmpty ? "Brand assets" : trimmed
}

func brandAssetDateLabel(_ iso: String) -> String? {
    guard let date = brandAssetDate(iso) else { return nil }
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(Locale(identifier: "en_US_POSIX")))
}

func brandAssetDate(_ iso: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = withFraction.date(from: iso) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: iso)
}

func brandAssetSafeFileName(_ name: String) -> String {
    let leaf = name.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    let cleaned = String(leaf.unicodeScalars.map { scalar -> Character in
        if scalar.value < 0x20 || scalar.value == 0x7f || scalar == "\"" || scalar == "'" {
            return "-"
        }
        return Character(scalar)
    })
    .trimmingCharacters(in: .whitespacesAndNewlines)
    let limited = String(cleaned.prefix(180))
    return limited.isEmpty ? "brand-asset" : limited
}

func brandAssetDownloadName(header: String?, fallback: String) -> String {
    guard let header else { return brandAssetSafeFileName(fallback) }
    if let encoded = header.range(of: "filename\\*=UTF-8''([^;]+)", options: .regularExpression) {
        let token = String(header[encoded])
            .replacingOccurrences(of: "filename*=UTF-8''", with: "")
            .trimmingCharacters(in: .whitespaces)
        if let decoded = token.removingPercentEncoding, !decoded.isEmpty {
            return brandAssetSafeFileName(decoded)
        }
    }
    if let quoted = header.range(of: "filename=\"([^\"]+)\"", options: .regularExpression) {
        let token = String(header[quoted])
        let name = token
            .replacingOccurrences(of: "filename=\"", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        if !name.isEmpty { return brandAssetSafeFileName(name) }
    }
    return brandAssetSafeFileName(fallback)
}

func brandAssetSVGDocument(from data: Data) -> String? {
    guard data.count <= 1_500_000, var source = String(data: data, encoding: .utf8) else { return nil }
    guard source.range(of: "<svg", options: .caseInsensitive) != nil else { return nil }
    let patterns = [
        "(?is)<script\\b[^>]*>.*?</script>",
        "(?is)<foreignObject\\b[^>]*>.*?</foreignObject>",
        "(?i)</body",
        "(?i)</html",
        "(?i)\\son[a-z]+\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)",
        "(?i)javascript:",
    ]
    for pattern in patterns {
        source = source.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }
    return """
    <!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:transparent;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%}</style></head><body>\(source)</body></html>
    """
}

func brandAssetPreviewImage(at url: URL, maxPixel: CGFloat = 2048) -> UIImage? {
    let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions) else { return nil }
    let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
    return UIImage(cgImage: image)
}
