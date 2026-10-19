import type { Role } from "@prisma/client";

export type AnnouncementKindValue = "FEATURE" | "UPDATE" | "NOTICE";

export const ANNOUNCEMENT_KIND_LABEL: Record<AnnouncementKindValue, string> = {
  FEATURE: "New",
  UPDATE: "Update",
  NOTICE: "Heads up",
};

/** Roles that can ever see an announcement. Collaborators are external and never do. */
export const ANNOUNCEMENT_ROLES: Role[] = ["ADMIN", "STAFF", "STUDENT"];

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

/** Banner images must be our own Blob uploads: next/image only optimizes that host. */
export function isAnnouncementImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
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
  imageUrls: string[];
  imageAlt: string | null;
  publishedAt: string;
  /** How many more unseen announcements wait behind this one. */
  remaining: number;
};

export type AnnouncementDraftFields = {
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  showOnWeb: boolean;
  showOnIos: boolean;
  /** `datetime-local` wall time, or "" for none. */
  endsAt: string;
};

export type AnnouncementDraftErrors = Partial<
  Record<"title" | "body" | "ctaLabel" | "ctaUrl" | "platforms" | "endsAt", string>
>;

/**
 * The same rules the API enforces, run in the editor so a mistake is caught beside
 * the field before anything is sent. The server still validates; this only explains.
 */
export function validateAnnouncementDraft(d: AnnouncementDraftFields, now = new Date()): AnnouncementDraftErrors {
  const errors: AnnouncementDraftErrors = {};
  if (!d.title.trim()) errors.title = "Add a title";
  else if (d.title.trim().length > 80) errors.title = "Keep the title to 80 characters";
  if (!d.body.trim()) errors.body = "Add a message";
  else if (d.body.trim().length > 1200) errors.body = "Keep the message to 1,200 characters";

  const label = d.ctaLabel.trim();
  const url = d.ctaUrl.trim();
  if (label && !url) errors.ctaUrl = "Add a link for the button, or clear its label";
  else if (url && !label) errors.ctaLabel = "Add a label for the button, or clear its link";
  else if (url && !isSafeAnnouncementUrl(url)) errors.ctaUrl = "Use a path like /releases or an https link";

  if (!d.showOnWeb && !d.showOnIos) errors.platforms = "Show it on web, the iPhone app, or both";

  if (d.endsAt) {
    const ends = new Date(d.endsAt);
    if (Number.isNaN(ends.getTime())) errors.endsAt = "Pick a valid date and time";
    else if (ends <= now) errors.endsAt = "Pick a time in the future, or clear it";
  }
  return errors;
}
