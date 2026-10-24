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

/**
 * Released 1.4 (36) receives universal links for `/login?invite=` but cannot
 * read the token, so the app button would strand a student in the old app.
 * Flip to true once a build with native invite sign-up is the App Store version.
 */
export const NATIVE_INVITE_SETUP_RELEASED = false;

const APP_STORE_URL = "https://apps.apple.com/us/app/wisconsin-creative/id6763456945";

export function buildInviteEmail({
  name,
  email,
  kind = "invite",
  inviteToken = null,
  nativeSetup = NATIVE_INVITE_SETUP_RELEASED,
}: {
  name?: string | null;
  email: string;
  kind?: InviteEmailKind;
  /** Present for an unclaimed invite; the sign-up form needs this link. */
  inviteToken?: string | null;
  /** Offer the universal-link app button beside the browser one. */
  nativeSetup?: boolean;
}): { subject: string; html: string; text: string } {
  const first = firstName(name);
  /** "Hi Maya, you've..." with a name, "You've..." without. */
  const lead = (sentence: string) =>
    first ? `Hi ${first}, ${sentence}` : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
  const loginUrl = inviteLoginUrl(email, inviteToken);
  // `web=1` keeps a link out of the app association, so the website path works
  // even with an older app installed. Only the "Set up in the app" link is claimed.
  const browserLoginUrl = inviteToken ? `${loginUrl}&web=1` : loginUrl;
  const reminder = kind === "reminder";
  const offerApp = Boolean(inviteToken) && nativeSetup;
  const subject = reminder ? "Finish setting up your Wisconsin Creative account" : "Set up your Wisconsin Creative account";

  const invite = !reminder;
  const steps = offerApp
    ? [
        "Download Wisconsin Creative from the App Store",
        "Come back to this email on your iPhone and tap Set up in the app",
        "Choose a password, then add your phone, Wiscard, and sizes",
      ]
    : [
        "Tap Set up your account and choose a password",
        "Add your phone, Wiscard, and sizes",
        "Download the iPhone app and sign in",
      ];

  const rendered = renderEmail({
    preheader: reminder
      ? "Sign in and finish your profile so we can schedule you."
      : "Setup takes about three minutes.",
    eyebrow: reminder ? "Quick reminder" : undefined,
    headline: reminder ? "Your account is still waiting" : "Set up your Wisconsin Creative account",
    paragraphs: reminder
      ? [lead("we can't schedule you for shifts until you've signed in and finished your profile. It takes about three minutes.")]
      : [lead("you've been added to Wisconsin Creative, where we schedule shifts and check out gear. Setup takes about three minutes.")],
    steps: invite ? { heading: offerApp ? "On your iPhone" : "How to set up", items: steps } : undefined,
    action: reminder
      ? { label: "Finish setting up", url: browserLoginUrl }
      : offerApp
        ? { label: "Set up in the app", url: loginUrl }
        : { label: "Set up your account", url: browserLoginUrl },
    secondaryAction: !invite
      ? undefined
      : offerApp
        ? [
            { label: "Download the app from the App Store", url: APP_STORE_URL },
            { label: "Or set up on the website", url: browserLoginUrl },
          ]
        : [{ label: "Download the iPhone app", url: APP_STORE_URL }],
    note: inviteToken
      ? `Your setup link is for ${email} and works for 30 days. If it expires, open the sign-in page and choose Email me my invite link.`
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
