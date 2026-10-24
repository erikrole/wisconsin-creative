import { z } from "zod";
import { checkpointSchema, createPrintJobSchema, printJobSchema } from "./label-print-job";

export const PRINT_JOURNAL_KEY = "wc-qr-usb-journal-v2";
export const LEGACY_PRINT_KEY = "wc-qr-usb-last-batch-v1";
const BROWSER_KEY = "wc-qr-printer-browser-v1";
const envelopeSchema = z.object({
  job: printJobSchema,
  pending: z.discriminatedUnion("type", [
    z.object({ type: z.literal("create"), input: createPrintJobSchema }).strict(),
    z.object({ type: z.literal("checkpoint"), input: checkpointSchema }).strict(),
  ]).optional(),
}).strict().superRefine((envelope, ctx) => {
  const pending = envelope.pending;
  if (!pending) return;
  if (pending.type === "create") {
    if (pending.input.transport !== envelope.job.transport || pending.input.id !== envelope.job.id || pending.input.browserId !== envelope.job.browserId || JSON.stringify(pending.input.labels) !== JSON.stringify(envelope.job.labels) || envelope.job.revision !== 0) ctx.addIssue({ code: "custom", message: "Invalid pending batch identity." });
  } else if (pending.input.revision + 1 !== envelope.job.revision) ctx.addIssue({ code: "custom", message: "Invalid pending print revision." });
});
export type PrintEnvelope = z.infer<typeof envelopeSchema>;
export type JournalRead = { kind: "missing" } | { kind: "valid"; envelope: PrintEnvelope } | { kind: "unreadable"; message: string; raw?: string; key: string };
export function readPrintJournal(storage: Storage): JournalRead {
  try {
    const raw = storage.getItem(PRINT_JOURNAL_KEY);
    if (raw !== null) {
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return { kind: "unreadable", message: "The saved print journal is damaged. Check the printer and archive it before starting another batch.", raw, key: PRINT_JOURNAL_KEY }; }
      const parsed = envelopeSchema.safeParse(value);
      if (!parsed.success) return { kind: "unreadable", message: "The saved print journal cannot be verified. Check the printer and archive this record before starting another batch.", raw, key: PRINT_JOURNAL_KEY };
      return { kind: "valid", envelope: parsed.data };
    }
    const legacy = storage.getItem(LEGACY_PRINT_KEY);
    if (legacy !== null) return { kind: "unreadable", message: "An older print receipt needs physical review. Its original record will be archived; it will not be assigned to the current person.", raw: legacy, key: LEGACY_PRINT_KEY };
    return { kind: "missing" };
  } catch {
    return { kind: "unreadable", message: "Print storage is unavailable. Enable browser storage before printing.", key: PRINT_JOURNAL_KEY };
  }
}
export function printerBrowserId(storage: Storage): string {
  const existing = storage.getItem(BROWSER_KEY);
  if (existing !== null) return z.string().uuid().parse(existing);
  const id = crypto.randomUUID(); storage.setItem(BROWSER_KEY, id); return id;
}
export function savePrintJournal(storage: Storage, envelope: PrintEnvelope) {
  envelopeSchema.parse(envelope);
  storage.setItem(PRINT_JOURNAL_KEY, JSON.stringify(envelope));
}
export function archiveUnreadableJournal(storage: Storage, record: Extract<JournalRead, { kind: "unreadable" }>) {
  if (record.raw === undefined || storage.getItem(record.key) !== record.raw) throw new Error("The record changed or cannot be read. Reload and review it again.");
  storage.setItem(`wc-qr-usb-archive-${crypto.randomUUID()}`, JSON.stringify({ archivedAt: new Date().toISOString(), source: record.key, raw: record.raw }));
  storage.removeItem(record.key);
}
