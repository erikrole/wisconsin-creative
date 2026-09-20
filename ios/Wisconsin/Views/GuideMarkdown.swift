import Foundation
import Markdown

// Block model for the Resources (guide) reader.
//
// Guide Markdown is CommonMark + GFM on both platforms. The web reader
// (src/components/resources/MarkdownReader.tsx) parses it with `remark-gfm`;
// this file parses it with apple/swift-markdown, which wraps the same
// `cmark-gfm` engine, so both clients agree on the document without either one
// maintaining a private dialect.
//
// Two house conventions ride on top of the spec, plus two inline/fence
// conventions, and they are the only things this file knows that the spec does not:
//
//   1. GitHub alert callouts — a blockquote whose first line is `[!WARNING]`.
//      `shortcut` is a house kind. Mirrors src/lib/remark-callouts.ts.
//   2. Video embeds — a fenced block tagged `embed` or `video` whose body is a
//      URL. Mirrors src/lib/media-embed.ts.
//   3. Keyboard shortcuts — inline code that looks like a key combo (`⌘K`,
//      `Cmd+S`) renders as a keyboard chip. Mirrors src/lib/guide-keyboard.ts.
//   4. Copyable strings — a fenced block tagged `copy` or `path`. Mirrors
//      `isCopyFenceLanguage` in src/lib/guide-content.ts.
//
// The contract both platforms implement is written down in
// docs/GUIDE_MARKDOWN.md. Change that first.
//
// Deliberately free of SwiftUI so it can be unit tested directly
// (ios/WisconsinTests/GuideMarkdownTests.swift).

// MARK: - Inline content

/// One run of inline text with the marks that apply to it. A flat run list is
/// all `Text` needs, and it keeps the parser free of any font decisions.
struct GuideInlineSpan: Hashable {
    var text: String
    var isBold = false
    var isItalic = false
    var isStrikethrough = false
    var isCode = false
    var link: URL?

    /// Inline code that both readers treat as a keyboard shortcut.
    var isKeyboardShortcut: Bool { isCode && GuideMarkdown.isKeyboardShortcut(text) }

    /// Every mark except the text, so adjacent runs can be coalesced.
    fileprivate var marks: GuideInlineSpan {
        var copy = self
        copy.text = ""
        return copy
    }
}

/// The inline content of a block.
struct GuideInlineText: Hashable {
    var spans: [GuideInlineSpan]

    init(_ spans: [GuideInlineSpan] = []) {
        self.spans = GuideInlineText.merged(spans)
    }

    /// Unstyled text — used for accessibility labels and search.
    var plain: String { spans.map(\.text).joined() }

    var isEmpty: Bool { plain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Trims outer whitespace without disturbing the runs in between.
    func trimmed() -> GuideInlineText {
        var trimmed = spans
        while let first = trimmed.first {
            let text = String(first.text.drop(while: \.isWhitespace))
            if text.isEmpty {
                trimmed.removeFirst()
            } else {
                trimmed[0].text = text
                break
            }
        }
        while let last = trimmed.last {
            var text = last.text
            while let character = text.last, character.isWhitespace { text.removeLast() }
            if text.isEmpty {
                trimmed.removeLast()
            } else {
                trimmed[trimmed.count - 1].text = text
                break
            }
        }
        return GuideInlineText(trimmed)
    }

    private static func merged(_ spans: [GuideInlineSpan]) -> [GuideInlineSpan] {
        var merged: [GuideInlineSpan] = []
        for span in spans where !span.text.isEmpty {
            if let last = merged.last, last.marks == span.marks {
                merged[merged.count - 1].text += span.text
            } else {
                merged.append(span)
            }
        }
        return merged
    }
}

// MARK: - Callouts

/// GitHub alert kinds, matching `CALLOUT_TYPES` in src/lib/remark-callouts.ts.
enum GuideCallout: String, CaseIterable, Hashable {
    case note
    case tip
    case shortcut
    case important
    case warning
    case caution

    var label: String {
        switch self {
        case .note: "Note"
        case .tip: "Tip"
        case .shortcut: "Shortcut"
        case .important: "Important"
        case .warning: "Warning"
        case .caution: "Caution"
        }
    }
}

// MARK: - Tables

/// A parsed GFM table. The delimiter row is consumed for column alignment and
/// never survives into the rendered document.
struct GuideTable: Hashable {
    enum Alignment: Hashable {
        case leading
        case center
        case trailing
    }

