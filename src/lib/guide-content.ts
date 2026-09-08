const WHITESPACE_RE = /\s+/g;

type TextNode = {
  type?: unknown;
  text?: unknown;
  styles?: unknown;
};

type BlockNode = {
  type?: unknown;
  content?: unknown;
  children?: unknown;
};

function collectText(value: unknown, parts: string[]) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) parts.push(text);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }

  if (!value || typeof value !== "object") return;

  const node = value as TextNode & BlockNode;
  if (node.type === "text" && typeof node.text === "string") {
    const text = node.text.trim();
    if (text) parts.push(text);
    return;
  }

  if (Array.isArray(node.content)) collectText(node.content, parts);
  if (Array.isArray(node.children)) collectText(node.children, parts);
}

export function extractGuideText(content: unknown): string {
  const parts: string[] = [];
  collectText(content, parts);
  return parts.join(" ").replace(WHITESPACE_RE, " ").trim();
}

export function summarizeGuideContent(content: unknown, maxLength = 180): string {
  const text = extractGuideText(content);
  return summarizeText(text, maxLength);
}

export function summarizeText(text: string, maxLength = 180): string {
  const normalized = text.replace(WHITESPACE_RE, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/([\\*_~[\]])/g, "\\$1");
}

function escapeMarkdownTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, "<br>");
}

function codeSpan(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  return `${fence}${text}${fence}`;
}

function applyMarkdownStyles(text: string, styles: unknown): string {
  if (!text) return "";
  if (!styles || typeof styles !== "object") return escapeMarkdownText(text);
  const styleMap = styles as Record<string, unknown>;
  let output = styleMap.code
    ? text.split("\n").map(codeSpan).join("\n")
    : escapeMarkdownText(text);
  if (styleMap.bold) output = `**${output}**`;
  if (styleMap.italic) output = `_${output}_`;
  if (styleMap.strike) output = `~~${output}~~`;
  return output;
}

function markdownInline(value: unknown): string {
  if (typeof value === "string") return escapeMarkdownText(value);
  if (Array.isArray(value)) return value.map(markdownInline).join("");
  if (!value || typeof value !== "object") return "";

  const node = value as TextNode & BlockNode;
  if (node.type === "text" && typeof node.text === "string") {
    return applyMarkdownStyles(node.text, node.styles);
  }

  if (Array.isArray(node.content)) return markdownInline(node.content);
  if (Array.isArray(node.children)) return markdownInline(node.children);
  return "";
}

function quoteMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

function tableCellMarkdown(cell: unknown): string {
  if (!cell || typeof cell !== "object") return "";
  const node = cell as BlockNode;
  return escapeMarkdownTableCell(markdownInline(node.content).trim());
}

function tableMarkdown(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const rows = (content as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const normalizedRows = rows
    .map((row) => {
      const cells = row && typeof row === "object" ? (row as { cells?: unknown }).cells : null;
      return Array.isArray(cells) ? cells.map(tableCellMarkdown) : [];
    })
    .filter((cells) => cells.length > 0);
  if (normalizedRows.length === 0) return "";

  const width = Math.max(...normalizedRows.map((cells) => cells.length));
  const paddedRows = normalizedRows.map((cells) => [
    ...cells,
    ...Array.from({ length: width - cells.length }, () => ""),
  ]);
  const header = paddedRows[0] ?? [];
  const separator = Array.from({ length: width }, () => "---");
  const body = paddedRows.slice(1);
  const rowMarkdown = [header, separator, ...body].map((cells) => `| ${cells.join(" | ")} |`);
  return rowMarkdown.join("\n");
}

function blockToMarkdown(block: unknown, orderedIndex: number): string {
  if (!block || typeof block !== "object") return "";
  const node = block as BlockNode & { props?: Record<string, unknown> };
  const content = markdownInline(node.content).trim();

  switch (node.type) {
    case "heading": {
      const level = typeof node.props?.level === "number"
        ? Math.min(Math.max(node.props.level, 1), 6)
        : 2;
      return `${"#".repeat(level)} ${content}`;
    }
    case "bulletListItem":
      return content ? `- ${content}` : "- ";
    case "numberedListItem":
      return content ? `${orderedIndex}. ${content}` : `${orderedIndex}. `;
    case "codeBlock":
      return `\`\`\`text\n${extractGuideText(node.content)}\n\`\`\``;
    case "quote":
      return content ? quoteMarkdown(content) : "> ";
    case "divider":
      return "---";
    case "table":
      return tableMarkdown(node.content);
    case "paragraph":
    default:
      return content;
  }
}

export function blockNoteToMarkdown(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  let orderedIndex = 1;
  let previousType: unknown = null;

  return content
    .map((block) => {
      const type = block && typeof block === "object" ? (block as BlockNode).type : null;
      if (type !== "numberedListItem") orderedIndex = 1;
      const markdown = blockToMarkdown(block, orderedIndex);
      if (type === "numberedListItem") {
        orderedIndex = previousType === "numberedListItem" ? orderedIndex + 1 : 2;
      }
      previousType = type;
      return markdown;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
    .replace(/^>\s?\[!(?:note|tip|important|warning|caution)\]\s*/gim, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~#|]/g, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function summarizeMarkdown(markdown: string, maxLength = 180): string {
  return summarizeText(markdownToPlainText(markdown), maxLength);
}

export function legacyGuideMarkdown(markdown: string | null | undefined, content: unknown): string {
  if (markdown?.trim()) return markdown.trim();
  return blockNoteToMarkdown(content);
}

export function markdownHeadings(markdown: string) {
  const matches = markdown
    .split("\n")
    .map((line, index) => ({ match: line.match(/^(#{1,3})\s+(.+)$/), line: index + 1 }))
    .filter((item): item is { match: RegExpMatchArray; line: number } => Boolean(item.match));
  const counts = new Map<string, number>();

  for (const { match } of matches) {
    const text = markdownHeadingText(match[2] ?? "");
    const base = headingId(text);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  return matches
    .map(({ match, line }) => {
      const marker = match[1] ?? "#";
      const text = markdownHeadingText(match[2] ?? "");
      return {
        id: markdownHeadingId(text, line, counts),
        level: marker.length,
        text,
      };
    })
    .filter((heading) => heading.text.length > 0);
}

export function markdownHeadingText(text: string): string {
  return markdownToPlainText(text);
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function markdownHeadingId(text: string, line: number | undefined, counts: Map<string, number>): string {
  const base = headingId(text) || "section";
  if ((counts.get(base) ?? 0) <= 1) return base;
  return line ? `${base}-${line}` : base;
}
