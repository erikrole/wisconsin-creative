"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { WelcomeDone } from "./WelcomeDone";

export default function WelcomePage() {
  const router = useRouter();
  const { data, isLoading, isError, isFetching, refetch } = useProfileCompletion();
  const [outcome, setOutcome] = useState<"complete" | "later" | null>(null);

  if (isLoading && !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 py-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="mx-auto max-w-3xl py-4">
        <EmptyState
          icon="wifi-off"
          title="Could not load your welcome setup"
          description="Check your connection and try again. You can also continue to the dashboard and finish your profile later."
          actionLabel="Try again"
          onAction={() => {
            void refetch();
          }}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" className="h-10" onClick={() => router.replace("/")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl py-4">
        <EmptyState
          icon="users"
          title="Welcome setup unavailable"
          description="Sign in again if this keeps happening, or continue to the dashboard."
          actionLabel="Go to dashboard"
          onAction={() => router.replace("/")}
        />
      </div>
    );
  }

  const firstName = data.profile.name.split(" ")[0] || data.profile.name;
  const collaborator = data.profile.role === "COLLABORATOR";
  const student = data.profile.role === "STUDENT";
  const goHome = () => router.replace("/");

  if (outcome || data.completion.profileComplete) {
    return (
      <WelcomeDone
        firstName={firstName}
        role={data.profile.role}
        outcome={outcome === "later" ? "later" : "complete"}
        onContinue={goHome}
      />
    );
  }

  return (
    <div
      className={
        isFetching
          ? "mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 opacity-80 sm:py-16"
          : "mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 sm:py-16"
      }
    >
      <header className="space-y-2">
        <p className="text-sm font-bold text-[var(--accent)]">Welcome to Wisconsin Creative</p>
        <h1 className="text-balance text-3xl">Let’s get you set up, {firstName}</h1>
        <p className="max-w-xl text-pretty text-[var(--text-secondary)]">
          {collaborator
            ? "Add a profile photo so the team can recognize you. That’s the only step."
            : student
              ? "A few details so the team can reach you and schedule you. It takes about three minutes, and you can pause any time."
              : "A few details so the team can reach you and identify you at the kiosk. It takes about three minutes, and you can pause any time."}
        </p>
      </header>

      <ProfileCompletionWizard
        presentation="page"
        onComplete={() => setOutcome("complete")}
        onSnooze={() => setOutcome("later")}
      />
    </div>
  );
}
