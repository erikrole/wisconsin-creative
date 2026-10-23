import { renderEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { issueInviteToken } from "@/lib/services/invite-token";

export type InviteEmailKind = "invite" | "reminder";

/** `not_configured` means no provider key is set, so nothing left the server. */
export type InviteEmailStatus = "sent" | "failed" | "not_configured";

/**
 * The login page prefills the invited address, so the link claims the right
 * invite. An unclaimed invite's link also carries its one-time sign-up token.
 */
export function inviteLoginUrl(email: string, inviteToken?: string | null): string {
  const url = `${env.appUrl}/login?email=${encodeURIComponent(email)}`;
  return inviteToken ? `${url}&invite=${encodeURIComponent(inviteToken)}` : url;
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function buildInviteEmail({
  name,
  email,
  kind = "invite",
  inviteToken = null,
}: {
  name?: string | null;
  email: string;
  kind?: InviteEmailKind;
  /** Present for an unclaimed invite; the sign-up form needs this link. */
  inviteToken?: string | null;
}): { subject: string; html: string; text: string } {
  const first = firstName(name);
  /** "Hi Maya, you've..." with a name, "You've..." without. */
  const lead = (sentence: string) =>
    first ? `Hi ${first}, ${sentence}` : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
  const loginUrl = inviteLoginUrl(email, inviteToken);
  // The primary browser path must remain available to installed 1.4 clients,
  // which cannot read an invite token. Only the explicit app action is claimed.
  const browserLoginUrl = inviteToken ? `${loginUrl}&web=1` : loginUrl;
  const reminder = kind === "reminder";
  const subject = reminder ? "Finish setting up your Wisconsin Creative account" : "You're invited to Wisconsin Creative";

  const rendered = renderEmail({
    preheader: reminder
      ? "Sign in and finish your profile so we can schedule you."
      : "Your account is ready. Setup takes about three minutes.",
    eyebrow: reminder ? "Quick reminder" : "You're invited",
    headline: reminder ? "Your account is still waiting" : "Welcome to the crew",
    paragraphs: reminder
      ? [lead("we can't schedule you for shifts until you've signed in and finished your profile. It takes about three minutes.")]
      : [
          lead(
            "you've been added to Wisconsin Creative, where we schedule shifts, check out gear, and keep game days running. Finishing your profile takes about three minutes."
          ),
        ],
    steps: reminder
      ? undefined
      : {
          heading: "What happens next",
          items: [
            "Choose a password for your account",
            "Add your phone, Wiscard, and student details",
            "Pick your apparel sizes and add a photo, now or later",
            "Install the iPhone app to scan gear and get shift reminders",
          ],
        },
    action: { label: reminder ? "Finish setting up" : inviteToken ? "Set up in browser" : "Set up your account", url: browserLoginUrl },
    secondaryAction: inviteToken ? { label: "Set up in the iPhone app", url: loginUrl } : undefined,
    note: inviteToken
      ? `Sign in with ${email}, using either setup link: each carries your invitation and works for 30 days. For setup in the iPhone app, install the latest version first. Need a fresh one later? Enter your address on the sign-in page and choose Email me my invite link.`
      : `Sign in with ${email}. Use this exact address so we can find your invite.`,
    footer: [
      "Forget your password later? Choose Forgot password on the sign-in page and we'll email you a reset link.",
      "Questions? Reply to this email. Wasn't expecting this? You can ignore it, nothing happens until you sign in.",
    ],
    showFallbackLink: true,
  });

  return { subject, ...rendered };
}

/**
 * Never throws: callers decide what to tell the admin from the returned status.
 * Pass `allowedEmailId` for an unclaimed invite so the link carries a fresh
 * sign-up token; a reminder to someone who already registered needs none.
 */
export async function sendInviteEmail(input: {
  email: string;
  name?: string | null;
  kind?: InviteEmailKind;
  allowedEmailId?: string;
}): Promise<InviteEmailStatus> {
  if (!env.resendApiKey) return "not_configured";
  try {
    const inviteToken = input.allowedEmailId ? await issueInviteToken(input.allowedEmailId) : null;
    if (input.allowedEmailId && !inviteToken) return "failed";
    const { subject, html, text } = buildInviteEmail({ ...input, inviteToken });
    const delivered = await sendEmail({ to: input.email, subject, html, text });
    return delivered ? "sent" : "failed";
  } catch {
    // Keep the caller's delivery receipt honest without exposing the address
    // or raw inbox credential in a response or log.
    console.error("[Invite] could not prepare or send the invitation");
    return "failed";
  }
}
