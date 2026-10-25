import Link from "next/link";
import { BookOpenIcon, CalendarDaysIcon, ChevronRightIcon, ClockIcon, PackageIcon, SmartphoneIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";

type NextStep = {
  href: string;
  title: string;
  detail: string;
  icon: typeof CalendarDaysIcon;
  external?: boolean;
};

export const APP_STORE_URL = "https://apps.apple.com/us/app/wisconsin-creative/id6763456945";

/** Where to look first. Collaborators only see what their access allows. */
export function welcomeNextSteps(role: Role): NextStep[] {
  const app: NextStep = {
    href: APP_STORE_URL,
    title: "Get the iPhone app",
    detail: "Sign in with this same email and password. Scan gear, get shift reminders, and claim open trades.",
    icon: SmartphoneIcon,
    external: true,
  };
  if (role === "COLLABORATOR") return [app];
  const gear: NextStep = { href: "/bookings", title: "Find your gear", detail: "Anything you check out shows up here, with its return time.", icon: PackageIcon };
  const guides: NextStep = { href: "/resources", title: "Read the guides", detail: "How we shoot, where gear lives, and who to ask.", icon: BookOpenIcon };
  if (role === "STUDENT") {
    return [
      { href: "/welcome/availability", title: "Add when you can’t work", detail: "Classes, a job, or days away, so you’re not scheduled then.", icon: ClockIcon },
      { href: "/schedule", title: "Check the schedule", detail: "See the events you’re on and the ones that need crew.", icon: CalendarDaysIcon },
      gear,
      guides,
      app,
    ];
  }
  return [
    { href: "/schedule", title: "Check the schedule", detail: "Build crews and see which events still need people.", icon: CalendarDaysIcon },
    { href: "/staff/onboarding-status", title: "See who’s set up", detail: "Track invites and nudge anyone who hasn’t finished.", icon: UsersIcon },
    gear,
    guides,
    app,
  ];
}

export type WelcomeDoneProps = {
  firstName: string;
  role: Role;
  /** `later` means they stopped before the last step; we say so rather than claim they finished. */
  outcome: "complete" | "later";
  onContinue: () => void;
};

export function WelcomeDone({ firstName, role, outcome, onContinue }: WelcomeDoneProps) {
  const steps = welcomeNextSteps(role);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-10 sm:py-16">
      <header className="space-y-2">
        <p className="text-sm font-bold text-[var(--accent)]">
          {outcome === "complete" ? "Setup complete" : "Setup paused"}
        </p>
        <h1 className="text-balance text-3xl">
          {outcome === "complete" ? `You’re all set, ${firstName}` : `Welcome, ${firstName}`}
        </h1>
        <p className="text-pretty text-[var(--text-secondary)]">
          {outcome === "complete"
            ? "Your account is ready. Here’s where to start."
            : "Your account works. We’ll remind you tomorrow to finish your profile, and you can do it any time from Home."}
        </p>
      </header>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
        {steps.map(({ href, title, detail, icon: Icon, external }) => (
          <li key={href}>
            <Link
              href={href}
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
              className="flex items-center gap-4 px-4 py-4 text-foreground transition-colors hover:bg-[var(--bg-surface)] focus-visible:bg-[var(--bg-surface)] focus-visible:outline-none"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{title}</span>
                <span className="block text-sm text-[var(--text-secondary)]">{detail}</span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <Button className="h-11 w-full text-base font-bold sm:w-auto sm:self-start sm:px-8" onClick={onContinue}>
        Go to Home
      </Button>
    </div>
  );
}
