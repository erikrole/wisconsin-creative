import { beforeEach, vi } from "vitest";

// next/font only works inside the Next compiler. Rendered components that pull
// in a font loader (the Lato chrome font, for example) get a stub instead.
vi.mock("next/font/google", () => ({
  Lato: () => ({ className: "font-stub", variable: "font-stub-variable", style: {} }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
