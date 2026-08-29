"use client";

import { useMemo, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, ExternalLinkIcon, FileSpreadsheetIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOOTBALL_STAFFING_SHEET_SOURCE,
  type FootballSheetCellReview,
  type FootballSheetEventResolution,
  type FootballStaffingSheetApplyRow,
  type FootballStaffingSheetRowIssue,
} from "@/lib/football-staffing-sheet";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { AREA_LABELS } from "@/types/areas";

type PreviewResponse = {
  source: typeof FOOTBALL_STAFFING_SHEET_SOURCE;
  dimensions: { rows: number; columns: number };
  sourceFingerprint: string;
  reviewFingerprint: string;
  eventReviews: FootballSheetEventResolution[];
  rowIssues: FootballStaffingSheetRowIssue[];
  cellReviews: FootballSheetCellReview[];
  applyRows: FootballStaffingSheetApplyRow[];
  summary: {
    matchedEvents: number;
    eventBlockers: number;
    resolvedDirectAssignments: number;
    studentOpportunities: number;
    intentionallyUnstaffed: number;
    blankCells: number;
    applicableChanges: number;
    cellBlockers: number;
    rowBlockers: number;
    blockingReviewItems: number;
  };
  previewOnly: true;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${FOOTBALL_STAFFING_SHEET_SOURCE.sheetId}/edit#gid=0&range=${FOOTBALL_STAFFING_SHEET_SOURCE.range}`;

function eventStatusLabel(status: FootballSheetEventResolution["status"]) {
  if (status === "MATCHED") return "Matched";
  if (status === "AMBIGUOUS") return "Multiple matches";
  if (status === "NOT_FOUND") return "No match";
  return "Header needs review";
}

function reviewMessage(review: FootballSheetCellReview) {
  switch (review.resolution) {
    case "DIRECT_ASSIGNMENT_MATCHED":
      return `Exact active user: ${review.personCandidates[0]?.name ?? review.raw}`;
    case "DIRECT_ASSIGNMENT_AMBIGUOUS":
      return `${review.personCandidates.length} active users have this exact normalized name.`;
    case "DIRECT_ASSIGNMENT_UNKNOWN":
      return "No active visible user has this exact normalized name.";
    case "STUDENT_OPPORTUNITY":
      return "Student opportunity; no person is selected in preview.";
    case "INTENTIONALLY_UNSTAFFED":
      return "Source explicitly leaves this role unstaffed.";
    case "BLANK":
      return "Blank source cell; meaning is not inferred.";
    case "AMBIGUOUS_ALTERNATIVES":
      return `Deferred alternatives: ${review.alternatives.join(" / ")}.`;
    case "UNRESOLVED_ROLE":
      return "Literal Role meaning is unresolved.";
    case "NOTE_OR_INSTRUCTION":
      return "Note or instruction preserved for review; not treated as a person.";
  }
}

export function FootballStaffingSheetPreviewDialog({ open, onOpenChange }: Props) {
  const [tsv, setTsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [slotSelections, setSlotSelections] = useState<Record<string, string>>({});
  const [applyingSourceA1, setApplyingSourceA1] = useState<string | null>(null);

  const headerByColumn = useMemo(
    () => new Map(preview?.eventReviews.map((review) => [review.header.column, review.header.raw]) ?? []),
    [preview],
  );
  const blockingCells = preview?.cellReviews.filter((review) => review.blocking) ?? [];
  const readyCells = preview?.cellReviews.filter((review) => !review.blocking) ?? [];

  async function runPreview() {
    if (!tsv.trim()) {
      toast.error("Copy Sheet1!A1:M14 and paste it first.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/schedule/football-staffing-sheet/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sportCode: "FB",
          source: {
            sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
            tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
            range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
          },
          tsv,
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Football sheet preview failed"));
        return;
      }
      const json = await response.json() as { data: PreviewResponse };
      setPreview(json.data);
      setSlotSelections({});
    } catch {
      toast.error("Could not reach the Football sheet preview. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function applyReviewedRow(row: FootballStaffingSheetApplyRow) {
    if (!preview || row.workingVersion === null || !row.userId && row.kind === "DIRECT_ASSIGNMENT") return;
    const slotKey = row.assignedSlotKey ?? slotSelections[row.sourceA1];
    if (row.kind === "DIRECT_ASSIGNMENT" && !slotKey) {
      toast.error("Choose the exact Schedule slot before staging this person.");
      return;
    }
    setApplyingSourceA1(row.sourceA1);
    try {
      const selection = row.kind === "DIRECT_ASSIGNMENT"
        ? {
            kind: "ASSIGN_ROLE" as const,
            sourceA1: row.sourceA1,
            eventId: row.eventId,
            userId: row.userId!,
            slotKey: slotKey!,
            expectedVersion: row.workingVersion,
          }
        : {
            kind: "CLEAR_ROLE" as const,
            sourceA1: row.sourceA1,
            eventId: row.eventId,
            expectedVersion: row.workingVersion,
          };
      const response = await fetch("/api/schedule/football-staffing-sheet/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sportCode: "FB",
          source: {
            sheetId: FOOTBALL_STAFFING_SHEET_SOURCE.sheetId,
            tabName: FOOTBALL_STAFFING_SHEET_SOURCE.tabName,
            range: FOOTBALL_STAFFING_SHEET_SOURCE.range,
          },
          tsv,
          sourceFingerprint: preview.sourceFingerprint,
          reviewFingerprint: preview.reviewFingerprint,
          selection,
        }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Football staffing change could not be staged"));
        return;
      }
      toast.success(`${row.role} change staged in the working schedule.`);
      await runPreview();
    } catch {
      toast.error("Could not stage the Football staffing change. Try again.");
    } finally {
      setApplyingSourceA1(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] sm:max-w-5xl">
        <DialogHeader className="items-start pr-12">
          <div className="space-y-1">
            <DialogTitle>Review Football staffing sheet</DialogTitle>
            <DialogDescription>
              Review Sheet1!A1:M14, then stage only the exact changes you approve. This never writes to Google Sheets.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <div className="rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Pinned source · Sheet1 · A1:M14 · 14 rows × 13 columns</span>
              <Button asChild variant="ghost" size="sm" className="h-9 px-2 text-xs">
                <a href={SHEET_URL} target="_blank" rel="noreferrer">
                  Open source sheet
                  <ExternalLinkIcon data-icon="inline-end" />
                </a>
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Select the exact range in Google Sheets, copy it, then paste the tab-separated snapshot below.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Sheet snapshot</span>
            <Textarea
              value={tsv}
              onChange={(event) => {
                setTsv(event.target.value);
                setPreview(null);
              }}
              className="min-h-32 font-mono text-xs"
              placeholder="Paste copied cells from Sheet1!A1:M14"
              spellCheck={false}
              disabled={loading}
            />
          </label>

          {preview && (
            <div className="space-y-5" aria-live="polite">
              <div className="flex flex-wrap gap-2">
                <Badge variant="green">{preview.summary.matchedEvents} events matched</Badge>
                <Badge variant="blue">{preview.summary.resolvedDirectAssignments} exact people</Badge>
                <Badge variant="purple">{preview.summary.studentOpportunities} Student opportunities</Badge>
                <Badge variant="gray">{preview.summary.intentionallyUnstaffed} intentionally unstaffed</Badge>
                <Badge variant={preview.summary.blockingReviewItems > 0 ? "orange" : "green"}>
                  {preview.summary.blockingReviewItems} review blockers
                </Badge>
                <Badge variant="blue">{preview.summary.applicableChanges} changes ready</Badge>
              </div>

              {preview.summary.blockingReviewItems > 0 ? (
                <Alert>
                  <AlertTriangleIcon />
                  <AlertTitle>Review is required</AlertTitle>
                  <AlertDescription>
                    Missing years, unresolved Role semantics, blanks, notes, and ambiguous or unknown identities remain visible below. Nothing is guessed.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>Preview resolved without blockers</AlertTitle>
                  <AlertDescription>Only individually reviewed changes can be staged into the private working schedule.</AlertDescription>
                </Alert>
              )}

              {preview.applyRows.length > 0 && (
                <section className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Reviewed Schedule changes</h3>
                    <p className="text-xs text-muted-foreground">
                      Every action rechecks this snapshot, the exact user and event, and the current working schedule before staging.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {preview.applyRows.map((row) => {
                      const needsSlot = row.kind === "DIRECT_ASSIGNMENT" && !row.assignedSlotKey;
                      const selectedSlot = row.assignedSlotKey ?? slotSelections[row.sourceA1];
                      return (
                        <div key={row.sourceA1} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">
                                {row.sourceA1} · {row.role} · {row.eventSummary}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
                              {row.currentRoleHolders.length > 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Current holders: {row.currentRoleHolders.map((holder) => holder.userName).join(", ")}
                                </p>
                              )}
                            </div>
                            <Badge variant={row.canApply ? "green" : "gray"} size="sm">
                              {row.canApply ? "Ready" : "No change"}
                            </Badge>
                          </div>
                          {row.canApply && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {needsSlot && (
                                <Select
                                  value={slotSelections[row.sourceA1] ?? ""}
                                  onValueChange={(value) => setSlotSelections((current) => ({ ...current, [row.sourceA1]: value }))}
                                  disabled={Boolean(applyingSourceA1)}
                                >
                                  <SelectTrigger size="sm" className="h-9 min-w-52" aria-label={`Schedule slot for ${row.userName ?? row.role}`}>
                                    <SelectValue placeholder="Choose exact open slot" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {row.openSlots.map((slot) => (
                                      <SelectItem key={slot.key} value={slot.key}>
                                        {AREA_LABELS[slot.area] ?? slot.area} · {slot.workerType === "ST" ? "Student" : "Staff"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant={row.kind === "INTENTIONALLY_UNSTAFFED" ? "outline" : "default"}
                                onClick={() => void applyReviewedRow(row)}
                                loading={applyingSourceA1 === row.sourceA1}
                                disabled={Boolean(applyingSourceA1) || (needsSlot && !selectedSlot)}
                              >
                                {row.kind === "INTENTIONALLY_UNSTAFFED"
                                  ? `Stage ${row.role} vacancy`
                                  : row.assignedSlotKey
                                    ? `Stage ${row.role} for ${row.userName}`
                                    : `Stage ${row.userName}`}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Event matching</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {preview.eventReviews.map((review) => (
                    <div key={review.header.source.a1} className="rounded-md border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{review.header.raw || "Blank header"}</p>
                          <p className="text-xs text-muted-foreground">{review.header.source.a1}</p>
                        </div>
                        <Badge variant={review.status === "MATCHED" ? "green" : "orange"} size="sm">
                          {eventStatusLabel(review.status)}
                        </Badge>
                      </div>
                      {review.status === "AMBIGUOUS" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {review.candidates.map((candidate) => `${candidate.summary} · ${candidate.startsAt.slice(0, 10)}`).join("; ")}
                        </p>
                      )}
                      {review.status === "INVALID_HEADER" && (
                        <p className="mt-2 text-xs text-muted-foreground">{review.header.issue?.replaceAll("_", " ").toLowerCase()}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {preview.rowIssues.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Role-row decisions</h3>
                  {preview.rowIssues.map((issue) => (
                    <div key={issue.source.a1} className="rounded-md border border-[var(--orange-border)] bg-[var(--orange-bg)] p-3 text-sm text-[var(--orange-text)]">
                      <span className="font-medium">{issue.source.a1} · {issue.raw || "Blank role label"}</span>
                      <p className="mt-1 text-xs">{issue.kind === "UNRESOLVED_ROLE_ROW" ? "Literal Role meaning is unresolved." : "This row is not an accepted Football role label."}</p>
                    </div>
                  ))}
                </section>
              )}

              {blockingCells.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Cell review blockers ({blockingCells.length})</h3>
                  <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                    {blockingCells.map((review) => (
                      <div key={review.source.a1} className="rounded-md px-2 py-2 text-sm hover:bg-muted/30">
                        <p className="font-medium">
                          {review.source.a1} · {review.role} · {headerByColumn.get(review.eventColumn) || "Unknown event"}
                        </p>
                        <p className="text-xs text-muted-foreground">{review.raw || "Blank"} — {reviewMessage(review)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Resolved source states ({readyCells.length})</h3>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                  {readyCells.map((review) => (
                    <div key={review.source.a1} className="rounded-md px-2 py-2 text-sm hover:bg-muted/30">
                      <p className="font-medium">
                        {review.source.a1} · {review.role} · {headerByColumn.get(review.eventColumn) || "Unknown event"}
                      </p>
                      <p className="text-xs text-muted-foreground">{review.raw || "Blank"} — {reviewMessage(review)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </DialogBody>
        <DialogFooter className="items-center justify-between border-t pt-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">Changes stay private until the existing Schedule release</p>
          <Button type="button" onClick={() => void runPreview()} loading={loading} disabled={!tsv.trim()}>
            <FileSpreadsheetIcon data-icon="inline-start" />
            Preview snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
