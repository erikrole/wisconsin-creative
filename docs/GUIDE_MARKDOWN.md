# Guide Markdown contract

Guides (the Resources area) are authored once and read on two clients. This
document is the contract both readers implement. Change it before changing
either renderer.

## The standard

Guide content is **CommonMark + GFM**. Neither client owns a dialect.

| Surface | Parser | Engine |
| --- | --- | --- |
| Web reader | `remark-gfm` via `react-markdown` | cmark-gfm semantics |
| iOS reader | [`apple/swift-markdown`](https://github.com/apple/swift-markdown) | cmark-gfm |
| Editor | MDXEditor (`@mdxeditor/editor`) | serializes CommonMark + GFM |

Because both readers sit on the same spec, anything CommonMark or GFM defines —
reference links, nested lists, escapes, tables, task lists, strikethrough — works
on both without either side special-casing it.

Source of truth for each half:

- Web: `src/components/resources/MarkdownReader.tsx`
- iOS: `ios/Wisconsin/Views/GuideMarkdown.swift` (parse) and
  `ios/Wisconsin/Views/GuidesView.swift` (render)
- iOS contract tests: `ios/WisconsinTests/GuideMarkdownTests.swift`

## House conventions

Four things ride on top of the spec. They are conventions, not syntax
extensions — all are plain CommonMark that each reader gives extra meaning.

### 1. Callouts (GitHub alerts, plus Shortcut)

A blockquote whose first line is an alert marker.

```markdown
> [!WARNING]
> Do not unplug the drive mid-transfer.
```

Kinds: `NOTE`, `TIP`, `SHORTCUT`, `IMPORTANT`, `WARNING`, `CAUTION`
(case-insensitive). The marker is stripped and the quote is rendered as a
tone-matched card. `SHORTCUT` is a house kind for keyboard and menu accelerators;
the other five match GitHub alerts.

| Kind | Tone | Use for |
| --- | --- | --- |
| note | blue | Extra context that is not required |
| tip | green | A faster way or useful default |
| shortcut | slate | Keyboard or menu accelerators |
| important | purple | A requirement later steps depend on |
| warning | orange | Something that can go wrong |
| caution | red | Risk of damage to gear, files, or a live deliverable |

Implemented by `src/lib/remark-callouts.ts` and `GuideMarkdown.calloutMarker`.
A blockquote with no marker stays a plain quote. An escaped marker
(`> \[!IMPORTANT]`) is still recognised so a backslash from the editor cannot
flatten a callout into a quote.

### 2. Keyboard chips

Inline code that looks like a key combo renders as a keyboard chip, not a path
or code sample.

```markdown
Press `⌘K` to search. Save with `Cmd+S`.
```

Recognised forms: modifier symbols (`⌘K`, `⇧⌘G`), named combos (`Cmd+Shift+S`,
`Ctrl+K`), function keys (`F5`), and single-character keys used as hotkeys
(`3`, `I`). Paths, filenames, and naming patterns stay ordinary inline code:
`smb://server/share`, `SPORT-YYYYMMDD`, `Q2`.

Implemented by `src/lib/guide-keyboard.ts` and `GuideMarkdown.isKeyboardShortcut`.

### 3. Video embeds

A fenced block tagged `embed` or `video` whose body is a URL.

````markdown
```embed
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
````

Web frames a validated player URL (YouTube or Vimeo only — the raw string is
never passed to an `<iframe>`). iOS cannot frame a provider player, so it renders
a card that opens the URL. A body that is not a usable URL falls back to a normal
code block on both clients.

Implemented by `src/lib/media-embed.ts` and `GuideMarkdown.parseEmbed`.

### 4. Copyable paths and strings

A fenced block tagged `copy` or `path` whose body is the exact string to copy.

````markdown
```copy
smb://ath01-nas.uwia.wisc.edu/users/
```
````

Both readers render it as a one-tap copy control, not a terminal. Use it for
server paths, rename strings, and other values people should paste unchanged.
Ordinary ` ```text ` fences stay code samples.

Implemented by `isCopyFenceLanguage` in `src/lib/guide-content.ts` and
`GuideMarkdown` copy fences.

## Rules both readers follow

**Raw HTML is dropped.** Web passes `skipHtml`; iOS discards `HTMLBlock` and
`InlineHTML`. Do not author HTML in a guide — it will not render anywhere.

**Images.** Uploads go through `/api/resources/upload-image` and come back as
absolute Vercel Blob URLs, which is the normal case. Hand-authored destinations
also work, including root-relative ones (`/uploads/rig.png`), which iOS resolves
against the active API origin. Alt text is shown as a visible caption on both
clients, so write it as a caption. A destination containing a space must be
wrapped in angle brackets (`![Rig](<https://…/a b.png>)`) or percent-encoded —
CommonMark ends a bare destination at the first space.

**Link schemes.** `http`, `https`, `mailto`, and `tel` are permitted; anything
else (`javascript:`, `data:`, `file:`) is refused rather than handed to the
system opener. Image destinations are narrower still: `http`/`https` only,
because they feed a network image loader.

**Tables** are GFM tables, including column alignment (`:--`, `:-:`, `--:`). The
delimiter row is consumed for alignment and never rendered. Escape a literal pipe
inside a cell as `\|`.

**Headings** are ATX (`## Section`) and need the space after the hashes. The web
TOC indexes levels 1–3. Do not start a guide with `# Title` that restates the
resource title — the page already has an `h1`. A matching lead heading is
stripped.

**Screenshots** sit as their own figure, not inside a numbered step. After a
step, a blank line then an image, then `2.` (or `3.`, …) continues the sequence
via the list `start` value. Keep alt text short; it becomes the caption.

**Callouts carry their payload.** A Shortcut card should contain the shortcuts,
not a sentence that points at a table below.

**Ordered lists** are ordinary CommonMark numbered lists. Both readers render
top-level steps with numbered badges so a how-to scans as a sequence. Keep a
click-by-click list contiguous when there is no figure between steps. A blank
line followed by a paragraph, then `1.` again, starts a new list at 1. Use
`2.` / `3.` after a figure so numbering continues. Do not use GFM task lists
(`- [ ]`) — they look like interactive checkboxes and are not.

**Before/after photos** go in one paragraph so the reader can pair them:

```markdown
![Pre-curve](https://…/before.png) ![Post-curve](https://…/after.png)
```

## Adding a feature

1. Update this document.
2. Update both readers.
3. Add a case to `GuideMarkdownTests.swift` and to the web reader's tests.

If a feature cannot be expressed in CommonMark + GFM, prefer a convention layered
on valid Markdown (as callouts, keyboard chips, embeds, and copy fences are) over a syntax
extension — an extension would put the two parsers back out of step.
