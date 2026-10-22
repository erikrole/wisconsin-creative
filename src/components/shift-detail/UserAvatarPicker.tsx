"use client";

import { useMemo } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";
import { shiftWorkerLabelForProfile, shiftWorkerSlotLabel, shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { cn } from "@/lib/utils";
import { AREA_LABELS } from "@/types/areas";
import { FRESH_SCOPE_CLASS } from "@/lib/fonts/fresh";

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
  /** Short context line above the list, such as "Student slot · Video". */
  heading?: string;
};

type Fit = "best" | "check" | "blocked" | "unknown";

// The panel carries the fresh theme itself because it portals out of the page
// wrapper; restating the scope here keeps Schedule and Event detail consistent.
const FIT_STATUS: Record<Fit, { dot: string; pill: string }> = {
  best: { dot: "bg-[#30a46c]", pill: "bg-[var(--bg-surface)] text-[var(--text-secondary)]" },
  check: { dot: "bg-[#f76b15]", pill: "bg-[#fff1e7] text-[#bd4b00] dark:bg-[rgba(247,107,21,0.16)] dark:text-[#ff9b55]" },
  blocked: { dot: "bg-[#b9bbc6]", pill: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
  unknown: { dot: "bg-transparent", pill: "bg-[var(--bg-surface)] text-[var(--text-secondary)]" },
};

function fitFor(score: CandidateRecommendation | undefined): Fit {
  if (!score) return "unknown";
  if (score.blockingConflict) return "blocked";
  if ((score.bucket === "recommended" || score.bucket === "good_fit") && !score.advisoryConflict) return "best";
  return "check";
}

function statusLabel(fit: Fit, score: CandidateRecommendation | undefined): string | null {
  if (!score) return null;
  if (fit === "blocked") return "Unavailable";
  if (score.advisoryConflict) return "Conflict";
  const week = score.workload.weekAssignments;
  return week === 0 ? "Free this week" : `${week} this week`;
}

function detailFor(user: PickerUser, score: CandidateRecommendation | undefined, slotWorkerType: string | null | undefined) {
  const candidateWorkerType = shiftWorkerTypeForProfile(user);
  if (slotWorkerType && candidateWorkerType && candidateWorkerType !== slotWorkerType) {
    return `Will use ${shiftWorkerSlotLabel(candidateWorkerType).toLowerCase()} and leave ${shiftWorkerSlotLabel(slotWorkerType).toLowerCase()} open`;
  }
  const fallback = [shiftWorkerLabelForProfile(user) ?? "Worker", user.primaryArea ? AREA_LABELS[user.primaryArea] ?? user.primaryArea : null]
    .filter(Boolean)
    .join(" · ");
  if (!score) return fallback;
  if (score.blockingConflict) return score.advisoryConflictNote ?? score.warnings[0]?.label ?? "Can't take this shift";
  // "Student" or "Staff" slot fit is implied by the list, so lead with the next reason.
  const reason = score.reasons.filter((signal) => signal.code !== "role_fit").slice(0, 2).map((signal) => signal.label).join(" · ");
  return score.advisoryConflictNote ?? score.warnings[0]?.label ?? (reason || fallback);
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
  heading,
}: Props) {
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = users.filter((user) => !query || user.name.toLowerCase().includes(query));
    if (!candidateScores) return [{ key: "all", label: "People", users: [...matching].sort((a, b) => a.name.localeCompare(b.name)) }];
    const ranked = [...matching].sort((a, b) =>
      (candidateScores[b.id]?.score ?? -1) - (candidateScores[a.id]?.score ?? -1)
      || a.name.localeCompare(b.name),
    );
    const byFit = (fit: Fit) => ranked.filter((user) => fitFor(candidateScores[user.id]) === fit);
    return [
      { key: "best", label: "Suggested", users: byFit("best") },
      { key: "check", label: "Check first", users: [...byFit("check"), ...byFit("unknown")] },
      { key: "blocked", label: "Unavailable", users: byFit("blocked") },
    ].filter((group) => group.users.length > 0);
  }, [candidateScores, search, users]);

  const matchCount = groups.reduce((total, group) => total + group.users.length, 0);

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      className={cn(
        FRESH_SCOPE_CLASS,
        "flex w-full flex-col overflow-hidden rounded-[inherit] bg-[var(--background)] text-[var(--text)]",
      )}
    >
      {heading && (
        <div className="px-3.5 pt-3 text-xs font-bold text-[var(--text-muted)]">{heading}</div>
      )}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5">
        <SearchIcon className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <CommandPrimitive.Input
          id="user-avatar-picker-search"
          name="user-avatar-picker-search"
          value={search}
          onValueChange={onSearchChange}
          placeholder="Assign to…"
          aria-label="Search people"
          autoFocus
          className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--text-muted)]"
        />
        {scoresLoading && !loading && (
          <span className="shrink-0 text-xs text-[var(--text-muted)]">Checking availability…</span>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-1 p-1.5" aria-label="Loading people">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 px-2 py-2">
              <div className="size-8 animate-pulse rounded-full bg-[var(--bg-surface)]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-surface)]" />
                <div className="h-2.5 w-44 animate-pulse rounded bg-[var(--bg-surface)]" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3 p-4 text-sm">
          <p className="text-[var(--text-secondary)]">
            {loadError === "network"
              ? "Couldn't reach the server. Try again before assigning this slot."
              : "Couldn't load people. Try again before assigning this slot."}
          </p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <CommandPrimitive.List className="max-h-[min(22rem,var(--radix-popover-content-available-height,22rem))] overflow-y-auto overscroll-contain p-1.5">
          {matchCount === 0 && (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-secondary)]">
              {search ? `No one named "${search.trim()}"` : "No active people to assign"}
            </div>
          )}
          {groups.map((group) => (
            <CommandPrimitive.Group
              key={group.key}
              heading={group.label}
              className="[&:not(:first-child)]:mt-1.5 [&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[var(--text-muted)]"
            >
              {group.users.map((u) => {
                const score = candidateScores?.[u.id];
                const fit = fitFor(score);
                const blocked = fit === "blocked";
                const status = statusLabel(fit, score);
                return (
                  <CommandPrimitive.Item
                    key={u.id}
                    value={u.id}
                    disabled={disabled || blocked}
                    onSelect={() => onSelect(u.id)}
                    className={cn(
                      "group flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors",
                      "data-[selected=true]:bg-[var(--accent-soft)]",
                      "data-[disabled=true]:cursor-default data-[disabled=true]:opacity-55",
                    )}
                  >
                    <span className="relative shrink-0">
                      <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size="default" className={cn(blocked && "grayscale")} />
                      {fit !== "unknown" && (
                        <span
                          className={cn("absolute -bottom-px -right-px size-2.5 rounded-full ring-2 ring-[var(--background)]", FIT_STATUS[fit].dot)}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold leading-5">{u.name}</span>
                      <span className="block truncate text-[13px] leading-[18px] text-[var(--text-secondary)]">
                        {detailFor(u, score, slotWorkerType)}
                      </span>
                    </span>
                    {status && (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", FIT_STATUS[fit].pill)}>
                        {status}
                      </span>
                    )}
                  </CommandPrimitive.Item>
                );
              })}
            </CommandPrimitive.Group>
          ))}
        </CommandPrimitive.List>
      )}

      <div className="hidden items-center justify-between gap-3 border-t border-[var(--border)] px-3.5 py-2 text-xs text-[var(--text-muted)] sm:flex">
        <span>
          {scoresLoadError ? "Availability unavailable, sorted by name" : candidateScores ? "Sorted by fit" : "Sorted by name"}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-[var(--border)] px-1 font-sans">↑↓</kbd>
          <span>move</span>
          <kbd className="ml-1 rounded border border-[var(--border)] px-1 font-sans">↵</kbd>
          <span>assign</span>
        </span>
      </div>
    </CommandPrimitive>
  );
}
