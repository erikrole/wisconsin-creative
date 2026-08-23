import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support - Wisconsin Creative",
  description: "Support and contact information for the Wisconsin Creative iOS app and Gear Tracker service.",
};

const supportEmail = "erole@athletics.wisc.edu";

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12 sm:py-16">
        <header className="flex flex-col gap-4">
          <Link href="/about" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Wisconsin Creative
          </Link>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Support</p>
            <h1 className="text-balance">How can we help?</h1>
            <p className="text-base leading-7 text-muted-foreground">
              Get help with signing in, reservations, equipment lookup, schedules, notifications, or account access in
              the Wisconsin Creative app.
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <div className="flex flex-col gap-2">
            <h2>Contact Wisconsin Creative</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Email the Wisconsin Athletics Creative team and include a short description of what happened. Do not send
              passwords or other sensitive account information.
            </p>
          </div>
          <a
            className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href={`mailto:${supportEmail}?subject=Wisconsin%20Creative%20Support`}
          >
            Email {supportEmail}
          </a>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2>Account and privacy</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            The app includes password controls and account deletion under Account &amp; Security. Read how account,
            operational, and device information is handled in the{" "}
            <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
