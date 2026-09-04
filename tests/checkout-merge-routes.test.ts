import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/bookings", () => ({
  mergeCheckouts: vi.fn(),
  previewCheckoutMerge: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
  deferCompanionProjectionRefreshForCommittedMutation: vi.fn(),
}));

vi.mock("@/lib/live-activity-workflow", () => ({
  scheduleCheckoutReturnLiveActivity: vi.fn(),
}));

vi.mock("@/lib/services/live-activities", () => ({
  updateCheckoutReturnLiveActivities: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { mergeCheckouts, previewCheckoutMerge } from "@/lib/services/bookings";
import { scheduleCheckoutReturnLiveActivity } from "@/lib/live-activity-workflow";
import { updateCheckoutReturnLiveActivities } from "@/lib/services/live-activities";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { POST as postCheckoutMerge } from "@/app/api/checkouts/merge/route";
import { POST as postCheckoutMergePreview } from "@/app/api/checkouts/merge/preview/route";

const ids = ["cm000000000000000000000001", "cm000000000000000000000002"];
const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: Role.ADMIN,
  avatarUrl: null,
};

function post(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ ids }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  vi.mocked(previewCheckoutMerge).mockResolvedValue({
    targetCheckoutId: ids[0]!,
    sourceCheckoutIds: [ids[1]!],
    title: "Volleyball Photo",
    requesterUserId: "requester-1",
    custodyScope: "PERSON",
    eventIds: ["event-1"],
    serializedItemCount: 0,
    bulkQuantity: 3,
  } as never);
  vi.mocked(mergeCheckouts).mockResolvedValue({
    id: ids[0]!,
    status: "OPEN",
    title: "Volleyball Photo",
    endsAt: new Date("2026-09-05T04:00:00.000Z"),
  } as never);
});

describe("checkout merge routes", () => {
  it("previews only through the staff checkout permission", async () => {
    const response = await postCheckoutMergePreview(post("/api/checkouts/merge/preview"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(200);
    expect(previewCheckoutMerge).toHaveBeenCalledWith(ids);
  });

  it("merges through the service and refreshes the surviving return activity", async () => {
    const req = post("/api/checkouts/merge");
    const response = await postCheckoutMerge(req, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(mergeCheckouts).toHaveBeenCalledWith({
      ids,
      actorUserId: adminUser.id,
      actorRole: Role.ADMIN,
    });
    expect(deferCompanionProjectionRefreshForCommittedMutation).toHaveBeenCalledWith(req);
    expect(updateCheckoutReturnLiveActivities).toHaveBeenCalledWith({
      bookingId: ids[0],
      endsAt: new Date("2026-09-05T04:00:00.000Z"),
    });
    expect(scheduleCheckoutReturnLiveActivity).toHaveBeenCalledWith({
      bookingId: ids[0],
      endsAt: new Date("2026-09-05T04:00:00.000Z"),
    });
    expect(body.meta.mergedCheckoutIds).toEqual([ids[1]]);
  });

  it("denies merge preview to non-staff actors", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...adminUser, role: Role.STUDENT } as never);

    const response = await postCheckoutMergePreview(post("/api/checkouts/merge/preview"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(403);
    expect(previewCheckoutMerge).not.toHaveBeenCalled();
  });
});
