import { beforeEach, describe, expect, it, vi } from "vitest";
import { LicenseCodeStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/services/notifications", () => ({ sendPushToUser: vi.fn() }));

import { reportBrokenCode } from "@/lib/services/licenses";

type Candidate = {
  id: string;
  status: LicenseCodeStatus;
  expiresAt: Date | null;
  createdAt: Date;
  code: string;
  claims: Array<{ id: string }>;
};

function makeTx(opts: { held?: boolean; other?: { userId: string } | null; candidates?: Candidate[] }) {
  const held = opts.held ?? true;
  return {
    licenseCodeClaim: {
      findFirst: vi
        .fn()
        // First call: the reporter's own active claim. Second: any remaining holder.
        .mockResolvedValueOnce(held ? { id: "claim-1", licenseCodeId: "bad", userId: "u1", releasedAt: null } : null)
        .mockResolvedValueOnce(opts.other ? { userId: opts.other.userId, claimedAt: new Date("2026-10-01") } : null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    licenseCode: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        code: `CODE-${where.id}`,
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue(opts.candidates ?? []),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
  };
}

function run(tx: ReturnType<typeof makeTx>) {
  mocks.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return reportBrokenCode("bad", "u1", "STUDENT");
}

const cand = (id: string, status: LicenseCodeStatus, claims: number, expiresAt: string | null): Candidate => ({
  id,
  status,
  expiresAt: expiresAt ? new Date(expiresAt) : null,
  createdAt: new Date("2026-01-01"),
  code: `CODE-${id}`,
  claims: Array.from({ length: claims }, (_, i) => ({ id: `${id}-c${i}` })),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockReset();
});

describe("reportBrokenCode", () => {
  it("rejects a code the caller doesn't hold", async () => {
    await expect(run(makeTx({ held: false }))).rejects.toMatchObject({ status: 404 });
  });

  it("releases the seat, retires and stamps the bad code, and hands over the best open code", async () => {
    const tx = makeTx({
      candidates: [
        cand("fresh-long", LicenseCodeStatus.AVAILABLE, 0, "2027-12-31T00:00:00.000Z"),
        cand("half-used", LicenseCodeStatus.PARTIAL, 1, "2027-01-01T00:00:00.000Z"),
      ],
    });
    const result = await run(tx);

    expect(tx.licenseCodeClaim.update).toHaveBeenCalledWith({
      where: { id: "claim-1" },
      data: expect.objectContaining({ notes: "Reported not working" }),
    });
    expect(tx.licenseCode.update).toHaveBeenCalledWith({
      where: { id: "bad" },
      data: expect.objectContaining({
        status: LicenseCodeStatus.RETIRED,
        reportedBrokenById: "u1",
        reportedBrokenAt: expect.any(Date),
      }),
    });
    // Half-used code wins over a fresh one so whole codes stay free.
    expect(result.replacement?.id).toBe("half-used");
    expect(tx.licenseCodeClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ licenseCodeId: "half-used", userId: "u1" }),
    });
    expect(tx.licenseCode.update).toHaveBeenCalledWith({
      where: { id: "half-used" },
      data: expect.objectContaining({ status: LicenseCodeStatus.CLAIMED }),
    });
  });

  it("skips full candidates and still flags the code when nothing else is open", async () => {
    const tx = makeTx({ candidates: [cand("full", LicenseCodeStatus.PARTIAL, 2, null)] });
    const result = await run(tx);

    expect(result.replacement).toBeNull();
    expect(tx.licenseCodeClaim.create).not.toHaveBeenCalled();
    expect(tx.licenseCode.update).toHaveBeenCalledTimes(1);
  });

  it("keeps the other seat holder on the bad code's record", async () => {
    const tx = makeTx({ other: { userId: "u2" } });
    await run(tx);
    expect(tx.licenseCode.update).toHaveBeenCalledWith({
      where: { id: "bad" },
      data: expect.objectContaining({ claimedById: "u2" }),
    });
  });
});
