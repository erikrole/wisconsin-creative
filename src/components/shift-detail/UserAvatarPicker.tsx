"use client";

import { useMemo } from "react";
import { SearchIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
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
  candidateScores?: Record<string, CandidateRecommendation>;
  scoresLoading?: boolean;
  scoresLoadError?: boolean;
  slotWorkerType?: string | null;
};

type Tone = "good" | "check" | "blocked" | "none";
type Group = { key: string; label: string | null; users: PickerUser[] };

const TONE_DOT: Record<Tone, string> = {
  good: "bg-[var(--green)]",
  check: "bg-[var(--orange)]",
  blocked: "bg-destructive",
  none: "bg-transparent",
};

function toneFor(score: CandidateRecommendation | undefined): Tone {
  if (!score) return "none";
  if (score.blockingConflict) return "blocked";
  if (score.bucket === "recommended" || score.bucket === "good_fit") {
    return score.advisoryConflict ? "check" : "good";
  }
  return "check";
}

function workloadLabel(score: CandidateRecommendation | undefined): string | null {
  if (!score) return null;
  const count = score.workload.weekAssignments;
  return count === 0 ? "Free this week" : `${count} this week`;
}

export function UserAvatarPicker({
  users,
  loading,
  loadError = false,
  onRetry,
  search,
  onSearchChange,
  onSelect,
  disabled,
  candidateScores,
  scoresLoading,
  scoresLoadError = false,
  slotWorkerType,
}: Props) {
  const groups = useMemo<Group[]>(() => {
    const query = search.trim().toLowerCase();
    const matching = users.filter((user) => !query || user.name.toLowerCase().includes(query));
    if (!candidateScores) return [{ key: "all", label: null, users: matching }];
    const ranked = [...matching].sort((a, b) =>
      (candidateScores[b.id]?.score ?? -1) - (candidateScores[a.id]?.score ?? -1)
      || a.name.localeCompare(b.name),
    );
    const tone = (user: PickerUser) => toneFor(candidateScores[user.id]);
    const best = ranked.filter((user) => tone(user) === "good");
    const check = ranked.filter((user) => tone(user) === "check" || tone(user) === "none");
    const blocked = ranked.filter((user) => tone(user) === "blocked");
    return [
      { key: "best", label: "Best fit", users: best },
      { key: "check", label: "Worth a look", users: check },
      { key: "blocked", label: "Can't take this shift", users: blocked },
    ].filter((group) => group.users.length > 0);
  }, [candidateScores, search, users]);

  const matchCount = groups.reduce((total, group) => total + group.users.length, 0);

  return (
    <div className="flex flex-col">
      <div className="relative mb-2">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id="user-avatar-picker-search"
          name="user-avatar-picker-search"
          type="text"
          className="h-10 pl-9 text-sm"
          placeholder="Search people"
          aria-label="Search people"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
        />
      </div>
      {loading ? (
        <p className="p-2 text-sm text-muted-foreground">Loading people…</p>
      ) : loadError ? (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="flex flex-col gap-2 text-sm">
            <span className="block">
              {loadError === "network"
                ? "Could not reach the server. Retry before assigning this slot."
                : "Could not load people. Retry before assigning this slot."}
            </span>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onRetry}>
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : matchCount === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">
          {search ? "No one matches that name." : "No active people found."}
        </p>
      ) : (
        <ScrollArea className="h-72 max-h-[var(--radix-popover-content-available-height)]">
          <div className="flex flex-col gap-3 pr-2">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-0.5">
                {group.label && (
                  <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
                )}
                {group.users.map((u) => {
                  const score = candidateScores?.[u.id];
                  const tone = toneFor(score);
                  const blocked = tone === "blocked";
                  const candidateWorkerType = shiftWorkerTypeForProfile(u);
                  const candidateWorkerLabel = shiftWorkerLabelForProfile(u) ?? "Worker";
                  const roleSlotNote = slotWorkerType && candidateWorkerType && candidateWorkerType !== slotWorkerType
                    ? `Fills a ${shiftWorkerSlotLabel(candidateWorkerType).toLowerCase()} instead`
                    : null;
                  const detail = blocked
                    ? score?.advisoryConflictNote ?? score?.warnings[0]?.label ?? "Unavailable"
                    : score?.warnings[0]?.label
                      ?? score?.advisoryConflictNote
                      ?? roleSlotNote
                      ?? score?.reasons[0]?.label
                      ?? `${candidateWorkerLabel}${u.primaryArea ? ` · ${AREA_LABELS[u.primaryArea] ?? u.primaryArea}` : ""}`;
                  const workload = workloadLabel(score);
                  return (
                    <Button
                      key={u.id}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-auto min-h-12 w-full justify-start gap-3 rounded-md px-2 py-1.5 text-left font-normal hover:bg-accent focus-visible:bg-accent",
                        blocked && "opacity-60",
                      )}
                      onClick={() => onSelect(u.id)}
                      disabled={disabled || blocked}
                    >
                      <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{u.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {tone !== "none" && <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />}
                          <span className="truncate">{detail}</span>
                        </span>
                      </span>
                      {workload && !blocked && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{workload}</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
      {scoresLoading && !loading && (
        <p className="mt-1 px-2 text-xs text-muted-foreground">Checking availability…</p>
      )}
      {scoresLoadError && (
        <p className="mt-1 px-2 text-xs text-[var(--orange-text)]">
          Availability unavailable. People are shown alphabetically.
        </p>
      )}
    </div>
  );
}
