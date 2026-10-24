import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { realpathSync } from "node:fs";
import path from "node:path";

const root = realpathSync(process.env.WC_ONBOARDING_POSTGRES_ROOT ?? "/missing-owned-cluster");
const connection = new URL(process.env.WC_ONBOARDING_POSTGRES_URL ?? "invalid:");
if (!root.startsWith(`${realpathSync("/tmp")}/wc-onboarding-pg-`) || connection.hostname !== "localhost"
  || connection.username !== "wc_onboarding_test" || connection.pathname !== "/wc_onboarding_test"
  || connection.searchParams.get("host") !== path.join(root, "socket")) throw new Error("Refusing an unowned database.");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.href, max: 8 }) });
let gate: { remaining: number; ready: () => void; released: Promise<void> } | null = null;
const db = client.$extends({ query: { user: { async findUnique({ args, query }) {
  const result = await query(args);
  const paused = gate;
  if (paused) {
    if (--paused.remaining === 0) { gate = null; paused.ready(); }
    await paused.released;
  }
  return result;
} } } });
vi.mock("@/lib/db", () => ({ get db() { return db; } }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), SETTINGS_MUTATION_LIMIT: {} }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { requireAuth } from "@/lib/auth";
import { GET, PATCH } from "@/app/api/me/profile-completion/route";
import { PATCH as checklist } from "@/app/api/me/getting-started/route";

