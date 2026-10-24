import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { fail } from "@/lib/http";

// The web and iOS clients read `error` (and `details` when present) off every
// non-2xx body. Pinned so a zod upgrade cannot change the wire shape unnoticed.
describe("zod validation error response shape", () => {
  it("turns a ZodError into a 400 with a top-level error and path-prefixed details", async () => {
    const schema = z.object({
      name: z.string().min(1),
      items: z.array(z.string()).max(2),
    });
    const parsed = schema.safeParse({ items: ["a", "b", "c"] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const res = fail(parsed.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["details", "error"]);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toEqual([
      "name: Invalid input: expected string, received undefined",
      "items: Too big: expected array to have <=2 items",
    ]);
  });

  it("keeps ZodError.issues available for routes that build their own 400 message", () => {
    const parsed = z.object({ qty: z.number().int().max(5) }).safeParse({ qty: 9 });
    if (parsed.success) throw new Error("expected failure");
    expect(parsed.error.issues[0]?.message).toBe("Too big: expected number to be <=5");
    expect("errors" in parsed.error).toBe(false);
  });
});
