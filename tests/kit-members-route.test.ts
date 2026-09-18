import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/services/kits", () => ({
  addKitMembers: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { MAX_EQUIPMENT_SELECTIONS_PER_REQUEST } from "@/lib/request-limits";
import { addKitMembers } from "@/lib/services/kits";
import { POST } from "@/app/api/kits/[id]/members/route";

const user = {
  id: "cm000000000000000000000001",
  email: "admin@test.com",
  name: "Admin",
  role: Role.ADMIN,
  avatarUrl: null,
};

const routeParams = {
  params: Promise.resolve({ id: "cm000000000000000000000010" }),
};

function request(assetIds: string[]) {
  return new Request("https://app.example.com/api/kits/cm000000000000000000000010/members", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify({ assetIds }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(addKitMembers).mockResolvedValue({ kit: { id: "kit-1", members: [] }, addedAssetIds: [] } as never);
});

describe("POST /api/kits/[id]/members", () => {
  it("accepts the exact member ceiling in one service call", async () => {
    const assetIds = Array.from(
      { length: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST },
      (_, index) => `asset-${index}`,
    );

    const res = await POST(request(assetIds), routeParams);

    expect(res.status).toBe(200);
    expect(addKitMembers).toHaveBeenCalledTimes(1);
    expect(addKitMembers).toHaveBeenCalledWith(
      "cm000000000000000000000010",
      assetIds,
      user.id,
      user.role,
    );
  });

  it("rejects max plus one before calling the kit service", async () => {
    const assetIds = Array.from(
      { length: MAX_EQUIPMENT_SELECTIONS_PER_REQUEST + 1 },
      (_, index) => `asset-${index}`,
    );

    const res = await POST(request(assetIds), routeParams);

    expect(res.status).toBe(400);
    expect(addKitMembers).not.toHaveBeenCalled();
  });
});
