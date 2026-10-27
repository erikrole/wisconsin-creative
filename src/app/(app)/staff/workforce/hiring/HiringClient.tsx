"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { FileText, Link2, Plus, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { messageOf } from "./types";
import {
  APPLICATION_STAGES,
  CONFIRM_STAGES,
  STAGE_LABELS,
  STANDING_LABELS,
} from "@/lib/hiring/contract";
import type { ApplicationStage } from "@prisma/client";
import CsvImportDialog from "../CsvImportDialog";
import ApplicationSheet from "./ApplicationSheet";
import BulkResumeDialog from "./BulkResumeDialog";
import { AddApplicantDialog, CloseCycleDialog, NewCycleDialog } from "./HiringDialogs";
import { AREA_COLORS } from "../../types";
import { AREA_LABEL, AREA_OPTIONS, type BoardApplication, type CycleSummary } from "./types";

/** Dot beside each column heading; the column itself stays quiet. */
const STAGE_DOT: Record<ApplicationStage, string> = {
  APPLIED: "bg-[#8b8d98]",
  ROUND_1: "bg-[#3e63dd]",
  HIRE: "bg-[#218358]",
  PASSED: "bg-[#8b8d98]",
  WITHDRAWN: "bg-[#8b8d98]",
};

function BoardSkeleton() {
  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: "repeat(4, minmax(15rem, 1fr))" }} aria-busy="true" aria-label="Loading applicants">
      {Array.from({ length: 4 }).map((_, column) => (
        <div key={column} className="flex min-h-48 flex-col gap-2 rounded-lg border bg-muted/30 p-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

export default function HiringClient() {
  const confirm = useConfirm();
  const [cycles, setCycles] = useState<CycleSummary[] | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [apps, setApps] = useState<BoardApplication[] | null>(null);
  /** Cycle id the current `apps` rows belong to; kept across refreshes so a cycle switch can show the prior board until the new list arrives. */
  const [appsCycleId, setAppsCycleId] = useState<string | null>(null);
  const [cyclesError, setCyclesError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardRefreshing, setBoardRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"" | "unreviewed" | "reviewed">("");
  const [showPassed, setShowPassed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resumesOpen, setResumesOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
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
      setCyclesError(null);
      setCycleId((current) => select ?? current ?? list.find((c) => c.status === "OPEN")?.id ?? list[0]?.id ?? null);
    } catch (err) {
      setCyclesError(err instanceof Error ? err.message : "Could not load hiring cycles.");
    }
  }, []);

  // Only the newest list request may update the board; a slower, older response for a
  // cycle that is no longer selected is dropped.
  const appsRequest = useRef(0);
  const loadApps = useCallback(async (id: string) => {
    const ticket = ++appsRequest.current;
    setBoardRefreshing(true);
    setBoardError(null);
    try {
      const res = await fetch(`/api/hiring/applications?cycleId=${encodeURIComponent(id)}`);
      if (handleAuthRedirect(res)) return;
      const json = await parseJsonSafely<{ data?: BoardApplication[] }>(res);
      if (ticket !== appsRequest.current) return;
      if (!res.ok) throw new Error(messageOf(json, "Could not load applicants."));
      setApps(json?.data ?? []);
      setAppsCycleId(id);
      setBoardError(null);
    } catch (err) {
      if (ticket !== appsRequest.current) return;
      setBoardError(err instanceof Error ? err.message : "Could not load applicants.");
    } finally {
      if (ticket === appsRequest.current) setBoardRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  useEffect(() => {
    if (!cycleId) return;
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

  const appsMatchCycle = apps !== null && appsCycleId === cycleId;
  const hasBoardFilters = Boolean(search.trim() || areaFilter || reviewFilter);
  const filterEmpty = appsMatchCycle && apps.length > 0 && filtered.length === 0;
  const clearBoardFilters = () => {
    setSearch("");
    setAreaFilter("");
    setReviewFilter("");
  };
  const retryBoard = () => {
    if (cycleId) void loadApps(cycleId);
  };

  if (cyclesError && !cycles) {
    return (
      <>
        <PageHeader title="Hiring" description="Run each student hiring cycle: applicants, resumes, interviews, and decisions." />
        <EmptyState
          icon="wifi-off"
          title="Couldn’t load hiring"
          description={cyclesError}
          actionLabel="Retry"
          onAction={() => void loadCycles()}
        />
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
        <Button variant="outline" onClick={() => setResumesOpen(true)} disabled={!appsMatchCycle || !apps?.length}>
          Upload resumes
        </Button>
        <Button onClick={() => setAddOpen(true)} disabled={!cycle}>
          <Plus className="size-4" aria-hidden /> Add applicant
        </Button>
      </PageHeader>

      {!cycles ? (
        <BoardSkeleton />
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
              <Button variant="outline" onClick={() => setCloseOpen(true)}>
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
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={retryBoard}
              disabled={!cycleId || boardRefreshing}
              aria-label="Refresh applicants"
            >
              <RefreshCw className={cn("size-4", boardRefreshing && "animate-spin")} />
            </Button>
          </div>

          {cycle && cycle.slots.length > 0 && (
            <div
              className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-xs"
              aria-label="Hiring targets by area"
            >
              <span className="text-sm font-black">{cycle.label} targets</span>
              {cycle.slots.map((slot) => {
                const hired = (appsMatchCycle ? apps : []).filter((a) => a.stage === "HIRE" && a.primaryArea === slot.area).length;
                const met = hired >= slot.targetCount;
                return (
                  <span key={slot.area} className="inline-flex items-center gap-2 text-sm">
                    <span className="size-2 rounded-full" style={{ background: AREA_COLORS[slot.area] ?? "#8b8d98" }} aria-hidden />
                    {AREA_LABEL[slot.area] ?? slot.area}
                    <b className={cn("tabular-nums", met && "text-[#1b6e47] dark:text-[#6bd49a]")}>
                      {hired}/{slot.targetCount}
                    </b>
                    <span className="sr-only">hired</span>
                  </span>
                );
              })}
            </div>
          )}

          {boardError && appsMatchCycle ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Couldn’t refresh the board</AlertTitle>
              <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <p>{boardError} Showing the last loaded applicants.</p>
                <Button variant="outline" className="h-10 w-fit" onClick={retryBoard} disabled={boardRefreshing}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {!appsMatchCycle && boardError ? (
            <EmptyState
              icon="wifi-off"
              title="Couldn’t load applicants"
              description={boardError}
              actionLabel="Retry"
              onAction={retryBoard}
            />
          ) : !appsMatchCycle ? (
            <BoardSkeleton />
          ) : filterEmpty ? (
            <EmptyState
              icon="search"
              title="No applicants match these filters"
              description="Clear the search or area and review filters to see the full board."
              actionLabel="Clear filters"
              onAction={clearBoardFilters}
            />
          ) : (
            <div
              className={cn("grid gap-3 overflow-x-auto pb-2", boardRefreshing && "opacity-70")}
              style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(15rem, 1fr))` }}
              aria-busy={boardRefreshing || undefined}
            >
              {columns.map((stage) => {
                const items = filtered.filter((a) => a.stage === stage);
                return (
                  <section
                    key={stage}
                    aria-label={`${STAGE_LABELS[stage]} column`}
                    className="flex min-h-48 flex-col rounded-xl bg-muted/60 p-3"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId) void changeStage(dragId, stage);
                      setDragId(null);
                    }}
                  >
                    <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-black">
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", STAGE_DOT[stage])} aria-hidden />
                        {STAGE_LABELS[stage]}
                      </span>
                      <span className="text-[13px] font-bold tabular-nums text-muted-foreground">{items.length}</span>
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
                          className="rounded-xl border bg-card px-3.5 py-3 text-left shadow-xs transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-sm font-bold">{a.name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              {a.ratingAverage != null && (
                                <span className="text-xs font-bold text-[#8a5200] dark:text-[#f0c46a]" title="Average rating">
                                  ★ {a.ratingAverage.toFixed(1)}
                                </span>
                              )}
                              {!a.reviewed && <span className="size-2 rounded-full bg-primary" title="Not reviewed" />}
                            </span>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                            {a.primaryArea && (
                              <span className="size-2 shrink-0 rounded-full" style={{ background: AREA_COLORS[a.primaryArea] ?? "#8b8d98" }} aria-hidden />
                            )}
                            <span className="truncate">
                              {[
                                a.primaryArea ? AREA_LABEL[a.primaryArea] : a.rawAreas[0],
                                a.gradTerm && a.gradYear ? `grad ${a.gradYear}` : null,
                                a.standing ? STANDING_LABELS[a.standing] : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "No class info"}
                            </span>
                          </p>
                          {(a.hasInterview || a.hasResume || a.hasPortfolio) && (
                            <div className="mt-2 flex items-center gap-2">
                              {a.hasInterview && (
                                <Badge variant="green" size="sm">
                                  Interviewed
                                </Badge>
                              )}
                              <span className="ml-auto flex items-center gap-2 text-muted-foreground">
                                {a.hasResume && <FileText className="size-3.5" aria-label="Has resume" />}
                                {a.hasPortfolio && <Link2 className="size-3.5" aria-label="Has portfolio" />}
                              </span>
                            </div>
                          )}
                        </button>
                      ))}
                      {items.length === 0 && (
                        <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                          {hasBoardFilters ? "No matches" : "No applicants"}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
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
