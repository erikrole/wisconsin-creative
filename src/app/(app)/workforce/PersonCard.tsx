"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { TERM_LABELS } from "@/lib/hiring/contract";
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { AREA_LABEL, AREA_OPTIONS, messageOf } from "./hiring/types";

export type PersonCardData = {
  id: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  kind: "FULL_TIME" | "STUDENT";
  standing: string | null;
  graduation: string | null;
  graduatesThisYear: boolean;
  sports: string[];
  academicYearEnd: number;
  selectedTerm?: keyof typeof TERM_LABELS;
  selectedYear?: number;
  historical?: boolean;
  manager?: string | null;
  basis?: "profile" | "recorded" | "projected";
  unknownGraduation?: boolean;
};

type Placement = { id: string; term: keyof typeof TERM_LABELS; year: number; area: string | null; sportCodes: string[]; notes: string | null };
type PersonDetail = {
  id: string;
  staffingType: "FT" | "ST";
  name: string;
  startTerm: keyof typeof TERM_LABELS | null;
  startTermYear: number | null;
  termPlacements: Placement[];
};

export function PersonCard({ person }: { person: PersonCardData }) {
  const [open, setOpen] = useState(false);
  const subtitle =
    person.kind === "FULL_TIME"
      ? (person.title ?? "Full-time")
      : [person.standing, person.graduation ? `grad ${person.graduation}` : null].filter(Boolean).join(" · ") || "Student";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="default" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{person.name}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {person.manager && <p className="mt-1 text-xs text-muted-foreground">Reports to {person.manager}</p>}
          {person.kind === "STUDENT" && person.basis && person.basis !== "profile" && <p className="mt-1 text-xs text-muted-foreground">{person.basis === "recorded" ? "Placement recorded" : person.basis === "projected" ? person.unknownGraduation ? "Projected · graduation incomplete" : "Projected return" : "Current profile"}</p>}
          {person.sports.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {person.sports.slice(0, 4).map((s) => (
                <Badge key={s} variant="gray" size="sm">
                  {s}
                </Badge>
              ))}
              {person.sports.length > 4 && <span className="text-xs text-muted-foreground">+{person.sports.length - 4}</span>}
            </p>
          )}
        </div>
        {person.graduatesThisYear && !person.historical && (
          <Badge variant="orange" size="sm">
            Graduating
          </Badge>
        )}
      </button>
      {open && <PersonSheet person={person} onClose={() => setOpen(false)} />}
    </>
  );
}

