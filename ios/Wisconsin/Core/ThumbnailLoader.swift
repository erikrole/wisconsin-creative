import SwiftUI
import UIKit
import ImageIO

private let thumbnailURLCache = URLCache(
    memoryCapacity: 4_000_000,
    diskCapacity: 50_000_000,
    diskPath: "WisconsinThumbnailURLCache"
)

enum NativeImageProcessor {
    // ImageIO decode is deliberately concurrent. Calling this from a SwiftUI
    // task must not inherit the main actor and turn cache misses into scroll
    // hitches.
    @concurrent
    static func downsample(data: Data, maxPixels: CGFloat, scale: CGFloat) async -> UIImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else { return nil }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else { return nil }
        return UIImage(cgImage: cgImage, scale: scale, orientation: .up)
    }

    @concurrent
    static func croppedJPEGData(
        image: UIImage,
        cropDiameter: CGFloat,
        zoom: CGFloat,
        offset: CGSize
    ) async -> Data? {
        let normalized = normalizedImage(image)
        guard let cgImage = normalized.cgImage else { return nil }

        let imageSize = CGSize(width: cgImage.width, height: cgImage.height)
        let baseScale = max(cropDiameter / imageSize.width, cropDiameter / imageSize.height)
        let scale = baseScale * zoom
        let sourceSide = cropDiameter / scale
        let center = CGPoint(
            x: imageSize.width / 2 - offset.width / scale,
            y: imageSize.height / 2 - offset.height / scale
        )
        let rect = CGRect(
            x: min(max(0, center.x - sourceSide / 2), imageSize.width - sourceSide),
            y: min(max(0, center.y - sourceSide / 2), imageSize.height - sourceSide),
            width: sourceSide,
            height: sourceSide
        ).integral

        guard let cropped = cgImage.cropping(to: rect) else { return nil }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.preferredRange = .standard
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 1024, height: 1024),
            format: format
        )
        let output = renderer.image { _ in
            UIImage(cgImage: cropped).draw(in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
        }
        return output.jpegData(compressionQuality: 0.9)
    }

    private static func normalizedImage(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }
}

// NSCache-backed thumbnail store. Limited to 20 MB of decoded pixel data.
@MainActor
final class ThumbnailCache {
    static let shared = ThumbnailCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.totalCostLimit = 20_000_000
        cache.countLimit = 150
    }

    func image(for key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func store(_ image: UIImage, for key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    func evictAll() {
        cache.removeAllObjects()
    }

    func clearForSignOut() {
        cache.removeAllObjects()
        thumbnailURLCache.removeAllCachedResponses()
    }
}

// Dedicated session with a bounded disk cache so cold launches don't refetch
// every remote thumbnail before the decoded in-memory cache is rebuilt.
private let thumbnailSession: URLSession = {
    let config = URLSessionConfiguration.default
    config.urlCache = thumbnailURLCache
    config.requestCachePolicy = .returnCacheDataElseLoad
    config.waitsForConnectivity = false
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    config.multipathServiceType = .none
    return URLSession(configuration: config)
}()

/// The app's remote-image session. Shared with the guide reader so article
/// photos land in the same bounded disk cache as gear thumbnails and are
/// cleared by the same `clearForSignOut()` sweep.
enum RemoteImageLoading {
    static var session: URLSession { thumbnailSession }
}

// Drop-in replacement for AsyncImage that downsamples to the actual display size.
struct CachedThumbnail: View {
    let url: URL
    let size: CGFloat
    var placeholderSystemImage: String?

    @Environment(\.displayScale) private var displayScale
    @State private var uiImage: UIImage?
    @State private var loadTask: Task<Void, Never>?

    private var cacheKey: String { "\(url.absoluteString)@\(Int(size))" }

    var body: some View {
        Group {
            if let uiImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else if let placeholderSystemImage {
                Image(systemName: placeholderSystemImage)
                    .font(.system(size: size * 0.36))
                    .foregroundStyle(.secondary)
            } else {
                Color.clear
            }
        }
        .task(id: url) {
            loadTask?.cancel()
            loadTask = Task { await load(scale: displayScale) }
            await loadTask?.value
        }
        .onDisappear {
            loadTask?.cancel()
            loadTask = nil
        }
    }

    private func load(scale: CGFloat) async {
        if let cached = ThumbnailCache.shared.image(for: cacheKey) {
            uiImage = cached
            return
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        guard let (data, response) = try? await thumbnailSession.data(for: request),
              let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode),
              httpResponse.mimeType?.hasPrefix("image/") == true,
              !Task.isCancelled else { return }
        let pixels = size * scale
        guard pixels > 0,
              let image = await NativeImageProcessor.downsample(data: data, maxPixels: pixels, scale: scale),
              !Task.isCancelled else { return }
        ThumbnailCache.shared.store(image, for: cacheKey)
        uiImage = image
    }
}