    let header: [GuideInlineText]
    let rows: [[GuideInlineText]]
    let alignments: [Alignment]

    var columnCount: Int { header.count }

    func alignment(at column: Int) -> Alignment {
        alignments.indices.contains(column) ? alignments[column] : .leading
    }
}

// MARK: - Images

/// An image whose destination is already resolved to something `URLSession` can
/// fetch. `url` is nil when the destination was unusable, which is what drives
/// the reader's fallback chip.
struct GuideImage: Hashable {
    let alt: String
    let title: String?
    /// The destination exactly as authored, kept for the fallback chip.
    let source: String
    /// Resolved absolute http(s) URL, or nil when the destination is unusable.
    let url: URL?
    /// Set when the image was wrapped in a link — `[![alt](src)](href)`.
    let link: URL?
}

// MARK: - Embeds

/// A video embed authored as a fenced block tagged `embed` or `video`. Native
/// can't inline a provider iframe, so the reader opens the URL instead.
struct GuideEmbed: Hashable {
    enum Provider: Hashable {
        case youtube
        case vimeo
        case other
    }

    let url: URL
    let provider: Provider

    var title: String {
        switch provider {
        case .youtube: "YouTube video"
        case .vimeo: "Vimeo video"
        case .other: "Video"
        }
    }
}

// MARK: - Blocks

struct GuideBlock: Identifiable, Hashable {
    enum Kind: Hashable {
        case heading(level: Int, text: GuideInlineText)
        case paragraph(GuideInlineText)
        /// `checkbox` is set for GFM task-list items (`- [x] done`).
        case bullet(depth: Int, checkbox: Bool?, text: GuideInlineText)
        case numbered(depth: Int, number: Int, text: GuideInlineText)
        /// A blockquote. `callout` is nil for a plain quote.
        case quote(callout: GuideCallout?, paragraphs: [GuideInlineText])
        case code(language: String?, text: String)
        case copy(String)
        case embed(GuideEmbed)
        case table(GuideTable)
        case image(GuideImage)
        case rule
    }

    /// Source order. Unique on its own, so it is a stable `ForEach` identity
    /// even when a document repeats a block verbatim.
    let id: Int
    let kind: Kind
}


// MARK: - Parser

enum GuideMarkdown {
    /// Parse guide Markdown into renderable blocks.
    ///
    /// - Parameter baseURL: origin used to resolve root-relative destinations
    ///   such as `/uploads/rig.png`. Uploads carry absolute Blob URLs, but
    ///   hand-authored Markdown does not have to.
    static func parse(
        _ markdown: String,
        baseURL: URL? = AppEnvironment.activeAPIBaseURL
    ) -> [GuideBlock] {
        var builder = Builder(inliner: Inliner(baseURL: baseURL))
        builder.append(Document(parsing: markdown).children, depth: 0)
        return builder.blocks()
    }

    /// Drop a leading ATX h1 that restates the resource title so the reader
    /// header and the article do not both show the same heading. Mirrors
    /// `omitDuplicateLeadHeading` in `src/lib/guide-content.ts`.
    static func omittingDuplicateLeadHeading(_ blocks: [GuideBlock], title: String) -> [GuideBlock] {
        let expected = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !expected.isEmpty, let first = blocks.first else { return blocks }
        guard case .heading(let level, let text) = first.kind, level == 1 else { return blocks }
        let lead = text.plain.trimmingCharacters(in: .whitespacesAndNewlines)
        guard lead.caseInsensitiveCompare(expected) == .orderedSame else { return blocks }
        return Array(blocks.dropFirst())
    }

    // MARK: Block walk

    private struct Builder {
        let inliner: Inliner
        private var kinds: [GuideBlock.Kind] = []

        init(inliner: Inliner) {
            self.inliner = inliner
        }

        func blocks() -> [GuideBlock] {
            kinds.enumerated().map { GuideBlock(id: $0.offset, kind: $0.element) }
        }

        mutating func append(_ markup: some Sequence<Markup>, depth: Int) {
            for child in markup { append(child, depth: depth) }
        }

