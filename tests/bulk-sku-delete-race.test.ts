import { expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/api", () => ({ withAuth: (handler: (req: Request, context: unknown) => Promise<unknown>) => (req: Request) => handler(req, { user: { id: "admin", role: "ADMIN" }, params: { id: "sku" } }) }));
vi.mock("@/lib/db", () => ({ db: { bulkSku: { findUnique: async () => ({ id: "sku", name: "Synthetic batteries" }), delete: mocks.remove }, bookingBulkItem: { count: async () => 0 } } }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mocks.audit }));
import { DELETE } from "@/app/api/bulk-skus/[id]/route";
it("returns a friendly conflict when booking history appears after the precheck", async () => {
  mocks.remove.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Foreign key constraint", { code: "P2003", clientVersion: "6.19.2" }));
  await expect(DELETE(new Request("http://localhost/api/bulk-skus/sku", { method: "DELETE" }), { params: Promise.resolve({ id: "sku" }) })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Archive it instead") });
  expect(mocks.audit).not.toHaveBeenCalled();
});
