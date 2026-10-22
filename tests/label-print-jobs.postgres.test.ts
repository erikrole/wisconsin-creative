import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import type { AuthUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { checkpointSchema, createPrintJobSchema, printJobSchema, remainingLabels } from "@/lib/label-print-job";

const holder = vi.hoisted(() => ({ db: undefined as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
import { checkpointLabelPrintJob, createLabelPrintJob, getLabelPrintJob, listLabelPrintJobs } from "@/lib/services/label-print-jobs";

const connection = process.env.QR_PRINT_TEST_DATABASE_URL;
const suite = connection ? describe : describe.skip;
const user: AuthUser = { id: "staff-1", name: "Real Session Name", email: "staff@creative.local", role: Role.STAFF, avatarUrl: null };
const student: AuthUser = { ...user, id: "student-1", name: "Student", role: Role.STUDENT };
const createInput = () => createPrintJobSchema.parse({ id: crypto.randomUUID(), browserId: crypto.randomUUID(), labels: [0, 1, 2].map((i) => ({ copyId: `copy-${i}`, row: { kind: "body", dept: "FB", model: "FX3", number: "1", qrCodeValue: "c62a82d7", copies: 1 } })) });
const checkpoint = (revision: number, command: unknown, requestId = crypto.randomUUID()) => checkpointSchema.parse({ revision, command, requestId });

suite("print job service on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(connection!);
    if (target.hostname !== "127.0.0.1" || target.pathname !== "/wc_integrity_test") throw new Error("Refusing a non-disposable print test database");
    holder.db = new PrismaClient({ datasourceUrl: connection });
    const count = await holder.db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_tables WHERE schemaname='public'`;
    if (Number(count[0]!.count) !== 0) throw new Error("Refusing a nonempty print test database");
    await holder.db.$executeRawUnsafe('CREATE TABLE users (id TEXT PRIMARY KEY)');
    await holder.db.$executeRawUnsafe('CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, before_json JSONB, after_json JSONB, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const statement of readFileSync("prisma/migrations/0202_label_print_jobs/migration.sql", "utf8").split(";").map((part) => part.trim()).filter(Boolean)) await holder.db.$executeRawUnsafe(statement);
    await holder.db.$executeRaw`INSERT INTO users (id) VALUES ('staff-1'), ('student-1'), ('student-2')`;
  });
  beforeEach(async () => { await holder.db.$executeRaw`TRUNCATE label_print_jobs, audit_logs`; });
  afterAll(async () => { await holder.db?.$disconnect(); });
  it("records session-derived identity, exact labels and completion timestamps without marking gear applied", async () => {
    const input = createInput(); let job = await createLabelPrintJob(input, user);
    job = await checkpointLabelPrintJob(job.id, checkpoint(0, { type: "begin", index: 0 }), user);
    job = await checkpointLabelPrintJob(job.id, checkpoint(1, { type: "complete", index: 0 }), user);
    const stored = await getLabelPrintJob(job.id, user);
    expect(stored.actor).toEqual({ id: user.id, name: user.name });
    expect(stored.labels[0]).toEqual(input.labels[0]);
    expect(stored.outcomes[0]).toMatchObject({ status: "printed", evidence: "printer", recordedAt: expect.any(String) });
    const audits = await holder.db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(3); expect(audits.every((entry) => entry.actorUserId === user.id)).toBe(true);
    expect(audits.at(-1)?.afterJson).toMatchObject({ _actorRole: "STAFF", type: "complete", index: 0, recordedAt: stored.updatedAt });
  });
  it("makes create/checkpoint retries idempotent, rejects changed payloads and stale revisions", async () => {
    const input = createInput(), first = await createLabelPrintJob(input, user);
    expect(await createLabelPrintJob(JSON.parse(JSON.stringify(input)), user)).toEqual(first);
    const begin = checkpoint(0, { type: "begin", index: 0 });
    const started = await checkpointLabelPrintJob(first.id, begin, user);
    expect(await checkpointLabelPrintJob(first.id, begin, user)).toEqual(started);
    await expect(checkpointLabelPrintJob(first.id, { ...begin, command: { type: "complete", index: 0 } }, user)).rejects.toMatchObject({ status: 409 });
    await expect(checkpointLabelPrintJob(first.id, checkpoint(0, { type: "begin", index: 1 }), user)).rejects.toMatchObject({ status: 409 });
    expect(await holder.db.auditLog.count()).toBe(2);
  });
  it("reserves one active browser job even when two creations race", async () => {
    const first = createInput(), second = { ...createInput(), browserId: first.browserId };
    const settled = await Promise.allSettled([createLabelPrintJob(first, user), createLabelPrintJob(second, user)]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await holder.db.labelPrintJob.count()).toBe(1); expect(await holder.db.auditLog.count()).toBe(1);
  });
  it("rolls back job progress if the matching audit write fails", async () => {
    const job = await createLabelPrintJob(createInput(), user);
    await holder.db.$executeRawUnsafe("ALTER TABLE audit_logs ADD CONSTRAINT reject_test_begin CHECK (action <> 'label_print_begin')");
    try { await expect(checkpointLabelPrintJob(job.id, checkpoint(0, { type: "begin", index: 0 }), user)).rejects.toThrow(); }
    finally { await holder.db.$executeRawUnsafe("ALTER TABLE audit_logs DROP CONSTRAINT reject_test_begin"); }
    expect((await getLabelPrintJob(job.id, user)).revision).toBe(0);
    expect(await holder.db.auditLog.count()).toBe(1);
  });
  it("retains student printing while guarding foreign-account reads and sends", async () => {
    const job = await createLabelPrintJob(createInput(), student), other = { ...student, id: "student-2" };
    await expect(getLabelPrintJob(job.id, other)).rejects.toBeInstanceOf(HttpError);
    const foreign = await listLabelPrintJobs(other, job.browserId);
    expect(foreign).toMatchObject({ jobs: [], active: null, blockedByOtherOperator: true });
    await expect(checkpointLabelPrintJob(job.id, checkpoint(0, { type: "begin", index: 0 }), user)).rejects.toMatchObject({ status: 403 });
    await expect(createLabelPrintJob(createInput(), { ...user, role: Role.COLLABORATOR })).rejects.toMatchObject({ status: 403 });
  });
  it("atomically reviews the parent and creates only exact remaining copies, preserving lineage", async () => {
    let parent = await createLabelPrintJob(createInput(), user);
    parent = await checkpointLabelPrintJob(parent.id, checkpoint(0, { type: "begin", index: 0 }), user);
    parent = await checkpointLabelPrintJob(parent.id, checkpoint(1, { type: "complete", index: 0 }), user);
    parent = await checkpointLabelPrintJob(parent.id, checkpoint(2, { type: "begin", index: 1 }), user);
    await expect(createLabelPrintJob({ ...createInput(), browserId: parent.browserId, parentId: parent.id, parentRevision: parent.revision }, user)).rejects.toMatchObject({ status: 409 });
    parent = await checkpointLabelPrintJob(parent.id, checkpoint(3, { type: "resolve", index: 1, printed: true }), user);
    const child = await createLabelPrintJob({ id: crypto.randomUUID(), browserId: parent.browserId, labels: remainingLabels(parent), parentId: parent.id, parentRevision: parent.revision }, user);
    expect(child.labels.map((label) => label.copyId)).toEqual(["copy-2"]);
    expect(child.parentId).toBe(parent.id); expect((await getLabelPrintJob(parent.id, user)).state).toBe("reviewed");
    expect((await listLabelPrintJobs(user, parent.browserId)).active?.id).toBe(child.id);
    await expect(checkpointLabelPrintJob(parent.id, checkpoint(parent.revision, { type: "begin", index: 2 }), user)).rejects.toMatchObject({ status: 409 });
  });
  it("rolls parent review back when child reservation fails", async () => {
    const parent = await createLabelPrintJob(createInput(), user);
    await holder.db.$executeRawUnsafe("ALTER TABLE label_print_jobs ADD CONSTRAINT reject_child_test CHECK (job->>'parentId' IS NULL)");
    try { await expect(createLabelPrintJob({ id: crypto.randomUUID(), browserId: parent.browserId, labels: remainingLabels(parent), parentId: parent.id, parentRevision: parent.revision }, user)).rejects.toThrow(); }
    finally { await holder.db.$executeRawUnsafe("ALTER TABLE label_print_jobs DROP CONSTRAINT reject_child_test"); }
    expect((await getLabelPrintJob(parent.id, user)).state).toBe("ready");
    expect((await listLabelPrintJobs(user, parent.browserId)).active?.id).toBe(parent.id);
    expect(await holder.db.auditLog.count()).toBe(1);
  });
  it("lets staff reconcile another operator's uncommitted checkpoint without sending or impersonating them", async () => {
    const job = await createLabelPrintJob(createInput(), student), original = checkpoint(0, { type: "begin", index: 0 });
    // The original begin never reached the server; a browser still holds that outbox.
    const reviewed = await checkpointLabelPrintJob(job.id, checkpoint(0, { type: "reconcile", original, printed: false }), user);
    expect(reviewed.actor.id).toBe(student.id);
    expect(reviewed.outcomes[0]).toMatchObject({ status: "not-printed", evidence: "physical-review", resolvedBy: { id: user.id } });
    const audits = await holder.db.auditLog.findMany({ where: { action: "label_print_reconcile" } });
    expect(audits).toHaveLength(1); expect(audits[0]!.actorUserId).toBe(user.id);
    expect(audits[0]!.afterJson).toMatchObject({ original });
  });
  it("persists chain Stop intent atomically, preserves provisional copies and creates an exact remaining-only child", async () => {
    let job = await createLabelPrintJob({ ...createInput(), transport: "sdk-chain-v1" }, user);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "begin", index: 0 }), user);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "buffer", index: 0 }), user);
    expect(job.outcomes[0]!.status).toBe("buffered");
    await expect(createLabelPrintJob({ ...createInput(), browserId: job.browserId, parentId: job.id, parentRevision: job.revision }, user)).rejects.toThrow("uncertain");
    const beforeFeed = job;
    await holder.db.$executeRawUnsafe("ALTER TABLE audit_logs ADD CONSTRAINT reject_feed_test CHECK (action <> 'label_print_begin-feed')");
    try { await expect(checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "begin-feed" }), user)).rejects.toThrow(); }
    finally { await holder.db.$executeRawUnsafe("ALTER TABLE audit_logs DROP CONSTRAINT reject_feed_test"); }
    expect(await getLabelPrintJob(job.id, user)).toEqual(beforeFeed);
    const feed = checkpoint(job.revision, { type: "begin-feed" });
    job = await checkpointLabelPrintJob(job.id, feed, user);
    expect(await checkpointLabelPrintJob(job.id, feed, user)).toEqual(job);
    expect(job.finish).toMatchObject({ kind: "stop-feed", state: "intent" });
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "settle-chain" }), user);
    expect(job.outcomes.map(o => o.status)).toEqual(["printed", "pending", "pending"]);
    const child = await createLabelPrintJob({ id: crypto.randomUUID(), browserId: job.browserId, transport: "sdk-chain-v1", parentId: job.id, parentRevision: job.revision, labels: remainingLabels(job) }, user);
    expect(child.labels.map(l => l.copyId)).toEqual(["copy-1", "copy-2"]);
    expect((await getLabelPrintJob(job.id, user)).state).toBe("reviewed");
    const audit = await holder.db.auditLog.findFirstOrThrow({ where: { action: "label_print_begin-feed" } });
    expect(audit.actorUserId).toBe(user.id); expect(audit.afterJson).toMatchObject({ type: "begin-feed", recordedAt: expect.any(String) });
  });
  it("allows staff to review held copies individually while reserving chain output acknowledgements to the original operator", async () => {
    let job = await createLabelPrintJob({ ...createInput(), transport: "sdk-chain-v1" }, student);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "begin", index: 0 }), student);
    for (const command of [{ type: "buffer", index: 0 }, { type: "begin-feed" }, { type: "settle-chain" }]) await expect(checkpointLabelPrintJob(job.id, checkpoint(job.revision, command), user)).rejects.toMatchObject({ status: 403 });
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "buffer", index: 0 }), student);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "begin", index: 1 }), student);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "halt", error: "Disconnected" }), student);
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "resolve", index: 0, printed: true }), user);
    expect(() => remainingLabels(job)).toThrow("uncertain");
    job = await checkpointLabelPrintJob(job.id, checkpoint(job.revision, { type: "resolve", index: 1, printed: false }), user);
    expect(job.outcomes[0]).toMatchObject({ evidence: "physical-review", resolvedBy: { id: user.id } });
    expect(job.actor.id).toBe(student.id); expect(remainingLabels(job).map(l => l.copyId)).toEqual(["copy-1", "copy-2"]);
  });
  it("bounds UTF-8 history pages while preserving a large active receipt and every paginated batch", async () => {
    const ids: string[] = []; let activeBrowser = "";
    for (let batch = 0; batch < 3; batch++) {
      const input = createPrintJobSchema.parse({ ...createInput(), labels: Array.from({ length: 500 }, (_, index) => ({
        copyId: `${index}-${"\u0001".repeat(230)}`,
        row: { kind: "text", dept: "\u0001".repeat(180), model: "\u0001".repeat(200), number: "1", qrCodeValue: "", copies: 1 },
      })) });
      const initial = await createLabelPrintJob(input, user), now = new Date().toISOString();
      const job = printJobSchema.parse({ ...initial, state: "completed", revision: 1,
        outcomes: initial.labels.map(() => ({ status: "printed", attemptedAt: now, recordedAt: now, evidence: "physical-review", resolvedBy: { id: user.id, name: "\u0001".repeat(200) } })),
      });
      await holder.db.labelPrintJob.update({ where: { id: job.id }, data: { revision: 1, job: job as unknown as Prisma.InputJsonValue } });
      ids.push(job.id); if (!batch) activeBrowser = job.browserId;
    }
    let page = await listLabelPrintJobs(user, activeBrowser);
    expect(page.active?.id).toBe(ids[0]); expect(page.jobs).toHaveLength(0); expect(page.nextCursor).toBe("history-start");
    const seen: string[] = []; let requests = 0;
    while (true) {
      expect(Buffer.byteLength(JSON.stringify({ data: page }), "utf8")).toBeLessThanOrEqual(3_500_000);
      seen.push(...page.jobs.map(job => job.id));
      const cursor = page.nextCursor; if (!cursor) break;
      expect(requests++).toBeLessThan(5);
      page = await listLabelPrintJobs(user, activeBrowser, cursor);
      expect(page.active).toBeNull(); expect(page.nextCursor).not.toBe(cursor);
    }
    expect(seen).toHaveLength(3); expect(new Set(seen)).toEqual(new Set(ids));
  });
  it("keeps print history and actor snapshot after account removal", async () => {
    const operator = { ...student, id: "student-2" }, job = await createLabelPrintJob(createInput(), operator);
    await holder.db.$executeRaw`DELETE FROM users WHERE id='student-2'`;
    const stored = await holder.db.labelPrintJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.actorUserId).toBeNull(); expect(stored.job).toMatchObject({ actor: { id: operator.id, name: operator.name } });
  });
});
