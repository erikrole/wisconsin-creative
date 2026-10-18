import { z } from "zod";
import { isSafeAnnouncementUrl } from "@/lib/announcements";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const fields = {
  kind: z.enum(["FEATURE", "UPDATE", "NOTICE"]),
  title: z.string().trim().min(1, "Add a title").max(80),
  body: z.string().trim().min(1, "Add a message").max(1200),
  ctaLabel: optionalText(32),
  ctaUrl: optionalText(500),
  roles: z.array(z.enum(["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"])).max(4),
  showOnWeb: z.boolean(),
  showOnIos: z.boolean(),
  endsAt: z.coerce.date().nullable().optional(),
};

function ctaPair(v: { ctaLabel?: string | null; ctaUrl?: string | null }, ctx: z.RefinementCtx) {
  if (Boolean(v.ctaLabel) !== Boolean(v.ctaUrl)) {
    ctx.addIssue({ code: "custom", path: ["ctaUrl"], message: "Add both a button label and a link, or neither" });
  } else if (v.ctaUrl && !isSafeAnnouncementUrl(v.ctaUrl)) {
    ctx.addIssue({ code: "custom", path: ["ctaUrl"], message: "Use a path like /releases or an https link" });
  }
}

export const announcementCreateBody = z
  .object({ ...fields, publish: z.boolean().default(false) })
  .superRefine(ctaPair)
  .refine((v) => v.showOnWeb || v.showOnIos, { message: "Show it on web, iOS, or both", path: ["showOnWeb"] });

export const announcementPatchBody = z
  .object(fields)
  .partial()
  .extend({
    /** draft: unpublish. live: publish now. ended: stop showing it. */
    state: z.enum(["draft", "live", "ended"]).optional(),
    /** Forget who dismissed it so everyone sees it again. */
    showAgain: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.ctaLabel !== undefined || v.ctaUrl !== undefined) ctaPair(v, ctx);
  });

export type AnnouncementCreateInput = z.infer<typeof announcementCreateBody>;
