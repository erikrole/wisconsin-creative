"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, UserRound } from "lucide-react";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileCompletion } from "@/hooks/use-profile-completion";

export default function WelcomePage() {
  const router = useRouter();
  const { data, isLoading } = useProfileCompletion();

  if (isLoading || !data) {
    return <Card className="mx-auto max-w-3xl"><CardContent className="grid gap-4 p-8"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-full" /><Skeleton className="h-28 w-full" /></CardContent></Card>;
  }

  const percent = data.completion.totalCount > 0
    ? Math.round((data.completion.completedCount / data.completion.totalCount) * 100)
    : 100;
  const collaborator = data.profile.role === "COLLABORATOR";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 py-4">
      <Card className="overflow-hidden">
        <div className="h-1 bg-[var(--wi-red)]" />
        <CardHeader className="gap-3 p-7 sm:p-9">
          <Badge variant="gray" className="w-fit">Welcome to Wisconsin Creative</Badge>
          <div className="grid gap-2">
            <CardTitle asChild className="text-3xl">
              <h1>Let’s set up your account, {data.profile.name.split(" ")[0]}</h1>
            </CardTitle>
            <CardDescription className="max-w-2xl text-base">
              {collaborator
                ? "Add a profile photo so the Wisconsin Creative team can recognize you."
                : "Add the contact and identification details the team needs for daily work. Apparel and a photo can be finished now or later."}
            </CardDescription>
          </div>
          <div className="grid gap-2 pt-2">
            <div className="flex items-center justify-between text-sm"><span>Profile progress</span><span className="tabular-nums text-muted-foreground">{percent}%</span></div>
            <Progress value={percent} aria-label={`${percent}% profile complete`} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 border-t p-7 sm:grid-cols-2 sm:p-9">
          <div className="flex gap-3"><ClipboardCheck className="mt-0.5 size-5 text-[var(--wi-red)]" /><div><p className="font-medium">Operationally ready</p><p className="text-sm text-muted-foreground">{data.completion.operationalReady ? "You have supplied the essentials needed for access." : collaborator ? "Your welcome setup is ready; a photo can be added anytime." : "Complete contact, Wiscard, and student details where applicable."}</p></div></div>
          <div className="flex gap-3"><UserRound className="mt-0.5 size-5 text-[var(--wi-red)]" /><div><p className="font-medium">Profile complete</p><p className="text-sm text-muted-foreground">{data.completion.profileComplete ? "Your full profile is complete." : collaborator ? "Add a photo if you want a complete profile." : "Add apparel, shoe sizing, and a photo for a complete profile."}</p></div></div>
        </CardContent>
      </Card>

      {data.completion.profileComplete && (
        <Alert><CheckCircle2 /><AlertTitle>You’re all set</AlertTitle><AlertDescription className="flex items-center justify-between gap-4"><span>Your account and profile are ready.</span><Button onClick={() => router.replace("/")}>Go to dashboard</Button></AlertDescription></Alert>
      )}

      <p className="text-center text-sm text-muted-foreground">You can continue later. We’ll remind you again tomorrow.</p>
      <ProfileCompletionWizard onComplete={() => router.replace("/")} onSnooze={() => router.replace("/")} />
    </div>
  );
}
