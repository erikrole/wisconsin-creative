"use client";

import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import type { ProfileCompletionField } from "@/lib/profile-completion";
import { useProfileCompletion } from "@/hooks/use-profile-completion";

const FIELD_LABELS: Record<ProfileCompletionField, string> = {
  campusEmail: "Campus login email",
  athleticsEmail: "Athletics email",
  personalPhone: "Personal phone",
  workPhone: "Work phone",
  wiscard: "Wiscard",
  studentYear: "Year",
  anticipatedGraduation: "Anticipated graduation",
  clothingSize: "Clothing size",
  shoeSize: "Shoe size",
  photo: "Profile photo",
};

export function ProfileCompletionNotice() {
  const { data, isLoading, isError } = useProfileCompletion();
  if (isLoading || isError || !data) return null;

  if (data.completion.isComplete) return null;

  return (
    <Alert className="mb-4 border-[var(--orange)]/50 bg-[var(--orange-bg)]">
      <AlertCircleIcon />
      <AlertTitle>Complete your profile</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          {data.completion.completedCount} of {data.completion.totalCount} details are complete. Add the remaining information so contact, student, Wiscard, and apparel records stay useful.
        </p>
        <div className="flex flex-wrap gap-2" aria-label="Missing profile details">
          {data.completion.missingFields.map((field) => (
            <Badge key={field} variant="orange" size="sm">Needed: {FIELD_LABELS[field]}</Badge>
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
