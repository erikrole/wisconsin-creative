"use client";

import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import { PROFILE_FIELD_LABELS } from "@/lib/profile-completion";
import { useProfileCompletion } from "@/hooks/use-profile-completion";

export function ProfileCompletionNotice() {
  const { data, isLoading, isError } = useProfileCompletion();
  if (isLoading || isError || !data) return null;

  if (data.completion.isComplete) return null;

  const collaborator = data.profile.role === "COLLABORATOR";

  return (
    <Alert className="mb-4 border-[var(--orange)]/50 bg-[var(--orange-bg)]">
      <AlertCircleIcon />
      <AlertTitle>Complete your profile</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          {collaborator
            ? "Add a profile photo so teammates can recognize you across the roster."
            : `${data.completion.completedCount} of ${data.completion.totalCount} details are complete. Add the remaining information so contact, Wiscard, and apparel records stay useful.`}
        </p>
        <div className="flex flex-wrap gap-2" aria-label="Missing profile details">
          {data.completion.missingFields.map((field) => (
            <Badge key={field} variant="orange" size="sm">
              Needed: {PROFILE_FIELD_LABELS[field]}
            </Badge>
          ))}
        </div>
        <div>
          <Button className="h-10" type="button" onClick={openProfileCompletion}>
            Complete profile
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
