import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  passwordResetToken: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireKiosk: vi.fn(),
  tokenHash: vi.fn(async (value: string) => `hash:${value}`),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  enforceRateLimit: vi.fn(),
}));

import { checkRateLimit } from "@/lib/rate-limit";
import { POST as resetAccount } from "@/app/api/auth/reset-password/account/route";
import { GET as changePasswordWellKnown } from "@/app/.well-known/change-password/route";

const source = (path: string) => readFileSync(path, "utf8");

function request(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/auth/reset-password/account", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 });
});

describe("well-known change-password URL", () => {
  it("sends a password manager to the page that changes the password", async () => {
    const response = await changePasswordWellKnown(
      new Request("https://app.example.com/.well-known/change-password") as never,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.com/settings/security");
  });

  it("redirects against the requesting origin, not a pinned host", async () => {
    const response = await changePasswordWellKnown(
      new Request("http://localhost:3000/.well-known/change-password") as never,
    );

    expect(response.headers.get("location")).toBe("http://localhost:3000/settings/security");
  });
});

describe("reset link account lookup", () => {
  it("names the account a valid link belongs to without consuming it", async () => {
    dbMock.passwordResetToken.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: { email: "user@example.com", active: true },
    });

    const response = await resetAccount(request({ token: "reset-token" }), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ email: "user@example.com" });
    expect(dbMock.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: "hash:reset-token" } }),
    );
  });

  it("says the same thing for an unknown, expired, or deactivated account link", async () => {
    const cases = [
      null,
      { expiresAt: new Date(Date.now() - 1), user: { email: "user@example.com", active: true } },
      { expiresAt: new Date(Date.now() + 60_000), user: { email: "user@example.com", active: false } },
    ];

    for (const record of cases) {
      dbMock.passwordResetToken.findUnique.mockResolvedValue(record);
      const response = await resetAccount(request({ token: "reset-token" }), { params: Promise.resolve({}) });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Invalid or expired reset link" });
    }
  });

  it("rate-limits the lookup per client", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

    const response = await resetAccount(request({ token: "reset-token" }), { params: Promise.resolve({}) });

    expect(response.status).toBe(429);
    expect(dbMock.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("web credential pairing contract", () => {
  const forms: Array<[string, string]> = [
    ["src/app/login/LoginForm.tsx", "login-username"],
    ["src/app/change-password/ForcePasswordChangeForm.tsx", "change-password-username"],
    ["src/app/reset-password/page.tsx", "reset-username"],
    ["src/app/(app)/settings/security/page.tsx", "security-username"],
  ];

  it("pairs every standalone password form with the account it belongs to", () => {
    for (const [path, id] of forms) {
      const file = source(path);
      expect(file, path).toContain("AccountUsernameField");
      expect(file, path).toContain(id);
    }
  });

  it("keeps the account field readable by a manager rather than removed from layout", () => {
    const field = source("src/components/auth/AccountUsernameField.tsx");
    expect(field).toContain('autoComplete="username"');
    expect(field).toContain('name="username"');
    expect(field).toContain("readOnly");
    expect(field).toContain("tabIndex={-1}");
    // A `type="hidden"` input is skipped by password managers; a visually
    // hidden text input is not.
    expect(field).toContain('className="sr-only"');
    expect(field).toContain('type="text"');
    expect(field).not.toContain('type="hidden"');
  });

  it("declares the server's password rule where a password is generated", () => {
    expect(source("src/components/auth/AccountUsernameField.tsx")).toContain('"minlength: 8;"');
    for (const path of [
      "src/app/login/LoginForm.tsx",
      "src/app/change-password/ForcePasswordChangeForm.tsx",
      "src/app/reset-password/page.tsx",
      "src/app/(app)/settings/security/page.tsx",
    ]) {
      expect(source(path), path).toContain("passwordRulesAttribute");
    }
  });
});

describe("native credential pairing contract", () => {
  it("puts an account field beside every native password field", () => {
    const login = source("ios/Wisconsin/Views/LoginView.swift");
    const security = source("ios/Wisconsin/Views/AccountSecuritySettingsView.swift");
    const setup = source("ios/Wisconsin/Views/PasswordSetupView.swift");
    const registration = source("ios/Wisconsin/Views/NativeAuthViews.swift");

    // The email field belongs to the previous step and is gone by the time the
    // password field appears.
    expect(login).toContain('TextField("Account", text: .constant(trimmedEmail))');
    expect(login).toContain(".textContentType(.username)");
    expect(security).toContain('TextField("Account", text: .constant(session.currentUser?.email ?? ""))');
    expect(setup).toContain('TextField("Account", text: .constant(email))');
    // Sign-up: `.username` is what iOS files the saved credential under.
    expect(registration).toContain(".textContentType(.username)");
    expect(registration).not.toContain(".textContentType(.emailAddress)\n                    .autocorrectionDisabled()");
  });
});
