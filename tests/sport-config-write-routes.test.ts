import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getAll: vi.fn(),
  get: vi.fn(),
  upsert: vi.fn(),
  toggle: vi.fn(),
  upsertGroup: vi.fn(),
  audit: vi.fn(),
  rebase: vi.fn(),
  syncCallTimes: vi.fn(),
  notifyWorkers: vi.fn(),
  notifyFollowers: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/services/sport-configs", () => ({
  getAllSportConfigs: mocks.getAll,
  getSportConfig: mocks.get,
  upsertSportConfig: mocks.upsert,
  toggleSportConfig: mocks.toggle,
  upsertSportConfigsForGroup: mocks.upsertGroup,
}));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 10, windowMs: 60_000 },
}));
vi.mock("@/lib/services/shift-generation", () => ({ rebaseUpcomingShiftsForSportCodes: mocks.rebase }));
vi.mock("@/lib/services/schedule-call-time-sync", () => ({ syncCurrentSportCallTimes: mocks.syncCallTimes }));
vi.mock("@/lib/services/notifications", () => ({
  notifyPublishedShiftGroupWorkers: mocks.notifyWorkers,
  notifyPublishedScheduleFollowers: mocks.notifyFollowers,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { GET as listConfigs, POST as createConfig } from "@/app/api/sport-configs/route";
import { POST as updateGroup } from "@/app/api/sport-configs/group/route";
import { PATCH as updateConfig } from "@/app/api/sport-configs/[sportCode]/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const existing = {
  id: "sc-vb",
  sportCode: "VB",
  active: true,
  shiftConfigs: [{ id: "row-1", area: "VIDEO", homeCount: 2, awayCount: 1, homeStaffCount: 1, homeStudentCount: 1, awayStaffCount: 1, awayStudentCount: 0 }],
};
const published = { publishedChanges: [{ shiftGroupId: "group-1", affectedUserIds: ["u1"] }] };

function send(method: string, path: string, body: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

async function runAfterWork() {
  for (const [work] of mocks.after.mock.calls) await (work as () => Promise<unknown>)();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.getAll.mockResolvedValue([existing]);
  mocks.get.mockResolvedValue(existing);
  mocks.upsert.mockImplementation(async (sportCode: string, active: boolean) => ({ ...existing, sportCode, active }));
  mocks.toggle.mockImplementation(async (sportCode: string, active: boolean) => ({ ...existing, sportCode, active }));
  mocks.upsertGroup.mockResolvedValue([{ id: "sc-mxc" }, { id: "sc-wxc" }]);
  mocks.rebase.mockResolvedValue({ updated: 4 });
  mocks.syncCallTimes.mockResolvedValue({ publishedChanges: [] });
  mocks.notifyWorkers.mockResolvedValue(undefined);
  mocks.notifyFollowers.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe("/api/sport-configs", () => {
  it("lists every sport's defaults", async () => {
    const { body } = await json(await listConfigs(new Request("https://app.example.com/api/sport-configs"), { params: Promise.resolve({}) }));

    expect(body).toEqual({ data: [existing] });
  });

  it("creates defaults as active with no shifts unless told otherwise", async () => {
    const { status, body } = await json(await createConfig(send("POST", "/api/sport-configs", { sportCode: "vb" }), { params: Promise.resolve({}) }));

    expect(status).toBe(201);
    expect(mocks.upsert).toHaveBeenCalledWith("VB", true, [], undefined, undefined);
    expect(mocks.syncCallTimes).not.toHaveBeenCalled();
    expect(body).toEqual(expect.objectContaining({ callTimes: null, callTimesFailed: false }));
  });

  it("moves current call times and tells the crew on published schedules", async () => {
    mocks.syncCallTimes.mockResolvedValue(published);

    await createConfig(send("POST", "/api/sport-configs", { sportCode: "VB", shiftStartOffset: 90 }), { params: Promise.resolve({}) });
    await runAfterWork();

    expect(mocks.syncCallTimes).toHaveBeenCalledWith(["VB"], { actor: staff });
    expect(mocks.notifyWorkers).toHaveBeenCalledWith("group-1", ["u1"]);
    expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
  });

  it("still saves the defaults when moving call times fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.syncCallTimes.mockRejectedValue(new Error("busy"));

    const { status, body } = await json(await createConfig(send("POST", "/api/sport-configs", { sportCode: "VB", shiftEndOffset: 60 }), { params: Promise.resolve({}) }));

    expect(status).toBe(201);
    expect(body.callTimesFailed).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ after: expect.objectContaining({ callTimesFailed: true }) }));
    expect(mocks.after).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });

    expect((await createConfig(send("POST", "/api/sport-configs", { sportCode: "VB" }), { params: Promise.resolve({}) })).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/sport-configs/[sportCode]", () => {
  const params = { params: Promise.resolve({ sportCode: "vb" }) };

  it("only flips active when that is the whole change", async () => {
    const { body } = await json(await updateConfig(send("PATCH", "/api/sport-configs/vb", { active: false }), params));

    expect(mocks.toggle).toHaveBeenCalledWith("VB", false);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(body.data.active).toBe(false);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "sc-vb", before: { active: true } }));
  });

  it("keeps the current shift counts when only the call offsets change", async () => {
    await updateConfig(send("PATCH", "/api/sport-configs/vb", { shiftStartOffset: 60 }), params);

    expect(mocks.upsert).toHaveBeenCalledWith("VB", true, [
      { area: "VIDEO", homeCount: 2, awayCount: 1, homeStaffCount: 1, homeStudentCount: 1, awayStaffCount: 1, awayStudentCount: 0 },
    ], 60, undefined);
    expect(mocks.syncCallTimes).toHaveBeenCalledWith(["VB"], { actor: staff });
  });

  it("saves nothing new for an empty change", async () => {
    const { body } = await json(await updateConfig(send("PATCH", "/api/sport-configs/vb", {}), params));

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.toggle).not.toHaveBeenCalled();
    expect(body.data).toEqual(existing);
  });

  it("returns 404 for a sport with no defaults", async () => {
    mocks.get.mockResolvedValue(null);

    expect((await updateConfig(send("PATCH", "/api/sport-configs/vb", { active: false }), params)).status).toBe(404);
  });
});

