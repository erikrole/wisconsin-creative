import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { renderEmail, sendEmail } from "@/lib/email";
import { getProfileCompletion } from "@/lib/profile-completion";
import { readinessProfileSelect } from "@/lib/services/onboarding-readiness";

const APP_STORE_URL = "https://apps.apple.com/us/app/wisconsin-creative/id6763456945";

export function buildWelcomeEmail({ name }: { name?: string | null }): { subject: string; html: string; text: string } {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  const rendered = renderEmail({
    preheader: "You're set up. Here's where to start.",
    eyebrow: "You're set up",
    headline: first ? `You're all set, ${first}` : "You're all set",
    paragraphs: ["Your Wisconsin Creative account is ready. Here's where to start in your first weeks."],
    steps: {
      heading: "Start here",
      items: [
        "Check the schedule to see the events you're on",
        "Find gear you've checked out, with its return time, under Bookings",
        "Read the guides for how we shoot and who to ask",
        "Install the iPhone app to scan gear and get shift reminders",
      ],
    },
    action: { label: "Open Wisconsin Creative", url: env.appUrl },
    footer: [`Get the iPhone app: ${APP_STORE_URL}`, "Questions? Reply to this email and a person will answer."],
    showFallbackLink: true,
  });
  return { subject: "You're set up on Wisconsin Creative", ...rendered };
}

/**
 * Sends the one-time welcome email when a student or staff member finishes setup.
 * The claim on `welcomeEmailSentAt` is atomic, so concurrent saves send at most one;
 * a failed send releases the claim so a later save can try again.
 * Never throws: setup must not fail because of email.
 */
export async function sendWelcomeEmailIfDone(userId: string): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { ...readinessProfileSelect, active: true, hiddenFromRoster: true, welcomeEmailSentAt: true },
    });
    if (!user || !user.active || user.hiddenFromRoster || user.welcomeEmailSentAt) return;
    if (user.role === "COLLABORATOR") return;
    if (!getProfileCompletion(user).profileComplete) return;
    if (!env.resendApiKey) return;

    const claim = await db.user.updateMany({
      where: { id: userId, welcomeEmailSentAt: null },
      data: { welcomeEmailSentAt: new Date() },
    });
    if (claim.count !== 1) return;

    const { subject, html, text } = buildWelcomeEmail({ name: user.name });
    const delivered = await sendEmail({ to: user.email, subject, html, text });
    if (!delivered) {
      await db.user.updateMany({ where: { id: userId }, data: { welcomeEmailSentAt: null } });
    }
  } catch (error) {
    console.error("welcome email failed", error);
  }
}
