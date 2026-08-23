import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

const AUTH_SCREENS = [
  "src/app/login/LoginForm.tsx",
  "src/app/forgot-password/page.tsx",
  "src/app/reset-password/page.tsx",
  "src/app/change-password/ForcePasswordChangeForm.tsx",
];

describe("Unauthenticated screen contracts", () => {
  it("renders every unauthenticated screen through the shared shell", () => {
    for (const path of AUTH_SCREENS) {
      const file = source(path);
      expect(file, path).toContain('from "@/components/auth/AuthScreen"');
      expect(file, path).toContain("<AuthScreen");
    }
  });

  it("keeps the scene and its noise texture in one place", () => {
    const shell = source("src/components/auth/AuthScreen.tsx");
    expect(shell).toContain("login-bg min-h-screen");
    expect(shell).toContain("feTurbulence");

    // Sign-in, forgot, reset, and forced change each carried a byte-identical
    // copy of the scene wrapper and the inline noise data URI.
    for (const path of AUTH_SCREENS) {
      expect(source(path), path).not.toContain("login-bg min-h-screen");
      expect(source(path), path).not.toContain("feTurbulence");
    }
  });

  it("uses the designed login material rather than a plain card", () => {
    const shell = source("src/components/auth/AuthScreen.tsx");
    expect(shell).toContain("login-card");
    expect(shell).toContain("login-materialize");
    expect(shell).toContain("login-rise");
    expect(shell).toContain("login-lockup-title");

    // The plain treatment three screens used instead.
    for (const path of AUTH_SCREENS) {
      expect(source(path), path).not.toContain("shadow-2xl border-0 animate-in fade-in-0 zoom-in-95");
    }
  });

  it("gives every unauthenticated screen a real h1", () => {
    const shell = source("src/components/auth/AuthScreen.tsx");
    expect(shell).toMatch(/<h1 className="login-lockup-title[^"]*">Wisconsin Creative<\/h1>/);

    // Forgot, reset, and forced change previously titled the page with a
    // CardTitle, so those routes rendered no heading element at all.
    for (const path of AUTH_SCREENS) {
      expect(source(path), path).not.toContain("<CardTitle");
    }
  });

  it("keeps the login scene styles the shell depends on", () => {
    const css = source("src/app/globals.css");
    for (const cls of [".login-card", ".login-materialize", ".login-rise", ".login-lockup-title"]) {
      expect(css, cls).toContain(cls);
    }
  });
});
