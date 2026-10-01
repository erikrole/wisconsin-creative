"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Link2, MessageSquare, Plus, Search, Video } from "lucide-react";
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
  STANDING_LABELS,
  TERM_LABELS,
} from "@/lib/hiring/contract";
import type { ApplicationStage } from "@prisma/client";
import CsvImportDialog from "../CsvImportDialog";
import ApplicationSheet from "./ApplicationSheet";
import BulkResumeDialog from "./BulkResumeDialog";
import { AddApplicantDialog, NewCycleDialog } from "./HiringDialogs";
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
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [apps, setApps] = useState<BoardApplication[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"" | "unreviewed" | "reviewed">("");
  const [showPassed, setShowPassed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resumesOpen, setResumesOpen] = useState(false);
  const [blankPassed, setBlankPassed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const loadCycles = useCallback(async (select?: string) => {
    try {
      const res = await fetch("/api/hiring/cycles");
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: CycleSummary[] }>(res);
      if (!res.ok) throw new Error(messageOf(json, "Could not load hiring cycles."));
      const list = json?.data ?? [];
      setCycles(list);
      setCycleId((current) => select ?? current ?? list.find((c) => c.status === "OPEN")?.id ?? list[0]?.id ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load hiring cycles.");
    }
  }, []);

  // Only the newest list request may update the board; a slower, older response for a
  // cycle that is no longer selected is dropped.
  const appsRequest = useRef(0);
  const loadApps = useCallback(async (id: string) => {
    const ticket = ++appsRequest.current;
    try {
      const res = await fetch(`/api/hiring/applications?cycleId=${encodeURIComponent(id)}`);
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: BoardApplication[] }>(res);
      if (ticket !== appsRequest.current) return;
      if (!res.ok) throw new Error(messageOf(json, "Could not load applicants."));
      setApps(json?.data ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load applicants.");
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

  const cycle = cycles?.find((c) => c.id === cycleId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (apps ?? []).filter((a) => {
      if (q && !`${a.name} ${a.email ?? ""} ${a.rawAreas.join(" ")}`.toLowerCase().includes(q)) return false;
      if (areaFilter && a.primaryArea !== areaFilter && !a.rawAreas.some((r) => r.toLowerCase() === (AREA_LABEL[areaFilter] ?? "").toLowerCase())) return false;
      if (reviewFilter === "reviewed" && !a.reviewed) return false;
      if (reviewFilter === "unreviewed" && a.reviewed) return false;
      return true;
    });
  }, [apps, search, areaFilter, reviewFilter]);

  const columns = APPLICATION_STAGES.filter((s) => showPassed || (s !== "PASSED" && s !== "WITHDRAWN"));
  // Review shortcuts walk only what is visible on the board.
  const queueIds = useMemo(() => filtered.filter((a) => columns.includes(a.stage)).map((a) => a.id), [filtered, columns]);

  async function setCycleStatus(status: "OPEN" | "CLOSED") {
    if (!cycle) return;
    if (status === "CLOSED") {
      const confirmed = await confirm({
        title: `Close ${cycle.label}?`,
        message: "Closing starts the 36-month retention clock for everyone in this cycle: after that, personal data is deleted and only names remain. You can reopen it.",
        confirmLabel: "Close cycle",
      });
      if (!confirmed) return;
    }
    const res = await fetch(`/api/hiring/cycles/${cycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
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

  if (loadError && !cycles) {
    return (
      <>
        <PageHeader title="Hiring" />
        <EmptyState title="Could not load hiring" description={loadError} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Hiring" description="Run each student hiring cycle: applicants, resumes, interviews, and decisions.">
        <Button variant="outline" onClick={() => setCycleOpen(true)}>
          New cycle
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!cycle}>
          Import CSV
        </Button>
        <Button variant="outline" onClick={() => setResumesOpen(true)} disabled={!apps?.length}>
          Upload resumes
        </Button>
        <Button onClick={() => setAddOpen(true)} disabled={!cycle}>
          <Plus className="size-4" aria-hidden /> Add applicant
        </Button>
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
              onChange={(e) => setCycleId(e.target.value)}
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
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <NativeSelect aria-label="Filter by area" className="w-44" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
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
              onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
            >
              <option value="">Any review state</option>
              <option value="unreviewed">Not reviewed</option>
              <option value="reviewed">Reviewed</option>
            </NativeSelect>
            {cycle && (cycle.status === "OPEN" || cycle.status === "PLANNING") && (
              <Button variant="outline" onClick={() => void setCycleStatus("CLOSED")}>
                Close cycle
              </Button>
            )}
            {cycle && (cycle.status === "CLOSED" || cycle.status === "ARCHIVED") && (
              <Button variant="outline" onClick={() => void setCycleStatus("OPEN")}>
                Reopen cycle
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} />
              Show passed
            </label>
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

          {!apps ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(15rem, 1fr))` }}>
              {columns.map((stage) => {
                const items = filtered.filter((a) => a.stage === stage);
                return (
                  <section
                    key={stage}
                    aria-label={`${STAGE_LABELS[stage]} column`}
                    className="flex min-h-48 flex-col rounded-lg border bg-muted/30 p-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId) void changeStage(dragId, stage);
                      setDragId(null);
                    }}
                  >
                    <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                      {STAGE_LABELS[stage]}
                      <Badge variant={STAGE_BADGE[stage]} size="sm">
                        {items.length}
                      </Badge>
                    </h2>
                    <div className="flex flex-col gap-2">
                      {items.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          draggable
                          onDragStart={() => setDragId(a.id)}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => setOpenId(a.id)}
                          className="rounded-md border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-medium">{a.name}</span>
                            {!a.reviewed && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" title="Not reviewed" />}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[a.standing ? STANDING_LABELS[a.standing] : null, a.gradTerm && a.gradYear ? `${TERM_LABELS[a.gradTerm]} ${a.gradYear}` : null]
                              .filter(Boolean)
                              .join(" · ") || "No class info"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(a.rawAreas.length ? a.rawAreas : a.primaryArea ? [AREA_LABEL[a.primaryArea] ?? a.primaryArea] : []).map((r) => (
                              <Badge key={r} variant="gray" size="sm">
                                {r}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                            {a.hasResume && <FileText className="size-3.5" aria-label="Has resume" />}
                            {a.hasPortfolio && <Link2 className="size-3.5" aria-label="Has portfolio" />}
                            {a.hasInterview && <Video className="size-3.5" aria-label="Has interview" />}
                            {a.ratingAverage != null && (
                              <span className="ml-auto flex items-center gap-1 text-xs">
                                <MessageSquare className="size-3.5" aria-hidden /> {a.ratingAverage.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                      {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No applicants</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {loadError && <p role="alert" className="mt-3 text-sm text-destructive">{loadError}</p>}
        </>
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
          extraPayload={{ cycleId: cycle.id, blankDecisionMeansPassed: blankPassed }}
          extraControls={
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={blankPassed} onChange={(e) => setBlankPassed(e.target.checked)} />
              <span>
                A blank decision means passed over
                <span className="block text-xs text-muted-foreground">Use for finished cycles such as Spring 2026. Leave off for an open cycle.</span>
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
