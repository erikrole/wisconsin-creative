import { env } from "@/lib/env";
import { EMAIL_THEME, escapeEmailHtml, renderEmail, type RenderedEmail } from "@/lib/email-template";

export { EMAIL_THEME, escapeEmailHtml, renderEmail };
export type { RenderedEmail };

type EmailParams = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Mail clients and spam filters both prefer having one. */
  text?: string;
};

export const EMAIL_SEND_TIMEOUT_MS = 4_000;

/**
 * Send a transactional email via Resend.
 * Falls back to console.log when RESEND_API_KEY is not set (dev mode).
 * Failures are non-fatal — logged but never thrown.
 */
export async function sendEmail({ to, subject, html, text }: EmailParams): Promise<boolean> {
  if (!env.resendApiKey) {
    console.log(`[EMAIL-DEV] To: ${to} | Subject: ${subject}`);
    return true;
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(env.resendApiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);

    try {
      // Resend forwards its request options into fetch. Its runtime supports
      // AbortSignal even though the current public request-options type omits it.
      const requestOptions: NonNullable<Parameters<typeof resend.emails.send>[1]> & {
        signal: AbortSignal;
      } = { signal: controller.signal };
      const { error } = await resend.emails.send(
        {
          from: env.emailFrom,
          to,
          subject,
          html,
          ...(text ? { text } : {}),
          ...(env.emailReplyTo ? { replyTo: env.emailReplyTo } : {}),
        },
        requestOptions,
      );

      if (error) {
        console.error("[EMAIL] Resend error:", error);
        return false;
      }

      return true;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error("[EMAIL] Failed to send:", err);
    return false;
  }
}

/**
 * Build a notification email. Spread the result into `sendEmail` arguments so
 * the HTML and plain-text versions travel together.
 */
export type NotificationEmailKind = "checkout" | "schedule" | "item";

const NOTIFICATION_KINDS: Record<
  NotificationEmailKind,
  { eyebrow: string; titleLabel: string; dateLabel: string; actionLabel: string; path: string }
> = {
  checkout: { eyebrow: "Checkout", titleLabel: "Checkout", dateLabel: "Due", actionLabel: "View checkout", path: "/checkouts" },
  schedule: { eyebrow: "Schedule", titleLabel: "Event", dateLabel: "Call time", actionLabel: "View your schedule", path: "/schedule" },
  item: { eyebrow: "Item report", titleLabel: "Item", dateLabel: "Reported", actionLabel: "Review item", path: "/items" },
};

export function buildNotificationEmail({
  title,
  body,
  bookingTitle,
  dueAt,
  kind,
}: {
  title: string;
  body: string;
  bookingTitle?: string;
  dueAt?: string;
  /** Picks the label, fact names, and button destination. Omit for a generic notice. */
  kind?: NotificationEmailKind;
}): RenderedEmail {
  const copy = kind ? NOTIFICATION_KINDS[kind] : null;
  const dueStr = dueAt
    ? new Date(dueAt).toLocaleString("en-US", {
        // Emails are built on the server, which runs in UTC. Without the
        // institution timezone a 7pm Central due time mails out as midnight
        // the next day.
        timeZone: env.appTimezone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const facts = [
    ...(bookingTitle ? [{ label: copy?.titleLabel ?? "Booking", value: bookingTitle }] : []),
    ...(dueStr ? [{ label: copy?.dateLabel ?? "Due", value: dueStr }] : []),
  ];

  return renderEmail({
    preheader: body,
    eyebrow: copy?.eyebrow,
    // Overdue and damage notices read as urgent; everything else stays neutral.
    urgent: kind === "item" || /overdue/i.test(title),
    headline: title,
    paragraphs: [body],
    facts,
    action: copy
      ? { label: copy.actionLabel, url: `${env.appUrl}${copy.path}` }
      : { label: "Open Wisconsin Creative", url: env.appUrl },
    manageNotifications: true,
  });
}
