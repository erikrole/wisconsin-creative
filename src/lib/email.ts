import { env } from "@/lib/env";

type EmailParams = {
  to: string;
  subject: string;
  html: string;
};

export const EMAIL_SEND_TIMEOUT_MS = 4_000;

export const EMAIL_THEME = {
  background: "#FFFFFF",
  text: "#1A1A2E",
  body: "#333333",
  muted: "#6B7280",
  divider: "#E5E7EB",
  brand: "#A00000",
  onBrand: "#FFFFFF",
} as const;

/**
 * Send a transactional email via Resend.
 * Falls back to console.log when RESEND_API_KEY is not set (dev mode).
 * Failures are non-fatal — logged but never thrown.
 */
export async function sendEmail({ to, subject, html }: EmailParams): Promise<boolean> {
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

export function buildEmailDocument({ title, content }: { title: string; content: string }): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background-color: ${EMAIL_THEME.background}; color: ${EMAIL_THEME.text};">
  <div style="border-bottom: 3px solid ${EMAIL_THEME.brand}; padding-bottom: 12px; margin-bottom: 20px;">
    <strong style="font-size: 18px;">${escapeEmailHtml(title)}</strong>
  </div>
  ${content}
  <hr style="border: none; border-top: 1px solid ${EMAIL_THEME.divider}; margin: 24px 0;">
  <p style="font-size: 11px; color: ${EMAIL_THEME.muted};">Wisconsin Creative &mdash; University of Wisconsin&ndash;Madison</p>
</body>
</html>`.trim();
}

/**
 * Build notification email HTML. Minimal inline-styled template.
 */
export function buildNotificationEmail({
  title,
  body,
  bookingTitle,
  dueAt,
}: {
  title: string;
  body: string;
  bookingTitle?: string;
  dueAt?: string;
}): string {
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

  return buildEmailDocument({
    title,
    content: `
  <p style="font-size: 15px; line-height: 1.5; color: ${EMAIL_THEME.body};">${escapeEmailHtml(body)}</p>
  ${bookingTitle ? `<p style="font-size: 13px; color: ${EMAIL_THEME.muted};">Booking: <strong>${escapeEmailHtml(bookingTitle)}</strong></p>` : ""}
  ${dueStr ? `<p style="font-size: 13px; color: ${EMAIL_THEME.muted};">Due: ${escapeEmailHtml(dueStr)}</p>` : ""}`.trim(),
  });
}

export function escapeEmailHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
