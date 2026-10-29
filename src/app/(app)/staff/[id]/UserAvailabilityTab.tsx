"use client";

import { useId, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { AlertCircle, CalendarPlusIcon, CheckIcon, PencilIcon, PlusIcon, Trash2, XIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { availabilityToday, isAvailabilityHistory } from "@/lib/student-availability-display";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/use-fetch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmDialog";

type AvailabilityKind = "WEEKLY" | "AD_HOC";
type AvailabilityIntent = "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
type AvailabilityStatus = "APPROVED" | "PENDING" | "DENIED";

type AvailabilityBlock = {
  id: string;
  userId: string;
  kind?: AvailabilityKind;
  intent?: AvailabilityIntent;
  status?: AvailabilityStatus;
  dayOfWeek: number | null;
  date: string | null;
  dateEndsOn?: string | null;
  allDay?: boolean;
  startsAt: string;
  endsAt: string;
  label: string | null;
  semesterLabel: string | null;
  semesterStartsOn: string | null;
  semesterEndsOn: string | null;
  reviewedAt?: string | null;
  reviewedById?: string | null;
  reviewNote?: string | null;
  createdAt: string;
  updatedAt?: string;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


function blockKind(block: AvailabilityBlock): AvailabilityKind {
  return block.kind ?? "WEEKLY";
}

function blockIntent(block: AvailabilityBlock): AvailabilityIntent {
  return block.intent ?? "CANNOT_WORK";
}

function blockStatus(block: AvailabilityBlock): AvailabilityStatus {
  return block.status ?? "APPROVED";
}

function dateValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function formatTime(hhmm: string): string {
  const parts = hhmm.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const startValue = dateValue(start);
  const endValue = dateValue(end);
  if (!startValue) return "";
  if (!endValue || endValue === startValue) return formatDate(startValue);
  return `${formatDate(startValue)} – ${formatDate(endValue)}`;
}

function allDayDescription(intent: AvailabilityIntent): string {
  switch (intent) {
    case "PREFER": return "Marks the entire day as preferred when staff are choosing coverage.";
    case "DISLIKE": return "Marks the entire day as less ideal without blocking assignment.";
    case "TIME_OFF": return "Requests the entire day off for staff review.";
    default: return "Use this for travel, visitors, or any day you cannot work at all.";
  }
}

function isAllDay(block: AvailabilityBlock): boolean {
  return block.allDay === true;
}

function isApprovedTimeOff(block: AvailabilityBlock): boolean {
  return blockIntent(block) === "TIME_OFF" && blockStatus(block) === "APPROVED";
}

function isAdvisoryConflict(block: AvailabilityBlock): boolean {
  const intent = blockIntent(block);
  const status = blockStatus(block);
  return intent === "CANNOT_WORK" || intent === "DISLIKE" || (intent === "TIME_OFF" && status === "PENDING");
}

function isPreference(block: AvailabilityBlock): boolean {
  return blockIntent(block) === "PREFER";
}

function nextDatedBlock(blocks: AvailabilityBlock[]): AvailabilityBlock | null {
  const today = availabilityToday();
  const dated = blocks
    .filter((block) => {
      if (blockKind(block) !== "AD_HOC") return false;
      const end = dateValue(block.dateEndsOn) || dateValue(block.date);
      return end >= today;
    })
    .filter((block) => !(blockIntent(block) === "TIME_OFF" && blockStatus(block) === "DENIED"))
    .sort((a, b) => dateValue(a.date).localeCompare(dateValue(b.date)) || a.startsAt.localeCompare(b.startsAt));
  return dated[0] ?? null;
}

function sortBlocks(blocks: AvailabilityBlock[]): AvailabilityBlock[] {
  return [...blocks].sort((a, b) => {
    if (blockIntent(a) !== blockIntent(b)) {
      const order: AvailabilityIntent[] = ["TIME_OFF", "CANNOT_WORK", "DISLIKE", "PREFER"];
      return order.indexOf(blockIntent(a)) - order.indexOf(blockIntent(b));
    }
    if (blockKind(a) !== blockKind(b)) return blockKind(a) === "WEEKLY" ? -1 : 1;
    if (blockKind(a) === "AD_HOC") return dateValue(a.date).localeCompare(dateValue(b.date)) || a.startsAt.localeCompare(b.startsAt);
    const dayA = a.dayOfWeek ?? 7;
    const dayB = b.dayOfWeek ?? 7;
    return dayA !== dayB ? dayA - dayB : a.startsAt.localeCompare(b.startsAt);
  });
}

function impactLabel(block: AvailabilityBlock): string {
  const intent = blockIntent(block);
  const status = blockStatus(block);
  if (intent === "TIME_OFF") {
    if (status === "APPROVED") return "Approved time off";
    if (status === "DENIED") return "Denied time off";
    return "Pending time off";
  }
  if (intent === "PREFER") return "Preferred window";
  if (intent === "DISLIKE") return "Disliked window";
  return blockKind(block) === "AD_HOC" ? "One-time conflict" : "Class conflict";
}

function AvailabilityImpactSummary({ blocks }: { blocks: AvailabilityBlock[] }) {
  const approvedTimeOffCount = blocks.filter(isApprovedTimeOff).length;
  const advisoryConflictCount = blocks.filter(isAdvisoryConflict).length;
  const preferenceCount = blocks.filter(isPreference).length;
  const nextBlock = nextDatedBlock(blocks);
  const nextBlockCopy = nextBlock
    ? `${formatDateRange(nextBlock.date, nextBlock.dateEndsOn)} - ${isAllDay(nextBlock) ? "All day" : `${formatTime(nextBlock.startsAt)}-${formatTime(nextBlock.endsAt)}`} - ${impactLabel(nextBlock)}`
    : "No upcoming dated exceptions";

  const summaryItems = [
    {
      label: "Approved time off",
      value: approvedTimeOffCount,
      tone: "green" as const,
      detail: "Blocks assignment, pickup, trade, and call-window changes.",
    },
    {
      label: "Advisory conflicts",
      value: advisoryConflictCount,
      tone: "orange" as const,
      detail: "Warns assignment, auto-fill, and Trade Board review.",
    },
    {
      label: "Preferred windows",
      value: preferenceCount,
      tone: "blue" as const,
      detail: "Improves candidate fit when staff review coverage.",
    },
  ];

  return (
    <section className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">Scheduling impact</h3>
          <p className="text-xs text-muted-foreground">
            Approved time off is blocking. Other availability stays visible as staff-reviewed guidance.
          </p>
        </div>
        <Badge variant={blocks.length ? "secondary" : "gray"} size="sm">
          {blocks.length} {blocks.length === 1 ? "signal" : "signals"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="rounded-md border bg-background px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              <Badge variant={item.tone} className="h-5 px-1.5 text-xs tabular-nums">{item.value}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-md border border-dashed bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Next dated exception:</span> {nextBlockCopy}
      </div>
    </section>
  );
}

type AvailabilityFormProps = {
  userId: string;
  initial?: AvailabilityBlock | null;
  initialKind?: AvailabilityKind;
  onSaved: (block: AvailabilityBlock) => void;
  onCancel: () => void;
  canReview: boolean;
};

function AvailabilityForm({ userId, initial, initialKind = "WEEKLY", onSaved, onCancel, canReview }: AvailabilityFormProps) {
  const queryClient = useQueryClient();
  const kindId = useId();
  const intentId = useId();
  const statusId = useId();
  const dayId = useId();
  const dateId = useId();
  const dateEndId = useId();
  const allDayId = useId();
  const startId = useId();
  const endId = useId();
  const labelId = useId();
  const semesterId = useId();
  const semesterStartId = useId();
  const semesterEndId = useId();

  const [kind, setKind] = useState<AvailabilityKind>(initial ? blockKind(initial) : initialKind);
  const [intent, setIntent] = useState<AvailabilityIntent>(blockIntent(initial ?? ({ intent: "CANNOT_WORK" } as AvailabilityBlock)));
  const [status, setStatus] = useState<AvailabilityStatus>(blockStatus(initial ?? ({ status: "APPROVED" } as AvailabilityBlock)));
  const [dayOfWeek, setDayOfWeek] = useState(String(initial?.dayOfWeek ?? 1));
  const [date, setDate] = useState(dateValue(initial?.date) || (initialKind === "AD_HOC" ? availabilityToday() : ""));
  const [dateEndsOn, setDateEndsOn] = useState(() => {
    const start = dateValue(initial?.date);
    const end = dateValue(initial?.dateEndsOn);
    return end && end !== start ? end : "";
  });
  const [allDay, setAllDay] = useState(initial?.allDay === true);
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? "09:00");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? "11:00");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [semesterLabel, setSemesterLabel] = useState(initial?.semesterLabel ?? "");
  const [semesterStartsOn, setSemesterStartsOn] = useState(dateValue(initial?.semesterStartsOn));
  const [semesterEndsOn, setSemesterEndsOn] = useState(dateValue(initial?.semesterEndsOn));
  const [reviewNote, setReviewNote] = useState(initial?.reviewNote ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestId = useRef<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allDay && startsAt >= endsAt) {
      toast.error("Start time must be before end time");
      return;
    }
    if (kind === "AD_HOC" && !date) {
      toast.error("Choose a date for the one-time conflict");
      return;
    }
    if (kind === "AD_HOC" && dateEndsOn && date > dateEndsOn) {
      toast.error("End date must be on or after the start date");
      return;
    }
    if (semesterStartsOn && semesterEndsOn && semesterStartsOn > semesterEndsOn) {
      toast.error("Semester end date must be on or after start date");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError(null);
    setSaving(true);
    try {
      await queryClient.cancelQueries({ queryKey: ["fetch", `/api/users/${userId}/availability`] });
      const res = await fetch(
        initial ? `/api/users/${userId}/availability/${initial.id}` : `/api/users/${userId}/availability`,
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: initial ? undefined : (requestId.current ??= crypto.randomUUID()),
            expectedUpdatedAt: initial?.updatedAt,
            kind,
            intent,
            status: intent === "TIME_OFF" && canReview ? status : undefined,
            reviewNote: intent === "TIME_OFF" && canReview ? reviewNote.trim() || null : undefined,
            dayOfWeek: kind === "WEEKLY" ? Number(dayOfWeek) : null,
            date: kind === "AD_HOC" ? date : null,
            dateEndsOn: kind === "AD_HOC" ? dateEndsOn || date : null,
            allDay: kind === "AD_HOC" && allDay,
            startsAt: kind === "AD_HOC" && allDay ? "00:00" : startsAt,
            endsAt: kind === "AD_HOC" && allDay ? "23:59" : endsAt,
            label: label.trim() || undefined,
            semesterLabel: kind === "WEEKLY" ? semesterLabel.trim() || undefined : undefined,
            semesterStartsOn: kind === "WEEKLY" ? semesterStartsOn || null : null,
            semesterEndsOn: kind === "WEEKLY" ? semesterEndsOn || null : null,
          }),
        },
      );
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const message = await parseErrorMessage(res, "Could not save availability");
        setSaveError(message);
        toast.error(message);
        if (res.status === 409) await queryClient.invalidateQueries({ queryKey: ["fetch", `/api/users/${userId}/availability`] });
        return;
      }
      const json = await parseJsonSafely<{ data?: AvailabilityBlock }>(res);
      if (!json?.data) {
        setSaveError("The save response was incomplete. Your entries are still here; refresh availability to check whether it saved before trying again.");
        return;
      }
      onSaved(json.data);
      toast.success(initial ? "Availability updated" : "Availability added");
    } catch {
      setSaveError("Could not confirm the save. Your entries are still here; check your connection and refresh availability before trying again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={initial ? "Edit availability" : "Add availability"} className="rounded-lg border bg-muted/30 p-4">
      <fieldset disabled={saving} className="min-w-0">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">All dates and times use Madison time (Central).</p>
        {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={intentId} className="text-xs">Availability</Label>
            <Select
              name="availability-intent"
              value={intent}
              onValueChange={(value) => {
                const next = value as AvailabilityIntent;
                setIntent(next);
                if (next !== "TIME_OFF") setStatus("APPROVED");
                if (next === "TIME_OFF" && !canReview) setStatus("PENDING");
              }}
            >
              <SelectTrigger id={intentId} className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CANNOT_WORK">Cannot work</SelectItem>
                <SelectItem value="PREFER">Prefer to work</SelectItem>
                <SelectItem value="DISLIKE">Avoid if possible</SelectItem>
                <SelectItem value="TIME_OFF">Time off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={kindId} className="text-xs">Type</Label>
            <Select
              name="availability-kind"
              value={kind}
              onValueChange={(value) => {
                const next = value as AvailabilityKind;
                setKind(next);
                if (next === "AD_HOC" && !date) setDate(availabilityToday());
                if (next === "WEEKLY") setAllDay(false);
              }}
            >
              <SelectTrigger id={kindId} className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly class</SelectItem>
                <SelectItem value="AD_HOC">One-time day or range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "WEEKLY" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dayId} className="text-xs">Day</Label>
              <Select name="availability-day" value={dayOfWeek} onValueChange={setDayOfWeek}>
                <SelectTrigger id={dayId} className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((name, i) => (
                    <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={dateId} className="text-xs">From</Label>
                <Input
                  id={dateId}
                  name="availability-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDate(next);
                    if (dateEndsOn && next > dateEndsOn) setDateEndsOn(next);
                  }}
                  className="h-10 text-sm"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={dateEndId} className="text-xs">Through <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id={dateEndId} name="availability-date-end" type="date" value={dateEndsOn} min={date || undefined} onChange={(e) => setDateEndsOn(e.target.value)} className="h-10 text-sm" />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={labelId} className="text-xs">Label</Label>
            <Input id={labelId} name="availability-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "WEEKLY" ? "COMM 201" : "Exam"} className="h-10 text-sm" maxLength={80} />
          </div>
        </div>

        {kind === "AD_HOC" && (
          <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-2.5">
            <Checkbox id={allDayId} checked={allDay} onCheckedChange={(checked) => setAllDay(checked === true)} />
            <div className="-mt-0.5 flex flex-col gap-0.5">
              <Label htmlFor={allDayId} className="text-sm font-medium">All day</Label>
              <p className="text-xs text-muted-foreground">{allDayDescription(intent)}</p>
            </div>
          </div>
        )}

        {intent === "TIME_OFF" && !canReview && (
          <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
            {initial ? "Saving changes sends this request back to staff for review." : "Staff will review this request. It blocks scheduling only after approval."}
          </p>
        )}
        {intent === "TIME_OFF" && canReview && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={statusId} className="text-xs">Review status</Label>
              <Select name="availability-status" value={status} onValueChange={(value) => setStatus(value as AvailabilityStatus)}>
                <SelectTrigger id={statusId} className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="DENIED">Denied</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`${statusId}-note`} className="text-xs">Note to student (optional)</Label>
              <Textarea id={`${statusId}-note`} disabled={status === "PENDING"} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={500} placeholder={status === "PENDING" ? "Choose Approved or Denied to add a note" : "Explain the decision or next step"} />
            </div>
          </div>
        )}

        {!allDay && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={startId} className="text-xs">Start time</Label>
              <Input id={startId} name="availability-start" type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-10 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={endId} className="text-xs">End time</Label>
              <Input id={endId} name="availability-end" type="time" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-10 text-sm" required />
            </div>
            {kind === "WEEKLY" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={semesterId} className="text-xs">Term label <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id={semesterId} name="availability-semester-label" value={semesterLabel} onChange={(e) => setSemesterLabel(e.target.value)} placeholder="Fall 2026" className="h-10 text-sm" maxLength={40} />
              </div>
            )}
          </div>
        )}

        {allDay && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            This will be saved as {intent === "TIME_OFF" ? "a full-day time-off request" : intent === "PREFER" ? "a full-day preferred window" : intent === "DISLIKE" ? "a full-day avoid window" : "unavailable all day"}{dateEndsOn ? " for the selected date range" : ""}.
          </p>
        )}

        {kind === "WEEKLY" && (
          <div className="grid grid-cols-1 gap-3 rounded-md border bg-background p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-xs font-medium">Term dates <span className="font-normal text-muted-foreground">(optional — keeps old classes from creating future warnings)</span></p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={semesterStartId} className="text-xs">Starts</Label>
              <Input id={semesterStartId} name="availability-semester-start" type="date" value={semesterStartsOn} onChange={(e) => setSemesterStartsOn(e.target.value)} className="h-10 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={semesterEndId} className="text-xs">Ends</Label>
              <Input id={semesterEndId} name="availability-semester-end" type="date" value={semesterEndsOn} min={semesterStartsOn || undefined} onChange={(e) => setSemesterEndsOn(e.target.value)} className="h-10 text-sm" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-10" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" className="h-10" disabled={saving}>
            {saving ? "Saving..." : initial ? "Save changes" : "Add availability"}
          </Button>
        </div>
      </div>
      </fieldset>
    </form>
  );
}

