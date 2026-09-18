import SwiftUI

/// iOS 27 system chrome that degrades cleanly on the iOS 26 floor.
///
/// Standard SwiftUI controls pick up the refined Liquid Glass look when the
/// app is built with the iOS 27 SDK. These helpers opt into the 27-only
/// behaviors that still need an availability branch: receding navigation bars
/// on scrolling lists, and pointing AsyncImage at the same bounded cache the
/// rest of the app already uses.
extension View {
    /// Recedes the navigation bar while scrolling on iOS 27. iOS 26 keeps the
    /// bar fully visible because the API does not exist there.
    @ViewBuilder
    func nativeScrollBarMinimization() -> some View {
        if #available(iOS 27.0, *) {
            self.toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)
        } else {
            self
        }
    }

    /// Points AsyncImage at the same bounded disk cache `CachedThumbnail` uses.
    /// iOS 27 caches AsyncImage responses by default; the shared session keeps
    /// those images inside the existing sign-out sweep.
    @ViewBuilder
    func nativeRemoteImageSession() -> some View {
        if #available(iOS 27.0, *) {
            self.asyncImageURLSession(RemoteImageLoading.session)
        } else {
            self
        }
    }
}
