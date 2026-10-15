"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import EmptyState from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileCompletion } from "@/hooks/use-profile-completion";

export default function WelcomePage() {
  const router = useRouter();
  const { data, isLoading, isError, isFetching, refetch } = useProfileCompletion();

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
  const percent =
    data.completion.totalCount > 0
      ? Math.round((data.completion.completedCount / data.completion.totalCount) * 100)
      : 100;
  const collaborator = data.profile.role === "COLLABORATOR";
  const student = data.profile.role === "STUDENT";

  if (data.completion.profileComplete) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5 py-8">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>You’re all set, {firstName}</AlertTitle>
          <AlertDescription className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span>Your account and profile are ready for Wisconsin Creative work.</span>
            <Button className="h-10 shrink-0" onClick={() => router.replace("/")}>
              Go to dashboard
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div
      className={
        isFetching
          ? "mx-auto flex max-w-4xl flex-col gap-6 py-4 opacity-80"
          : "mx-auto flex max-w-4xl flex-col gap-6 py-4"
      }
    >
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Welcome to Wisconsin Creative</p>
        <h1 className="text-balance">Let’s get you ready, {firstName}</h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
          {collaborator
            ? "Add a profile photo so the Wisconsin Creative team can recognize you."
            : student
              ? "Add the contact, Wiscard, and student details the team needs for daily work. Apparel and a photo can wait."
              : "Add the contact and identification details the team needs for daily work. Apparel and a photo can be finished now or later."}
        </p>
        <div className="grid max-w-md gap-2 pt-1">
          <div className="flex items-center justify-between text-sm">
            <span>
              {data.completion.operationalReady
                ? "Working details ready — finish the rest when you can"
                : "Essentials first, then optional details"}
            </span>
            <span className="tabular-nums text-muted-foreground">{percent}%</span>
          </div>
          <Progress value={percent} aria-label={`${percent}% profile complete`} />
        </div>
      </header>

      <ProfileCompletionWizard
        presentation="page"
        onComplete={() => router.replace("/")}
        onSnooze={() => router.replace("/")}
      />

      <p className="text-center text-sm text-muted-foreground">
        You can continue later from Home. We’ll remind you again tomorrow.
      </p>
    </div>
  );
}