function BlockPill({
  block,
  canEdit,
  canReview,
  showDay,
  deleting,
  reviewing,
  onEdit,
  onDelete,
  onReview,
}: {
  block: AvailabilityBlock;
  canEdit: boolean;
  canReview: boolean;
  showDay: boolean;
  deleting: boolean;
  reviewing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReview: (status: "APPROVED" | "DENIED", note?: string) => void;
}) {
  const [note, setNote] = useState(block.reviewNote ?? "");
  const noteId = useId();
  const kind = blockKind(block);
  const intent = blockIntent(block);
  const status = blockStatus(block);
  const range = isAllDay(block) ? "All day" : `${formatTime(block.startsAt)}-${formatTime(block.endsAt)}`;
  const dateRange = kind === "AD_HOC" ? formatDateRange(block.date, block.dateEndsOn) : showDay ? DAY_NAMES[block.dayOfWeek ?? 0] : "";
  const semesterRange = [formatDate(block.semesterStartsOn), formatDate(block.semesterEndsOn)].filter(Boolean).join(" to ");
  const intentBadge = intent === "TIME_OFF"
    ? status === "APPROVED" ? { label: "Approved time off", variant: "green" as const }
      : status === "DENIED" ? { label: "Denied", variant: "gray" as const }
        : { label: "Pending time off", variant: "orange" as const }
    : intent === "PREFER" ? { label: "Prefer", variant: "green" as const }
      : intent === "DISLIKE" ? { label: "Dislike", variant: "orange" as const }
        : { label: kind === "AD_HOC" ? "Conflict" : "Class", variant: "blue" as const };

  return (
    <div className="w-full min-w-0 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium tabular-nums">{range}</span>
      {dateRange && <span className="text-muted-foreground">{dateRange}</span>}
      <Badge variant={intentBadge.variant} size="sm">{intentBadge.label}</Badge>
      {block.label && <Badge variant="secondary" size="sm">{block.label}</Badge>}
      {block.semesterLabel && <Badge variant="gray" size="sm">{block.semesterLabel}</Badge>}
      {semesterRange && kind === "WEEKLY" && <span className="text-muted-foreground">{semesterRange}</span>}
      {canEdit && (
        <span className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-xs" className="size-9 text-muted-foreground" disabled={deleting || reviewing} onClick={onEdit} aria-label="Edit availability block">
            <PencilIcon className="size-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" className="size-9 text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={deleting || reviewing} aria-label="Remove availability block">
            <Trash2 className={cn("size-3", deleting && "animate-pulse")} />
          </Button>
        </span>
      )}
      </div>
      {block.reviewNote && <p className="mt-2 break-words text-sm text-muted-foreground"><span className="font-medium">Staff note:</span> {block.reviewNote}</p>}
      {canReview && intent === "TIME_OFF" && status === "PENDING" && (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3">
          <Label htmlFor={noteId} className="text-xs">Note to student (optional)</Label>
          <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} disabled={reviewing || deleting} placeholder="Explain the decision or next step" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onReview("APPROVED", note)} disabled={reviewing || deleting}><CheckIcon className="size-4" />{reviewing ? "Saving…" : "Approve"}</Button>
            <Button type="button" variant="outline" onClick={() => onReview("DENIED", note)} disabled={reviewing || deleting}><XIcon className="size-4" />Deny</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserAvailabilityTab({
  userId,
  canEdit,
  currentUserRole,
}: {
  userId: string;
  canEdit: boolean;
  currentUserRole: string | null;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newKind, setNewKind] = useState<AvailabilityKind>("WEEKLY");
  const [editing, setEditing] = useState<AvailabilityBlock | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const reviewingRef = useRef(false);
  const canReview = canEdit && (currentUserRole === "ADMIN" || currentUserRole === "STAFF");

  const {
    data: fetchedBlocks,
    loading,
    error,
    reload,
  } = useFetch<AvailabilityBlock[]>({
    url: `/api/users/${userId}/availability`,
    returnTo: `/staff/${userId}`,
    refetchOnFocus: !showForm && !editing && !reviewing && !deleting,
    transform: (json) => sortBlocks((json as { data: AvailabilityBlock[] }).data ?? []),
  });

  const blocks = sortBlocks(fetchedBlocks ?? []);
  const today = availabilityToday();
  const currentBlocks = blocks.filter((block) => !isAvailabilityHistory(block, today));
  const historyBlocks = blocks.filter((block) => isAvailabilityHistory(block, today));
  const pendingBlocks = currentBlocks.filter((block) => blockIntent(block) === "TIME_OFF" && blockStatus(block) === "PENDING");
  const listedBlocks = currentBlocks.filter((block) => !pendingBlocks.includes(block));
  const weeklyBlocks = listedBlocks.filter((block) => blockKind(block) === "WEEKLY");
  const adHocBlocks = listedBlocks.filter((block) => blockKind(block) === "AD_HOC");

  function openNewForm(kind: AvailabilityKind) {
    setEditing(null);
    setNewKind(kind);
    setShowForm(true);
  }

  function updateBlocks(update: (current: AvailabilityBlock[]) => AvailabilityBlock[]) {
    queryClient.setQueryData<{ data: AvailabilityBlock[] }>(["fetch", `/api/users/${userId}/availability`], (current) => ({ data: update(current?.data ?? []) }));
  }

  function upsertBlock(block: AvailabilityBlock, closeEditor = true) {
    updateBlocks((current) => sortBlocks([...current.filter((b) => b.id !== block.id), block]));
    if (closeEditor) {
      setShowForm(false);
      setEditing(null);
    }
  }

  function editBlock(block: AvailabilityBlock) {
    setShowForm(false);
    setEditing(block);
  }

  function renderBlock(block: AvailabilityBlock, history = false) {
    return <BlockPill showDay={history || pendingBlocks.includes(block)} key={block.id} block={block} canEdit={canEdit && !showForm && !editing}
      canReview={canReview && !history && !showForm && !editing} deleting={deleting !== null} reviewing={reviewing !== null}
      onEdit={() => editBlock(block)} onDelete={() => handleDelete(block)}
      onReview={(status, note) => handleReview(block, status, note)} />;
  }

  async function handleDelete(block: AvailabilityBlock) {
    if (deletingRef.current || reviewingRef.current) return;
    const kind = blockKind(block);
    const scheduleLabel = kind === "WEEKLY"
      ? `${DAY_NAMES[block.dayOfWeek ?? 0]} ${formatTime(block.startsAt)}-${formatTime(block.endsAt)}`
      : `${formatDateRange(block.date, block.dateEndsOn)} ${isAllDay(block) ? "all day" : `${formatTime(block.startsAt)}-${formatTime(block.endsAt)}`}`;
    const confirmed = await confirm({
      title: "Remove availability?",
      message: `Remove ${block.label ? `${block.label}, ` : ""}${scheduleLabel}? This can change scheduling warnings and time-off context.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!confirmed) return;

    if (deletingRef.current || reviewingRef.current) return;
    deletingRef.current = true;
    setDeleting(block.id);
    try {
      await queryClient.cancelQueries({ queryKey: ["fetch", `/api/users/${userId}/availability`] });
      const res = await fetch(`/api/users/${userId}/availability/${block.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not remove availability"));
        return;
      }
      updateBlocks((current) => current.filter((b) => b.id !== block.id));
      toast.success("Availability removed");
    } catch {
      toast.error("Could not confirm the change. Refreshing saved availability.");
      reload();
    } finally {
      deletingRef.current = false;
      setDeleting(null);
    }
  }

  async function handleReview(block: AvailabilityBlock, status: "APPROVED" | "DENIED", note = "") {
    if (reviewingRef.current || deletingRef.current) return;
    reviewingRef.current = true;
    setReviewing(block.id);
    try {
      await queryClient.cancelQueries({ queryKey: ["fetch", `/api/users/${userId}/availability`] });
      const res = await fetch(`/api/users/${userId}/availability/${block.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNote: note.trim() || null, expectedUpdatedAt: block.updatedAt }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not review time off"));
        if (res.status === 409) reload();
        return;
      }
      const json = await parseJsonSafely<{ data?: AvailabilityBlock }>(res);
      if (!json?.data) {
        toast.error("Review response was incomplete. Checking the saved request.");
        reload();
        return;
      }
      upsertBlock(json.data, false);
      toast.success(status === "APPROVED" ? "Time off approved" : "Time off denied");
    } catch {
      toast.error("Could not confirm the change. Refreshing saved availability.");
      reload();
    } finally {
      reviewingRef.current = false;
      setReviewing(null);
    }
  }

  if (loading) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  if (error && !fetchedBlocks) {
    return (
      <div className="mt-4">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Failed to load availability</AlertTitle>
          <AlertDescription className="mt-2 flex items-center gap-3">
            <Button variant="outline" className="h-10" onClick={reload}>Retry</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {error && <Alert variant="destructive"><AlertDescription>Could not refresh availability. Showing the last saved view. <Button variant="link" onClick={reload}>Retry</Button></AlertDescription></Alert>}
      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-3 pb-3 sm:flex-row">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold">When can’t you work?</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add recurring class times first, then record one-off days or ranges away. Use Madison time (Central). Staff sets the final call window; approved time off blocks scheduling.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="ghost" className="h-10" onClick={reload} disabled={deleting !== null || reviewing !== null}>Refresh</Button>
          {canEdit && !showForm && !editing && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="h-10" onClick={() => openNewForm("WEEKLY")}>
                <PlusIcon className="size-3.5" />
                Add class time
              </Button>
              <Button variant="outline" className="h-10" onClick={() => openNewForm("AD_HOC")}>
                <CalendarPlusIcon className="size-3.5" />
                Add day away
              </Button>
            </div>
          )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <AvailabilityImpactSummary blocks={currentBlocks} />
          <p className="text-xs text-muted-foreground">Counts include current and upcoming entries. Past dates, ended terms, and denied requests are in History.</p>

          {showForm && (
            <AvailabilityForm
              key={`new-${newKind}`}
              userId={userId}
              initialKind={newKind}
              canReview={canReview}
              onSaved={upsertBlock}
              onCancel={() => setShowForm(false)}
            />
          )}
          {editing && (
            <AvailabilityForm
              key={editing.id}
              userId={userId}
              initial={editing}
              canReview={canReview}
              onSaved={upsertBlock}
              onCancel={() => setEditing(null)}
            />
          )}

          {pendingBlocks.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Time-off requests awaiting review">
              <h3 className="text-sm font-medium">Awaiting review <Badge variant="orange" size="sm">{pendingBlocks.length}</Badge></h3>
              <p className="text-xs text-muted-foreground">Pending requests guide staff but do not block assignments until approved.</p>
              {pendingBlocks.map((block) => renderBlock(block))}
            </section>
          )}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="blue" size="sm">Weekly</Badge>
                <h3 className="text-sm font-medium">Weekly class schedule</h3>
              </div>
              <span className="text-xs text-muted-foreground">{weeklyBlocks.length} saved</span>
            </div>
            {weeklyBlocks.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No repeating class, preference, or weekly time-off signals.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                  const dayBlocks = weeklyBlocks.filter((block) => block.dayOfWeek === day);
                  if (!dayBlocks.length) return null;
                  return (
                    <div key={day} className="flex items-start gap-3">
                      <span className="w-8 shrink-0 pt-1 text-xs font-semibold text-muted-foreground">
                        {DAY_SHORT[day]}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {dayBlocks.map((block) => renderBlock(block))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="orange" size="sm">Dated</Badge>
                <h3 className="text-sm font-medium">One-off days and ranges</h3>
              </div>
              <span className="text-xs text-muted-foreground">{adHocBlocks.length} saved</span>
            </div>
            {adHocBlocks.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No dated conflicts, preferences, or time-off requests.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {adHocBlocks.map((block) => (
                  <div key={block.id} className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                      {renderBlock(block)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {historyBlocks.length > 0 && (
            <section className="border-t pt-3">
              <Button type="button" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? "Hide history" : "Show history"} ({historyBlocks.length})
              </Button>
              {showHistory && <div className="mt-3 flex flex-col gap-2">{historyBlocks.map((block) => renderBlock(block, true))}</div>}
            </section>
          )}
        </CardContent>
      </Card>

      {canEdit && !showForm && !editing && (
        <Button variant="outline" className="h-10 w-fit" onClick={() => openNewForm("WEEKLY")}>
          <CalendarPlusIcon className="size-4" />
          Add another class time
        </Button>
      )}
    </div>
  );
}
