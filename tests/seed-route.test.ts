import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { jsonRequest, routeCtx, authUser } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  db: { location: { findFirst: vi.fn() }, user: { upsert: vi.fn() } },
  hash: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));

async function loadRoute(env: { NODE_ENV?: string; SEED_ENDPOINT_ENABLED?: string; SEED_ADMIN_PASSWORD?: string }) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.NODE_ENV ?? "test");
  if (env.SEED_ENDPOINT_ENABLED === undefined) vi.stubEnv("SEED_ENDPOINT_ENABLED", "");
  else vi.stubEnv("SEED_ENDPOINT_ENABLED", env.SEED_ENDPOINT_ENABLED);
  if (env.SEED_ADMIN_PASSWORD === undefined) vi.stubEnv("SEED_ADMIN_PASSWORD", "");
  else vi.stubEnv("SEED_ADMIN_PASSWORD", env.SEED_ADMIN_PASSWORD);
  if (env.SEED_ADMIN_PASSWORD === undefined) delete process.env.SEED_ADMIN_PASSWORD;
  return (await import("@/app/api/seed/route")).POST;
}

const seed = (POST: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) =>
  POST(jsonRequest("/api/seed", "POST", {}), routeCtx({}));

beforeEach(() => {
  mocks.db.location.findFirst.mockResolvedValue({ id: "loc-1", name: "Camp Randall" });
  mocks.db.user.upsert.mockResolvedValue({ email: "admin@creative.local", name: "Creative Admin", role: "ADMIN" });
  mocks.hash.mockResolvedValue("hashed");
  mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/seed", () => {
  it("does not exist unless the seed endpoint is switched on", async () => {
    const POST = await loadRoute({});

    const res = await seed(POST);

    expect(res.status).toBe(404);
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
  });

  it("in development seeds the admin against the home venue and echoes the default login", async () => {
    const POST = await loadRoute({ NODE_ENV: "development", SEED_ENDPOINT_ENABLED: "true" });

    const res = await seed(POST);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.requireAuth).not.toHaveBeenCalled();
    expect(mocks.hash).toHaveBeenCalledWith("ChangeMeNow123!", 10);
    expect(mocks.db.location.findFirst).toHaveBeenCalledWith({ where: { isHomeVenue: true, active: true }, orderBy: { name: "asc" } });
    expect(mocks.db.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: "admin@creative.local" },
      create: expect.objectContaining({ role: "ADMIN", locationId: "loc-1", passwordHash: "hashed" }),
      update: { passwordHash: "hashed", role: "ADMIN", locationId: "loc-1" },
    }));
    expect(body.hint).toBe("Login with admin@creative.local / ChangeMeNow123!");
  });

  it("refuses to run before the canonical locations exist", async () => {
    const POST = await loadRoute({ NODE_ENV: "development", SEED_ENDPOINT_ENABLED: "true" });
    mocks.db.location.findFirst.mockResolvedValue(null);

    const res = await seed(POST);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/db:seed/);
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
  });

  it("in production needs a signed-in admin and an explicit password, and never echoes it", async () => {
    const POST = await loadRoute({ NODE_ENV: "production", SEED_ENDPOINT_ENABLED: "true", SEED_ADMIN_PASSWORD: "correct horse battery" });

    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await seed(POST)).status).toBe(403);
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(authUser(Role.ADMIN));
    const res = await seed(POST);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.hash).toHaveBeenCalledWith("correct horse battery", 10);
    expect(body).not.toHaveProperty("hint");
    expect(JSON.stringify(body)).not.toContain("correct horse battery");
  });

  it("in production refuses the publicly known default password", async () => {
    const POST = await loadRoute({ NODE_ENV: "production", SEED_ENDPOINT_ENABLED: "true" });

    const res = await seed(POST);

    expect(res.status).toBe(500);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.db.user.upsert).not.toHaveBeenCalled();
  });

  it("in production stays hidden when the switch is off, even for an admin", async () => {
    const POST = await loadRoute({ NODE_ENV: "production", SEED_ADMIN_PASSWORD: "x" });

    expect((await seed(POST)).status).toBe(404);
  });
});
