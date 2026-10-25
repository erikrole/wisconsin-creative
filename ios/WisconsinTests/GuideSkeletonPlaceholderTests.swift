import Testing
@testable import Wisconsin

/// The Guides loading skeleton builds its rows by decoding a JSON literal. If
/// `GuideListItem` gains a required field, that decode fails and the skeleton
/// crashes on the force unwrap, so a model change has to fail here first.
struct GuideSkeletonPlaceholderTests {
    @Test func placeholdersDecodeWithUniqueIds() {
        let placeholders = GuideListItem.placeholders

        #expect(placeholders.count == 5)
        #expect(Set(placeholders.map(\.id)).count == placeholders.count)
    }
}
