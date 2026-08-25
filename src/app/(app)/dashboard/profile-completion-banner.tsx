"use client";

import { ArrowRightIcon, ClipboardCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import type { ProfileCompletionField } from "@/lib/profile-completion";

const FIELD_LABELS: Record<ProfileCompletionField, string> = {
  campusEmail: "campus email",
  athleticsEmail: "Athletics email",
  personalPhone: "personal phone",
  workPhone: "work phone",
  wiscard: "Wiscard",
  studentYear: "student year",
  anticipatedGraduation: "graduation details",
  clothingSize: "clothing size",
  shoeSize: "shoe size",
  photo: "profile photo",
};

function formatMissingFields(fields: ProfileCompletionField[]) {
  const labels = fields.map((field) => FIELD_LABELS[field]);
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function ProfileCompletionBanner() {
  const { data } = useProfileCompletion();

  if (!data || data.completion.profileComplete || !data.completion.shouldPrompt) return null;

  const missingFields = data.completion.missingFields;
  if (missingFields.length === 0) return null;

  const missingCount = missingFields.length;
  const missingLabel = missingCount === 1 ? "1 detail left" : `${missingCount} details left`;
  const description = data.profile.role === "COLLABORATOR"
    ? "Add a profile photo so teammates can recognize you across the roster."
    : data.completion.operationalReady
      ? "Your working details are ready. Add the remaining profile details when you have a minute."
      : "Add the remaining contact and identification details so the team can reach you and keep handoffs moving.";

  return (
    <section
      aria-labelledby="profile-completion-banner-title"
      className="relative mb-4 overflow-hidden rounded-lg border border-[var(--blue-text)]/20 bg-[var(--blue-bg)]/[0.04] dark:bg-[var(--blue-bg)]/[0.08]"
    >
      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-[var(--blue-text)]" aria-hidden="true" />

      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--blue-text)]/15 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardCheckIcon className="size-3.5 shrink-0 text-[var(--blue-text)]" aria-hidden="true" />
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--blue-text)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Profile setup
          </span>
          <Badge variant="blue" size="sm">
            {missingLabel}
          </Badge>
        </div>
        <span className="hidden shrink-0 text-[10.5px] text-muted-foreground/60 sm:inline">
          {data.completion.completedCount} of {data.completion.totalCount} complete
        </span>
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            id="profile-completion-banner-title"
            className="text-[13px] font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
          >
            Complete your profile
          </h2>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            {description} <span className="text-muted-foreground/75">Missing: {formatMissingFields(missingFields)}.</span>
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="min-h-10 w-full sm:w-auto"
          onClick={openProfileCompletion}
        >
          Finish setup
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </section>
  );
}
