import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("email-first onboarding source wiring", () => {
  it("discovers the email before selecting password or account setup", () => {
    const source = readFileSync("src/app/login/LoginForm.tsx", "utf8");

    expect(source).toContain('fetch("/api/auth/discover"');
    expect(source).toContain('result?.flow === "onboarding" ? "onboarding" : "password"');
    expect(source).toContain('url: "/api/auth/register"');
    expect(source).toMatch(/onSuccess: \(\) => \{[\s\S]*?router\.replace\("\/welcome"\);/);
    expect(source).toContain("Your email is approved.");
    expect(source).not.toContain("Need an account?");
  });

  it("keeps linked registration compatible while making login the entry point", () => {
    const source = readFileSync("src/app/register/page.tsx", "utf8");

    expect(source).toContain("redirect(target)");
    expect(source).toContain('const target = email?.trim()');
    expect(source).toContain('"/login"');
  });
});
