import { describe, expect, it } from "vitest";
import { loginPathWithReturnTo, safeReturnTo } from "@/lib/return-to";

describe("safeReturnTo", () => {
  it("keeps same-origin app paths with their query and hash", () => {
    expect(safeReturnTo("/checkouts/abc?tab=items#notes")).toBe("/checkouts/abc?tab=items#notes");
    expect(safeReturnTo("/")).toBe("/");
  });

  it.each([
    null,
    "",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "\\evil.example",
    "/\t/evil.example", // a raw tab, which URL parsing strips
    "javascript:alert(1)",
    "checkouts",
    "/login?returnTo=/items",
    "/api/me",
    "/change-password",
    "/reset-password?token=x",
  ])("rejects %j", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});

describe("loginPathWithReturnTo", () => {
  it("encodes a safe destination and drops unsafe or trivial ones", () => {
    expect(loginPathWithReturnTo("/items?q=a b")).toBe("/login?returnTo=%2Fitems%3Fq%3Da%2520b");
    expect(loginPathWithReturnTo("/")).toBe("/login");
    expect(loginPathWithReturnTo("//evil.example")).toBe("/login");
    expect(loginPathWithReturnTo(null)).toBe("/login");
  });
});
