import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const value = process.env.WC_CUSTODY_TEST_DATABASE_URL;
  if (!value) throw new Error("Run scripts/test-custody-postgres.mjs; no external database is accepted");
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "localhost" || url.port !== "5432"
    || url.username !== "custody_test" || url.password || url.pathname !== "/custody_test"
    || [...url.searchParams.keys()].join() !== "host"
    || !/^\/(private\/)?tmp\/wc-custody-pg-[a-zA-Z0-9]+$/.test(url.searchParams.get("host") ?? "")) {
    throw new Error("Refusing a database outside the disposable custody-test cluster");
  }
  // Use Prisma's native PostgreSQL transport; no query/transaction is mocked.
  return { db: new PrismaClient({ datasources: { db: { url: `${value}&connection_limit=5` } } }) };
});
// Route tests keep the real wrapper, JSON validation, service and receipts.
// Device authentication and post-response delivery are external boundaries.
vi.mock("@/lib/auth", () => ({
  requireKiosk: vi.fn(async () => ({ kioskId: "test-kiosk", locationId: "studio", locationName: "Test studio" })),
  requireAuth: vi.fn(),
}));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/live-activity-workflow", () => ({ scheduleCheckoutReturnLiveActivity: vi.fn() }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: vi.fn() }));
import { after } from "next/server";
import { db } from "@/lib/db";
import { transferKioskItems } from "@/lib/services/kiosk-item-transfer";
import { kioskOperationContext, readKioskOperationReceipt } from "@/lib/services/kiosk-operation-receipts";
import { POST } from "@/app/api/kiosk/checkout/[id]/transfer/route";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { endCheckoutReturnLiveActivities } from "@/lib/services/live-activities";

let args: Parameters<typeof transferKioskItems>[0];
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "users", "locations" CASCADE');
  await db.user.createMany({ data: ["operator", "recipient"].map(id => ({
    id, name: id, email: `${id}@example.test`, passwordHash: "unused-fixture", role: "STAFF" as const,
  })) });
  await db.location.create({ data: { id: "studio", name: "Test studio" } });
  await db.asset.create({ data: { id: "asset", assetTag: "TEST-1", type: "Camera", brand: "Test", model: "Test", qrCodeValue: "TEST-1", locationId: "studio" } });
  const startsAt = new Date(Date.now() - 60_000), endsAt = new Date(Date.now() + 86_400_000);
  await db.booking.createMany({ data: ["source", "destination"].map(id => ({
    id, kind: "CHECKOUT" as const, status: "OPEN" as const, title: "Test production", startsAt, endsAt,
    locationId: "studio", requesterUserId: id === "source" ? "operator" : "recipient", createdBy: "operator",
  })) });
  await db.bookingSerializedItem.create({ data: { id: "item", bookingId: "source", assetId: "asset" } });
  await db.assetAllocation.create({ data: { id: "allocation", bookingId: "source", assetId: "asset", startsAt, endsAt, kind: "CHECKOUT" } });
  const source = await db.booking.findUniqueOrThrow({ where: { id: "source" } });
  args = { sourceId: "source", targetBookingId: "destination", actorId: "operator", expectedUpdatedAt: source.updatedAt,
    assetIds: ["asset"], bulkUnitIds: [], reason: "Test handoff", kioskId: "test-kiosk" };
  args.receipt = kioskOperationContext({ requestId: `${Date.now()}:00000000-0000-4000-8000-000000000001`,
    kioskId: "test-kiosk", actorId: "operator", operation: "transfer", sourceId: "source", payload: args });
});
afterEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_transfer_audit ON "audit_logs"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS pause_transfer_write ON "booking_serialized_items"');
});
afterAll(() => db.$disconnect());

async function snapshot() {
  return {
    bookings: await db.booking.findMany({ orderBy: { id: "asc" } }),
    items: await db.bookingSerializedItem.findMany({ orderBy: { id: "asc" } }),
    allocations: await db.assetAllocation.findMany({ orderBy: { id: "asc" } }),
    audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }),
  };
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function holdItemWrites() {
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION pause_transfer_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(9272026); RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER pause_transfer_write BEFORE UPDATE ON booking_serialized_items
    FOR EACH ROW EXECUTE FUNCTION pause_transfer_write()`);
  const ready = signal(), release = signal();
  const lock = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(9272026)::text`;
    ready.resolve();
    await release.promise;
  }, { timeout: 10_000 });
  await Promise.race([ready.promise, lock]);
  return async () => { release.resolve(); await lock; };
}

