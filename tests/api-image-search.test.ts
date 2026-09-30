import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { HttpError } from "@/lib/http";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/image-search", () => ({
  getImageSearchProviderName: vi.fn(),
  isImageSearchConfigured: vi.fn(),
  normalizeImageSearchQuery: vi.fn((query: string) => query.replace(/\s+/g, " ").trim()),
  searchProductImages: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  getImageSearchProviderName,
  isImageSearchConfigured,
  normalizeImageSearchQuery,
  searchProductImages,
} from "@/lib/image-search";
import { GET } from "@/app/api/image-search/route";

const staffUser = {
  id: "staff-1",
  email: "staff@example.com",
  name: "Staff One",
  role: Role.STAFF,
  avatarUrl: null,
  forcePasswordChange: false,
};

const studentUser = {
  ...staffUser,
  id: "student-1",
  role: Role.STUDENT,
};

function get(path: string) {
  return new Request(`https://app.example.com${path}`, {
    method: "GET",
    headers: { host: "app.example.com" },
  });
}

async function call(path: string) {
  return GET(get(path), { params: Promise.resolve({}) });
}

describe("GET /api/image-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.mocked(requireAuth).mockResolvedValue(staffUser);
    vi.mocked(enforceRateLimit).mockResolvedValue(undefined);
    vi.mocked(getImageSearchProviderName).mockReturnValue("brave");
    vi.mocked(isImageSearchConfigured).mockReturnValue(true);
    vi.mocked(searchProductImages).mockResolvedValue({
      status: "ok",
      provider: "brave",
      results: [
        {
          id: "result-1",
          url: "https://images.example/fx3.jpg",
          thumbnailUrl: "https://images.example/fx3-thumb.jpg",
          title: "Sony FX3 product photo",
          sourceUrl: "https://manufacturer.example/fx3",
          sourceDomain: "manufacturer.example",
          width: 1200,
          height: 800,
        },
      ],
    });
  });

  afterEach(() => {
    vi.mocked(console.info).mockRestore();
  });

  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new HttpError(401, "Unauthorized"));

    const res = await call("/api/image-search?probe=1");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("forbids students before provider calls", async () => {
    vi.mocked(requireAuth).mockResolvedValue(studentUser);

    const res = await call("/api/image-search?q=Sony+FX3");

    expect(res.status).toBe(403);
    expect(searchProductImages).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns provider status for probe requests without spending quota", async () => {
    const res = await call("/api/image-search?probe=1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        configured: true,
        provider: "brave",
      },
    });
    expect(searchProductImages).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects missing search query", async () => {
    const res = await call("/api/image-search");

    expect(res.status).toBe(400);
    expect(searchProductImages).not.toHaveBeenCalled();
  });

  it("rate limits user search requests and returns mapped results", async () => {
    const res = await call("/api/image-search?q=%20Sony%20%20FX3%20");

    expect(res.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledWith("image-search:staff-1", { max: 30, windowMs: 60_000 });
    expect(normalizeImageSearchQuery).toHaveBeenCalledWith("Sony  FX3");
    expect(searchProductImages).toHaveBeenCalledWith("Sony FX3");
    expect(console.info).toHaveBeenCalledWith("image-search", {
      provider: "brave",
      status: "ok",
      resultCount: 1,
      latencyMs: expect.any(Number),
      quotaExceeded: false,
    });
    expect(await res.json()).toEqual({
      data: {
        configured: true,
        provider: "brave",
        quotaExceeded: false,
        results: [
          {
            id: "result-1",
            url: "https://images.example/fx3.jpg",
            thumbnailUrl: "https://images.example/fx3-thumb.jpg",
            title: "Sony FX3 product photo",
            sourceUrl: "https://manufacturer.example/fx3",
            sourceDomain: "manufacturer.example",
            width: 1200,
            height: 800,
          },
        ],
      },
    });
  });

  it("returns an empty no-provider response when unconfigured", async () => {
    vi.mocked(getImageSearchProviderName).mockReturnValue("none");
    vi.mocked(isImageSearchConfigured).mockReturnValue(false);

    const res = await call("/api/image-search?q=Sony+FX3");

    expect(res.status).toBe(200);
    expect(searchProductImages).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("image-search", {
      provider: "none",
      status: "unconfigured",
      resultCount: 0,
      latencyMs: expect.any(Number),
      quotaExceeded: false,
    });
    expect(await res.json()).toEqual({
      data: {
        configured: false,
        provider: "none",
        quotaExceeded: false,
        results: [],
      },
    });
  });

  it("surfaces provider quota state without exposing stale results", async () => {
    vi.mocked(searchProductImages).mockResolvedValue({
      status: "quota",
      provider: "brave",
      results: [],
    });

    const res = await call("/api/image-search?q=Sony+FX3");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        configured: true,
        provider: "brave",
        quotaExceeded: true,
        results: [],
      },
    });
  });

  it("distinguishes provider failure from an honest empty search", async () => {
    vi.mocked(searchProductImages).mockResolvedValue({ status: "failed", provider: "brave", results: [] });
    const res = await call("/api/image-search?q=Sony+FX3");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ failed: true, results: [] });
  });

  it("returns 429 when the user exceeds the search limit", async () => {
    vi.mocked(enforceRateLimit).mockRejectedValue(new HttpError(429, "Too many requests. Try again in 60s."));

    const res = await call("/api/image-search?q=Sony+FX3");

    expect(res.status).toBe(429);
    expect(searchProductImages).not.toHaveBeenCalled();
  });
});
