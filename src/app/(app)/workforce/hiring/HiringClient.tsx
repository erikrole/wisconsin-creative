"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { hiringView, hiringSort, inHiringView, sortHiringApplications } from "./board-view";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ArrowRight, MoreHorizontal, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { messageOf } from "./types";
import {
  APPLICATION_STAGES,
  CONFIRM_STAGES,
  STAGE_LABELS,
} from "@/lib/hiring/contract";
import type { ApplicationStage } from "@prisma/client";
import CsvImportDialog from "../CsvImportDialog";
import ApplicationSheet from "./ApplicationSheet";
import ApplicantCard from "./ApplicantCard";
import BulkResumeDialog from "./BulkResumeDialog";
import { AddApplicantDialog, CloseCycleDialog, NewCycleDialog } from "./HiringDialogs";
import { AREA_LABEL, AREA_OPTIONS, type BoardApplication, type CycleSummary } from "./types";

const STAGE_BADGE: Record<ApplicationStage, "gray" | "blue" | "green" | "orange" | "red"> = {
  APPLIED: "gray",
  ROUND_1: "blue",
  HIRE: "green",
  PASSED: "orange",
  WITHDRAWN: "gray",
};

export default function HiringClient() {
  const confirm = useConfirm();
  const params = useSearchParams();
  const requestedCycle = params.get("cycle");
  const initialCycle = useRef(requestedCycle);
  const search = params.get("q") ?? "";
  const areaFilter = params.get("area") ?? "";
  const reviewFilter = params.get("review") ?? "";
  const view = hiringView(params.get("view"));
  const sort = hiringSort(params.get("sort"));
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [apps, setApps] = useState<BoardApplication[] | null>(null);
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resumesOpen, setResumesOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [blankPassed, setBlankPassed] = useState(false);
  const reviewBusy = useRef(new Set<string>());
  const [reviewPending, setReviewPending] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  const loadCycles = useCallback(async (select?: string) => {
    try {
      const res = await fetch("/api/hiring/cycles");
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: CycleSummary[] }>(res);
      if (!res.ok) throw new Error(messageOf(json, "Could not load hiring cycles."));
      const list = json?.data ?? [];
      setCyclesError(null);
      setCycles(list);
      setCycleId((current) => select ?? (list.some(c => c.id === current) ? current : null) ?? list.find(c => c.id === initialCycle.current)?.id ?? list.find((c) => c.status === "OPEN")?.id ?? list[0]?.id ?? null);
    } catch (err) {
      setCyclesError(err instanceof Error ? err.message : "Could not load hiring cycles.");
    }
  }, []);

  // Only the newest list request may update the board; a slower, older response for a
  // cycle that is no longer selected is dropped.
  const appsRequest = useRef(0);
  const loadApps = useCallback(async (id: string) => {
    const ticket = ++appsRequest.current;
    setAppsError(null);
    try {
      const res = await fetch(`/api/hiring/applications?cycleId=${encodeURIComponent(id)}`);
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: BoardApplication[] }>(res);
      if (ticket !== appsRequest.current) return;
      if (!res.ok) throw new Error(messageOf(json, "Could not load applicants."));
      setApps(json?.data ?? []);
      setAppsError(null);
    } catch (err) {
      if (ticket !== appsRequest.current) return;
      setAppsError(err instanceof Error ? err.message : "Could not load applicants.");
    }
  }, []);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  useEffect(() => {
    if (!cycleId) return;
    setApps(null);
    void loadApps(cycleId);
  }, [cycleId, loadApps]);

  useEffect(() => {
    if (requestedCycle && cycles?.some(c => c.id === requestedCycle)) setCycleId(requestedCycle);
  }, [requestedCycle, cycles]);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (cycleId) next.set("cycle", cycleId);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "view") next.delete("review");
    window.history.replaceState(null, "", `/workforce/hiring?${next.toString()}`);
  }

  const cycle = cycles?.find((c) => c.id === cycleId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortHiringApplications((apps ?? []).filter((a) => {
      if (!inHiringView(a, view)) return false;
      if (q && !`${a.name} ${a.email ?? ""} ${a.rawAreas.join(" ")}`.toLowerCase().includes(q)) return false;
      if (areaFilter && a.primaryArea !== areaFilter && !a.rawAreas.some((r) => r.toLowerCase() === (AREA_LABEL[areaFilter] ?? "").toLowerCase())) return false;
      if (reviewFilter === "reviewed" && !a.reviewed) return false;
      if (reviewFilter === "unreviewed" && a.reviewed) return false;
      return true;
    }), sort);
  }, [apps, search, areaFilter, reviewFilter, view, sort]);

  const columns = useMemo(() => APPLICATION_STAGES.filter(s => view === "round1" ? s === "ROUND_1" : view === "review" ? s === "APPLIED" || s === "ROUND_1" : view === "all" || (s !== "PASSED" && s !== "WITHDRAWN")), [view]);
  // Review shortcuts walk only what is visible on the board.
  const queueIds = useMemo(() => filtered.filter((a) => columns.includes(a.stage)).map((a) => a.id), [filtered, columns]);

  const nextReview = filtered.find(a => !a.reviewed && (a.stage === "APPLIED" || a.stage === "ROUND_1"));

  async function setCycleStatus(status: "OPEN" | "CLOSED", closedOn?: string) {
    if (!cycle) return;
    const res = await fetch(`/api/hiring/cycles/${cycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(status === "CLOSED" && closedOn ? { status, closedOn } : { status }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) {
      toast.error(await parseErrorMessage(res, "Could not update the cycle."));
      return;
    }
    toast.success(status === "CLOSED" ? "Cycle closed" : "Cycle reopened");
    void loadCycles();
  }

  const changeStage = useCallback(
    async (id: string, stage: ApplicationStage) => {
      const target = apps?.find((a) => a.id === id);
      if (!target || target.stage === stage) return;
      if (CONFIRM_STAGES.has(stage)) {
        const confirmed = await confirm({
          title: stage === "HIRE" ? `Mark ${target.name} as Hire?` : `Pass on ${target.name}?`,
          message:
            stage === "HIRE"
              ? "This records the decision. It does not create an account yet."
              : "They move to Passed. You can move them back later.",
          confirmLabel: stage === "HIRE" ? "Mark as Hire" : "Pass",
          variant: stage === "PASSED" ? "danger" : "default",
        });
        if (!confirmed) return;
      }
      const previous = apps;
      setApps((list) => list?.map((a) => (a.id === id ? { ...a, stage } : a)) ?? list);
      try {
        const res = await fetch(`/api/hiring/applications/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not change the stage."));
        void loadCycles();
      } catch (err) {
        setApps(previous);
        toast.error(err instanceof Error ? err.message : "Could not change the stage.");
      }
    },
    [apps, confirm, loadCycles],
  );

  async function toggleReviewed(application: BoardApplication) {
    if (reviewBusy.current.has(application.id)) return;
    reviewBusy.current.add(application.id);
    setReviewPending([...reviewBusy.current]);
    try {
      const res = await fetch(`/api/hiring/applications/${application.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: !application.reviewed }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save review state."));
      setApps((list) => list?.map((a) => a.id === application.id ? { ...a, reviewed: !application.reviewed } : a) ?? list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save review state.");
    } finally {
      reviewBusy.current.delete(application.id);
      setReviewPending([...reviewBusy.current]);
    }
  }

  if (cyclesError && !cycles) {
    return (
      <>
        <PageHeader title="Hiring" />
        <EmptyState title="Could not load hiring" description={cyclesError} actionLabel="Retry" onAction={() => void loadCycles()} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Hiring" description="Openings, applicants, and decisions for your creative team.">
        <Button disabled={!nextReview || Boolean(appsError)} onClick={() => nextReview && setOpenId(nextReview.id)}>Review next <ArrowRight className="size-4" aria-hidden /></Button>
        <Button variant="outline" onClick={() => setAddOpen(true)} disabled={!cycle}><Plus className="size-4" aria-hidden /> Add applicant</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" aria-label="Hiring actions"><MoreHorizontal className="size-4" aria-hidden />Manage</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCycleOpen(true)}>New cycle</DropdownMenuItem>
            <DropdownMenuItem disabled={!cycle} onSelect={() => setImportOpen(true)}>Import CSV</DropdownMenuItem>
            <DropdownMenuItem disabled={!apps?.length} onSelect={() => setResumesOpen(true)}>Upload resumes</DropdownMenuItem>
            <DropdownMenuSeparator />
            {cycle && (cycle.status === "OPEN" || cycle.status === "PLANNING") && <DropdownMenuItem onSelect={() => setCloseOpen(true)}>Close cycle</DropdownMenuItem>}
            {cycle && (cycle.status === "CLOSED" || cycle.status === "ARCHIVED") && <DropdownMenuItem onSelect={() => void setCycleStatus("OPEN")}>Reopen cycle</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {!cycles ? (
        <Skeleton className="h-64 w-full" />
      ) : cycles.length === 0 ? (
        <EmptyState
          title="No hiring cycles yet"
          description="Create a cycle (for example Fall 2026) to start adding applicants."
          icon="users"
          actionLabel="Create a cycle"
          onAction={() => setCycleOpen(true)}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Hiring cycle"
              className="w-48"
              value={cycleId ?? ""}
              onChange={(e) => { setApps(null); updateFilter("cycle", e.target.value); }}
            >
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.status === "OPEN" ? " (open)" : ""}
                </option>
              ))}
            </NativeSelect>
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Search applicants"
                placeholder="Search name, email, area"
                className="pl-9"
                value={search}
                onChange={(e) => updateFilter("q", e.target.value)}
              />
            </div>
            <NativeSelect aria-label="Filter by area" className="w-44" value={areaFilter} onChange={(e) => updateFilter("area", e.target.value)}>
              <option value="">All areas</option>
              {AREA_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filter by review state"
              className="w-40"
              value={reviewFilter}
              onChange={(e) => updateFilter("review", e.target.value)}
            >
              <option value="">Any review state</option>
              <option value="unreviewed">Not reviewed</option>
              <option value="reviewed">Reviewed</option>
            </NativeSelect>
            <NativeSelect aria-label="Sort applicants" className="w-40" value={sort} onChange={e => updateFilter("sort", e.target.value)}><option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="unreviewed">Unreviewed first</option></NativeSelect>
          </div>

          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Applicant views">
            {([ ["active", "Active"], ["review", "Needs review"], ["round1", "Round 1"], ["all", "All applicants"] ] as const).map(([value, label]) => <Button key={value} variant={view === value ? "secondary" : "ghost"} aria-pressed={view === value} onClick={() => updateFilter("view", value)}>{label}<Badge variant="gray" size="sm">{apps ? apps.filter(a => inHiringView(a, value)).length : "—"}</Badge></Button>)}
          </div>

          {cycle && cycle.slots.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Hiring targets by area">
              {cycle.slots.map((slot) => {
                const hired = (apps ?? []).filter((a) => a.stage === "HIRE" && a.primaryArea === slot.area).length;
                return (
                  <Badge key={slot.area} variant={hired >= slot.targetCount ? "green" : "gray"}>
                    {AREA_LABEL[slot.area] ?? slot.area}: {hired} of {slot.targetCount} hired
                  </Badge>
                );
              })}
            </div>
          )}

          {appsError ? (
            <EmptyState title="Could not load applicants" description={appsError} actionLabel="Retry" onAction={() => cycleId && void loadApps(cycleId)} />
          ) : !apps ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="grid items-start gap-4 overflow-x-auto pb-4" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(18rem, 1fr))` }}>
              {columns.map((stage) => {
                const items = filtered.filter((a) => a.stage === stage);
                return (
                  <section
                    key={stage}
                    aria-label={`${STAGE_LABELS[stage]} column`}
                    className="flex min-h-48 min-w-0 flex-col rounded-xl border bg-muted/30 p-3"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId) void changeStage(dragId, stage);
                      setDragId(null);
                    }}
                  >
                    <h2 className="mb-3 flex items-center justify-between px-1 py-1 text-sm font-semibold">
                      {STAGE_LABELS[stage]}
                      <Badge variant={STAGE_BADGE[stage]} size="sm">
                        {items.length}
                      </Badge>
                    </h2>
                    <div className="flex flex-col gap-3">
                      {items.map((a) => (
                        <ApplicantCard
                          key={a.id}
                          application={a}
                          reviewPending={reviewPending.includes(a.id)}
                          onOpen={() => setOpenId(a.id)}
                          onReview={() => void toggleReviewed(a)}
                          onDragStart={() => setDragId(a.id)}
                          onDragEnd={() => setDragId(null)}
                        />
                      ))}
                      {items.length === 0 && <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">No applicants</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {cyclesError && (
            <div role="alert" className="mt-3 flex items-center gap-3 text-sm text-destructive">
              <p>{cyclesError}</p>
              <Button variant="outline" onClick={() => void loadCycles()}>Retry cycles</Button>
            </div>
          )}
        </>
      )}

      {cycle && (
        <CloseCycleDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          label={cycle.label}
          onConfirm={(closedOn) => {
            setCloseOpen(false);
            void setCycleStatus("CLOSED", closedOn);
          }}
        />
      )}
      <NewCycleDialog
        open={cycleOpen}
        onOpenChange={setCycleOpen}
        onCreated={(id) => {
          setCycleOpen(false);
          void loadCycles(id);
        }}
      />
      {cycle && (
        <AddApplicantDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          cycleId={cycle.id}
          onCreated={(applicationId) => {
            setAddOpen(false);
            void loadApps(cycle.id);
            void loadCycles();
            setOpenId(applicationId);
          }}
        />
      )}
      {cycle && apps && (
        <BulkResumeDialog
          open={resumesOpen}
          onOpenChange={setResumesOpen}
          apps={apps}
          onUploaded={() => void loadApps(cycle.id)}
        />
      )}
      {cycle && (
        <CsvImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          title={`Import applicants into ${cycle.label}`}
          description="Works with the PageUp export and the Google Form or prospect sheets. Known people are matched by email; likely duplicates are flagged, never merged."
          endpoint="/api/hiring/import"
          extraPayload={{ cycleId: cycle.id, blankDecisionMeansPassed: blankPassed && (cycle.status === "CLOSED" || cycle.status === "ARCHIVED") }}
          extraControls={
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={blankPassed && (cycle.status === "CLOSED" || cycle.status === "ARCHIVED")}
                disabled={cycle.status === "OPEN" || cycle.status === "PLANNING"}
                onChange={(e) => setBlankPassed(e.target.checked)}
              />
              <span>
                A blank decision means passed over
                <span className="block text-xs text-muted-foreground">
                  {cycle.status === "OPEN" || cycle.status === "PLANNING"
                    ? "Available once the cycle is closed. An open cycle still has undecided applicants."
                    : "Use for finished cycles such as Spring 2026."}
                </span>
              </span>
            </label>
          }
          onApplied={() => {
            void loadApps(cycle.id);
            void loadCycles();
          }}
        />
      )}
      <ApplicationSheet
        applicationId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          if (cycleId) void loadApps(cycleId);
          void loadCycles();
        }}
        onStageChange={changeStage}
        queue={queueIds}
        onNavigate={setOpenId}
      />
    </>
  );
}
