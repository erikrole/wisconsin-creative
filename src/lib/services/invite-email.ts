import { EMAIL_THEME, buildEmailDocument, escapeEmailHtml, sendEmail } from "@/lib/email";
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
}): { subject: string; html: string } {
  const greeting = firstName(name) ? `Hi ${escapeEmailHtml(firstName(name))},` : "Hi,";
  const loginUrl = inviteLoginUrl(email);
  const intro =
    kind === "reminder"
      ? "A reminder that your Wisconsin Creative account is waiting for you."
      : "You have been added to Wisconsin Creative, the team's home for schedules, gear, and reservations.";
  const subject =
    kind === "reminder" ? "Finish setting up your Wisconsin Creative account" : "You're invited to Wisconsin Creative";

  const html = buildEmailDocument({
    title: subject,
    content: `
  <p style="font-size: 15px; line-height: 1.5; color: ${EMAIL_THEME.body};">${greeting}</p>
  <p style="font-size: 15px; line-height: 1.5; color: ${EMAIL_THEME.body};">${intro}</p>
  <p style="font-size: 15px; line-height: 1.5; color: ${EMAIL_THEME.body};">Sign in with <strong>${escapeEmailHtml(email)}</strong> to finish setup. It takes a couple of minutes: add a photo, your availability, and your sizes.</p>
  <p style="margin: 24px 0;"><a href="${escapeEmailHtml(loginUrl)}" style="display: inline-block; background-color: ${EMAIL_THEME.brand}; color: ${EMAIL_THEME.onBrand}; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 20px; border-radius: 8px;">Set up your account</a></p>
  <p style="font-size: 13px; line-height: 1.5; color: ${EMAIL_THEME.muted};">Use this exact address. If the button does not work, open ${escapeEmailHtml(loginUrl)} in your browser. If you were not expecting this, you can ignore it.</p>`.trim(),
  });

  return { subject, html };
}

/** Never throws: callers decide what to tell the admin from the returned status. */
export async function sendInviteEmail(input: {
  email: string;
  name?: string | null;
  kind?: InviteEmailKind;
}): Promise<InviteEmailStatus> {
  if (!env.resendApiKey) return "not_configured";
  const { subject, html } = buildInviteEmail(input);
  const delivered = await sendEmail({ to: input.email, subject, html });
  return delivered ? "sent" : "failed";
}