describe("POST /api/sport-configs/group", () => {
  const noParams = { params: Promise.resolve({}) };

  it("updates every sport in the group and rebases upcoming shifts", async () => {
    const shiftConfigs = [{ area: "VIDEO", homeCount: 1, awayCount: 0 }];
    const { body } = await json(await updateGroup(send("POST", "/api/sport-configs/group", { codes: ["mxc", "wxc"], shiftConfigs }), noParams));

    expect(mocks.upsertGroup).toHaveBeenCalledWith(["MXC", "WXC"], { active: undefined, shiftConfigs, shiftStartOffset: undefined, shiftEndOffset: undefined });
    expect(mocks.rebase).toHaveBeenCalledWith(["MXC", "WXC"]);
    expect(body).toEqual(expect.objectContaining({ rebase: { updated: 4 }, rebaseFailed: false, callTimes: null }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "MXC,WXC", action: "sport_config_group_updated" }));
  });

  it("does not rebase shifts for a group being turned off", async () => {
    await updateGroup(send("POST", "/api/sport-configs/group", { codes: ["MXC", "WXC"], active: false, shiftStartOffset: 30 }), noParams);

    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.syncCallTimes).toHaveBeenCalledWith(["MXC", "WXC"], { actor: staff });
  });

  it("reports a failed rebase and a failed call-time move without undoing the save", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rebase.mockRejectedValue(new Error("rebase"));
    mocks.syncCallTimes.mockRejectedValue(new Error("sync"));

    const { status, body } = await json(await updateGroup(send("POST", "/api/sport-configs/group", { codes: ["MXC"], active: true, shiftEndOffset: 30 }), noParams));

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ rebaseFailed: true, callTimesFailed: true }));
    consoleError.mockRestore();
  });

  it("logs a notification that fails without failing the others", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.syncCallTimes.mockResolvedValue(published);
    mocks.notifyWorkers.mockRejectedValue(new Error("push down"));

    await updateGroup(send("POST", "/api/sport-configs/group", { codes: ["MXC"], shiftStartOffset: 45 }), noParams);
    await runAfterWork();

    expect(mocks.notifyFollowers).toHaveBeenCalledWith("group-1");
    expect(consoleError).toHaveBeenCalledWith("Published schedule call-time notification failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it.each([
    ["no change", { codes: ["MXC"] }],
    ["a repeated sport", { codes: ["MXC", "mxc"], active: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await updateGroup(send("POST", "/api/sport-configs/group", body), noParams)).status).toBe(400);
    expect(mocks.upsertGroup).not.toHaveBeenCalled();
  });
});
