import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
let apiKey = "";

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/env", () => ({
  env: {
    get resendApiKey() {
      return apiKey;
    },
    appUrl: "https://creative.example.test",
    appTimezone: "America/Chicago",
  },
}));

import { buildInviteEmail, inviteLoginUrl, sendInviteEmail } from "@/lib/services/invite-email";

describe("invite email", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    apiKey = "re_test";
  });

  it("links to the login page with the invited address prefilled", () => {
    expect(inviteLoginUrl("a+b@wisc.edu")).toBe("https://creative.example.test/login?email=a%2Bb%40wisc.edu");
  });

  it("greets by first name, escapes dynamic content, and tells them which address to use", () => {
    const { subject, html } = buildInviteEmail({ name: "<b>Maya</b> Chen", email: "maya@wisc.edu" });
    expect(subject).toBe("You're invited to Wisconsin Creative");
    expect(html).toContain("Hi &lt;b&gt;Maya&lt;/b&gt;,");
    expect(html).not.toContain("<b>Maya");
    expect(html).toContain("Sign in with maya@wisc.edu.");
    expect(html).toContain("Choose Forgot password on the sign-in page");
    expect(html).toContain("https://creative.example.test/login?email=maya%40wisc.edu");
  });

  it("uses reminder wording for a resend and a neutral greeting without a name", () => {
    const { subject, html } = buildInviteEmail({ email: "x@wisc.edu", kind: "reminder" });
    expect(subject).toBe("Finish setting up your Wisconsin Creative account");
    expect(html).toContain("We can&#39;t schedule you".replace("&#39;", "'"));
    expect(html).not.toContain("Hi,");
  });

  it("reports not_configured and sends nothing when no provider key is set", async () => {
    apiKey = "";
    await expect(sendInviteEmail({ email: "x@wisc.edu" })).resolves.toBe("not_configured");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports sent or failed from the delivery result", async () => {
    sendEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(sendInviteEmail({ email: "x@wisc.edu", name: "Xi" })).resolves.toBe("sent");
    await expect(sendInviteEmail({ email: "x@wisc.edu", name: "Xi" })).resolves.toBe("failed");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "x@wisc.edu" }));
  });
});
