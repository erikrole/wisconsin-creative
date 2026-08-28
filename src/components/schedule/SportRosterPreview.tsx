"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS,
  SPORT_AUTO_ASSIGN_POLICY_LABELS,
} from "@/lib/sport-auto-assign-policy";
import type { SportRosterPreviewResponse } from "@/lib/services/sport-roster-preview";

type SportRosterPreviewProps = {
  roster: SportRosterPreviewResponse | null;
  loading: boolean;
  error: string | null;
  /** Opens the sport setup wizard at this sport. */
  onEditSport: (sportCode: string) => void;
};

/** Cap the inline names; the roster page owns the full list. */
const MAX_NAMES = 6;

function nameList(members: { id: string; name: string }[]) {
  const shown = members.slice(0, MAX_NAMES).map((member) => member.name);
  const extra = members.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

/**
 * What auto assignment will do for each selected sport, and who it can draw
 * from, shown beside the sport picker.
 *
 * Assignment is purely roster-based and each sport carries its own policy, so
 * the two most common reasons a run comes back empty -- nobody on the roster,
 * or the sport held back on purpose -- are both visible before the preview is
 * ever built, next to the control that changes them.
 */
export function SportRosterPreview({ roster, loading, error, onEditSport }: SportRosterPreviewProps) {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Loading sport assignments…
      </p>
    );
  }
  if (error) {
    return <p className="text-xs text-[var(--orange-text)]" role="alert">{error}</p>;
  }
  if (!roster || roster.sports.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {roster.sports.map((sport) => (
        <div
          key={sport.sportCode}
          className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{sport.label}</span>
              <Badge variant={sport.policy === "HOLD" ? "orange" : sport.policy === "STAFF_ONLY" ? "blue" : "gray"} size="sm">
                {SPORT_AUTO_ASSIGN_POLICY_LABELS[sport.policy]}
              </Badge>
              {sport.total === 0 ? (
                <Badge variant="orange" size="sm">Nobody assigned</Badge>
              ) : (
                <Badge variant="gray" size="sm">
                  {sport.total} assigned
                </Badge>
              )}
            </div>
            {sport.policy === "HOLD" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS.HOLD} Nothing in this sport will be proposed or staged.
              </p>
            ) : sport.total === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Auto assign only proposes people on a sport&apos;s roster, so this sport will produce nothing.
              </p>
            ) : (
              <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {sport.staff.length > 0 ? (
                  <span><span className="font-medium text-foreground/80">Staff</span> · {nameList(sport.staff)}</span>
                ) : null}
                {sport.students.length > 0 ? (
                  <span>
                    <span className="font-medium text-foreground/80">Students</span> · {nameList(sport.students)}
                    {sport.policy === "STAFF_ONLY" ? " (request their own slots)" : ""}
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 shrink-0 text-xs"
            onClick={() => onEditSport(sport.sportCode)}
          >
            <SlidersHorizontalIcon data-icon="inline-start" className="size-3.5" />
            Change
          </Button>
        </div>
      ))}
    </div>
  );
}
