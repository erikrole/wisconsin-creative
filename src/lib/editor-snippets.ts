// Markdown snippet builders for the guide editor's insert tools.
//
// The reader renders GitHub-style alert callouts (src/lib/remark-callouts.ts)
// and safe video embeds (src/lib/media-embed.ts). These helpers build the
// exact source syntax so staff don't have to hand-type it.

import { CALLOUT_TYPES as CALLOUT_TYPE_IDS } from "@/lib/remark-callouts";

export const CALLOUT_TYPES = CALLOUT_TYPE_IDS.map((type) => type.toUpperCase()) as [
  "NOTE",
  "TIP",
  "SHORTCUT",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
];

export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const CALLOUT_LABELS: Record<CalloutType, string> = {
  NOTE: "Note",
  TIP: "Tip",
  SHORTCUT: "Shortcut",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

export const CALLOUT_PLACEHOLDERS: Record<CalloutType, string> = {
  NOTE: "Add helpful context that is not required to finish the steps.",
  TIP: "Share a faster way, a useful default, or a gotcha-avoiding habit.",
  SHORTCUT: "`⌘K` — Quick find",
  IMPORTANT: "Do not skip this. Later steps depend on it.",
  WARNING: "This can go wrong if skipped or done out of order.",
  CAUTION: "Stop. This can damage gear, files, or a live deliverable.",
};

/** Builds a GitHub-style alert callout blockquote, e.g. `> [!NOTE]`. */
export function buildCalloutSnippet(type: CalloutType, body = CALLOUT_PLACEHOLDERS[type]): string {
  return `> [!${type}]\n> ${body}\n`;
}

/** Builds a fenced ```embed block for an allowlisted video URL. */
export function buildEmbedSnippet(url: string): string {
  return `\`\`\`embed\n${url.trim()}\n\`\`\`\n`;
}

/** Builds a fenced ```copy block for a path or rename string. */
export function buildCopySnippet(value: string): string {
  return `\`\`\`copy\n${value.trim()}\n\`\`\`\n`;
}
