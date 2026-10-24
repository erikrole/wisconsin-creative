import { z } from "zod";
import { printHistoryCursorSchema, printJobSchema, type CreatePrintJob, type PrintCheckpoint } from "./label-print-job";
import { parseJsonSafely } from "./errors";
const historySchema = z.object({ jobs: z.array(printJobSchema), nextCursor: printHistoryCursorSchema.nullable(), active: printJobSchema.nullable(), blockedByOtherOperator: z.boolean() });
export type PrintHistory = z.infer<typeof historySchema>;
export class PrintApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request(path: string, init?: RequestInit) {
  const res = await fetch(`/api/labels/print-jobs${path}`, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10000) });
  const body = await parseJsonSafely<{ data?: unknown; error?: string }>(res);
  if (!res.ok) throw new PrintApiError(body?.error || (res.status === 401 ? "Sign in again to record print history." : "Print history could not be saved. No further labels will be sent."), res.status);
  return body?.data;
}
export const printJobApi = {
  async list(browserId: string, cursor?: string): Promise<PrintHistory> { return historySchema.parse(await request(`?browserId=${encodeURIComponent(browserId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)); },
  async get(id: string) { return printJobSchema.parse(await request(`/${encodeURIComponent(id)}`)); },
  async create(input: CreatePrintJob) { return printJobSchema.parse(await request("", { method: "POST", body: JSON.stringify(input) })); },
  async checkpoint(id: string, input: PrintCheckpoint) { return printJobSchema.parse(await request(`/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })); },
};
export type PrintJobApi = typeof printJobApi;
