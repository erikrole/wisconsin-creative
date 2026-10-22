"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import type { GridEvent } from "@/hooks/use-assignment-grid";
import { summarizeStudentWorkload, type WorkloadRosterEntry } from "@/lib/assignment-workload";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Props = {
  events: GridEvent[];
  loading: boolean;
  monthLabel: string;
  focusUserId: string | null;
  onFocusUser: (userId: string | null) => void;
};

async function fetchStudentRoster(): Promise<WorkloadRosterEntry[]> {
  const response = await fetch("/api/users?limit=200&active=true&role=STUDENT");
  if (handleAuthRedirect(response)) throw new DOMException("Auth redirect", "AbortError");
  if (!response.ok) throw new Error("roster fetch failed");
  const json = await parseJsonSafely<{ data?: WorkloadRosterEntry[] }>(response);
  if (!Array.isArray(json?.data)) throw new Error("roster response malformed");
  return json.data;
}

function shiftsLabel(count: number) {
  return `${count} shift${count === 1 ? "" : "s"}`;
}

/**
 * Who is carrying the month, and who has nothing yet. Tapping a person
 * highlights their cells in the grid below.
 */
export function WorkloadPanel({ events, loading, monthLabel, focusUserId, onFocusUser }: Props) {
  const [open, setOpen] = useState(true);
  const roster = useQuery({
    queryKey: ["assign-workload-roster"],
    queryFn: fetchStudentRoster,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const summary = useMemo(
    () => summarizeStudentWorkload(events, roster.data ?? null),
    [events, roster.data],
  );
  const maxShifts = summary.working[0]?.shifts ?? 0;
  const heavyCount = summary.working.filter((person) => person.heavy).length;
  const focusName = summary.working.find((person) => person.userId === focusUserId)?.name;

  return (
    <section
      aria-label="Student workload"
      className="mb-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]"
    >
      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <h2 className="text-sm font-bold">Student workload</h2>
        <p className="text-xs text-[var(--text-secondary)] tabular-nums">
          {loading
            ? "Counting shifts…"
            : [
              `${summary.working.length} working in ${monthLabel}`,
              roster.data ? `${summary.idle.length} with no shifts` : null,
              heavyCount > 0 ? `${heavyCount} heavy` : null,
            ].filter(Boolean).join(" · ")}
        </p>
        <div className="ml-auto flex items-center gap-1">
          {focusName ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 gap-1.5 text-xs"
              onClick={() => onFocusUser(null)}
            >
              <XIcon className="size-3.5" />
              Showing {focusName.split(" ")[0]}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1 text-xs text-[var(--text-secondary)]"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
            <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>

      {open && !loading ? (
        <div className="border-t border-[var(--border)] px-4 py-3">
          {summary.working.length === 0 ? (
            <p className="py-1 text-sm text-[var(--text-secondary)]">No student shifts assigned in {monthLabel} yet.</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {summary.working.map((person) => {
                const focused = focusUserId === person.userId;
                return (
                  <li key={person.userId}>
                    <button
                      type="button"
                      onClick={() => onFocusUser(focused ? null : person.userId)}
                      aria-pressed={focused}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-[var(--bg-surface)]",
                        focused && "bg-[var(--bg-surface)]",
                      )}
                    >
                      <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="xs" />
                      <span className="w-28 shrink-0 truncate text-sm">{person.name}</span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            person.heavy ? "bg-[var(--orange-text)]" : "bg-[var(--text-muted)]",
                          )}
                          style={{ width: `${maxShifts > 0 ? Math.max(8, (person.shifts / maxShifts) * 100) : 0}%` }}
                        />
                      </span>
                      <span
                        className={cn(
                          "w-24 shrink-0 text-right text-xs tabular-nums",
                          person.heavy ? "font-bold text-[var(--orange-text)]" : "text-[var(--text-secondary)]",
                        )}
                      >
                        {shiftsLabel(person.shifts)}
                        {person.hours > 0 ? ` · ${Math.round(person.hours)}h` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {summary.idle.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
              <span className="mr-1 text-xs font-bold text-[var(--text-secondary)]">No shifts yet</span>
              {summary.idle.map((person) => (
                <span
                  key={person.userId}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border)] px-2 text-xs"
                >
                  <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="xs" />
                  {person.name}
                </span>
              ))}
            </div>
          ) : roster.isError ? (
            <p className="mt-3 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
              The student list didn&apos;t load, so people with no shifts aren&apos;t shown.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
