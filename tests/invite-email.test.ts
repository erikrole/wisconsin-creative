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

vi.mock("@/lib/services/invite-token", () => ({
  issueInviteToken: vi.fn(async () => "fresh-raw-token"),
}));

import { NATIVE_INVITE_SETUP_RELEASED, buildInviteEmail, inviteLoginUrl, sendInviteEmail } from "@/lib/services/invite-email";
import { issueInviteToken } from "@/lib/services/invite-token";

describe("invite email", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    apiKey = "re_test";
  });

  it("links to the login page with the invited address prefilled", () => {
    expect(inviteLoginUrl("a+b@wisc.edu")).toBe("https://creative.example.test/login?email=a%2Bb%40wisc.edu");
    expect(inviteLoginUrl("a@wisc.edu", "tok/en")).toBe("https://creative.example.test/login?email=a%40wisc.edu&invite=tok%2Fen");
  });

  it("mints a fresh sign-up token for an unclaimed invite and puts it in the link", async () => {
    sendEmail.mockResolvedValueOnce(true);
    await expect(sendInviteEmail({ email: "x@wisc.edu", allowedEmailId: "invite-1" })).resolves.toBe("sent");
    expect(issueInviteToken).toHaveBeenCalledWith("invite-1");
    const sent = sendEmail.mock.calls[0]![0] as { html: string; text: string };
    expect(sent.html).toContain("login?email=x%40wisc.edu&amp;invite=fresh-raw-token");
    expect(sent.text).toContain("login?email=x%40wisc.edu&invite=fresh-raw-token");
    expect(sent.html).toContain("works for 30 days");
  });

  it("keeps browser setup out of universal linking while offering explicit native setup", () => {
    const { html, text } = buildInviteEmail({ email: "alex@wisc.edu", inviteToken: "fixture-token", nativeSetup: true });
    expect(html).toContain('href="https://creative.example.test/login?email=alex%40wisc.edu&amp;invite=fixture-token&amp;web=1"');
    expect(html).toContain('href="https://creative.example.test/login?email=alex%40wisc.edu&amp;invite=fixture-token"');
    expect(text).toContain("Set up in the app: https://creative.example.test/login?email=alex%40wisc.edu&invite=fixture-token\n");
    expect(text).toContain("Download the app from the App Store: https://apps.apple.com/");
    expect(text).toContain("Or set up on the website: https://creative.example.test/login?email=alex%40wisc.edu&invite=fixture-token&web=1");
  });

  it("sends only the browser link until a native invite build is released", () => {
    expect(NATIVE_INVITE_SETUP_RELEASED).toBe(false);
    const { html, text } = buildInviteEmail({ email: "alex@wisc.edu", inviteToken: "fixture-token" });
    expect(text).toContain("Set up your account: https://creative.example.test/login?email=alex%40wisc.edu&invite=fixture-token&web=1");
    expect(text).toContain("Download the iPhone app: https://apps.apple.com/");
    expect(text).not.toContain("Set up in the app:");
    expect(html).not.toContain('href="https://creative.example.test/login?email=alex%40wisc.edu&amp;invite=fixture-token"');
    expect(text).toContain("works for 30 days");
  });

  it("sends a plain sign-in link for a reminder to someone who already registered", async () => {
    sendEmail.mockResolvedValueOnce(true);
    await sendInviteEmail({ email: "x@wisc.edu", kind: "reminder" });
    expect(issueInviteToken).not.toHaveBeenCalled();
    const sent = sendEmail.mock.calls[0]![0] as { text: string };
    expect(sent.text).not.toContain("invite=");
  });

  it("greets by first name, escapes dynamic content, and tells them which address to use", () => {
    const { subject, html } = buildInviteEmail({ name: "<b>Maya</b> Chen", email: "maya@wisc.edu" });
    expect(subject).toBe("Set up your Wisconsin Creative account");
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

  it("does not email a sign-up link when the invite was claimed before token issuance", async () => {
    vi.mocked(issueInviteToken).mockResolvedValueOnce(null);
    await expect(sendInviteEmail({ email: "x@wisc.edu", allowedEmailId: "invite-1" })).resolves.toBe("failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports token-issuance failure without throwing or sending a misleading link", async () => {
    vi.mocked(issueInviteToken).mockRejectedValueOnce(new Error("Invite no longer exists"));
    await expect(sendInviteEmail({ email: "x@wisc.edu", allowedEmailId: "invite-1" })).resolves.toBe("failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("reports sent or failed from the delivery result", async () => {
    sendEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(sendInviteEmail({ email: "x@wisc.edu", name: "Xi" })).resolves.toBe("sent");
    await expect(sendInviteEmail({ email: "x@wisc.edu", name: "Xi" })).resolves.toBe("failed");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "x@wisc.edu" }));
  });
});