        mutating func append(_ markup: Markup, depth: Int) {
            switch markup {
            case let heading as Heading:
                kinds.append(.heading(level: heading.level, text: inliner.text(in: heading)))

            case let paragraph as Paragraph:
                appendParagraph(paragraph)

            case let list as UnorderedList:
                for item in list.listItems { appendListItem(item, depth: depth, number: nil) }

            case let list as OrderedList:
                var number = Int(list.startIndex)
                for item in list.listItems {
                    appendListItem(item, depth: depth, number: number)
                    number += 1
                }

            case let quote as BlockQuote:
                appendQuote(quote)

            case let code as CodeBlock:
                appendCode(code)

            case let table as Markdown.Table:
                appendTable(table)

            case is ThematicBreak:
                kinds.append(.rule)

            case is HTMLBlock:
                // The web reader passes `skipHtml`; dropping it here keeps the
                // two readers showing the same document.
                break

            default:
                append(markup.children, depth: depth)
            }
        }

        /// A list item's own line is its first paragraph; anything after that
        /// (nested lists, code samples) becomes its own block one level in.
        private mutating func appendListItem(_ item: ListItem, depth: Int, number: Int?) {
            var children = Array(item.children)
            var text = GuideInlineText()

            if let first = children.first as? Paragraph {
                text = inliner.text(in: first)
                children.removeFirst()
            }

            if !text.isEmpty || children.isEmpty {
                if let number {
                    kinds.append(.numbered(depth: depth, number: number, text: text))
                } else {
                    kinds.append(.bullet(depth: depth, checkbox: item.checkbox.map { $0 == .checked }, text: text))
                }
            }

            append(children, depth: depth + 1)
        }

        /// Splits a paragraph at its images so a photo inside a sentence, or
        /// wrapped in a link, still renders as a figure instead of vanishing.
        private mutating func appendParagraph(_ paragraph: Paragraph) {
            var spans: [GuideInlineSpan] = []

            func flush() {
                let text = GuideInlineText(spans).trimmed()
                spans.removeAll()
                guard !text.isEmpty else { return }
                kinds.append(.paragraph(text))
            }

            for child in paragraph.children {
                if let image = child as? Markdown.Image {
                    flush()
                    kinds.append(.image(inliner.image(image, link: nil)))
                } else if let link = child as? Markdown.Link, let image = inliner.soleImage(in: link) {
                    flush()
                    let href = link.destination.flatMap { resolvedLinkURL($0, baseURL: inliner.baseURL) }
                    kinds.append(.image(inliner.image(image, link: href)))
                } else {
                    spans.append(contentsOf: inliner.spans(child, marks: GuideInlineSpan(text: "")))
                }
            }

            flush()
        }

        private mutating func appendQuote(_ quote: BlockQuote) {
            var paragraphs: [GuideInlineText] = []
            for child in quote.children {
                let text = inliner.text(in: child)
                if !text.isEmpty { paragraphs.append(text) }
            }

            var callout: GuideCallout?
            if var first = paragraphs.first?.spans, let marker = calloutMarker(in: &first) {
                callout = marker
                let stripped = GuideInlineText(first).trimmed()
                if stripped.isEmpty {
                    paragraphs.removeFirst()
                } else {
                    paragraphs[0] = stripped
                }
            }

            kinds.append(.quote(callout: callout, paragraphs: paragraphs))
        }

        private mutating func appendCode(_ code: CodeBlock) {
            let language = code.language?.split(separator: " ").first.map { $0.lowercased() }
            var text = code.code
            while text.hasSuffix("\n") { text.removeLast() }

            if language == "embed" || language == "video",
               let embed = parseEmbed(text.trimmingCharacters(in: .whitespacesAndNewlines)) {
                kinds.append(.embed(embed))
                return
            }
            if language == "copy" || language == "path" {
                let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    kinds.append(.copy(value))
                    return
                }
            }
            kinds.append(.code(language: language, text: text))
        }

        private mutating func appendTable(_ table: Markdown.Table) {
            // Bound to a local so the `map` closures below don't capture a
            // mutating `self`.
            let inliner = self.inliner

            let header = Array(table.head.cells.map { inliner.text(in: $0) })
            guard !header.isEmpty else { return }

            let rows = Array(table.body.rows.map { row -> [GuideInlineText] in
                var cells = Array(row.cells.map { inliner.text(in: $0) })
                // Normalize to the header width the way GFM does, so the grid
                // never gets a ragged row.
                if cells.count < header.count {
                    cells.append(contentsOf: Array(repeating: GuideInlineText(), count: header.count - cells.count))
                } else if cells.count > header.count {
                    cells = Array(cells.prefix(header.count))
                }
                return cells
            })

            let alignments = (0..<header.count).map { column -> GuideTable.Alignment in
                guard table.columnAlignments.indices.contains(column),
                      let alignment = table.columnAlignments[column] else { return .leading }
                switch alignment {
                case .left: return .leading
                case .center: return .center
                case .right: return .trailing
                }
            }

            kinds.append(.table(GuideTable(header: header, rows: rows, alignments: alignments)))
        }
    }

