import type { Role } from "@prisma/client";

export type AnnouncementKindValue = "FEATURE" | "UPDATE" | "NOTICE";

export const ANNOUNCEMENT_KIND_LABEL: Record<AnnouncementKindValue, string> = {
  FEATURE: "New",
  UPDATE: "Update",
  NOTICE: "Heads up",
};

/** Audience presets the editor offers. An empty role list means everyone. */
export const ANNOUNCEMENT_AUDIENCES = [
  { id: "everyone", label: "Everyone", roles: [] as Role[] },
  { id: "team", label: "Admins and staff", roles: ["ADMIN", "STAFF"] as Role[] },
  { id: "students", label: "Students", roles: ["STUDENT"] as Role[] },
] as const;

export function audienceIdForRoles(roles: readonly Role[]): string {
  const key = [...roles].sort().join(",");
  const match = ANNOUNCEMENT_AUDIENCES.find((a) => [...a.roles].sort().join(",") === key);
  return match?.id ?? "everyone";
}

export type AnnouncementBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

/**
 * Body text is deliberately tiny: blank lines split paragraphs and lines that
 * start with "- " become a bullet list. No HTML, so an admin can't break the page.
 */
export function parseAnnouncementBody(body: string): AnnouncementBlock[] {
  const blocks: AnnouncementBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
    } else if (/^[-•]\s+/.test(line)) {
      flushParagraph();
      list.push(line.replace(/^[-•]\s+/, ""));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** A button link must stay in the app or go to https. */
export function isSafeAnnouncementUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type AnnouncementState = "draft" | "scheduled" | "live" | "ended";

export function announcementState(
  a: { publishedAt: Date | string | null; endsAt: Date | string | null },
  now = new Date(),
): AnnouncementState {
  if (!a.publishedAt) return "draft";
  if (a.endsAt && new Date(a.endsAt) <= now) return "ended";
  if (new Date(a.publishedAt) > now) return "scheduled";
  return "live";
}

/** What the apps receive. Kept small and stable: iOS decodes this exact shape. */
export type ActiveAnnouncement = {
  id: string;
  kind: AnnouncementKindValue;
  kindLabel: string;
  title: string;
  blocks: AnnouncementBlock[];
  ctaLabel: string | null;
  ctaUrl: string | null;
  publishedAt: string;
};
