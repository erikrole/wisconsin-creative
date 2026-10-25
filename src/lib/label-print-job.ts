import { z } from "zod";
import { LABEL_KINDS, fitsBrotherQr } from "./brother-label-csv";

const actorSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(200) }).strict();
const labelRowSchema = z.object({
  kind: z.enum(["body", "lens", "sd", "text", "numberTag", "battery"]),
  dept: z.string().max(200), model: z.string().max(200), number: z.string().max(200),
  qrCodeValue: z.string().max(200), copies: z.literal(1),
}).strict().superRefine((row, ctx) => {
  if (LABEL_KINDS[row.kind].needsQr && !fitsBrotherQr(row.qrCodeValue)) ctx.addIssue({ code: "custom", message: "This QR does not fit the approved layout." });
});
const printLabelSchema = z.object({
  copyId: z.string().min(1).max(400),
  row: labelRowSchema,
  entryId: z.string().min(1).max(200).optional(),
  unit: z.object({ skuId: z.string().min(1).max(100), number: z.number().int().positive().max(2147483647) }).strict().optional(),
}).strict();
export type PrintLabel = z.infer<typeof printLabelSchema>;
export type PrintActor = z.infer<typeof actorSchema>;
const outcomeSchema = z.object({
  status: z.enum(["pending", "sending", "buffered", "printed", "not-printed"]),
  attemptedAt: z.string().datetime().optional(),
  recordedAt: z.string().datetime().optional(),
  evidence: z.enum(["printer", "physical-review", "not-sent"]).optional(),
  resolvedBy: actorSchema.optional(),
}).strict().superRefine((outcome, ctx) => {
  if ((["sending", "buffered"].includes(outcome.status) && !outcome.attemptedAt) ||
    (["printed", "not-printed"].includes(outcome.status) && (!outcome.recordedAt || !outcome.evidence)) ||
    (outcome.evidence === "physical-review" && !outcome.resolvedBy) ||
    (outcome.status === "not-printed" && !["physical-review", "not-sent"].includes(outcome.evidence ?? ""))) ctx.addIssue({ code: "custom", message: "Invalid label outcome." });
});
export const printJobSchema = z.object({
  version: z.literal(2), transport: z.literal("sdk-chain-v1").optional(), id: z.string().uuid(), browserId: z.string().uuid(), actor: actorSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(), parentId: z.string().uuid().optional(),
  labels: z.array(printLabelSchema).min(1).max(500), outcomes: z.array(outcomeSchema).min(1).max(500),
  activeIndex: z.number().int().nonnegative().nullable(),
  state: z.enum(["ready", "printing", "stopped", "completed", "needs-review", "reviewed"]),
  finish: z.object({ kind: z.enum(["last-page", "stop-feed"]), state: z.enum(["intent", "completed"]), attemptedAt: z.string().datetime(), recordedAt: z.string().datetime().optional() }).strict().optional(),
  error: z.string().max(2000).optional(), reviewedAt: z.string().datetime().optional(),
}).strict().superRefine((job, ctx) => {
  if (new Set(job.labels.map((label) => label.copyId)).size !== job.labels.length) ctx.addIssue({ code: "custom", message: "Duplicate copy identity." });
  const active = job.outcomes.flatMap((o, i) => o.status === "sending" ? [i] : []);
  const buffered = job.outcomes.some((o) => o.status === "buffered");
  if (new TextEncoder().encode(JSON.stringify(job)).length > 3_300_000) ctx.addIssue({ code: "custom", message: "This print receipt is too large. Split the sheet into smaller batches." });
  const allPrinted = job.outcomes.every((o) => o.status === "printed");
  if (job.outcomes.length !== job.labels.length || active.length > 1 ||
      (active[0] ?? null) !== job.activeIndex ||
      (job.activeIndex !== null && !["printing", "needs-review"].includes(job.state)) ||
      (job.state === "printing" && job.activeIndex === null) ||
      (job.state === "completed" && !allPrinted) ||
      (job.state === "reviewed" && (!job.reviewedAt || job.activeIndex !== null || buffered)) ||
      ((buffered || job.finish) && job.transport !== "sdk-chain-v1") ||
      (job.finish?.state === "completed" && (!job.finish.recordedAt || buffered || job.activeIndex !== null))) {
    ctx.addIssue({ code: "custom", message: "The saved print progress is inconsistent. Review it before printing." });
  }
});
export type PrintJob = z.infer<typeof printJobSchema>;
export const createPrintJobSchema = z.object({
  transport: z.literal("sdk-chain-v1").optional(), id: z.string().uuid(), browserId: z.string().uuid(), labels: z.array(printLabelSchema).min(1).max(500),
  parentId: z.string().uuid().optional(), parentRevision: z.number().int().nonnegative().optional(),
}).strict().superRefine((input, ctx) => {
  // Leave room for 500 bounded outcome/physical-review snapshots to grow.
  if (new TextEncoder().encode(JSON.stringify(input)).length > 2_000_000) ctx.addIssue({ code: "custom", message: "This print sheet is too large. Split it into smaller batches." });
});
export const printHistoryCursorSchema = z.union([z.string().uuid(), z.literal("history-start")]);
export type CreatePrintJob = z.infer<typeof createPrintJobSchema>;
const ordinaryCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("cancel-unsent"), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("complete"), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("buffer"), index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("begin-feed") }).strict(),
  z.object({ type: z.literal("settle-chain") }).strict(),
  z.object({ type: z.literal("halt"), error: z.string().max(2000).optional() }).strict(),
  z.object({ type: z.literal("resolve"), index: z.number().int().nonnegative(), printed: z.boolean() }).strict(),
  z.object({ type: z.literal("review") }).strict(),
]);
const originalCheckpointSchema = z.object({ requestId: z.string().uuid(), revision: z.number().int().nonnegative(), command: ordinaryCommandSchema }).strict();
const printCommandSchema = z.union([ordinaryCommandSchema, z.object({
  type: z.literal("reconcile"), original: originalCheckpointSchema, printed: z.boolean(),
}).strict(), z.object({ type: z.literal("recover-chain"), original: originalCheckpointSchema }).strict()]);
export const checkpointSchema = z.object({
  requestId: z.string().uuid(), revision: z.number().int().nonnegative(), command: printCommandSchema,
}).strict();
export type PrintCheckpoint = z.infer<typeof checkpointSchema>;
export type PrintCommand = z.infer<typeof printCommandSchema>;

