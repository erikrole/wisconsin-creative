import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { checkpointSchema } from "@/lib/label-print-job";
import { checkpointLabelPrintJob, getLabelPrintJob } from "@/lib/services/label-print-jobs";
export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => ok({ data: await checkpointLabelPrintJob(z.string().uuid().parse(params.id), checkpointSchema.parse(await req.json()), user) }));

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => ok({ data: await getLabelPrintJob(z.string().uuid().parse(params.id), user) }));