function PersonSheet({ person, onClose }: { person: PersonCardData; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startTerm, setStartTerm] = useState("");
  const [startYear, setStartYear] = useState("");
  const [form, setForm] = useState({ term: person.selectedTerm ?? "FALL", year: String(person.selectedYear ?? person.academicYearEnd - 1), area: "", notes: "" });
  const [sports, setSports] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workforce/people/${person.id}`);
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: PersonDetail }>(res);
      if (!res.ok || !json?.data) throw new Error(messageOf(json, "Could not load this person."));
      setDetail(json.data);
      setStartTerm(json.data.startTerm ?? "");
      setStartYear(json.data.startTermYear ? String(json.data.startTermYear) : "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this person.");
    }
  }, [person.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEditPlacements = person.kind === "STUDENT" && detail?.staffingType === "ST";

  useEffect(() => {
    if (!detail) return;
    const existing = detail.termPlacements.find(placement => placement.term === form.term && placement.year === Number(form.year));
    setForm(value => ({ ...value, area: existing?.area ?? "", notes: existing?.notes ?? "" }));
    setSports(existing?.sportCodes ?? []);
  }, [detail, form.term, form.year]);

  async function send(url: string, init: RequestInit, failure: string) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      if (handleAuthRedirect(res)) return false;
      if (!res.ok) throw new Error(await parseErrorMessage(res, failure));
      await load();
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveStart = () =>
    send(
      `/api/workforce/people/${person.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startTerm && startYear ? { startTerm, startTermYear: Number(startYear) } : { startTerm: null, startTermYear: null }),
      },
      "Could not save the start term.",
    );

  async function addPlacement(e: React.FormEvent) {
    e.preventDefault();
    await send(
      `/api/workforce/people/${person.id}/placements`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term: form.term,
          year: Number(form.year),
          area: form.area || null,
          sportCodes: sports,
          notes: form.notes || null,
        }),
      },
      "Could not save the placement.",
    );
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>
            {person.kind === "FULL_TIME" ? (person.title ?? "Full-time") : "Student"}
            {" · "}
            <Link href={`/users/${person.id}`} className="underline underline-offset-2">
              Open full profile
            </Link>
          </SheetDescription>
        </SheetHeader>

        {error && (
          <div role="alert" className="flex items-center gap-3 px-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Retry</Button></div>
        )}
        {!detail && !error && <Skeleton className="mx-4 h-48" />}

        {detail && person.kind === "FULL_TIME" && (
          <p className="px-4 text-sm text-muted-foreground">Start terms and term placements are recorded for student workers only.</p>
        )}
        {detail && person.kind === "STUDENT" && (
          <div className="grid gap-6 px-4 pb-6">
            {!canEditPlacements && <p className="text-sm text-muted-foreground">This person is now staff. Their recorded intern placements remain available here.</p>}
            {canEditPlacements && <section aria-label="Start term" className="grid gap-2">
              <h3 className="text-sm font-semibold">Started</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="start-term">Term</Label>
                  <NativeSelect id="start-term" className="w-32" value={startTerm} onChange={(e) => setStartTerm(e.target.value)}>
                    <option value="">—</option>
                    {Object.entries(TERM_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="start-year">Year</Label>
                  <Input id="start-year" className="w-24" inputMode="numeric" value={startYear} onChange={(e) => setStartYear(e.target.value)} />
                </div>
                <Button variant="outline" disabled={busy || Boolean(startTerm) !== Boolean(startYear)} onClick={() => void saveStart()}>
                  Save
                </Button>
              </div>
            </section>}

            <section aria-label="Term placements" className="grid gap-3">
              <h3 className="text-sm font-semibold">Placements by term</h3>
              {detail.termPlacements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No placements recorded yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {detail.termPlacements.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {TERM_LABELS[p.term]} {p.year}
                          {p.area ? <span className="font-normal text-muted-foreground"> · {AREA_LABEL[p.area] ?? p.area}</span> : null}
                        </p>
                        {p.sportCodes.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-1">
                            {p.sportCodes.map((c) => (
                              <Badge key={c} variant="gray" size="sm" title={sportLabel(c)}>
                                {c}
                              </Badge>
                            ))}
                          </p>
                        )}
                        {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
                      </div>
                      {canEditPlacements && <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Remove ${TERM_LABELS[p.term]} ${p.year} placement`}
                        disabled={busy}
                        onClick={() => void send(`/api/workforce/people/${person.id}/placements?placementId=${p.id}`, { method: "DELETE" }, "Could not remove the placement.")}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>}
                    </li>
                  ))}
                </ul>
              )}

              {canEditPlacements && <form onSubmit={addPlacement} className="grid gap-3 rounded-md border border-dashed p-3">
                <p className="text-sm font-medium">Add or update a term</p>
                <div className="grid grid-cols-3 gap-2">
                  <NativeSelect aria-label="Term" value={form.term} onChange={(e) => setForm((f) => ({ ...f, term: e.target.value as keyof typeof TERM_LABELS }))}>
                    {Object.entries(TERM_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input aria-label="Year" inputMode="numeric" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
                  <NativeSelect aria-label="Area" value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}>
                    <option value="">No area</option>
                    {AREA_OPTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1 text-xs text-muted-foreground">Sports</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {SPORT_CODES.map((s) => {
                      const on = sports.includes(s.code);
                      return (
                        <button
                          key={s.code}
                          type="button"
                          aria-pressed={on}
                          title={s.label}
                          onClick={() => setSports((list) => (on ? list.filter((c) => c !== s.code) : [...list, s.code]))}
                          className={cn(
                            "min-h-10 rounded-md border px-2.5 text-xs font-medium transition-colors",
                            on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                          )}
                        >
                          {s.code}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <Input aria-label="Notes" placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                <div>
                  <Button type="submit" disabled={busy || !/^\d{4}$/.test(form.year)}>
                    Save term
                  </Button>
                </div>
              </form>}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
