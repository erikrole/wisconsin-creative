import { renderEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

export type InviteEmailKind = "invite" | "reminder";

/** `not_configured` means no provider key is set, so nothing left the server. */
export type InviteEmailStatus = "sent" | "failed" | "not_configured";

/** The login page prefills the invited address, so the link claims the right invite. */
export function inviteLoginUrl(email: string): string {
  return `${env.appUrl}/login?email=${encodeURIComponent(email)}`;
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function buildInviteEmail({
  name,
  email,
  kind = "invite",
}: {
  name?: string | null;
  email: string;
  kind?: InviteEmailKind;
}): { subject: string; html: string; text: string } {
  const first = firstName(name);
  /** "Hi Maya, you've..." with a name, "You've..." without. */
  const lead = (sentence: string) =>
    first ? `Hi ${first}, ${sentence}` : `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
  const loginUrl = inviteLoginUrl(email);
  const reminder = kind === "reminder";
  const subject = reminder ? "Finish setting up your Wisconsin Creative account" : "You're invited to Wisconsin Creative";

  const rendered = renderEmail({
    preheader: reminder
      ? "Sign in and finish your profile so we can schedule you."
      : "Your account is ready. Finishing your profile takes about three minutes.",
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
          heading: "What you'll set up",
          items: [
            "Contact details so we can reach you",
            "Student details like year and graduation",
            "Apparel sizes and a photo for team gear and your badge",
          ],
        },
    action: { label: reminder ? "Finish setting up" : "Set up your account", url: loginUrl },
    note: `Sign in with ${email}. Use this exact address so we can find your invite.`,
    footer: ["Questions? Reply to this email. Wasn't expecting this? You can ignore it, nothing happens until you sign in."],
    showFallbackLink: true,
  });

  return { subject, ...rendered };
}

/** Never throws: callers decide what to tell the admin from the returned status. */
export async function sendInviteEmail(input: {
  email: string;
  name?: string | null;
  kind?: InviteEmailKind;
}): Promise<InviteEmailStatus> {
  if (!env.resendApiKey) return "not_configured";
  const { subject, html, text } = buildInviteEmail(input);
  const delivered = await sendEmail({ to: input.email, subject, html, text });
  return delivered ? "sent" : "failed";
}
