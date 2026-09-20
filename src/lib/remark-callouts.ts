// Remark plugin: GitHub-style alert callouts.
//
// Authors write a normal blockquote whose first line is an alert marker:
//
//   > [!WARNING]
//   > Do not unplug the drive mid-transfer.
//
// The marker is stripped and the blockquote is tagged with
// `guide-alert guide-alert-<type>` so the reader renders it as a callout card.
// This keeps Markdown as the source of truth and needs no new editor primitive.
//
// `shortcut` is a house kind on top of GitHub's five alerts. Keep this list in
// sync with src/lib/editor-snippets.ts and ios GuideCallout.

export const CALLOUT_TYPES = ["note", "tip", "shortcut", "important", "warning", "caution"] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

const MARKER_RE = new RegExp(`^\\\\?\\[!(${CALLOUT_TYPES.join("|")})\\][ \\t]*`, "i");
const CLASS_RE = new RegExp(`guide-alert-(${CALLOUT_TYPES.join("|")})`);

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
};

function visit(node: MdastNode, type: string, fn: (n: MdastNode) => void): void {
  if (node.type === type) fn(node);
  if (node.children) {
    // Snapshot children so callbacks that mutate the tree don't skip siblings.
    for (const child of [...node.children]) visit(child, type, fn);
  }
}

export function remarkCallouts() {
  return (tree: MdastNode) => {
    visit(tree, "blockquote", (node) => {
      const firstPara = node.children?.[0];
      if (!firstPara || firstPara.type !== "paragraph" || !firstPara.children) return;

      const firstText = firstPara.children[0];
      if (!firstText || firstText.type !== "text" || typeof firstText.value !== "string") return;

      const match = firstText.value.match(MARKER_RE);
      if (!match || !match[1]) return;

      const type = match[1].toLowerCase() as CalloutType;
      const remainder = firstText.value.slice(match[0].length);

      if (remainder.trim().length > 0) {
        // Inline content followed the marker on the same line — keep it as body.
        firstText.value = remainder;
      } else {
        firstPara.children.shift();
        if (firstPara.children[0]?.type === "break") firstPara.children.shift();
        if (firstPara.children.length === 0) node.children?.shift();
      }

      node.data = node.data ?? {};
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        className: `guide-alert guide-alert-${type}`,
        "data-callout": type,
      };
    });
  };
}

export function parseCalloutType(className: string | undefined): CalloutType | null {
  if (!className) return null;
  if (!className.includes("guide-alert")) return null;
  const match = className.match(CLASS_RE);
  return match ? (match[1] as CalloutType) : null;
}
