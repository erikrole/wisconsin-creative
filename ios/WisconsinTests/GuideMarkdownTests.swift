import Testing
import Foundation
@testable import Wisconsin

/// Locks in the guide Markdown contract shared with the web reader.
///
/// Guide Markdown is CommonMark + GFM on both platforms — `remark-gfm` on web,
/// apple/swift-markdown (cmark-gfm) here — plus four house conventions: GitHub
/// alert callouts, `embed`/`video` fences, keyboard chips, and `copy`/`path`
/// fences. The contract is written down in docs/GUIDE_MARKDOWN.md; these tests
/// are the iOS half of enforcing it.
///
/// The image cases are regressions. The previous line-by-line parser dropped or
/// corrupted a photo whenever the destination carried a title, sat inside a
/// sentence, was wrapped in a link, used a reference definition, or was
/// root-relative — which is why guide photos did not load.
struct GuideMarkdownTests {

    // MARK: Helpers

    private let base = URL(string: "https://wisconsincreative.com")!
    private let blob = "https://x.public.blob.vercel-storage.com/resources/1-cam.png"

    private func kinds(_ markdown: String) -> [GuideBlock.Kind] {
        GuideMarkdown.parse(markdown, baseURL: base).map(\.kind)
    }

    private func images(_ markdown: String) -> [GuideImage] {
        kinds(markdown).compactMap { kind -> GuideImage? in
            guard case .image(let image) = kind else { return nil }
            return image
        }
    }

    private func firstTable(_ markdown: String) -> GuideTable? {
        kinds(markdown).compactMap { kind -> GuideTable? in
            guard case .table(let table) = kind else { return nil }
            return table
        }.first
    }

    // MARK: Images

    @Test func imageOnItsOwnLineResolves() {
        #expect(images("![Camera shelf](\(blob))").first?.url?.absoluteString == blob)
    }

    @Test func imageTitleIsNotSwallowedIntoTheURL() {
        let image = images("![Shelf](\(blob) \"Shelf A\")").first
        #expect(image?.url?.absoluteString == blob)
        #expect(image?.title == "Shelf A")
    }

    @Test func angleBracketDestinationIsUnwrapped() {
        #expect(images("![Shelf](<\(blob)>)").first?.url?.absoluteString == blob)
    }

