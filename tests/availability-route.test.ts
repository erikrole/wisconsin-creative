import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("@/lib/services/availability", () => ({
  checkAvailability: vi.fn(),
  getBulkAvailability: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { checkAvailability, getBulkAvailability } from "@/lib/services/availability";
import { POST } from "@/app/api/availability/check/route";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin One",
  role: "ADMIN" as const,
  avatarUrl: null,
};

function malformedPost() {
  return new Request("https://app.example.com/api/availability/check", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: "{not-json",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminUser);
});

function checkPost(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/availability/check", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  locationId: "ckzq6q6qq0000qzrmn831i7rn",
  startsAt: "2026-08-01T10:00:00.000Z",
  endsAt: "2026-08-01T18:00:00.000Z",
  serializedAssetIds: ["ckzq6q6qq0001qzrmn831i7rn"],
  bulkItems: [],
};

const emptyAvailability = {
  conflicts: [],
  shortages: [],
  unavailableAssets: [],
  upcomingCommitments: [],
  turnaroundRisks: [],
  bulkTurnaroundRisks: [],
};

describe("POST /api/availability/check", () => {
  it("rejects malformed JSON before checking availability", async () => {
    const res = await POST(malformedPost(), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  // ── REGRESSION: preflight must apply the same per-kind gating as the save.
  // Without kind, the wizard said "available" for an asset flagged
  // not-available-for-reservation, then the create 409'd. ──
  it("passes kind through to per-kind availability gating", async () => {
    vi.mocked(checkAvailability).mockResolvedValue(emptyAvailability);
    vi.mocked(getBulkAvailability).mockResolvedValue({});

    const res = await POST(
      checkPost({ ...validBody, kind: "RESERVATION" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(checkAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bookingKind: "RESERVATION" }),
    );
  });

  it("keeps legacy behavior when kind is omitted (older clients)", async () => {
    vi.mocked(checkAvailability).mockResolvedValue(emptyAvailability);
    vi.mocked(getBulkAvailability).mockResolvedValue({});

    const res = await POST(checkPost(validBody), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(checkAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bookingKind: undefined }),
    );
  });

  it("rejects an invalid kind value", async () => {
    const res = await POST(
      checkPost({ ...validBody, kind: "DRAFT" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    expect(checkAvailability).not.toHaveBeenCalled();
  });
});

describe("availability preflight client contract", () => {
  const source = (relativeFile: string) =>
    readFileSync(path.join(process.cwd(), relativeFile), "utf8");

  it("web preflight callers send their booking kind", () => {
    expect(source("src/components/booking-wizard/WizardStep2.tsx"))
      .toContain('bookingKind="RESERVATION"');
    expect(source("src/components/BookingDetailsSheet.tsx"))
      .toContain("bookingKind={booking.kind");
    expect(source("src/app/(app)/bookings/BookingEquipmentTab.tsx"))
      .toContain('kind: booking.kind');
    expect(source("src/components/equipment-picker/use-conflict-check.ts"))
      .toContain("kind: bookingKind");
  });

  it("keeps the top-level availability response visible to web previews", () => {
    expect(source("src/components/equipment-picker/use-conflict-check.ts"))
      .toContain("const data = json;");
    expect(source("src/components/equipment-picker/use-conflict-check.ts"))
      .not.toContain("const data = json?.data;");
    expect(source("src/app/(app)/bookings/BookingEquipmentTab.tsx"))
      .toContain("const data = json;");
  });

  it("checks visible picker rows before they are selected", () => {
    const picker = source("src/components/EquipmentPicker.tsx");

    expect(picker).toContain("sectionResults.map((asset) => asset.id)");
    expect(picker).toContain("assetIds: conflictPreviewAssetIds");
    expect(picker).toContain("for (const sku of sectionBulk)");
    expect(picker).toContain("bulkItems: bulkPreviewItems");
  });

  it("keeps selected-item timing copy aligned with the picker rows", () => {
    const shelf = source("src/components/equipment-picker/SelectedEquipmentShelf.tsx");

    expect(shelf).toContain('"Needed next"');
    expect(shelf).toContain("upcomingCommitmentLabel(upcoming, currentEndsAt)");
    expect(shelf).toContain("availabilityRiskBadgeLabel(risk!)");
  });

  it("picker holder lookup covers every blocking booking status", () => {
    expect(source("src/app/api/assets/picker-search/route.ts"))
      .toContain('status: { in: ["BOOKED", "PENDING_PICKUP", "OPEN"] }');
  });
});
