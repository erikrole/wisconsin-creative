import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    licenseCodeClaim: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { getClaimHistory } from "@/lib/services/licenses";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.licenseCodeClaim.findMany).mockResolvedValue([]);
});

describe("claim history query bounds", () => {
  it("bounds claim history service queries", async () => {
    await getClaimHistory("code-1", 100);

    expect(db.licenseCodeClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
