import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { createPrintJobSchema } from "@/lib/label-print-job";
import { createLabelPrintJob, listLabelPrintJobs } from "@/lib/services/label-print-jobs";
export const GET = withAuth(async (req, { user }) => {
  const query = new URL(req.url).searchParams;
  const browserId = z.string().uuid().optional().parse(query.get("browserId") ?? undefined);
  const cursor = z.string().uuid().optional().parse(query.get("cursor") ?? undefined);
  return ok({ data: await listLabelPrintJobs(user, browserId, cursor) });
});
export const POST = withAuth(async (req, { user }) => ok({ data: await createLabelPrintJob(createPrintJobSchema.parse(await req.json()), user) }, 201));
