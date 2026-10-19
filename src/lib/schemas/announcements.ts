import { z } from "zod";
import { isAnnouncementImageUrl, isSafeAnnouncementUrl } from "@/lib/announcements";

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
  imageUrls: z
    .array(z.string().trim().max(1000).refine(isAnnouncementImageUrl, "Upload images here instead of linking them"))
    .max(4, "Use up to 4 images"),
  imageAlt: optionalText(200),
  roles: z.array(z.enum(["ADMIN", "STAFF", "STUDENT"])).max(4),
  showOnWeb: z.boolean(),
  showOnIos: z.boolean(),
  endsAt: z.coerce.date().nullable().optional(),
};

function futureEnd(v: { endsAt?: Date | null }, ctx: z.RefinementCtx) {
  if (v.endsAt && v.endsAt <= new Date()) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Pick a time in the future, or clear it" });
  }
}

function ctaPair(v: { ctaLabel?: string | null; ctaUrl?: string | null }, ctx: z.RefinementCtx) {
  if (Boolean(v.ctaLabel) !== Boolean(v.ctaUrl)) {
    ctx.addIssue({ code: "custom", path: ["ctaUrl"], message: "Add both a button label and a link, or neither" });
  } else if (v.ctaUrl && !isSafeAnnouncementUrl(v.ctaUrl)) {
    ctx.addIssue({ code: "custom", path: ["ctaUrl"], message: "Use a path like /releases or an https link" });
  }
}

export const announcementCreateBody = z
  .object({ ...fields, imageUrls: fields.imageUrls.default([]), publish: z.boolean().default(false) })
  .superRefine(ctaPair)
  .superRefine(futureEnd)
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
    futureEnd(v, ctx);
    if (v.showOnWeb === false && v.showOnIos === false) {
      ctx.addIssue({ code: "custom", path: ["showOnWeb"], message: "Show it on web, iOS, or both" });
    }
  });

export type AnnouncementCreateInput = z.infer<typeof announcementCreateBody>;
