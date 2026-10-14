import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, transact, auth, audit } = vi.hoisted(() => ({
  tx: { asset: { findUnique: vi.fn(), update: vi.fn() } },
  transact: vi.fn(), auth: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAuth: auth }));
vi.mock("@/lib/db", () => ({ db: { $transaction: transact } }));
vi.mock("@/lib/audit", () => ({ createAuditEntryTx: audit, createAuditEntry: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
import { POST } from "@/app/api/assets/[id]/maintenance/route";

const version = "2026-10-03T15:00:00.000Z";
function request(body?: unknown) {
  return POST(new Request("https://app.example.com/api/assets/a1/maintenance", {
    method: "POST",
    headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ id: "a1" }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ id: "staff1", role: "STAFF", name: "Pat" });
  transact.mockImplementation((fn) => fn(tx));
  tx.asset.findUnique.mockResolvedValue({ id: "a1", status: "MAINTENANCE", updatedAt: new Date(version) });
  tx.asset.update.mockImplementation(({ data }) => ({ id: "a1", ...data }));
});

describe("maintenance release", () => {
  it("records an explicit release and its audit together", async () => {
    const response = await request({ status: "AVAILABLE", expectedUpdatedAt: version });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "AVAILABLE" } });
    expect(audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "cleared_maintenance", before: { status: "MAINTENANCE" }, after: { status: "AVAILABLE" },
    }));
  });

  it.each([
    ["a newer report or item change", "MAINTENANCE", "2026-10-03T15:01:00.000Z"],
    ["a retired item", "RETIRED", version],
  ])("rejects release after %s", async (_, status, updatedAt) => {
    tx.asset.findUnique.mockResolvedValue({ id: "a1", status, updatedAt: new Date(updatedAt) });
    expect((await request({ status: "AVAILABLE", expectedUpdatedAt: version })).status).toBe(409);
    expect(tx.asset.update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not toggle an explicit available request back into maintenance", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "a1", status: "AVAILABLE", updatedAt: new Date(version) });
    expect((await request({ status: "AVAILABLE", expectedUpdatedAt: version })).status).toBe(200);
    expect(tx.asset.update).not.toHaveBeenCalled();
  });

  it("preserves the bodyless toggle for existing native clients", async () => {
    expect((await request()).status).toBe(200);
    expect(tx.asset.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "AVAILABLE" } }));
  });

  it("rejects a malformed JSON body as a client error", async () => {
    const response = await POST(new Request("https://app.example.com/api/assets/a1/maintenance", {
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
      body: "{not json",
    }), { params: Promise.resolve({ id: "a1" }) });
    expect(response.status).toBe(400);
    expect(transact).not.toHaveBeenCalled();
  });

  it("denies students before any database mutation", async () => {
    auth.mockResolvedValue({ id: "student1", role: "STUDENT" });
    expect((await request({ status: "AVAILABLE", expectedUpdatedAt: version })).status).toBe(403);
    expect(transact).not.toHaveBeenCalled();
  });
});
