import { beforeEach, vi } from "vitest";

// next/font only works inside the Next compiler. Rendered components that pull
// in a font loader (the Lato chrome font, for example) get a stub instead.
vi.mock("next/font/google", () => ({
  Lato: () => ({ className: "font-stub", variable: "font-stub-variable", style: {} }),
}));

// Route wrappers record unexpected 500s in the background. In tests that write
// would reach a real Prisma client after the test ends, so it is a stub; the
// pure report builder stays real.
vi.mock("@/lib/error-reporting/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/error-reporting/server")>()),
  captureServerError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
