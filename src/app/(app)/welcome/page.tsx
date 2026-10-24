"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { useCurrentUser } from "@/hooks/use-current-user";
import { clearLocalTraces } from "@/lib/local-traces";
import { WelcomeDone } from "./WelcomeDone";

export default function WelcomePage() {
  const query = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data, isLoading, isError, isFetching, refetch } = useProfileCompletion();
  const [outcome, setOutcome] = useState<"complete" | "later" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const signOut = async () => {
    setSigningOut(true); setSignOutError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Couldn’t sign out. Check your connection and retry.");
      clearLocalTraces(); query.clear(); window.location.replace("/login");
    } catch (reason) { setSignOutError(reason instanceof Error ? reason.message : "Couldn’t sign out."); setSigningOut(false); }
  };
  const exitAction = user?.onboardingRequired
    ? <Button variant="outline" disabled={signingOut} onClick={() => { void signOut(); }}>Sign out</Button>
    : <Button variant="outline" onClick={() => window.location.replace("/")}>Go to dashboard</Button>;

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
          description="Check your connection and try again. Your saved answers will be here when you return."
          actionLabel="Try again"
          onAction={() => {
            void refetch();
          }}
        />
        <div className="mt-4 flex justify-center">
          {exitAction}
          {signOutError && <p role="alert">{signOutError}</p>}
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
          description="Sign in again if this keeps happening. Saved answers stay with your account."
          actionLabel="Try again"
          onAction={() => { void refetch(); }}
        />
        <div className="mt-4 flex justify-center">{exitAction}</div>
      </div>
    );
  }

  const firstName = data.profile.name.split(" ")[0] || data.profile.name;
  const collaborator = data.profile.role === "COLLABORATOR";
  const student = data.profile.role === "STUDENT";
  const goHome = () => window.location.replace("/");

  if (outcome || data.completion.onboardingComplete) {
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
              ? "A few details so the team can reach you and schedule you. Answers save to your account as you go, so you can continue here or in the iPhone app. Your photo and Wiscard are optional."
              : "A few details so the team can reach you and identify you at the kiosk. Answers save to your account as you go, so you can continue here or in the iPhone app. Your photo and Wiscard are optional."}
        </p>
      </header>

      <ProfileCompletionWizard
        presentation="page"
        onComplete={() => window.location.replace("/welcome")}
        onSnooze={() => setOutcome("later")}
      />
    </div>
  );
}