const actor = { id: "student", role: "STUDENT" as const, email: "student@wisc.edu", name: "Student", avatarUrl: null, onboardingRequired: true };
const params = { params: Promise.resolve({}) };
const request = (body: unknown, endpoint = "profile-completion") => new Request(`https://app.example.test/api/me/${endpoint}`, {
  method: "PATCH", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: JSON.stringify(body),
});
const read = async () => (await (await GET(new Request("https://app.example.test/api/me/profile-completion"), params)).json()).data;
const save = (snapshot: { versions: Record<string, string> }, group: string, values: unknown) => PATCH(request({ step: "SAVE", group, values, expectedVersion: snapshot.versions[group] }), params);
const finish = () => PATCH(request({ step: "FINISH", expectedUserId: actor.id }), params);
const required = { personalPhone: "(608) 555-0123", phone: "(608) 555-0123", wiscardCardNumber: "1234567890", wiscardIssueCode: "1", wiscardNumber: "12345678901", studentYearOverride: "FRESHMAN", topSizeFit: "MENS", topSize: "M", shoeSizeSystem: "US_WOMENS", shoeSize: "10" } as const;
function pauseTwoReads() {
  let ready!: () => void; let release!: () => void;
  const arrived = new Promise<void>((resolve) => { ready = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  gate = { remaining: 2, ready, released };
  return { arrived, release };
}

beforeEach(async () => {
  gate = null;
  await client.$executeRawUnsafe("DROP TRIGGER IF EXISTS onboarding_audit_failure ON audit_logs");
  await client.$executeRawUnsafe("TRUNCATE users CASCADE");
  await client.user.create({ data: { id: actor.id, name: actor.name, email: actor.email, passwordHash: "fixture-only", role: "STUDENT", onboardingRequired: true } });
  vi.mocked(requireAuth).mockResolvedValue(actor);
});
afterAll(() => client.$disconnect());

describe("onboarding account persistence and concurrency against PostgreSQL", () => {
  it("resumes partial answers and finishes without a photo; a lost Finish response can be replayed", async () => {
    let snapshot = await read();
    for (const [group, values] of [
      ["PERSONAL_PHONE", { personalPhone: "6085550123" }],
      ["WISCARD", { wiscardCardNumber: "1234567890", wiscardIssueCode: null }],
      ["WISCARD", { wiscardCardNumber: "1234567890", wiscardIssueCode: "1" }],
      ["STUDENT", { studentYearOverride: "FRESHMAN" }],
      ["CLOTHING", { topSizeFit: "MENS", topSize: null }],
      ["CLOTHING", { topSizeFit: "MENS", topSize: "M" }],
      ["SHOES", { shoeSizeSystem: "US_WOMENS", shoeSize: "10" }],
    ] as const) {
      const result = await save(snapshot, group, values);
      expect(result.status).toBe(200);
      snapshot = await read(); // A new client always hydrates from the account.
      expect(snapshot.completion.requiresSetup).toBe(true);
      if (group === "WISCARD" && values.wiscardIssueCode === null) expect(snapshot.completion.firstIncompleteStep).toBe("WISCARD");
    }
    expect(snapshot.completion).toMatchObject({ requiredComplete: true, onboardingComplete: false, firstIncompleteStep: "PHOTO" });
    expect((await finish()).status).toBe(200);
    const completed = await read();
    expect(completed.completion).toMatchObject({ requiresSetup: false, onboardingComplete: true, shouldPrompt: false });
    expect(completed.profile.avatarUrl).toBeNull();
    const receipt = completed.profile.onboardingCompletedAt;
    expect((await finish()).status).toBe(200);
    expect((await read()).profile.onboardingCompletedAt).toBe(receipt);
    expect(await client.auditLog.count({ where: { action: "onboarding_completed" } })).toBe(1);
  });

  it("blocks incomplete Finish and a Finish queued for another account", async () => {
    expect((await finish()).status).toBe(409);
    expect((await PATCH(request({ step: "FINISH", expectedUserId: "someone-else" }), params)).status).toBe(409);
    expect(await client.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ onboardingRequired: true, onboardingCompletedAt: null });
    expect(await client.auditLog.count()).toBe(0);
  });

  it("merges simultaneous saves to different groups from the same starting snapshot", async () => {
    const snapshot = await read(); const barrier = pauseTwoReads();
    const calls = [save(snapshot, "CLOTHING", { topSizeFit: "MENS", topSize: "M" }), save(snapshot, "SHOES", { shoeSizeSystem: "US_WOMENS", shoeSize: "10" })];
    await barrier.arrived; barrier.release();
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([200, 200]);
    expect(await client.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ topSizeFit: "MENS", topSize: "M", shoeSizeSystem: "US_WOMENS", shoeSize: "10" });
    expect(await client.auditLog.count()).toBe(2);
  });

  it("rejects the stale answer when two devices change the same group", async () => {
    const snapshot = await read(); const barrier = pauseTwoReads();
    const calls = [save(snapshot, "CLOTHING", { topSizeFit: "MENS", topSize: "M" }), save(snapshot, "CLOTHING", { topSizeFit: "WOMENS", topSize: "S" })];
    await barrier.arrived; barrier.release();
    expect((await Promise.all(calls)).map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await client.auditLog.count()).toBe(1);
  });

  it("replays an acknowledged answer without another audit and detects a changed legacy phone alias", async () => {
    const snapshot = await read();
    const values = { personalPhone: "6085550123" };
    expect((await save(snapshot, "PERSONAL_PHONE", values)).status).toBe(200);
    expect((await save(snapshot, "PERSONAL_PHONE", values)).status).toBe(200);
    expect(await client.auditLog.count()).toBe(1);
    const next = await read();
    await client.user.update({ where: { id: actor.id }, data: { phone: "(608) 555-9999" } });
    expect((await save(next, "PERSONAL_PHONE", values)).status).toBe(409);
    expect((await client.user.findUniqueOrThrow({ where: { id: actor.id } })).phone).toBe("(608) 555-9999");
  });

  it("rolls back answers and completion when their audit cannot commit", async () => {
    await client.$executeRawUnsafe("CREATE OR REPLACE FUNCTION onboarding_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$");
    await client.$executeRawUnsafe("CREATE TRIGGER onboarding_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION onboarding_fail_audit()");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await save(await read(), "CLOTHING", { topSizeFit: "MENS", topSize: "M" })).status).toBe(500);
      expect((await client.user.findUniqueOrThrow({ where: { id: actor.id } })).topSize).toBeNull();
      await client.user.update({ where: { id: actor.id }, data: required });
      expect((await finish()).status).toBe(500);
      expect(await client.user.findUniqueOrThrow({ where: { id: actor.id } })).toMatchObject({ onboardingRequired: true, onboardingCompletedAt: null });
      expect(await client.auditLog.count()).toBe(0);
    } finally { log.mockRestore(); }
  });

  it("lets an older client skip the photo through SNOOZE and records completion", async () => {
    await client.user.update({ where: { id: actor.id }, data: required });
    expect((await PATCH(request({ step: "SNOOZE" }), params)).status).toBe(200);
    const next = await read();
    expect(next.completion).toMatchObject({ onboardingComplete: true, shouldPrompt: false, requiresSetup: false });
    expect(next.profile.onboardingCompletedAt).not.toBeNull();
  });

  it("preserves checklist taps from simultaneous devices and ignores a replay", async () => {
    await client.user.update({ where: { id: actor.id }, data: { onboardingRequired: false, onboardingCompletedAt: new Date() } });
    vi.mocked(requireAuth).mockResolvedValue({ ...actor, onboardingRequired: false });
    const barrier = pauseTwoReads();
    const calls = [checklist(request({ done: ["guides"], expectedUserId: actor.id }, "getting-started"), params), checklist(request({ done: ["schedule"], dismissed: true, expectedUserId: actor.id }, "getting-started"), params)];
    await barrier.arrived; barrier.release();
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([200, 200]);
    expect((await client.user.findUniqueOrThrow({ where: { id: actor.id } })).gettingStarted).toMatchObject({ done: expect.arrayContaining(["guides", "schedule"]), dismissed: true });
    expect((await checklist(request({ done: ["guides"] }, "getting-started"), params)).status).toBe(200);
    expect(await client.auditLog.count({ where: { action: "getting_started_updated" } })).toBe(2);
    expect((await checklist(request({ done: ["crew"], expectedUserId: "another-account" }, "getting-started"), params)).status).toBe(409);
  });
});
