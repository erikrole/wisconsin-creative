import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckinReportType, Role } from "@prisma/client";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    bookingSerializedItem: {
      findUnique: vi.fn(),
    },
    scanEvent: {
      findFirst: vi.fn(),
    },
    checkinItemReport: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEntry: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  publicBlobAuth: () => ({ token: "test-public-store" }),
  validateImage: vi.fn(() => null),
  deleteImage: vi.fn(async () => undefined),
  isBlobUrl: vi.fn(() => true),
  imageExtensionForType: vi.fn(() => "jpg"),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

vi.mock("@/lib/services/booking-rules", () => ({
  requireBookingAction: vi.fn(),
}));

vi.mock("@/lib/services/notifications", () => ({
  notifyItemReport: vi.fn(async () => undefined),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteImage } from "@/lib/blob";
import { put } from "@vercel/blob";
import { requireBookingAction } from "@/lib/services/booking-rules";
import { POST as checkinReport } from "@/app/api/checkouts/[id]/checkin-report/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
};

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://app.example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(staffUser);
  vi.mocked(requireBookingAction).mockResolvedValue(
    { id: "booking-1", title: "Checkout" } as unknown as Awaited<ReturnType<typeof requireBookingAction>>,
  );
  vi.mocked(db.bookingSerializedItem.findUnique).mockResolvedValue({
    asset: { assetTag: "CAM-1", brand: "Sony", model: "FX3" },
  } as unknown as Awaited<ReturnType<typeof db.bookingSerializedItem.findUnique>>);
  vi.mocked(db.scanEvent.findFirst).mockResolvedValue(
    { id: "scan-1" } as unknown as Awaited<ReturnType<typeof db.scanEvent.findFirst>>,
  );
  vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue(null);
  vi.mocked(db.checkinItemReport.upsert).mockResolvedValue({
    id: "report-1",
    type: CheckinReportType.DAMAGED,
    description: "Scratched",
    imageUrl: null,
  } as unknown as Awaited<ReturnType<typeof db.checkinItemReport.upsert>>);
  vi.mocked(put).mockResolvedValue(
    { url: "https://blob.example.com/new.jpg" } as unknown as Awaited<ReturnType<typeof put>>,
  );
});

describe("check-in report route", () => {
  it("rejects duplicate check-in reports inside the five-second window", async () => {
    vi.mocked(db.checkinItemReport.findUnique).mockResolvedValue({
      imageUrl: null,
      createdAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof db.checkinItemReport.findUnique>>);

    const res = await checkinReport(
      post("/api/checkouts/booking-1/checkin-report", {
        assetId: "cm111111111111111111111111",
        type: "DAMAGED",
        description: "Scratched",
      }),
      { params: Promise.resolve({ id: "booking-1" }) },
    );

    expect(res.status).toBe(409);
    expect(db.checkinItemReport.upsert).not.toHaveBeenCalled();
  });

  it("deletes newly uploaded report images when report persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(db.checkinItemReport.upsert).mockRejectedValue(new Error("db down"));
    const file = new File(["image"], "damage.jpg", { type: "image/jpeg" });
    const form = new FormData();
    form.set("assetId", "cm111111111111111111111111");
    form.set("type", "DAMAGED");
    form.set("description", "Scratched");
    form.set("file", file);
    const req = new Request("https://app.example.com/api/checkouts/booking-1/checkin-report", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      body: form,
    });

    const res = await checkinReport(req, { params: Promise.resolve({ id: "booking-1" }) });

    expect(res.status).toBe(500);
    expect(deleteImage).toHaveBeenCalledWith("https://blob.example.com/new.jpg");
    consoleError.mockRestore();
  });
});