export function labelName(label: PrintLabel) {
  return [label.row.dept, label.row.model, label.row.number].filter(Boolean).join(" ") || label.row.qrCodeValue;
}
export function printedLabels(job: PrintJob) { return job.labels.filter((_, i) => job.outcomes[i]!.status === "printed"); }
export function uncertainIndices(job: PrintJob) { return job.outcomes.flatMap((outcome, index) => ["sending", "buffered"].includes(outcome.status) ? [index] : []); }
export function remainingLabels(job: PrintJob) {
  if (uncertainIndices(job).length) throw new Error("Check the uncertain physical label first.");
  return job.labels.filter((_, i) => ["pending", "not-printed"].includes(job.outcomes[i]!.status));
}
export function newPrintJob(input: CreatePrintJob, actor: PrintActor, now: string): PrintJob {
  return printJobSchema.parse({ version: 2, id: input.id, browserId: input.browserId, actor,
    createdAt: now, updatedAt: now, revision: 0, ...(input.transport ? { transport: input.transport } : {}), ...(input.parentId ? { parentId: input.parentId } : {}),
    labels: input.labels, outcomes: input.labels.map(() => ({ status: "pending" })), activeIndex: null, state: "ready" });
}
/** Pure state transitions shared by durable server writes and the browser's recovery mirror. */
export function applyPrintCommand(previous: PrintJob, command: PrintCommand, actor: PrintActor, now: string): PrintJob {
  const job = structuredClone(previous);
  if (job.state === "reviewed") throw new Error("This batch has already been reviewed.");
  const firstPending = job.outcomes.findIndex((o) => o.status === "pending");
  switch (command.type) {
    case "begin":
      if (job.actor.id !== actor.id || job.activeIndex !== null || command.index !== firstPending || job.finish || !["ready", "printing"].includes(job.state)) throw new Error("This label is not ready to print.");
      job.activeIndex = command.index; job.state = "printing";
      job.outcomes[command.index] = { status: "sending", attemptedAt: now };
      if (job.transport && command.index === job.labels.length - 1) job.finish = { kind: "last-page", state: "intent", attemptedAt: now };
      break;
    case "cancel-unsent":
      if (job.actor.id !== actor.id || job.activeIndex !== command.index) throw new Error("The active label changed.");
      job.outcomes[command.index] = { ...job.outcomes[command.index]!, status: "not-printed", recordedAt: now, evidence: "not-sent" };
      job.activeIndex = null; job.state = uncertainIndices(job).length ? "needs-review" : "stopped";
      if (job.finish?.kind === "last-page") delete job.finish;
      break;
    case "complete": {
      if (job.transport || job.actor.id !== actor.id || job.activeIndex !== command.index) throw new Error("The active label changed. Review the batch.");
      job.outcomes[command.index] = { ...job.outcomes[command.index]!, status: "printed", recordedAt: now, evidence: "printer" };
      job.activeIndex = null;
      // The final acknowledgement and terminal state are one durable checkpoint.
      job.state = job.outcomes.every((o) => o.status === "printed") ? "completed" : "ready";
      break;
    }
    case "buffer":
      if (!job.transport || job.actor.id !== actor.id || job.activeIndex !== command.index || command.index === job.labels.length - 1 || job.finish) throw new Error("This page cannot be recorded as held by the printer.");
      job.outcomes[command.index] = { ...job.outcomes[command.index]!, status: "buffered", recordedAt: now };
      job.activeIndex = null; job.state = "ready"; break;
    case "begin-feed":
      if (!job.transport || job.actor.id !== actor.id || job.activeIndex !== null || job.finish || !job.outcomes.some(o => o.status === "buffered") || !["ready", "stopped", "needs-review"].includes(job.state)) throw new Error("This batch cannot release its held labels.");
      job.finish = { kind: "stop-feed", state: "intent", attemptedAt: now }; job.state = "needs-review"; break;
    case "settle-chain": {
      if (!job.transport || job.actor.id !== actor.id || job.finish?.state !== "intent" ||
          (job.finish.kind === "last-page" ? job.activeIndex !== job.labels.length - 1 : job.activeIndex !== null) ||
          !uncertainIndices(job).length) throw new Error("This batch has no pending final feed.");
      for (const index of uncertainIndices(job)) job.outcomes[index] = { ...job.outcomes[index]!, status: "printed", recordedAt: now, evidence: "printer" };
      job.activeIndex = null; job.finish.state = "completed"; job.finish.recordedAt = now;
      job.state = job.outcomes.every(o => o.status === "printed") ? "completed" : "stopped"; break;
    }
    case "halt":
      job.state = uncertainIndices(job).length ? "needs-review" : job.outcomes.every((o) => o.status === "printed") ? "completed" : "stopped";
      if (command.error) job.error = command.error; break;
    case "resolve":
      if (!uncertainIndices(job).includes(command.index)) throw new Error("There is no uncertain label at that position.");
      job.outcomes[command.index] = { ...job.outcomes[command.index]!, status: command.printed ? "printed" : "not-printed", recordedAt: now, evidence: "physical-review", resolvedBy: actor };
      if (job.activeIndex === command.index) job.activeIndex = null;
      job.state = uncertainIndices(job).length ? "needs-review" : job.outcomes.every((o) => o.status === "printed") ? "completed" : "stopped";
      if (!uncertainIndices(job).length) delete job.error; break;
    case "reconcile": {
      if (job.transport) throw new Error("Recover the chained batch for individual physical review.");
      const original = command.original.command;
      if (!("index" in original) || !["begin", "complete", "cancel-unsent"].includes(original.type)) throw new Error("This pending command has no physical label to reconcile.");
      const index = original.index, outcome = job.outcomes[index];
      if (!outcome || (job.activeIndex !== null && job.activeIndex !== index) || (outcome.status === "pending" && index !== firstPending)) throw new Error("The pending label does not match the saved batch progress.");
      if (outcome.status === "printed") {
        if (!command.printed) throw new Error("A confirmed completed label cannot be changed to not printed. Start an intentional reprint separately.");
      } else job.outcomes[index] = { ...outcome, status: command.printed ? "printed" : "not-printed", recordedAt: now, evidence: "physical-review", resolvedBy: actor };
      job.activeIndex = null; job.state = job.outcomes.every((o) => o.status === "printed") ? "completed" : "stopped";
      delete job.error; break;
    }
    case "recover-chain": {
      if (!job.transport || command.original.revision > previous.revision || !["begin", "buffer", "cancel-unsent", "begin-feed", "settle-chain", "halt", "resolve"].includes(command.original.command.type)) throw new Error("This pending chain log cannot be recovered.");
      const original = command.original.command;
      // A failed begin may or may not have committed. Preserve that copy as unknown;
      // recovery is journal-only and never authorizes output or a feed.
      if ("index" in original && ["begin", "buffer"].includes(original.type)) {
        const outcome = job.outcomes[original.index];
        if (!outcome) throw new Error("The pending label is outside this batch.");
        if (outcome.status === "pending") {
          if (original.index !== firstPending || job.activeIndex !== null) throw new Error("The pending copy changed.");
          job.outcomes[original.index] = { status: "sending", attemptedAt: now }; job.activeIndex = original.index;
        }
      }
      job.state = uncertainIndices(job).length ? "needs-review" : job.outcomes.every(o => o.status === "printed") ? "completed" : "stopped";
      break;
    }
    case "review":
      if (uncertainIndices(job).length) throw new Error("Check the uncertain physical label first.");
      job.state = "reviewed"; job.reviewedAt = now; break;
  }
  job.revision++; job.updatedAt = now;
  return printJobSchema.parse(job);
}