    // MARK: Inline walk

    /// Split out of `Builder` so its methods can be passed to `map` without
    /// capturing a mutating `self`.
    private struct Inliner {
        let baseURL: URL?

        func text(in markup: Markup) -> GuideInlineText {
            GuideInlineText(markup.children.flatMap { spans($0, marks: GuideInlineSpan(text: "")) })
                .trimmed()
        }

        func spans(_ markup: Markup, marks: GuideInlineSpan) -> [GuideInlineSpan] {
            func span(_ text: String) -> GuideInlineSpan {
                var span = marks
                span.text = text
                return span
            }

            switch markup {
            case let text as Markdown.Text:
                return [span(text.string)]

            case let code as InlineCode:
                var marks = marks
                marks.isCode = true
                marks.text = code.code
                return [marks]

            case is SoftBreak:
                return [span(" ")]

            case is LineBreak:
                return [span("\n")]

            case let emphasis as Emphasis:
                var marks = marks
                marks.isItalic = true
                return emphasis.children.flatMap { spans($0, marks: marks) }

            case let strong as Strong:
                var marks = marks
                marks.isBold = true
                return strong.children.flatMap { spans($0, marks: marks) }

            case let struck as Strikethrough:
                var marks = marks
                marks.isStrikethrough = true
                return struck.children.flatMap { spans($0, marks: marks) }

            case let link as Markdown.Link:
                var marks = marks
                marks.link = link.destination.flatMap { resolvedLinkURL($0, baseURL: baseURL) } ?? marks.link
                return link.children.flatMap { spans($0, marks: marks) }

            case let image as Markdown.Image:
                // An image nested inside emphasis can't be lifted out as a
                // block; show its alt text so the sentence still reads.
                return image.children.flatMap { spans($0, marks: marks) }

            case is InlineHTML:
                return []

            default:
                return markup.children.flatMap { spans($0, marks: marks) }
            }
        }

        func image(_ image: Markdown.Image, link: URL?) -> GuideImage {
            let source = image.source ?? ""
            return GuideImage(
                alt: text(in: image).plain,
                title: image.title?.isEmpty == false ? image.title : nil,
                source: source,
                url: resolvedImageURL(source, baseURL: baseURL),
                link: link
            )
        }

        func soleImage(in link: Markdown.Link) -> Markdown.Image? {
            guard link.childCount == 1 else { return nil }
            return link.child(at: 0) as? Markdown.Image
        }
    }

    // MARK: - Conventions

    /// Matches `MARKER_RE` in src/lib/remark-callouts.ts. Strips the marker
    /// from the spans in place and returns the alert kind it named.
    private static func calloutMarker(in spans: inout [GuideInlineSpan]) -> GuideCallout? {
        guard let first = spans.first, !first.isCode else { return nil }
        var text = first.text.drop(while: \.isWhitespace)
        // Authors sometimes escape the marker (`\[!TIP]`); CommonMark may leave
        // the backslash in the text run. Strip it so the kind still parses.
        if text.hasPrefix("\\[") { text = text.dropFirst() }
        guard text.hasPrefix("[!"), let close = text.firstIndex(of: "]") else { return nil }

        let name = String(text[text.index(text.startIndex, offsetBy: 2)..<close]).lowercased()
        guard let callout = GuideCallout(rawValue: name) else { return nil }

        spans[0].text = String(text[text.index(after: close)...])
        return callout
    }

    /// Mirrors the provider allow-list in src/lib/media-embed.ts. Native opens
    /// the URL rather than framing it, so only the label needs the provider.
    static func parseEmbed(_ raw: String) -> GuideEmbed? {
        guard let url = resolvedImageURL(raw, baseURL: nil) else { return nil }
        guard var host = url.host()?.lowercased() else { return nil }
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }

