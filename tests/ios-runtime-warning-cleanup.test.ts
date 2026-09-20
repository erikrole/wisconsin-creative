import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS runtime warning cleanup", () => {
  it("keeps native URLSession clients on explicit mobile timeouts without multipath fallback", () => {
    for (const file of [
      "ios/Wisconsin/Core/APIClient.swift",
      "ios/Wisconsin/Core/ThumbnailLoader.swift",
    ]) {
      const swift = source(file);

      expect(swift).toContain("config.waitsForConnectivity = false");
      expect(swift).toContain("config.timeoutIntervalForRequest = 15");
      expect(swift).toContain("config.timeoutIntervalForResource = 30");
      expect(swift).toContain("config.multipathServiceType = .none");
    }

    const kiosk = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    expect(kiosk).toContain("config.waitsForConnectivity = true");
    expect(kiosk).toContain("config.timeoutIntervalForRequest = 15");
    expect(kiosk).toContain("config.timeoutIntervalForResource = 30");
    expect(kiosk).toContain("config.multipathServiceType = .none");
  });

  it("uses a bounded URL cache for remote thumbnails without replacing decoded image caching", () => {
    const thumbnails = source("ios/Wisconsin/Core/ThumbnailLoader.swift");

    expect(thumbnails).toContain("private let thumbnailURLCache = URLCache(");
    expect(thumbnails).toContain('diskPath: "WisconsinThumbnailURLCache"');
    expect(thumbnails).toContain("config.urlCache = thumbnailURLCache");
    expect(thumbnails).toContain("config.requestCachePolicy = .returnCacheDataElseLoad");
    expect(thumbnails).toContain("request.cachePolicy = .returnCacheDataElseLoad");
    expect(thumbnails).toContain("ThumbnailCache.shared.image(for: cacheKey)");
    expect(thumbnails).toContain("ThumbnailCache.shared.store(image, for: cacheKey)");
  });

  it("keeps image decode and profile crop rendering off the main actor", () => {
    const thumbnails = source("ios/Wisconsin/Core/ThumbnailLoader.swift");
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const crop = source("ios/Wisconsin/Views/Welcome/ProfilePhotoCropView.swift");

    expect(thumbnails).toContain("enum NativeImageProcessor");
    expect(thumbnails.match(/@concurrent/g)?.length).toBeGreaterThanOrEqual(2);
    expect(thumbnails).toContain("await NativeImageProcessor.downsample");
    expect(welcome).toContain("await NativeImageProcessor.downsample");
    expect(crop).toContain("await NativeImageProcessor.croppedJPEGData");
    expect(crop).not.toContain("private func croppedJPEGData()");
  });
});
