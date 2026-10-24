import { z } from "zod";

/** A Quick link as the sidebar and Settings see it. */
export type QuickLinkDto = {
  id: string;
  label: string;
  url: string;
  detail: string | null;
  roles: string[];
};

/** The four "who can see it" choices; each maps to the roles stored on the link. */
export const QUICK_LINK_AUDIENCES = [
  { id: "everyone", label: "Everyone", description: "Everyone signed in, collaborators included", roles: [] },
  { id: "internal", label: "Students, staff and admins", description: "Not collaborators", roles: ["ADMIN", "STAFF", "STUDENT"] },
  { id: "staff", label: "Staff and admins", description: "Not students", roles: ["ADMIN", "STAFF"] },
  { id: "admins", label: "Admins only", description: "Only admins", roles: ["ADMIN"] },
] as const;

export type QuickLinkAudienceId = (typeof QUICK_LINK_AUDIENCES)[number]["id"];

export function audienceForRoles(roles: readonly string[]): (typeof QUICK_LINK_AUDIENCES)[number] {
  const key = [...roles].sort().join(",");
  return QUICK_LINK_AUDIENCES.find((a) => [...a.roles].sort().join(",") === key) ?? QUICK_LINK_AUDIENCES[0];
}

export function canSeeQuickLink(roles: readonly string[], role: string | undefined) {
  return roles.length === 0 || (role !== undefined && roles.includes(role));
}

/** An https link to another site, or a path inside the app. */
export function isSafeQuickLinkUrl(url: string) {
  if (url.startsWith("/")) return !url.startsWith("//");
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export const quickLinkBody = z.object({
  label: z.string().trim().min(1, "Add a name").max(40, "Keep the name under 40 characters"),
  url: z
    .string()
    .trim()
    .min(1, "Add a link")
    .max(2000)
    .refine(isSafeQuickLinkUrl, "Use an https:// link, or a path like /resources"),
  detail: z
    .string()
    .trim()
    .max(60, "Keep the description under 60 characters")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  audience: z.enum(["everyone", "internal", "staff", "admins"]),
});

export const quickLinkOrderBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export function rolesForAudience(id: QuickLinkAudienceId): string[] {
  return [...(QUICK_LINK_AUDIENCES.find((a) => a.id === id)?.roles ?? [])];
}
