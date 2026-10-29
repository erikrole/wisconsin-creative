"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminOnlyLabel } from "@/components/booking-details/AdminOnlyLabel";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatDateShortCentral } from "@/lib/format";
import { ONBOARDING_NOTE_MAX, type OnboardingChecklist, type OnboardingRow } from "@/lib/onboarding-checklist";
import { type ApiEnvelope } from "./user-info-helpers";

type Change = { step: string; done?: boolean; note?: string };

function NoteButton({ row, busy, onSave }: { row: OnboardingRow; busy: boolean; onSave: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(row.note ?? "");
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(row.note ?? ""); }}>
      <PopoverTrigger asChild>
        <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline">
          {row.note ? "Edit note" : "Add note"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => { event.preventDefault(); onSave(draft); setOpen(false); }}
        >
          <Input value={draft} maxLength={ONBOARDING_NOTE_MAX} onChange={(event) => setDraft(event.target.value)} aria-label={`${row.label} note`} autoFocus />
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function GuideDialog({ rows, onClose, onSave, busy }: {
  rows: OnboardingRow[];
  onClose: () => void;
  onSave: (guide: Record<string, { contact: string; note: string }>) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, { contact: string; note: string }>>(() => Object.fromEntries(rows.map((row) => [row.key, { contact: row.contact ?? "", note: row.hint ?? "" }])));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>Who to contact</DialogTitle>
        <DialogDescription>Shown on every student&apos;s checklist.</DialogDescription>
        <DialogBody className="flex flex-col gap-4">
          {rows.map((row) => {
            const current = draft[row.key] ?? { contact: "", note: "" };
            return (
            <div key={row.key} className="flex flex-col gap-1.5">
              <p className="m-0 text-sm font-bold">{row.label}</p>
              <Input
                placeholder="Who to reach out to"
                value={current.contact}
                maxLength={120}
                onChange={(event) => setDraft({ ...draft, [row.key]: { ...current, contact: event.target.value } })}
                aria-label={`${row.label} contact`}
              />
              <Input
                placeholder="Notes"
                value={current.note}
                maxLength={300}
                onChange={(event) => setDraft({ ...draft, [row.key]: { ...current, note: event.target.value } })}
                aria-label={`${row.label} notes`}
              />
            </div>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSave(draft)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The checklist itself, so the preview lab can render it without a server. */
export function OnboardingChecklistView({
  checklist,
  onChange,
  onSaveGuide,
  busy = false,
}: {
  checklist: OnboardingChecklist;
  onChange: (change: Change) => void;
  onSaveGuide: (guide: Record<string, { contact: string; note: string }>) => void;
  busy?: boolean;
}) {
  const [editingGuide, setEditingGuide] = useState(false);
  return (
    <Card id="onboarding" className="scroll-mt-16 rounded-xl shadow-xs">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-black tracking-tight">Onboarding</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs"><AdminOnlyLabel>Admins only</AdminOnlyLabel></span>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Edit contacts and notes" onClick={() => setEditingGuide(true)}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={(checklist.done / checklist.total) * 100} className="h-1.5" aria-label="Onboarding progress" />
          <span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{checklist.done} of {checklist.total}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <ul className="m-0 list-none p-0">
          {checklist.rows.map((row) => (
            <li key={row.key} className="flex min-h-11 items-start gap-3 border-t border-border/50 px-6 py-2.5 first:border-t-0">
              <span className="flex h-6 items-center">
                {row.manual ? (
                  <Checkbox
                    checked={row.done}
                    disabled={busy}
                    onCheckedChange={(next) => onChange({ step: row.key, done: next === true })}
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
              </span>
              <div className="min-w-0 flex-1">
                <p className={row.done ? "m-0 text-sm leading-6" : "m-0 text-sm leading-6 text-muted-foreground"}>
                  {row.label}
                  {row.optional && <span className="ml-1.5 text-xs text-muted-foreground">Optional</span>}
                  {!row.manual && <span className="sr-only">{row.done ? ", done" : ", not yet"}</span>}
                </p>
                {row.manual && (row.contact || row.hint) && !row.done && (
                  <p className="m-0 text-xs text-muted-foreground">{[row.contact, row.hint].filter(Boolean).join(" · ")}</p>
                )}
                {row.note && <p className="m-0 text-xs text-muted-foreground">{row.note}</p>}
              </div>
              {row.doneAt && (
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                  <span>{row.doneBy ? `${row.doneBy.split(" ")[0]} · ` : ""}{formatDateShortCentral(row.doneAt)}</span>
                  <NoteButton row={row} busy={busy} onSave={(note) => onChange({ step: row.key, note })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      {editingGuide && (
        <GuideDialog
          rows={checklist.rows.filter((row) => row.manual)}
          busy={busy}
          onClose={() => setEditingGuide(false)}
          onSave={(guide) => { onSaveGuide(guide); setEditingGuide(false); }}
        />
      )}
    </Card>
  );
}

export function OnboardingChecklistCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["users", userId, "onboarding-checklist"];
  const url = `/api/users/${userId}/onboarding-checklist`;

  async function send<T>(input: string, method: string, body: unknown, fallback: string) {
    const res = await fetch(input, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (handleAuthRedirect(res)) throw new Error("Signed out");
    if (!res.ok) throw new Error(await parseErrorMessage(res, fallback));
    return (await parseJsonSafely<ApiEnvelope<T>>(res))!.data!;
  }

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

  const update = useMutation({
    mutationFn: (change: Change) => send<OnboardingChecklist>(url, "PATCH", change, "Failed to update onboarding"),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to update onboarding"),
  });

  const saveGuide = useMutation({
    mutationFn: (guide: Record<string, { contact: string; note: string }>) => send("/api/settings/onboarding-guide", "PUT", { guide }, "Failed to save contacts"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save contacts"),
  });

  if (!data) return <Skeleton className="h-72 rounded-xl" />;
  return (
    <OnboardingChecklistView
      checklist={data}
      busy={update.isPending || saveGuide.isPending}
      onChange={(change) => update.mutate(change)}
      onSaveGuide={(guide) => saveGuide.mutate(guide)}
    />
  );
}
