"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "@/lib/toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminOnlyLabel } from "@/components/booking-details/AdminOnlyLabel";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatDateShortCentral } from "@/lib/format";
import type { OnboardingChecklist } from "@/lib/onboarding-checklist";
import { type ApiEnvelope } from "./user-info-helpers";

/** The checklist itself, so the preview lab can render it without a server. */
export function OnboardingChecklistView({
  checklist,
  onToggle,
  busy = false,
}: {
  checklist: OnboardingChecklist;
  onToggle: (step: string, done: boolean) => void;
  busy?: boolean;
}) {
  return (
    <Card id="onboarding" className="scroll-mt-16 rounded-xl shadow-xs">
      <CardHeader className="gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base font-black tracking-tight">Onboarding</CardTitle>
          <span className="text-xs"><AdminOnlyLabel>Admins only</AdminOnlyLabel></span>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={(checklist.done / checklist.total) * 100} className="h-1.5" aria-label="Onboarding progress" />
          <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{checklist.done} of {checklist.total}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <ul className="m-0 list-none p-0">
          {checklist.rows.map((row) => (
            <li key={row.key} className="flex min-h-11 items-center gap-3 border-t border-border/50 px-6 py-2 first:border-t-0">
              {row.manual ? (
                <Checkbox
                  checked={row.done}
                  disabled={busy}
                  onCheckedChange={(next) => onToggle(row.key, next === true)}
                  aria-label={row.label}
                />
              ) : (
                <span
                  aria-hidden
                  className={row.done
                    ? "flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-white"
                    : "size-4 shrink-0 rounded-full border border-input"}
                >
                  {row.done && <Check className="size-3" strokeWidth={3} />}
                </span>
              )}
              <span className={row.done ? "min-w-0 flex-1 text-sm" : "min-w-0 flex-1 text-sm text-muted-foreground"}>
                {row.label}
                {row.optional && <span className="ml-1.5 text-xs text-muted-foreground">Optional</span>}
                {!row.manual && <span className="sr-only">{row.done ? ", done" : ", not yet"}</span>}
              </span>
              {row.doneAt && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.doneBy ? `${row.doneBy.split(" ")[0]} · ` : ""}{formatDateShortCentral(row.doneAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function OnboardingChecklistCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["users", userId, "onboarding-checklist"];
  const url = `/api/users/${userId}/onboarding-checklist`;

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(url);
      if (handleAuthRedirect(res)) throw new Error("Signed out");
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load onboarding"));
      return (await parseJsonSafely<ApiEnvelope<OnboardingChecklist>>(res))!.data!;
    },
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: async ({ step, done }: { step: string; done: boolean }) => {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, done }),
      });
      if (handleAuthRedirect(res)) throw new Error("Signed out");
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to update onboarding"));
      return (await parseJsonSafely<ApiEnvelope<OnboardingChecklist>>(res))!.data!;
    },
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update onboarding"),
  });

  if (!data) return <Skeleton className="h-72 rounded-xl" />;
  return (
    <OnboardingChecklistView
      checklist={data}
      busy={toggle.isPending}
      onToggle={(step, done) => toggle.mutate({ step, done })}
    />
  );
}
