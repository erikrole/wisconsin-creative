import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

// The repository runner owns this socket-only cluster; never accept an app URL.
const root = realpathSync(process.env.WC_ONBOARDING_POSTGRES_ROOT ?? "/missing-owned-cluster");
const connection = new URL(process.env.WC_ONBOARDING_POSTGRES_URL ?? "invalid:");
if (!root.startsWith(`${realpathSync("/tmp")}/wc-onboarding-pg-`) || connection.hostname !== "localhost"
  || connection.username !== "wc_onboarding_test" || connection.pathname !== "/wc_onboarding_test"
  || connection.searchParams.get("host") !== path.join(root, "socket")) throw new Error("Refusing an unowned database.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.href, max: 8 }) });
vi.mock("@/lib/db", () => ({ get db() { return client; } }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), SETTINGS_MUTATION_LIMIT: {} }));
vi.mock("@/lib/services/notifications", () => ({ deferPush: vi.fn(), sendPushToUser: vi.fn(async () => undefined) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { requireAuth } from "@/lib/auth";
import { POST } from "@/app/api/users/[id]/availability/route";
import { PATCH } from "@/app/api/users/[id]/availability/[blockId]/route";

const student = { id: "availability-student", name: "Fixture Student", email: "availability.student@example.test", role: "STUDENT" as const, staffingType: "ST" as const, avatarUrl: null, forcePasswordChange: false };
const staff = { ...student, id: "availability-staff", email: "availability.staff@example.test", role: "STAFF" as const };
const weekly = { kind: "WEEKLY", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startsAt: "09:00", endsAt: "11:00", label: "Class" };
const request = (body: object, userId = student.id) => POST(new Request(`https://app.example.test/api/users/${userId}/availability`, {
  method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ id: userId }) });

beforeEach(async () => {
  await client.$executeRawUnsafe("DROP TRIGGER IF EXISTS availability_save_failure ON student_availability_saves");
  await client.$executeRawUnsafe("TRUNCATE users, calendar_events CASCADE");
  await client.user.createMany({ data: [student, staff].map(({ avatarUrl: _avatar, forcePasswordChange: _force, ...user }) => ({ ...user, passwordHash: "fixture-only" })) });
  await client.calendarEvent.create({ data: { id: "availability-event", externalId: "availability-event", summary: "Fixture shift", startsAt: new Date("2099-11-02T15:00:00Z"), endsAt: new Date("2099-11-02T16:00:00Z"),
    shiftGroup: { create: { id: "availability-group", shifts: { create: { id: "availability-shift", area: "PHOTO", workerType: "ST", startsAt: new Date("2099-11-02T15:00:00Z"), endsAt: new Date("2099-11-02T16:00:00Z"), assignments: { create: { id: "availability-assignment", userId: student.id, status: "DIRECT_ASSIGNED" } } } } } },
  } });
  vi.mocked(requireAuth).mockResolvedValue(student);
});
afterAll(() => client.$disconnect());

describe("Availability save receipts against owned PostgreSQL", () => {
  it("replays a lost successful weekly response without duplicate blocks, audits or conflict updates", async () => {
    const body = { ...weekly, requestId: randomUUID() };
    const first = await request(body);
    expect(first.status).toBe(201);
    // The caller never consumes the first response before retrying.
    const beforeRetry = await client.shiftAssignment.findUniqueOrThrow({ where: { id: "availability-assignment" } });
    expect(beforeRetry.hasConflict).toBe(true);
    const replay = await request({ ...body, daysOfWeek: [...body.daysOfWeek].reverse() });
    expect(replay.status).toBe(201);
    expect((await replay.json()).blocks.map((block: { id: string }) => block.id)).toEqual((await first.json()).blocks.map((block: { id: string }) => block.id));
    expect(await client.studentAvailabilityBlock.count()).toBe(7);
    expect(await client.studentAvailabilitySave.count()).toBe(1);
    expect(await client.auditLog.count({ where: { action: "student_availability_created" } })).toBe(7);
    expect((await client.shiftAssignment.findUniqueOrThrow({ where: { id: "availability-assignment" } })).updatedAt).toEqual(beforeRetry.updatedAt);
  });

  it("allows concurrent submissions of one save to commit only one batch", async () => {
    const body = { ...weekly, requestId: randomUUID() };
    const responses = await Promise.all([request(body), request(body)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map((response) => response.json()));
    expect(first.blocks.map((block: { id: string }) => block.id)).toEqual(second.blocks.map((block: { id: string }) => block.id));
    expect(await client.studentAvailabilityBlock.count()).toBe(7);
    expect(await client.studentAvailabilitySave.count()).toBe(1);
    expect(await client.auditLog.count({ where: { action: "student_availability_created" } })).toBe(7);
  });

  it("rejects changed payloads and removed entries without recreating a completed save", async () => {
    const body = { ...weekly, requestId: randomUUID() };
    const original = await request(body); expect(original.status).toBe(201);
    const saved = (await original.json()).blocks;
    expect((await request({ ...body, label: "Changed after lost response" })).status).toBe(409);
    await client.studentAvailabilityBlock.delete({ where: { id: saved[0].id } });
    expect((await request(body)).status).toBe(409);
    expect(await client.studentAvailabilityBlock.count()).toBe(6);
    expect(await client.studentAvailabilitySave.count()).toBe(1);
    expect(await client.auditLog.count({ where: { action: "student_availability_created" } })).toBe(7);
  });

  it("keeps save IDs private to the actor and binds them to their target", async () => {
    const body = { ...weekly, requestId: randomUUID() };
    expect((await request(body)).status).toBe(201);
    expect((await request(body, staff.id)).status).toBe(403);
    vi.mocked(requireAuth).mockResolvedValue(staff);
    expect((await request(body, staff.id)).status).toBe(201);
    expect((await request(body, student.id)).status).toBe(409);
    expect(await client.studentAvailabilityBlock.count()).toBe(14);
    expect(await client.studentAvailabilitySave.count()).toBe(2);
  });

  it("rolls back the receipt, blocks, audits and conflict changes together, then accepts a retry", async () => {
    await client.$executeRawUnsafe("CREATE OR REPLACE FUNCTION availability_fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture save unavailable'; END $$");
    await client.$executeRawUnsafe("CREATE TRIGGER availability_save_failure BEFORE UPDATE ON student_availability_saves FOR EACH ROW EXECUTE FUNCTION availability_fail_save()");
    const body = { ...weekly, requestId: randomUUID() };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await request(body)).status).toBe(500); } finally { log.mockRestore(); }
    expect(await client.studentAvailabilitySave.count()).toBe(0);
    expect(await client.studentAvailabilityBlock.count()).toBe(0);
    expect(await client.auditLog.count({ where: { action: "student_availability_created" } })).toBe(0);
    expect((await client.shiftAssignment.findUniqueOrThrow({ where: { id: "availability-assignment" } })).hasConflict).toBe(false);
    await client.$executeRawUnsafe("DROP TRIGGER availability_save_failure ON student_availability_saves");
    expect((await request(body)).status).toBe(201);
    expect((await client.shiftAssignment.findUniqueOrThrow({ where: { id: "availability-assignment" } })).hasConflict).toBe(true);
  });

  it("replays current staff feedback instead of restoring an outdated pending request", async () => {
    const body = { requestId: randomUUID(), kind: "AD_HOC", intent: "TIME_OFF", date: "2099-11-02", allDay: true, startsAt: "00:00", endsAt: "23:59", label: "Trip" };
    const created = await request(body); expect(created.status).toBe(201);
    const block = (await created.json()).data;
    vi.mocked(requireAuth).mockResolvedValue(staff);
    const reviewed = await PATCH(new Request(`https://app.example.test/api/users/${student.id}/availability/${block.id}`, {
      method: "PATCH", headers: { origin: "https://app.example.test", "content-type": "application/json" },
      body: JSON.stringify({ status: "APPROVED", reviewNote: "Coverage confirmed", expectedUpdatedAt: block.updatedAt }),
    }), { params: Promise.resolve({ id: student.id, blockId: block.id }) });
    expect(reviewed.status).toBe(200);
    vi.mocked(requireAuth).mockResolvedValue(student);
    expect((await (await request(body)).json()).data).toMatchObject({ id: block.id, status: "APPROVED", reviewNote: "Coverage confirmed" });
    expect(await client.studentAvailabilityBlock.count()).toBe(1);
    expect(await client.notification.count({ where: { userId: student.id } })).toBe(1);
  });
});
