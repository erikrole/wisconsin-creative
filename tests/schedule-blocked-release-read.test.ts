import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({ editor: vi.fn(), preflight: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/services/schedule-working-copy", () => ({
  getWorkingScheduleEditor: mocks.editor, discardWorkingSchedule: vi.fn(), changeWorkingScheduleHistory: vi.fn(),
  getWorkingScheduleEventEndsAt: vi.fn(), mutateWorkingSchedule: vi.fn(), rebaseWorkingSchedule: vi.fn(),
}));
vi.mock("@/lib/services/schedule-publication", () => ({ getPublishPreflight: mocks.preflight, publishShiftGroup: vi.fn() }));
vi.mock("@/lib/schedule-auto-release", () => ({ enqueuePendingScheduleRelease: vi.fn() }));
vi.mock("@/lib/badges", () => ({ badges: {} }));
import { GET } from "@/app/api/shift-groups/[id]/working-copy/route";

async function read() {
  return GET(new Request("https://app.example.com/api/shift-groups/group/working-copy"), { params: Promise.resolve({ id: "group" }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ id: "staff", role: Role.STAFF });
  mocks.editor.mockResolvedValue({ workingVersion: 2, hasWorkingCopy: true, autoReleaseAt: "2026-08-17T22:43:40Z", autoReleaseError: "Old PHOTO conflict" });
  mocks.preflight.mockResolvedValue({ workingVersion: 2, staleness: null,
    blockers: [{ message: "Football vs Michigan State, Sat, Oct 3 (all day)" }] });
});
describe("blocked release read recovery", () => {
  it("explains an old failure using current preflight without a release attempt", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect((await response.json()).data.autoReleaseError).toContain("Football vs Michigan State");
    expect(mocks.preflight).toHaveBeenCalledWith("group");
  });
  it("does not attach a newer draft's diagnostics to an older editor", async () => {
    mocks.preflight.mockResolvedValue({ workingVersion: 3, staleness: null, blockers: [] });
    expect((await (await read()).json()).data.autoReleaseError).toContain("changed while release checks were loading");
  });
  it("does not imply release succeeded when the old blocker has disappeared", async () => {
    mocks.preflight.mockResolvedValue({ workingVersion: 2, staleness: null, blockers: [] });
    expect((await (await read()).json()).data.autoReleaseError).toContain("Previous release failed");
  });
  it("skips preflight for ordinary pending edits", async () => {
    mocks.editor.mockResolvedValue({ workingVersion: 2, hasWorkingCopy: true, autoReleaseError: null });
    expect((await read()).status).toBe(200);
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
  it("keeps diagnostics unavailable to students", async () => {
    mocks.auth.mockResolvedValue({ id: "student", role: Role.STUDENT });
    expect((await read()).status).toBe(403);
    expect(mocks.editor).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
  it("preserves intentionally retired drafts with no release timer", async () => {
    mocks.editor.mockResolvedValue({ workingVersion: 9, hasWorkingCopy: true, autoReleaseAt: null,
      autoReleaseError: "Retired when this event was combined into a shared crew." });
    expect((await (await read()).json()).data.autoReleaseError).toContain("Retired");
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
});
