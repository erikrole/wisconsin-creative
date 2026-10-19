import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { renderEmail, sendEmail } from "@/lib/email";
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
    ...buildShiftTradeEmail({ title, body, eventSummary, area }),
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
}) {
  return renderEmail({
    preheader: body,
    eyebrow: "Shift trade",
    headline: title,
    paragraphs: [body],
    facts: [
      { label: "Event", value: eventSummary },
      { label: "Area", value: area },
    ],
    action: { label: "Open your schedule", url: `${env.appUrl}/schedule` },
    manageNotifications: true,
  });
}
