"use client";

import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  filterCandidatesByConflict,
  type CandidateConflictFilter,
} from "@/lib/assignment-conflict-review";
import type { CandidateRecommendation, CandidateScoreBucket } from "@/lib/candidate-scoring-types";
import { shiftWorkerLabelForProfile, shiftWorkerSlotLabel, shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { cn } from "@/lib/utils";
import { AREA_LABELS } from "@/types/areas";

export type PickerUser = {
  id: string;
  name: string;
  role: string;
  staffingType?: string | null;
  collaboratorPolicy?: {
    status: string;
    capabilities?: string[];
  } | null;
  primaryArea: string | null;
  avatarUrl?: string | null;
};

type Props = {
  users: PickerUser[];
  loading: boolean;
  loadError?: false | "network" | "server";
  onRetry?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (userId: string) => void;
  disabled: boolean;
  /** Map of userId to conflict note for users with scheduling conflicts */
  conflictMap?: Record<string, string>;
  conflictsLoading?: boolean;
  candidateScores?: Record<string, CandidateRecommendation>;
  scoresLoading?: boolean;
  scoresLoadError?: boolean;
  slotWorkerType?: string | null;
};

const SCORE_BUCKET_LABELS: Record<CandidateScoreBucket, string> = {
  recommended: "Recommended",
  good_fit: "Good fit",
  warning: "Warning",
  overloaded: "Overloaded",
};

const SCORE_BUCKET_ORDER: CandidateScoreBucket[] = ["recommended", "good_fit", "warning", "overloaded"];

const SCORE_BUCKET_BADGE: Record<CandidateScoreBucket, "default" | "secondary" | "orange" | "destructive"> = {
  recommended: "default",
  good_fit: "secondary",
  warning: "orange",
  overloaded: "destructive",
};

export function UserAvatarPicker({
  users,
  loading,
  loadError = false,
  onRetry,
  search,
  onSearchChange,
  onSelect,
  disabled,
  conflictMap,
  conflictsLoading,
  candidateScores,
  scoresLoading,
  scoresLoadError = false,
  slotWorkerType,
}: Props) {
  const [conflictFilter, setConflictFilter] = useState<CandidateConflictFilter>("all");
  const canFilterConflicts = Boolean(conflictMap);
  const filteredUsers = useMemo(
    () => filterCandidatesByConflict(users, conflictMap, conflictFilter),
    [conflictFilter, conflictMap, users],
  );
  const groupedUsers = useMemo(() => {
    if (!candidateScores) {
      return [{ key: "all", label: null, users: [...filteredUsers].sort((a, b) => a.name.localeCompare(b.name)) }];
    }
    const rankedUsers = [...filteredUsers].sort((a, b) =>
      (candidateScores[b.id]?.score ?? -1) - (candidateScores[a.id]?.score ?? -1)
      || a.name.localeCompare(b.name),
    );
    const groups: Array<{ key: string; label: string | null; users: PickerUser[] }> = SCORE_BUCKET_ORDER.map((bucket) => ({
      key: bucket,
      label: SCORE_BUCKET_LABELS[bucket],
      users: rankedUsers.filter((user) => candidateScores[user.id]?.bucket === bucket),
    })).filter((group) => group.users.length > 0);
    const unscored = rankedUsers.filter((user) => !candidateScores[user.id]);
    if (unscored.length > 0) groups.push({ key: "unscored", label: "Other", users: unscored });
    return groups;
  }, [candidateScores, filteredUsers]);
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Input
          id="user-avatar-picker-search"
          name="user-avatar-picker-search"
          type="text"
          className="h-10 text-sm"
          placeholder="Search by name"
          aria-label="Search people by name"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" aria-live="polite">
          {filteredUsers.length} {filteredUsers.length === 1 ? "person" : "people"}
        </span>
      </div>
      {canFilterConflicts && (
        <div className="mb-3 border-b border-border/50 pb-2">
          <ToggleGroup
            type="single"
            value={conflictFilter}
            onValueChange={(value) => {
              if (value) setConflictFilter(value as CandidateConflictFilter);
            }}
            className="grid w-full grid-cols-3 gap-1"
            aria-label="Filter assignment candidates by conflict state"
          >
            <ToggleGroupItem value="all" className="h-8 px-2 text-[11px]">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="conflicts" className="h-8 px-2 text-[11px]">
              Conflicts
            </ToggleGroupItem>
            <ToggleGroupItem value="clean" className="h-8 px-2 text-[11px]">
              Clean
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground p-2">Loading users...</p>
      ) : loadError ? (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="flex flex-col gap-2 text-xs">
            <span className="block">
              {loadError === "network"
                ? "Could not reach the server. Retry before assigning this slot."
                : "Could not load assignable users. Retry before assigning this slot."}
            </span>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onRetry}>
                Retry users
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : scoresLoading && !candidateScores ? (
        <p role="status" className="text-xs text-muted-foreground p-2">Ranking candidates...</p>
      ) : filteredUsers.length === 0 ? (
        <p className="text-xs text-muted-foreground p-2">
          {search.trim()
            ? "No matching users."
            : conflictFilter === "conflicts"
              ? "No conflicted candidates for this slot."
              : conflictFilter === "clean"
                ? "No clean candidates for this slot."
                : "No active users found."}
        </p>
      ) : (
        <ScrollArea className="h-72 max-h-[var(--radix-popover-content-available-height)]">
          <div className="flex flex-col gap-1 pr-2">
            {groupedUsers.map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                {group.label && (
                  <div className="flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span>{group.label}</span>
                    <span className="tabular-nums">{group.users.length}</span>
                  </div>
                )}
                {group.users.map((u) => {
                  const conflict = conflictMap?.[u.id];
                  const score = candidateScores?.[u.id];
                  const topReason = score?.warnings[0]?.label ?? score?.reasons[0]?.label;
                  const candidateWorkerType = shiftWorkerTypeForProfile(u);
                  const candidateWorkerLabel = shiftWorkerLabelForProfile(u) ?? "Worker";
                  const roleSlotNote = slotWorkerType && candidateWorkerType && candidateWorkerType !== slotWorkerType
                    ? `Will use ${shiftWorkerSlotLabel(candidateWorkerType).toLowerCase()} and leave ${shiftWorkerSlotLabel(slotWorkerType).toLowerCase()} open.`
                    : null;
                  return (
                    <Button
                      key={u.id}
                      type="button"
                      variant="ghost"
                      className="min-h-12 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-[background-color,color,scale] hover:bg-accent active:scale-[0.96] disabled:opacity-50"
                      onClick={() => onSelect(u.id)}
                      disabled={disabled}
                      title={topReason ?? roleSlotNote ?? conflict ?? undefined}
                      aria-label={[
                        u.name,
                        candidateWorkerLabel,
                        conflict ? `conflict: ${conflict}` : null,
                        score ? `${SCORE_BUCKET_LABELS[score.bucket]}, score ${score.score}` : null,
                      ].filter(Boolean).join(", ")}
                    >
                      <div className="relative shrink-0">
                        <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                        {conflict && (
                          <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border border-background bg-[var(--orange)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{u.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {candidateWorkerLabel}
                          {u.primaryArea ? ` · ${AREA_LABELS[u.primaryArea] ?? u.primaryArea}` : ""}
                        </div>
                        {(conflict ?? topReason ?? roleSlotNote) && (
                          <div className={cn("truncate text-[11px]", conflict ? "text-[var(--orange-text)]" : "text-muted-foreground")}>
                            {conflict ?? topReason ?? roleSlotNote}
                          </div>
                        )}
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {conflict && (
                          <Badge variant="orange" size="sm" className="px-1.5 py-0 text-[9px]">Conflict</Badge>
                        )}
                        {score && (
                          <Badge
                            variant={SCORE_BUCKET_BADGE[score.bucket]}
                            size="sm"
                            className={cn(
                              "px-1.5 py-0 text-[9px] tabular-nums",
                              score.bucket === "recommended" && "bg-[var(--green)] text-white hover:bg-[var(--green)]",
                            )}
                          >
                            {score.score}
                          </Badge>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      {(conflictsLoading || scoresLoading) && (
        <p className="mt-1 px-1.5 text-[10px] text-muted-foreground">
          {scoresLoading ? "Scoring candidates..." : "Checking availability..."}
        </p>
      )}
      {scoresLoadError && (
        <p className="mt-1 px-1.5 text-[10px] text-[var(--orange-text)]">
          Ranking unavailable. Candidates are shown alphabetically.
        </p>
      )}
    </>
  );
}
