import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { applyPrintCommand, newPrintJob, printJobSchema, remainingLabels, type CreatePrintJob, type PrintCheckpoint, type PrintJob } from "@/lib/label-print-job";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const actor = (user: AuthUser) => ({ id: user.id, name: user.name });
const json = (value: unknown) => value as Prisma.InputJsonValue;
function mayReview(user: AuthUser, job: PrintJob) {
  if (job.actor.id !== user.id) requirePermission(user.role, "label_print", "review_others");
}
export async function createLabelPrintJob(input: CreatePrintJob, user: AuthUser) {
  requirePermission(user.role, "label_print", "print");
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.labelPrintJob.findUnique({ where: { id: input.id } });
      if (existing) {
        const job = printJobSchema.parse(existing.job);
        if (job.actor.id !== user.id || job.browserId !== input.browserId || job.parentId !== input.parentId || job.transport !== input.transport || JSON.stringify(job.labels) !== JSON.stringify(input.labels)) throw new HttpError(409, "This batch ID already belongs to a different print sheet.");
        return job;
      }
      const now = new Date().toISOString();
      if (input.parentId) {
        const parentRow = await tx.labelPrintJob.findUnique({ where: { id: input.parentId } });
        if (!parentRow) throw new HttpError(404, "The previous print batch was not found.");
        const parent = printJobSchema.parse(parentRow.job); mayReview(user, parent);
        if (parent.browserId !== input.browserId || parent.revision !== input.parentRevision || parent.state === "reviewed" || parent.activeIndex !== null || JSON.stringify(remainingLabels(parent)) !== JSON.stringify(input.labels)) throw new HttpError(409, "The remaining labels changed. Review the previous batch again.");
        const reviewed = applyPrintCommand(parent, { type: "review" }, actor(user), now);
        await tx.labelPrintJob.update({ where: { id: parent.id, revision: parent.revision }, data: { job: json(reviewed), revision: reviewed.revision, activeBrowserId: null } });
        await createAuditEntryTx(tx, { actorId: user.id, actorRole: user.role, entityType: "label_print_job", entityId: parent.id, action: "continue_remaining_labels", before: { revision: parent.revision }, after: { childId: input.id, revision: reviewed.revision } });
      }
      const active = await tx.labelPrintJob.findUnique({ where: { activeBrowserId: input.browserId } });
      if (active) throw new HttpError(409, "An earlier batch on this browser needs review before another can print.", { jobId: active.id });
      const job = newPrintJob(input, actor(user), now);
      await tx.labelPrintJob.create({ data: { id: job.id, actorUserId: user.id, browserId: job.browserId, activeBrowserId: job.browserId, revision: 0, lastRequestId: job.id, lastRequestHash: hash(input), job: json(job) } });
      await createAuditEntryTx(tx, { actorId: user.id, actorRole: user.role, entityType: "label_print_job", entityId: job.id, action: "start_label_print", after: { labels: job.labels, printer: "Brother PT-D610BT", layout: "Gotham XNarrow Bold 21 / Medium Small", parentId: job.parentId ?? null, startedAt: now } });
      return job;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "Another batch was saved first. Reload print history before continuing.");
    throw error;
  }
}
export async function checkpointLabelPrintJob(id: string, input: PrintCheckpoint, user: AuthUser) {
  requirePermission(user.role, "label_print", "print");
  return db.$transaction(async (tx) => {
    const row = await tx.labelPrintJob.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "Print batch not found.");
    const previous = printJobSchema.parse(row.job);
    mayReview(user, previous);
    if (["begin", "complete", "cancel-unsent", "buffer", "begin-feed", "settle-chain"].includes(input.command.type) && previous.actor.id !== user.id) throw new HttpError(403, "Only the batch's operator can send or acknowledge its labels.");
    if (row.lastRequestId === input.requestId) {
      if (row.lastRequestHash !== hash(input)) throw new HttpError(409, "This log request ID was already used for different progress.");
      return previous;
    }
    if (row.revision !== input.revision) throw new HttpError(409, "This print batch changed. Reload it before continuing.");
    let next: PrintJob;
    try { next = applyPrintCommand(previous, input.command, actor(user), new Date().toISOString()); }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : "Invalid print progress."); }
    await tx.labelPrintJob.update({ where: { id, revision: input.revision }, data: { job: json(next), revision: next.revision, lastRequestId: input.requestId, lastRequestHash: hash(input), activeBrowserId: next.state === "reviewed" ? null : next.browserId } });
    await createAuditEntryTx(tx, { actorId: user.id, actorRole: user.role, entityType: "label_print_job", entityId: id, action: `label_print_${input.command.type}`, before: { revision: previous.revision, activeIndex: previous.activeIndex }, after: { ...input.command, revision: next.revision, state: next.state, recordedAt: next.updatedAt } });
    return next;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
export async function listLabelPrintJobs(user: AuthUser, browserId?: string, cursor?: string) {
  requirePermission(user.role, "label_print", "view");
  const staff = ["ADMIN", "STAFF"].includes(user.role);
  const [rows, active] = await Promise.all([
    db.labelPrintJob.findMany({ where: staff ? {} : { actorUserId: user.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    browserId ? db.labelPrintJob.findUnique({ where: { activeBrowserId: browserId } }) : null,
  ]);
  const activeJob = active ? printJobSchema.parse(active.job) : null;
  // Keep the browser-level safety guard across accounts without disclosing another person's sheet to students.
  return { jobs: rows.slice(0, 20).map((row) => printJobSchema.parse(row.job)), nextCursor: rows.length > 20 ? rows[19]!.id : null,
    active: activeJob && (staff || activeJob.actor.id === user.id) ? activeJob : null,
    blockedByOtherOperator: Boolean(activeJob && !staff && activeJob.actor.id !== user.id) };
}

export async function getLabelPrintJob(id: string, user: AuthUser) {
  requirePermission(user.role, "label_print", "view");
  const row = await db.labelPrintJob.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Print batch not found.");
  const job = printJobSchema.parse(row.job); mayReview(user, job); return job;
}