    @Test func angleBracketDestinationEncodesSpaces() {
        #expect(
            images("![Shelf](<https://x.com/a b.png>)").first?.url?.absoluteString
                == "https://x.com/a%20b.png"
        )
    }

    @Test func existingPercentEscapesAreNotDoubleEncoded() {
        #expect(
            GuideMarkdown.resolvedImageURL("https://x.com/a%20b.png", baseURL: nil)?.absoluteString
                == "https://x.com/a%20b.png"
        )
    }

    @Test func imageInsideASentenceSurvivesWithItsProse() {
        let blocks = kinds("See ![Shelf](\(blob)) here.")
        #expect(blocks.count == 3)
        #expect(images("See ![Shelf](\(blob)) here.").count == 1)
    }

    @Test func linkedImageKeepsBothDestinations() {
        let image = images("[![Shelf](\(blob))](https://example.com)").first
        #expect(image?.url?.absoluteString == blob)
        #expect(image?.link?.absoluteString == "https://example.com")
    }

    @Test func referenceStyleImageResolves() {
        #expect(images("![Shelf][rig]\n\n[rig]: \(blob)").first?.url?.absoluteString == blob)
    }

    @Test func escapedBracketsInAltTextAreUnescaped() {
        #expect(images("![Cam \\[A\\]](\(blob))").first?.alt == "Cam [A]")
    }

    @Test func rootRelativeDestinationResolvesAgainstTheAPIOrigin() {
        #expect(
            images("![Shelf](/uploads/a.png)").first?.url?.absoluteString
                == "https://wisconsincreative.com/uploads/a.png"
        )
    }

    @Test func nonHTTPImageDestinationIsRefused() {
        #expect(images("![Shelf](javascript:alert(1))").first?.url == nil)
    }

    // MARK: Tables

    @Test func tableParsesAsOneBlockWithoutTheDelimiterRow() {
        let markdown = """
        | Contact | Role | Phone |
        | --- | :-: | ---: |
        | Name | Team | `555-555-5555` |
        | Second | Owner | `555-000-1111` |
        """
        #expect(kinds(markdown).count == 1)

        let table = firstTable(markdown)
        #expect(table?.header.map(\.plain) == ["Contact", "Role", "Phone"])
        #expect(table?.rows.count == 2)
        #expect(table?.alignments == [.leading, .center, .trailing])
        #expect(table?.rows.contains { $0.contains { $0.plain.contains("---") } } == false)
    }

    @Test func tableCellKeepsInlineCodeMarks() {
        let table = firstTable("| A |\n| --- |\n| `x` |")
        #expect(table?.rows.first?.first?.spans.first?.isCode == true)
        #expect(table?.rows.first?.first?.plain == "x")
    }

    @Test func escapedPipeStaysInsideItsCell() {
        let table = firstTable("| A | B |\n| --- | --- |\n| x \\| y | z |")
        #expect(table?.rows.first?.first?.plain == "x | y")
    }

    @Test func proseContainingAPipeIsNotATable() {
        let isTable = kinds("a | b\nsome text").contains {
            if case .table = $0 { return true }
            return false
        }
        #expect(isTable == false)
    }

    @Test func shortRowIsPaddedToHeaderWidth() {
        let table = firstTable("| A | B | C |\n| --- | --- | --- |\n| one |")
        #expect(table?.rows.first?.count == 3)
    }

    // MARK: Callouts

    @Test func alertMarkerBecomesACalloutAndIsStripped() {
        guard case .quote(let callout, let paragraphs)? = kinds("> [!WARNING]\n> Do not unplug.\n> Seriously.").first
        else {
            Issue.record("expected a quote block")
            return
        }
        #expect(callout == .warning)
        #expect(paragraphs.map(\.plain) == ["Do not unplug. Seriously."])
    }

    @Test func alertMarkerIsCaseInsensitiveAndMayLeadTheLine() {
        guard case .quote(let callout, let paragraphs)? = kinds("> [!tip] Start here\n> and continue").first else {
            Issue.record("expected a quote block")
            return
        }
        #expect(callout == .tip)
        #expect(paragraphs.map(\.plain) == ["Start here and continue"])
    }

    @Test func escapedAlertMarkerStillBecomesACallout() {
        guard case .quote(let callout, let paragraphs)? = kinds("> \\[!IMPORTANT]\n> Connect to VPN first.").first else {
            Issue.record("expected a quote block")
            return
        }
        #expect(callout == .important)
        #expect(paragraphs.map(\.plain) == ["Connect to VPN first."])
    }

    @Test func shortcutAlertKindIsRecognised() {
        guard case .quote(let callout, _)? = kinds("> [!SHORTCUT]\n> `⌘K` opens Quick find.").first else {
            Issue.record("expected a quote block")
            return
        }
        #expect(callout == .shortcut)
    }

    @Test func plainBlockquoteHasNoCallout() {
        guard case .quote(let callout, _)? = kinds("> Keep this current.").first else {
            Issue.record("expected a quote block")
            return
        }
        #expect(callout == nil)
    }

    @Test func everyAlertKindIsRecognised() {
        for callout in GuideCallout.allCases {
            guard case .quote(let parsed, _)? = kinds("> [!\(callout.rawValue.uppercased())]\n> body").first else {
                Issue.record("expected a quote block for \(callout.rawValue)")
                continue
            }
            #expect(parsed == callout)
        }
    }

    // MARK: Lists

    @Test func decimalProseIsNotAnOrderedListItem() {
        guard case .paragraph(let text)? = kinds("3.5 inches of rain fell overnight.").first else {
            Issue.record("expected a paragraph")
            return
        }
        #expect(text.plain == "3.5 inches of rain fell overnight.")
    }

    @Test func orderedListHonoursItsStartNumber() {
        guard case .numbered(_, let number, _)? = kinds("5. five\n6. six").first else {
            Issue.record("expected a numbered item")
            return
        }
        #expect(number == 5)
    }

    @Test func taskListCheckboxIsCarried() {
        let checkboxes = kinds("- [x] done\n- [ ] todo").compactMap { kind -> Bool?? in
            guard case .bullet(_, let checkbox, _) = kind else { return nil }
            return checkbox
        }
        #expect(checkboxes == [true, false])
    }

    @Test func nestedListItemIsIndentedOneLevel() {
        let depths = kinds("1. Two\n   - nested").compactMap { kind -> Int? in
            switch kind {
            case .bullet(let depth, _, _): return depth
            case .numbered(let depth, _, _): return depth
            default: return nil
            }
        }
        #expect(depths == [0, 1])
    }

    // MARK: Inline marks

    @Test func inlineMarksSurviveIntoRuns() {
        guard case .paragraph(let text)? = kinds("**b** _i_ ~~s~~ `c`").first else {
            Issue.record("expected a paragraph")
            return
        }
        #expect(text.spans.contains { $0.isBold && $0.text == "b" })
        #expect(text.spans.contains { $0.isItalic && $0.text == "i" })
        #expect(text.spans.contains { $0.isStrikethrough && $0.text == "s" })
        #expect(text.spans.contains { $0.isCode && $0.text == "c" })
    }

    @Test func keyboardShortcutInlineCodeIsFlagged() {
        guard case .paragraph(let text)? = kinds("Press `⌘K` then paste `smb://server/share`.").first else {
            Issue.record("expected a paragraph")
            return
        }
        #expect(text.spans.contains { $0.isKeyboardShortcut && $0.text == "⌘K" })
        #expect(text.spans.contains { $0.isCode && !$0.isKeyboardShortcut && $0.text.contains("smb://") })
        #expect(GuideMarkdown.isKeyboardShortcut("Cmd+Shift+S"))
        #expect(GuideMarkdown.isKeyboardShortcut("3"))
        #expect(!GuideMarkdown.isKeyboardShortcut("SPORT-YYYYMMDD"))
        #expect(!GuideMarkdown.isKeyboardShortcut("Q2"))
    }

    @Test func contactLinkSchemesAreKept() {
        guard case .paragraph(let text)? = kinds("[Email](mailto:a@wisc.edu) or [Call](tel:+15555555555)").first
        else {
            Issue.record("expected a paragraph")
            return
        }
        #expect(text.spans.contains { $0.link?.scheme == "mailto" })
        #expect(text.spans.contains { $0.link?.scheme == "tel" })
    }

    @Test func scriptLinkSchemeIsRefused() {
        guard case .paragraph(let text)? = kinds("[bad](javascript:alert(1))").first else {
            Issue.record("expected a paragraph")
            return
        }
        #expect(text.spans.allSatisfy { $0.link == nil })
    }

    // MARK: Code and embeds

    @Test func fencedCodeKeepsItsLanguageAndBody() {
        guard case .code(let language, let text)? = kinds("```text\nA/B/C\n```").first else {
            Issue.record("expected a code block")
            return
        }
        #expect(language == "text")
        #expect(text == "A/B/C")
    }

    @Test func embedFenceBecomesAVideoBlock() {
        guard case .embed(let embed)? = kinds("```embed\nhttps://youtu.be/dQw4w9WgXcQ\n```").first else {
            Issue.record("expected an embed block")
            return
        }
        #expect(embed.provider == .youtube)
    }

    @Test func videoFenceAcceptsVimeo() {
        guard case .embed(let embed)? = kinds("```video\nhttps://vimeo.com/123456\n```").first else {
            Issue.record("expected an embed block")
            return
        }
        #expect(embed.provider == .vimeo)
    }

    @Test func copyFenceBecomesACopyBlock() {
        guard case .copy(let text)? = kinds("```copy\nsmb://server/share\n```").first else {
            Issue.record("expected a copy block")
            return
        }
        #expect(text == "smb://server/share")
    }

    @Test func pathFenceIsAlsoCopyable() {
        guard case .copy(let text)? = kinds("```path\n/Volumes/Media/RESOURCES\n```").first else {
            Issue.record("expected a copy block")
            return
        }
        #expect(text == "/Volumes/Media/RESOURCES")
    }

    @Test func emptyCopyFenceFallsBackToCode() {
        let isCode = kinds("```copy\n\n```").contains {
            if case .code = $0 { return true }
            return false
        }
        #expect(isCode)
    }

    @Test func matchingLeadHeadingIsOmitted() {
        let markdown = "# Color Correction 101\n\nConfirm Premiere’s color settings."
        let parsed = GuideMarkdown.parse(markdown, baseURL: base)
        let stripped = GuideMarkdown.omittingDuplicateLeadHeading(parsed, title: "Color Correction 101")
        #expect(stripped.contains { if case .heading = $0.kind { return true }; return false } == false)
        #expect(stripped.contains { if case .paragraph(let text) = $0.kind { return text.plain.contains("Confirm") }; return false })
    }

    @Test func unmatchedLeadHeadingIsKept() {
        let parsed = GuideMarkdown.parse("# Phase 1\n\nPlug in the card.", baseURL: base)
        let kept = GuideMarkdown.omittingDuplicateLeadHeading(parsed, title: "Photo Mechanic")
        #expect(kept.contains { if case .heading(_, let text) = $0.kind { return text.plain == "Phase 1" }; return false })
    }

    @Test func unusableEmbedFallsBackToCode() {
        let isCode = kinds("```embed\nnot a url\n```").contains {
            if case .code = $0 { return true }
            return false
        }
        #expect(isCode)
    }

    // MARK: Safety

    @Test func rawHTMLIsDroppedLikeTheWebReaderSkipHTML() {
        #expect(kinds("<script>alert(1)</script>").isEmpty)
    }

    // MARK: Templates

    /// The shipped guide templates in
    /// src/app/(app)/resources/new/_components/NewGuideClient.tsx are
    /// table-heavy. Every row used to render as its own monospaced block,
    /// delimiter row included.
    @Test func contactsTemplateShapeRendersAsRealBlocks() {
        let markdown = """
        # Key contacts

        Use this Guide for phone numbers and internal owners.

        > Keep this current.

        ## Emergency

        | Contact | Role | Phone | When to use |
        | --- | --- | --- | --- |
        | Name | Role or team | `555-555-5555` | What triggers this contact |

        ## External

        - Vendor: contact, phone, account

        ```text
        ACCOUNT-OR-REFERENCE
        ```
        """
        let parsed = kinds(markdown)

        let tables = parsed.filter { if case .table = $0 { return true }; return false }
        #expect(tables.count == 1)

        let codeBlocks = parsed.filter { if case .code = $0 { return true }; return false }
        #expect(codeBlocks.count == 1)

        let headings = parsed.compactMap { kind -> Int? in
            guard case .heading(let level, _) = kind else { return nil }
            return level
        }
        #expect(headings == [1, 2, 2])
    }
}