async function blockedQueries(pattern: string) {
  const [row] = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock' AND query ILIKE ${pattern}`;
  return row!.count;
}

function requestBody() {
  return { actorId: args.actorId, requestId: `${args.receipt!.issuedAt}:00000000-0000-4000-8000-000000000001`,
    expectedUpdatedAt: args.expectedUpdatedAt.toISOString(), targetBookingId: args.targetBookingId,
    assetIds: args.assetIds, bulkUnitIds: args.bulkUnitIds, reason: args.reason };
}

function submit(body: unknown) {
  return POST(new Request("http://localhost/api/kiosk/checkout/source/transfer", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "source" }) });
}

it("rolls custody, parent status, audits, and receipt back after a late database failure", async () => {
  const before = await snapshot();
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_transfer_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced late transfer audit failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER reject_transfer_audit BEFORE INSERT ON audit_logs
    FOR EACH ROW WHEN (NEW.action = 'kiosk_items_transferred_in') EXECUTE FUNCTION reject_transfer_audit()`);
  await expect(transferKioskItems(args)).rejects.toThrow("forced late transfer audit failure");
  expect(await snapshot()).toEqual(before);
  expect(await readKioskOperationReceipt(db, args.receipt)).toBeNull();
});

it("retains a committed replay result and refuses duplicate custody and audit writes", async () => {
  const result = await transferKioskItems(args);
  expect(result).toMatchObject({ targetBookingId: "destination", sourceClosed: true, itemCount: 1 });
  const committed = await snapshot();
  expect(committed.items[0]!.bookingId).toBe("destination");
  expect(committed.allocations[0]!.bookingId).toBe("destination");
  expect(committed.audits.map(row => row.action).sort()).toEqual([
    "kiosk_items_transferred_in", "kiosk_items_transferred_out", "kiosk_operation_receipt",
  ]);
  expect(await readKioskOperationReceipt(db, args.receipt)).toEqual(JSON.parse(JSON.stringify(result)));
  await expect(transferKioskItems(args)).rejects.toThrow();
  expect(await snapshot()).toEqual(committed);
});

it("allows only one competing transfer after both have reached the custody write", async () => {
  const { startsAt, endsAt } = await db.booking.findUniqueOrThrow({ where: { id: "source" } });
  await db.booking.create({ data: { id: "other-destination", kind: "CHECKOUT", status: "OPEN", title: "Test production",
    startsAt, endsAt, locationId: "studio", requesterUserId: "operator", createdBy: "operator" } });
  const competing = { ...args, targetBookingId: "other-destination", receipt: undefined as typeof args.receipt };
  competing.receipt = kioskOperationContext({ requestId: `${Date.now()}:00000000-0000-4000-8000-000000000002`,
    kioskId: "test-kiosk", actorId: "operator", operation: "transfer", sourceId: "source", payload: competing });
  const before = await snapshot();
  const release = await holdItemWrites();
  const completed = Promise.allSettled([transferKioskItems(args), transferKioskItems(competing)]);
  try {
    // Both transactions passed their reads before either can commit. Waiting
    // on observed database locks avoids a timing-dependent sleep or fake race.
    await vi.waitFor(async () => expect(await blockedQueries('%UPDATE%booking_serialized_items%')).toBe(2), { interval: 10, timeout: 3_000 });
  } finally {
    await release();
    await completed;
  }
  const outcomes = await completed;
  const winners = outcomes.filter(outcome => outcome.status === "fulfilled");
  const losers = outcomes.filter(outcome => outcome.status === "rejected");
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  expect(losers[0]!.reason).toMatchObject({ status: 409 });
  const winner = winners[0]!.value;
  const winnerArgs = winner.targetBookingId === "destination" ? args : competing;
  const loserArgs = winnerArgs === args ? competing : args;
  const after = await snapshot();
  expect(after.items[0]!.bookingId).toBe(winner.targetBookingId);
  expect(after.allocations[0]!.bookingId).toBe(winner.targetBookingId);
  expect(after.bookings.find(row => row.id === "source")!.status).toBe("CANCELLED");
  expect(after.bookings.find(row => row.id === loserArgs.targetBookingId)).toEqual(before.bookings.find(row => row.id === loserArgs.targetBookingId));
  expect(after.audits.map(row => row.action).sort()).toEqual(["kiosk_items_transferred_in", "kiosk_items_transferred_out", "kiosk_operation_receipt"]);
  expect(await readKioskOperationReceipt(db, winnerArgs.receipt)).toEqual(JSON.parse(JSON.stringify(winner)));
  expect(await readKioskOperationReceipt(db, loserArgs.receipt)).toBeNull();
});

it("returns one committed result to concurrent HTTP retries and schedules delivery once", async () => {
  const body = requestBody();
  const release = await holdItemWrites();
  const requests = [submit(body)];
  try {
    await vi.waitFor(async () => expect(await blockedQueries('%UPDATE%booking_serialized_items%')).toBe(1), { interval: 10, timeout: 3_000 });
    requests.push(submit(body));
    await vi.waitFor(async () => expect(await blockedQueries('%INSERT%audit_logs%')).toBe(1), { interval: 10, timeout: 3_000 });
  } finally {
    await release();
    await Promise.allSettled(requests);
  }
  const responses = await Promise.all(requests);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  const [first, second] = await Promise.all(responses.map(response => response.json()));
  expect(first).toMatchObject({ success: true, targetBookingId: "destination", sourceClosed: true, itemCount: 1 });
  expect(second).toEqual(first);
  const committed = await snapshot();
  expect(committed.audits).toHaveLength(3);
  expect(committed.items[0]!.bookingId).toBe("destination");
  expect(committed.allocations[0]!.bookingId).toBe("destination");
  expect(after).toHaveBeenCalledTimes(1);
  const callback = vi.mocked(after).mock.calls[0]![0];
  if (typeof callback !== "function") throw new Error("Expected a deferred delivery callback");
  await callback();
  expect(scheduleCheckoutReturnLiveActivity).toHaveBeenCalledTimes(1);
  expect(endCheckoutReturnLiveActivities).toHaveBeenCalledExactlyOnceWith("source");
  expect(await (await submit(body)).json()).toEqual(first);
  expect(after).toHaveBeenCalledTimes(1);
  expect(await snapshot()).toEqual(committed);
});

it("seals and replays a definitive HTTP rejection without moving custody", async () => {
  await db.booking.update({ where: { id: "destination" }, data: { title: "Other purpose" } });
  const before = await snapshot(), body = requestBody();
  const response = await submit(body);
  expect(response.status).toBe(200);
  const rejection = await response.json();
  expect(rejection).toMatchObject({ success: false, operationRejected: true });
  const recorded = await snapshot();
  expect({ ...recorded, audits: [] }).toEqual(before);
  expect(recorded.audits).toHaveLength(1);
  expect(recorded.audits[0]!.afterJson).toEqual(rejection);
  expect(await (await submit(body)).json()).toEqual(rejection);
  expect(await snapshot()).toEqual(recorded);
  expect(after).not.toHaveBeenCalled();
});

it("rejects changed HTTP replay details without overwriting the committed result", async () => {
  const body = requestBody();
  const original = await (await submit(body)).json();
  expect(original).toMatchObject({ success: true });
  const committed = await snapshot();
  const response = await submit({ ...body, reason: "Changed saved handoff" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: false, operationRejected: true });
  expect(await snapshot()).toEqual(committed);
  expect(await (await submit(body)).json()).toEqual(original);
  expect(after).toHaveBeenCalledTimes(1);
});

it.each(["expired", "unreadable"])("returns a clearable rejection for an %s saved HTTP handoff", async kind => {
  const before = await snapshot(), body = requestBody();
  const response = await submit(kind === "expired"
    ? { ...body, requestId: `${Date.now() - 8 * 86_400_000}:00000000-0000-4000-8000-000000000001` }
    : { ...body, assetIds: "obsolete payload" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: false, operationRejected: true });
  expect(await snapshot()).toEqual(before);
  expect(after).not.toHaveBeenCalled();
});
