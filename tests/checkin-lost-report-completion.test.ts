import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/badges", () => ({ badges: {} }));
vi.mock("@/lib/services/live-activities", () => ({ endCheckoutReturnLiveActivities: vi.fn() }));

import { maybeAutoComplete } from "@/lib/services/bookings-checkin";

describe("return completion with a LOST report", () => {
  it("does not count an item with a LOST report on this booking as still out", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const tx = {
      bookingSerializedItem: { count },
      bookingBulkItem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(maybeAutoComplete(tx as never, "co-1", "loc-1", "u1", { auditAction: "x" })).resolves.toBeNull();
    expect(count).toHaveBeenCalledWith({
      where: {
        bookingId: "co-1",
        allocationStatus: "active",
        asset: { checkinReports: { none: { bookingId: "co-1", type: "LOST" } } },
      },
    });
  });
});