        switch host {
        case "youtube.com", "m.youtube.com", "youtube-nocookie.com", "youtu.be":
            return GuideEmbed(url: url, provider: .youtube)
        case "vimeo.com", "player.vimeo.com":
            return GuideEmbed(url: url, provider: .vimeo)
        default:
            return GuideEmbed(url: url, provider: .other)
        }
    }

    // MARK: - URLs

    /// `.urlFragmentAllowed` excludes `%`, so encoding with it alone turns an
    /// already-escaped `%20` into `%2520`.
    private static let urlSafeCharacters: CharacterSet = {
        var set = CharacterSet.urlFragmentAllowed
        set.insert(charactersIn: "%#")
        return set
    }()

    /// Image destinations feed a network loader, so only http(s) is accepted.
    static func resolvedImageURL(_ raw: String, baseURL: URL?) -> URL? {
        resolvedURL(raw, baseURL: baseURL, allowedSchemes: ["http", "https"])
    }

    /// Link destinations also carry `mailto:` and `tel:`, which Contacts guides
    /// lean on heavily. Everything else — `javascript:`, `data:`, `file:` — is
    /// refused rather than handed to the system opener.
    static func resolvedLinkURL(_ raw: String, baseURL: URL?) -> URL? {
        resolvedURL(raw, baseURL: baseURL, allowedSchemes: ["http", "https", "mailto", "tel"])
    }

    private static func resolvedURL(
        _ raw: String,
        baseURL: URL?,
        allowedSchemes: Set<String>
    ) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: urlSafeCharacters) ?? trimmed
        guard let candidate = URL(string: encoded) else { return nil }

        let resolved: URL?
        if candidate.scheme == nil {
            resolved = baseURL.flatMap { URL(string: encoded, relativeTo: $0)?.absoluteURL }
        } else {
            resolved = candidate
        }

        guard let resolved, let scheme = resolved.scheme?.lowercased(),
              allowedSchemes.contains(scheme) else { return nil }
        return resolved
    }

    // MARK: - Keyboard shortcuts

    /// Mirrors `isKeyboardShortcut` in src/lib/guide-keyboard.ts.
    static func isKeyboardShortcut(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 48, text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            return false
        }
        if text.contains("://") || text.contains("\\") || text.contains("/") { return false }
        if text.rangeOfCharacter(from: modifierSymbols) != nil { return true }
        if text.rangeOfCharacter(from: specialKeySymbols) != nil { return true }
        if text.count == 1, text.rangeOfCharacter(from: .decimalDigits.union(.letters)) != nil { return true }
        if isFunctionKey(text) || keyNames.contains(text.lowercased()) { return true }

        let plusParts = text.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if plusParts.count >= 2, plusParts.allSatisfy(isShortcutToken), plusParts.contains(where: isModifierToken) {
            return true
        }

        let hyphenParts = text.split(separator: "-").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if hyphenParts.count >= 2, isModifierToken(hyphenParts[0]), hyphenParts.allSatisfy(isShortcutToken) {
            return true
        }

        return false
    }

    private static let modifierNames: Set<String> = [
        "ctrl", "control", "cmd", "command", "alt", "option", "opt",
        "shift", "win", "windows", "meta", "super",
    ]
    private static let keyNames: Set<String> = [
        "tab", "enter", "return", "escape", "esc", "space", "spacebar",
        "delete", "del", "backspace", "home", "end", "insert", "ins",
        "pageup", "pagedown", "pgup", "pgdn",
        "up", "down", "left", "right",
        "arrowup", "arrowdown", "arrowleft", "arrowright",
        "plus", "minus",
    ]
    private static let modifierSymbols = CharacterSet(charactersIn: "⌘⌥⇧⌃⎈")
    private static let specialKeySymbols = CharacterSet(charactersIn: "↑↓←→⎋⏎↩⌫⌦")

    private static func isModifierToken(_ part: Substring) -> Bool {
        isModifierToken(String(part))
    }

    private static func isModifierToken(_ part: String) -> Bool {
        modifierNames.contains(part.lowercased()) || part.rangeOfCharacter(from: modifierSymbols) != nil
    }

    private static func isShortcutToken(_ part: Substring) -> Bool {
        isShortcutToken(String(part))
    }

    private static func isShortcutToken(_ part: String) -> Bool {
        if part.isEmpty { return false }
        if isModifierToken(part) { return true }
        if part.count == 1, part.rangeOfCharacter(from: .decimalDigits.union(.letters)) != nil { return true }
        if isFunctionKey(part) || keyNames.contains(part.lowercased()) { return true }
        return part.rangeOfCharacter(from: specialKeySymbols) != nil
    }

    private static func isFunctionKey(_ part: String) -> Bool {
        let upper = part.uppercased()
        guard upper.hasPrefix("F"), let number = Int(upper.dropFirst()) else { return false }
        return (1...12).contains(number)
    }
}
