import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - Wisconsin Creative",
  description: "Privacy policy for the Wisconsin Creative iOS app and Gear Tracker service.",
};

const updatedAt = "August 21, 2026";

const sections = [
  {
    title: "What We Collect",
    body: [
      "Account information such as name, email address, role, assigned location, and optional profile details your organization chooses to maintain.",
      "Operational records such as gear checkouts, reservations, returns, favorites, schedule assignments, availability, notifications, and audit history.",
      "Device information needed for iOS features, including push notification tokens, Live Activity tokens, app version, and basic session state. For the configured product owner’s support/adoption report, the app may also report a coarse device model, OS version, marketing/build version, and a best-effort distribution-channel signal.",
      "Camera access only when you choose to scan a barcode or QR code. Camera frames are used on device for scanning and are not stored by the app.",
      "Authenticated API diagnostics and server logs used to keep the service reliable, secure, and supportable. We also count a small allowlisted set of product events such as app opens and normalized area views using rotating pseudonymous identifiers. The native iOS app does not embed a third-party crash-reporting, session-replay, or advertising analytics SDK.",
    ],
  },
  {
    title: "What We Do Not Collect",
    body: [
      "We do not sell personal information.",
      "We do not track users across third-party apps or websites.",
      "We do not collect precise device location for the iOS app.",
      "We do not use booking photo uploads in the iOS launch scope.",
      "We do not collect native app crash reports, device-performance metrics, UDIDs, hardware serial numbers, advertising IDs, raw App Store receipts, free-form tap or click streams, page URLs containing record identifiers, search text, scanned values, or session replay in the iOS app.",
    ],
  },
  {
    title: "How We Use Information",
    body: [
      "Provide access to gear inventory, bookings, returns, schedules, notifications, and related operational workflows.",
      "Protect accounts and enforce role-based permissions.",
      "Show current gear custody, due dates, reminders, and Live Activity status.",
      "Troubleshoot errors, investigate operational changes, and maintain audit history.",
      "Support App Review and training using seeded fictional demo data when needed.",
    ],
  },
  {
    title: "Sharing",
    body: [
      "Information is used within Wisconsin Creative operations and by service providers needed to run the app: Vercel for hosting and platform logs, Neon for database storage, Sentry for web/server error diagnostics, Resend for service email, Upstash for rate limiting, Vercel Blob for stored media, and Apple for push notifications and Live Activities.",
      "We do not share user information for advertising.",
      "We may disclose information when required to comply with legal obligations, security needs, or institutional policy.",
    ],
  },
  {
    title: "Retention",
    body: [
      "Operational records are retained while they are needed for gear custody, scheduling, audit, reporting, and support.",
      "Accounts can be deactivated when access is no longer needed. Some historical records may remain to preserve audit and custody history.",
      "Push and Live Activity tokens are revoked or replaced as devices change, permissions are removed, or sessions end.",
    ],
  },
  {
    title: "Your Choices",
    body: [
      "You can manage notification preferences in the app.",
      "You can deny camera access and use manual code entry where available.",
      "You can delete your account from Account & Security in the iOS app. Deletion immediately removes access and cancels future reservations; open checkouts must be returned first.",
      "Some historical custody, scheduling, and audit records may remain after account deletion when needed for operational accountability, legal obligations, security, or institutional policy.",
      "You can contact support to request account corrections or access help.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12 sm:py-16">
        <header className="flex flex-col gap-4">
          <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Wisconsin Creative
          </Link>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Privacy Policy</p>
            <h1 className="text-balance">Wisconsin Creative Privacy Policy</h1>
            <p className="text-base leading-7 text-muted-foreground">
              This policy describes how Wisconsin Creative handles information for the Wisconsin Creative iOS app and
              Gear Tracker service.
            </p>
            <p className="text-sm text-muted-foreground">Last updated: {updatedAt}</p>
          </div>
        </header>

        <div className="flex flex-col gap-8">
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-3">
              <h2>{section.title}</h2>
              <ul className="list-disc flex flex-col gap-2 pl-5 text-sm leading-6 text-muted-foreground">
                {section.body.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2>Contact</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            For privacy or support questions, contact{" "}
            <a className="font-medium text-primary underline-offset-4 hover:underline" href="mailto:erole@athletics.wisc.edu">
              erole@athletics.wisc.edu
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
