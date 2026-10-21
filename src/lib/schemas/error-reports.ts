import { z } from "zod";
import { BREADCRUMB_TYPES, ERROR_PLATFORMS } from "@/lib/error-reporting/grouping";

const token = (max: number) => z.string().trim().min(1).max(max).regex(/^[A-Za-z0-9._,+() -]+$/);

export const breadcrumbSchema = z.object({
  at: z.string().max(40),
  type: z.enum(BREADCRUMB_TYPES),
  message: z.string().max(400),
  data: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
});

/** What every client says about itself; the server fills browser details from the user agent. */
export const clientInfoSchema = z.object({
  platform: z.enum(ERROR_PLATFORMS).exclude(["server"]),
  appVersion: token(32).nullish(),
  appBuild: token(40).nullish(),
  releaseChannel: z.enum(["app_store", "testflight", "development", "web", "production", "preview"]).nullish(),
  osVersion: token(64).nullish(),
  deviceModel: token(40).nullish(),
});

export const clientErrorReportSchema = z.object({
  kind: z.enum(["error", "unhandled_rejection", "render_error", "crash", "hang", "api_error"]),
  name: z.string().max(120).optional(),
  message: z.string().max(2_000),
  stack: z.string().max(20_000).optional(),
  digest: z.string().max(64).optional(),
  screen: z.string().max(300).nullish(),
  requestId: z.string().max(120).optional(),
  occurredAt: z.string().datetime().optional(),
  breadcrumbs: z.array(breadcrumbSchema).max(40).optional(),
  context: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).optional(),
});

export const errorReportBodySchema = z.object({
  client: clientInfoSchema,
  reports: z.array(clientErrorReportSchema).min(1).max(5),
});

export const supportReportBodySchema = z.object({
  message: z.string().trim().min(3, "Tell us a little about what happened").max(4_000),
  client: clientInfoSchema,
  screen: z.string().max(300).nullish(),
  breadcrumbs: z.array(breadcrumbSchema).max(40).optional(),
});

export const issueUpdateSchema = z
  .object({
    status: z.enum(["open", "resolved", "ignored"]).optional(),
    note: z.string().max(2_000).nullable().optional(),
  })
  .refine((body) => body.status !== undefined || body.note !== undefined, "Nothing to update");

export const supportReportUpdateSchema = z.object({ status: z.enum(["open", "closed"]) });
