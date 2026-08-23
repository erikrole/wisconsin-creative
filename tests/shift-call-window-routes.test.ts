import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { PATCH as patchShift } from "@/app/api/shifts/[id]/route";
import { PATCH as patchAssignment } from "@/app/api/shift-assignments/[id]/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: "STAFF" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

function patchRequest(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({
      callStartsAt: "2026-07-07T14:15:00.000Z",
      callEndsAt: "2026-07-07T15:30:00.000Z",
    }),
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("retired live call-window routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
  });

  it("directs slot call-window edits to the Event working schedule", async () => {
    const res = await patchShift(
      patchRequest("/api/shifts/shift-1"),
      routeParams("shift-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain("private working schedule editor");
  });

  it("directs personal call-window edits to the Event working schedule", async () => {
    const res = await patchAssignment(
      patchRequest("/api/shift-assignments/assignment-1"),
      routeParams("assignment-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain("private working schedule editor");
  });

  it("still checks permission before disclosing the retired mutation contract", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...staffUser, id: "student-1", role: "STUDENT" });

    const res = await patchAssignment(
      patchRequest("/api/shift-assignments/assignment-1"),
      routeParams("assignment-1"),
    );

    expect(res.status).toBe(403);
  });
});
