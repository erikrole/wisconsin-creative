"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { messageOf } from "./types";
import { STANDING_LABELS, TERM_LABELS, parseTermLabel } from "@/lib/hiring/contract";
import { AREA_OPTIONS } from "./types";

type PossibleMatch = { applicantId: string; name: string; reason: "email" | "name_and_grad" | "previous_applicant" };

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJsonSafely<{ data?: { id: string; matches?: PossibleMatch[] }; error?: string; code?: string }>(res);
  return { res, json };
}

export function NewCycleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [term, setTerm] = useState("FALL");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [closedOn, setClosedOn] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const slots = AREA_OPTIONS.filter((a) => Number(targets[a.value]) > 0).map((a) => ({
        area: a.value,
        targetCount: Number(targets[a.value]),
      }));
      const { res, json } = await postJson("/api/hiring/cycles", {
        term,
        year: Number(year),
        slots,
        ...(finished ? { status: "CLOSED", closedOn: closedOn || undefined } : {}),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok || !json?.data) throw new Error(messageOf(json, "Could not create the cycle."));
      toast.success("Cycle created");
      onCreated(json.data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the cycle.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New hiring cycle</DialogTitle>
            <DialogDescription>Targets are optional. They show as hired-versus-target meters on the board.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cycle-term">Term</Label>
                <NativeSelect id="cycle-term" value={term} onChange={(e) => setTerm(e.target.value)}>
                  {Object.entries(TERM_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cycle-year">Year</Label>
                <Input id="cycle-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
                This cycle already ended (importing history)
              </label>
              {finished && (
                <div className="grid gap-1.5">
                  <Label htmlFor="cycle-closed-on">When did it end?</Label>
                  <Input id="cycle-closed-on" type="date" className="w-44" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    The 36-month retention clock counts from this date. Leave blank to use today.
                  </p>
                </div>
              )}
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Hiring targets by area</legend>
              <div className="grid grid-cols-2 gap-3">
                {AREA_OPTIONS.map((a) => (
                  <div key={a.value} className="flex items-center gap-2">
                    <Input
                      aria-label={`${a.label} target`}
                      className="w-16"
                      inputMode="numeric"
                      placeholder="0"
                      value={targets[a.value] ?? ""}
                      onChange={(e) => setTargets((t) => ({ ...t, [a.value]: e.target.value }))}
                    />
                    <span className="text-sm">{a.label}</span>
                  </div>
                ))}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !parseTermLabel(`${TERM_LABELS[term as keyof typeof TERM_LABELS]} ${year}`)}>
              Create cycle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const INITIAL_APPLICANT_FORM = {
  name: "",
  email: "",
  phone: "",
  standing: "",
  gradTerm: "",
  gradYear: "",
  area: "",
  rawAreas: "",
  portfolioUrl: "",
  interviewUrl: "",
  externalApplicationId: "",
};

export function AddApplicantDialog({
  open,
  onOpenChange,
  cycleId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  onCreated: (applicationId: string) => void;
}) {
  const [form, setForm] = useState(INITIAL_APPLICANT_FORM);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<PossibleMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    // The duplicate choices were computed for the previous values. Once any field changes they
    // are stale ("Same person" would attach the new email and details to the wrong applicant),
    // so drop them and let the next save run duplicate detection again.
    setMatches(null);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  async function submit(options?: { existingApplicantId?: string; confirmNotDuplicate?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const rawAreas = form.rawAreas
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const { res, json } = await postJson("/api/hiring/applications", {
        cycleId,
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        standing: form.standing || undefined,
        gradTerm: form.gradTerm || undefined,
        gradYear: form.gradYear ? Number(form.gradYear) : undefined,
        primaryArea: form.area || undefined,
        rawAreas: rawAreas.length ? rawAreas : undefined,
        portfolioUrl: form.portfolioUrl || undefined,
        interviewUrl: form.interviewUrl || undefined,
        externalApplicationId: form.externalApplicationId || undefined,
        ...options,
      });
      if (handleAuthRedirect(res)) return;
      if (res.status === 409 && json?.code === "possible_match" && json.data?.matches) {
        setMatches(json.data.matches);
        return;
      }
      if (!res.ok || !json?.data) throw new Error(messageOf(json, "Could not add the applicant."));
      toast.success("Applicant added");
      setMatches(null);
      // Reset every field: a leftover standing or area must not carry onto the next person.
      setForm(INITIAL_APPLICANT_FORM);
      onCreated(json.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the applicant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setMatches(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add applicant</DialogTitle>
            <DialogDescription>Resumes are added from the applicant after they are created.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3 pb-4">
            {matches && (
              <div role="alert" className="rounded-md border border-[var(--orange-text)] bg-[var(--orange-bg)] p-3 text-sm">
                <p className="font-medium">This looks like someone already in the system.</p>
                <ul className="mt-2 grid gap-2">
                  {matches.map((m) => (
                    <li key={m.applicantId} className="flex items-center justify-between gap-2">
                      <span>
                        {m.name} <span className="text-muted-foreground">({m.reason === "email" ? "same email" : m.reason === "previous_applicant" ? "same name as a previous applicant" : "same name and graduation"})</span>
                      </span>
                      <Button type="button" disabled={busy} onClick={() => void submit({ existingApplicantId: m.applicantId })}>
                        Same person
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => void submit({ confirmNotDuplicate: true })}>
                  Different person, add anyway
                </Button>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="ap-name">Name</Label>
              <Input id="ap-name" required value={form.name} onChange={set("name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-email">Email</Label>
                <Input id="ap-email" type="email" required value={form.email} onChange={set("email")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-phone">Phone</Label>
                <Input id="ap-phone" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-standing">Standing</Label>
                <NativeSelect id="ap-standing" value={form.standing} onChange={set("standing")}>
                  <option value="">—</option>
                  {Object.entries(STANDING_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-term">Graduates</Label>
                <NativeSelect id="ap-term" value={form.gradTerm} onChange={set("gradTerm")}>
                  <option value="">—</option>
                  {Object.entries(TERM_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-year">Year</Label>
                <Input id="ap-year" inputMode="numeric" value={form.gradYear} onChange={set("gradYear")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-area">Primary area</Label>
                <NativeSelect id="ap-area" value={form.area} onChange={set("area")}>
                  <option value="">—</option>
                  {AREA_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-raw">Areas as submitted</Label>
                <Input id="ap-raw" placeholder="Design, Marketing" value={form.rawAreas} onChange={set("rawAreas")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ap-portfolio">Portfolio link</Label>
                <Input id="ap-portfolio" type="url" placeholder="https://" value={form.portfolioUrl} onChange={set("portfolioUrl")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ap-interview">Interview link</Label>
                <Input id="ap-interview" type="url" placeholder="https://" value={form.interviewUrl} onChange={set("interviewUrl")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-pageup">PageUp application ID</Label>
              <Input id="ap-pageup" value={form.externalApplicationId} onChange={set("externalApplicationId")} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim() || !form.email.trim()}>
              Add applicant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms closing a cycle and lets the admin give the real end date (retention clock start). */
export function CloseCycleDialog({
  open,
  onOpenChange,
  label,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  onConfirm: (closedOn: string | undefined) => void;
}) {
  const [closedOn, setClosedOn] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close {label}?</DialogTitle>
          <DialogDescription>
            Closing starts the 36-month retention clock for everyone in this cycle: after that, personal data is deleted and only names remain. You can reopen it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-1.5 pb-4">
          <Label htmlFor="close-cycle-on">When did it end?</Label>
          <Input id="close-cycle-on" type="date" className="w-44" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />
          <p className="text-xs text-muted-foreground">Leave blank to use today. For an older cycle, enter its real end date so it is not retained too long.</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(closedOn || undefined)}>
            Close cycle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
