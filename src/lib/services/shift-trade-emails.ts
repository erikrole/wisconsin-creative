import { db } from "@/lib/db";
import { EMAIL_THEME, buildEmailDocument, escapeEmailHtml, sendEmail } from "@/lib/email";
import { normalizePrefs, shouldDeliverCategory, shouldDeliverEmail } from "@/lib/services/notification-prefs";

export type ShiftTradeEmail = {
  userId: string;
  title: string;
  body: string;
  eventSummary: string;
  area: string;
};

export async function sendShiftTradeEmail({
  userId,
  title,
  body,
  eventSummary,
  area,
}: ShiftTradeEmail): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, active: true, notificationPrefs: true },
  });

  if (!user?.active || !user.email) return false;
  const prefs = normalizePrefs(user.notificationPrefs);
  if (!shouldDeliverEmail(prefs)) return false;
  if (!shouldDeliverCategory(prefs, "trade")) return false;

  return sendEmail({
    to: user.email,
    subject: title,
    html: buildShiftTradeEmail({ title, body, eventSummary, area }),
  });
}

function buildShiftTradeEmail({
  title,
  body,
  eventSummary,
  area,
}: {
  title: string;
  body: string;
  eventSummary: string;
  area: string;
}): string {
  return buildEmailDocument({
    title,
    content: `
  <p style="font-size: 15px; line-height: 1.5; color: ${EMAIL_THEME.body};">${escapeEmailHtml(body)}</p>
  <p style="font-size: 13px; color: ${EMAIL_THEME.muted};">Event: <strong>${escapeEmailHtml(eventSummary)}</strong></p>
  <p style="font-size: 13px; color: ${EMAIL_THEME.muted};">Area: ${escapeEmailHtml(area)}</p>`.trim(),
  });
}
