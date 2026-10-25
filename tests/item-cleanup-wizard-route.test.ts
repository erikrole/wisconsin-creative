import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  counts: vi.fn(),
  queue: vi.fn(),
  qr: vi.fn(),
  serial: vi.fn(),
  attach: vi.fn(),
  defer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/services/item-cleanup-wizard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/item-cleanup-wizard")>()),
  getCleanupWizardCounts: mocks.counts,
  listCleanupWizardQueue: mocks.queue,
  applyCleanupWizardQr: mocks.qr,
  applyCleanupWizardSerial: mocks.serial,
  applyCleanupWizardAttach: mocks.attach,
  deferCleanupWizardItem: mocks.defer,
}));

import { GET, POST } from "@/app/api/items/cleanup-wizard/route";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const counts = { legacy_qr: 4, missing_serial: 2, attachment_candidate: 1 };
const assetId = "casset00001";
const actor = { id: "staff-1", role: Role.STAFF };

async function queue(query = "") {
  const response = await GET(new Request(`https://app.example.com/api/items/cleanup-wizard${query}`), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

async function act(body: Record<string, unknown>) {
  const response = await POST(new Request("https://app.example.com/api/items/cleanup-wizard", {
    method: "POST",
    headers: { "content-type": "application/json", host: "app.example.com", origin: "https://app.example.com" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.counts.mockResolvedValue(counts);
  mocks.queue.mockResolvedValue([{ id: assetId }]);
  mocks.qr.mockResolvedValue({ id: assetId, qr: "set" });
  mocks.serial.mockResolvedValue({ id: assetId, serial: "set" });
  mocks.attach.mockResolvedValue({ id: assetId, attached: true });
  mocks.defer.mockResolvedValue({ deferred: true });
});

describe("GET /api/items/cleanup-wizard", () => {
  it("returns only the counts without a queue", async () => {
    const { body } = await queue();

    expect(body).toEqual({ data: { counts } });
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("lists a queue, skipping items already shown", async () => {
    const { body } = await queue("?kind=legacy_qr&limit=3&exclude=a, b,,c");

    expect(body.data).toEqual({ counts, kind: "legacy_qr", items: [{ id: assetId }] });
    expect(mocks.queue).toHaveBeenCalledWith("legacy_qr", 3, ["a", "b", "c"]);
  });

  it("defaults to eight items and caps the skip list at one hundred", async () => {
    const exclude = Array.from({ length: 120 }, (_, index) => `id${index}`).join(",");

    await queue(`?kind=missing_serial&exclude=${exclude}`);

    const [, limit, skipped] = mocks.queue.mock.calls[0]!;
    expect(limit).toBe(8);
    expect(skipped).toHaveLength(100);
  });

  it.each([
    ["an unknown queue", "?kind=everything", "Unknown cleanup queue"],
    ["too many items", "?kind=legacy_qr&limit=26", undefined],
  ])("rejects %s", async (_label, query, message) => {
    const { response, body } = await queue(query);

    expect(response.status).toBe(400);
    if (message) expect(body.error).toBe(message);
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });

    expect((await queue()).response.status).toBe(403);
    expect(mocks.counts).not.toHaveBeenCalled();
  });
});

describe("POST /api/items/cleanup-wizard", () => {
  it.each([
    ["set_qr", { code: " CHQ-9 " }, mocks.qr, { assetId, code: "CHQ-9", actor }],
    ["set_serial", { serialNumber: "SN-1" }, mocks.serial, { assetId, serialNumber: "SN-1", actor }],
    ["attach", { parentAssetId: "cparent0001" }, mocks.attach, { assetId, parentAssetId: "cparent0001", actor }],
  ])("applies %s and returns fresh counts", async (action, fields, service, expected) => {
    const { body } = await act({ action, assetId, ...fields });

    expect(service).toHaveBeenCalledWith(expected);
    expect(body.data).toEqual({ item: await service.mock.results[0]!.value, counts });
  });

  it("sets an item aside with its reason", async () => {
    const { body } = await act({ action: "defer", assetId, kind: "missing_serial", reason: "no_serial" });

    expect(mocks.defer).toHaveBeenCalledWith({ assetId, kind: "missing_serial", reason: "no_serial", actor });
    expect(body.data).toEqual({ deferred: true, counts });
  });

  it("rejects an unknown action or an empty code", async () => {
    expect((await act({ action: "delete", assetId })).response.status).toBe(400);
    expect((await act({ action: "set_qr", assetId, code: "  " })).response.status).toBe(400);
    expect(mocks.qr).not.toHaveBeenCalled();
  });
});
