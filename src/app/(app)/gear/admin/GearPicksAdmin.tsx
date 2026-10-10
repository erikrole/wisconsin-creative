"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, EyeOffIcon, SheetIcon, ShirtIcon, Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmDialog";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { FadeUp } from "@/components/ui/motion";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GEAR_PICKS_ME_QUERY_KEY } from "@/hooks/use-gear-picks";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { defaultAllowanceCents, formatUsd, type GearPickFitKey } from "@/lib/gear-picks/catalog";
import type {
  GearPickAdminParticipant,
  GearPicksAdminResponse,
  GearPickSubmissionStatus,
} from "@/lib/gear-picks/types";

const ADMIN_QUERY_KEY = ["gear-picks", "admin"] as const;

const STATUS_CHIP: Record<GearPickSubmissionStatus, { label: string; variant: "green" | "orange" | "gray" }> = {
  SUBMITTED: { label: "Submitted", variant: "green" },
  DRAFT: { label: "Draft", variant: "orange" },
  NOT_STARTED: { label: "Not started", variant: "gray" },
};

const FIT_LABELS: Record<GearPickFitKey, string> = { MEN: "Men’s", WOMEN: "Women’s" };

type AdminChange =
  | { action: "setDeadline"; deadline: string | null }
  | { action: "setLaunched"; launched: boolean }
  | { action: "addParticipant"; userId: string; fit: GearPickFitKey }
  | { action: "updateParticipant"; participantId: string; fit?: GearPickFitKey; allowanceCents?: number }
  | { action: "removeParticipant"; participantId: string };

export function GearPicksAdmin() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<GearPicksAdminResponse | null>({
    queryKey: ADMIN_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/gear-picks/admin", { signal });
      if (handleAuthRedirect(response, "/gear/admin")) return null;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not load gear pick results"));
      const json = await parseJsonSafely<{ data?: GearPicksAdminResponse }>(response);
      if (!json?.data) throw new Error("Gear pick results response was incomplete");
      return json.data;
    },
  });
  const [pending, setPending] = useState(false);

  async function applyChange(change: AdminChange, success: string) {
    setPending(true);
    try {
      const response = await fetch("/api/gear-picks/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (handleAuthRedirect(response, "/gear/admin")) return false;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That change wasn't saved. Try again."));
        return false;
      }
      toast.success(success);
      return true;
    } catch {
      toast.error("Couldn't reach the server. Try again.");
      return false;
    } finally {
      setPending(false);
      // Reconcile with the server either way so an uncertain outcome never lingers.
      void queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GEAR_PICKS_ME_QUERY_KEY });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label="Loading gear pick results" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load gear pick results"
        description="Check your connection and try again."
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  }

  const { cycle, summary } = data;

  return (
    <FadeUp>
      <PageHeader
        title="UA gear pick results"
        description={`${cycle.title}. ${!cycle.launchedAt ? "Not open to staff yet." : cycle.isOpen ? "Picks are open." : "Picks are closed."}`}
      >
        <Button asChild variant="outline" className="min-h-10">
          <Link href="/gear">
            <ShirtIcon data-icon="inline-start" />
            Pick list
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-10">
          <a href="/api/gear-picks/admin/export.csv" download>
            <DownloadIcon data-icon="inline-start" />
            Export CSV
          </a>
        </Button>
        <Button asChild className="min-h-10">
          <a href="/api/gear-picks/admin/export.xlsx" download>
            <SheetIcon data-icon="inline-start" />
            Equipment sheet
          </a>
        </Button>
      </PageHeader>

      <StaffAccessCard
        launchedAt={cycle.launchedAt}
        deadline={cycle.deadline}
        participantCount={summary.participantCount}
        pending={pending}
        onApply={applyChange}
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <OperationalMetricCard
          label="Submitted"
          value={`${summary.submittedCount}/${summary.participantCount}`}
          helper="People who submitted picks"
          tone={summary.submittedCount === summary.participantCount && summary.participantCount > 0 ? "green" : "muted"}
        />
        <OperationalMetricCard label="Drafts" value={summary.draftCount} helper="Saved but not submitted" tone={summary.draftCount > 0 ? "orange" : "muted"} />
        <OperationalMetricCard label="Not started" value={summary.notStartedCount} helper="Nothing saved yet" tone="muted" />
        <OperationalMetricCard label="Total picked" value={formatUsd(summary.totalCents)} helper="Drafts and submissions" tone="blue" />
      </div>

      <DeadlineCard deadline={cycle.deadline} isOpen={cycle.isOpen} pending={pending} onApply={applyChange} />

      <section aria-labelledby="gear-admin-people" className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="gear-admin-people" className="text-base font-semibold">People</h2>
        </div>
        <AddParticipant candidates={data.candidates} pending={pending} onApply={applyChange} />
        {data.participants.length === 0 ? (
          <EmptyState icon="users" compact title="No one is on the pick list" description="Add the people who should pick gear this year." />
        ) : (
          <ParticipantsTable participants={data.participants} pending={pending} onApply={applyChange} />
        )}
      </section>

      <section aria-labelledby="gear-admin-totals" className="mb-6">
        <h2 id="gear-admin-totals" className="mb-2 text-base font-semibold">Totals by item, color, and size</h2>
        {data.totals.length === 0 ? (
          <EmptyState icon="chart" compact title="Nothing picked yet" description="Totals appear as people save picks." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.totals.map((row) => (
                  <TableRow key={`${row.sku}|${row.size ?? ""}`}>
                    <TableCell>
                      <span className="font-medium">{row.itemName}</span>{" "}
                      <span className="font-mono text-[11px] text-muted-foreground">{row.sku}</span>
                    </TableCell>
                    <TableCell>{row.colorLabel}</TableCell>
                    <TableCell>{row.size ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(row.totalCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </FadeUp>
  );
}

/** Picks stay admin-only until opened; opening shows them to everyone on the list. */
function StaffAccessCard({
  launchedAt,
  deadline,
  participantCount,
  pending,
  onApply,
}: {
  launchedAt: string | null;
  deadline: string | null;
  participantCount: number;
  pending: boolean;
  onApply: (change: AdminChange, success: string) => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const people = `${participantCount} ${participantCount === 1 ? "person" : "people"}`;

  if (launchedAt) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <Badge variant="green" size="sm">Open</Badge>
          <span className="text-muted-foreground">Open to everyone on the list since {formatDateTime(launchedAt)}.</span>
        </p>
        <Button
          type="button"
          variant="ghost"
          className="min-h-10"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({
              title: "Close gear picks to staff?",
              message: "Only admins will see the banner, the catalog, and the Gear tab again. Saved picks stay as they are.",
              confirmLabel: "Close to staff",
              variant: "danger",
            });
            if (ok) await onApply({ action: "setLaunched", launched: false }, "Gear picks are closed to staff.");
          }}
        >
          <EyeOffIcon data-icon="inline-start" />
          Close to staff
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Not open to staff yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Admins can use everything now. Open it when the list and deadline are ready.
          </p>
        </div>
        <Button
          type="button"
          className="min-h-10"
          disabled={pending || participantCount === 0}
          onClick={async () => {
            const ok = await confirm({
              title: `Open gear picks to ${people}?`,
              message: `Everyone on the list gets the dashboard banner and can pick and submit${
                deadline ? ` until ${formatDateTime(deadline)}` : ". No deadline is set yet, so picks stay open until you add one"
              }.`,
              confirmLabel: "Open to staff",
            });
            if (ok) await onApply({ action: "setLaunched", launched: true }, `Gear picks are open to ${people}.`);
          }}
        >
          <UsersIcon data-icon="inline-start" />
          Open to {people}
        </Button>
      </CardContent>
    </Card>
  );
}

function DeadlineCard({
  deadline,
  isOpen,
  pending,
  onApply,
}: {
  deadline: string | null;
  isOpen: boolean;
  pending: boolean;
  onApply: (change: AdminChange, success: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Date | undefined>(deadline ? new Date(deadline) : undefined);
  useEffect(() => {
    setDraft(deadline ? new Date(deadline) : undefined);
  }, [deadline]);
  const changed = (draft?.toISOString() ?? null) !== deadline;

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="gear-deadline" className="text-sm font-semibold">Deadline</label>
          <p className="mb-2 text-xs text-muted-foreground">
            {deadline
              ? `${isOpen ? "Picks lock" : "Picks locked"} ${formatDateTime(deadline)}. After that, people can see but not change their lists.`
              : "No deadline. Picks stay open until you set one."}
          </p>
          <DateTimePicker id="gear-deadline" value={draft} onChange={setDraft} className="max-w-xs" />
        </div>
        <div className="flex gap-2">
          {deadline && (
            <Button
              type="button"
              variant="outline"
              className="min-h-10"
              disabled={pending}
              onClick={() => void onApply({ action: "setDeadline", deadline: null }, "Deadline cleared. Picks are open.")}
            >
              Clear deadline
            </Button>
          )}
          <Button
            type="button"
            className="min-h-10"
            disabled={pending || !draft || !changed}
            onClick={() =>
              draft && void onApply({ action: "setDeadline", deadline: draft.toISOString() }, `Deadline set to ${formatDateTime(draft.toISOString())}.`)
            }
          >
            Save deadline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddParticipant({
  candidates,
  pending,
  onApply,
}: {
  candidates: GearPicksAdminResponse["candidates"];
  pending: boolean;
  onApply: (change: AdminChange, success: string) => Promise<boolean>;
}) {
  const [userId, setUserId] = useState("");
  const [fit, setFit] = useState<GearPickFitKey>("MEN");
  const selected = candidates.find((candidate) => candidate.id === userId);

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-center">
      <Combobox
        options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.name, keywords: [candidate.role] }))}
        value={userId}
        onValueChange={setUserId}
        placeholder="Add a person…"
        searchPlaceholder="Search people"
        emptyMessage="No matching active people."
        className="sm:max-w-xs"
      />
      <NativeSelect
        aria-label="Fit for the new participant"
        value={fit}
        onChange={(event) => setFit(event.target.value as GearPickFitKey)}
        className="sm:w-40"
      >
        <option value="MEN">Men’s ({formatUsd(defaultAllowanceCents("MEN"))})</option>
        <option value="WOMEN">Women’s ({formatUsd(defaultAllowanceCents("WOMEN"))})</option>
      </NativeSelect>
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        disabled={pending || !selected}
        onClick={async () => {
          if (!selected) return;
          const added = await onApply({ action: "addParticipant", userId: selected.id, fit }, `${selected.name} can now pick gear.`);
          if (added) setUserId("");
        }}
      >
        <UserPlusIcon data-icon="inline-start" />
        Add
      </Button>
    </div>
  );
}

/**
 * `submittedAt` stays at the first submit, so a later edit shows as "Changed"
 * with the submit time underneath; admins can spot lists that moved before export.
 */
function LastChange({ submission }: { submission: GearPickAdminParticipant["submission"] }) {
  if (!submission) return <>—</>;
  if (!submission.submittedAt) return <>Saved {formatDateTime(submission.updatedAt)}</>;
  const changedAfterSubmit =
    new Date(submission.updatedAt).getTime() - new Date(submission.submittedAt).getTime() > 60_000;
  if (!changedAfterSubmit) return <>Submitted {formatDateTime(submission.submittedAt)}</>;
  return (
    <>
      <span className="font-medium text-[var(--orange-text)]">Changed {formatDateTime(submission.updatedAt)}</span>
      <span className="block">Submitted {formatDateTime(submission.submittedAt)}</span>
    </>
  );
}

function AllowanceInput({
  participant,
  pending,
  onApply,
}: {
  participant: GearPickAdminParticipant;
  pending: boolean;
  onApply: (change: AdminChange, success: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState((participant.allowanceCents / 100).toFixed(2));
  useEffect(() => {
    setValue((participant.allowanceCents / 100).toFixed(2));
  }, [participant.allowanceCents]);

  function commit() {
    // Number("") is 0, so a cleared box would silently save $0; treat it as invalid.
    const dollars = value.trim() === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setValue((participant.allowanceCents / 100).toFixed(2));
      toast.error("Enter an allowance in dollars, like 185.");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents === participant.allowanceCents) return;
    void onApply(
      { action: "updateParticipant", participantId: participant.id, allowanceCents: cents },
      `${participant.user.name}'s allowance is now ${formatUsd(cents)}.`,
    ).then((saved) => {
      // A refused change (e.g. below their saved picks) leaves the row as it was.
      if (!saved) setValue((participant.allowanceCents / 100).toFixed(2));
    });
  }

  return (
    <Input
      aria-label={`Allowance for ${participant.user.name}`}
      inputMode="decimal"
      className="h-9 w-24 text-right tabular-nums"
      value={value}
      disabled={pending}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function ParticipantsTable({
  participants,
  pending,
  onApply,
}: {
  participants: GearPickAdminParticipant[];
  pending: boolean;
  onApply: (change: AdminChange, success: string) => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Fit</TableHead>
            <TableHead className="text-right">Allowance</TableHead>
            <TableHead className="text-right">Picked</TableHead>
            <TableHead>Last change</TableHead>
            <TableHead className="w-10"><span className="sr-only">Remove</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {participants.map((participant) => {
            const chip = STATUS_CHIP[participant.status];
            const lines = participant.submission?.lines ?? [];
            const isExpanded = expanded.has(participant.id);
            const total = participant.submission?.totalCents ?? 0;
            return (
              <Fragment key={participant.id}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-left font-medium disabled:cursor-default"
                      onClick={() => toggle(participant.id)}
                      disabled={lines.length === 0}
                      aria-expanded={lines.length > 0 ? isExpanded : undefined}
                    >
                      {lines.length > 0 ? (
                        isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />
                      ) : (
                        <span className="inline-block size-4" />
                      )}
                      {participant.user.name}
                      {!participant.user.active && <Badge variant="gray" size="sm">Inactive</Badge>}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={chip.variant} size="sm">{chip.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Fit for ${participant.user.name}`}
                      className="h-9 w-28"
                      value={participant.fit}
                      disabled={pending}
                      onChange={(event) => {
                        const next = event.target.value as GearPickFitKey;
                        void onApply(
                          { action: "updateParticipant", participantId: participant.id, fit: next },
                          `${participant.user.name} now shops ${FIT_LABELS[next]}.`,
                        );
                      }}
                    >
                      <option value="MEN">{FIT_LABELS.MEN}</option>
                      <option value="WOMEN">{FIT_LABELS.WOMEN}</option>
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <AllowanceInput participant={participant} pending={pending} onApply={onApply} />
                    </div>
                  </TableCell>
                  <TableCell className={total > participant.allowanceCents ? "text-right font-semibold tabular-nums text-[var(--red-text)]" : "text-right tabular-nums"}>
                    {formatUsd(total)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <LastChange submission={participant.submission} />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      disabled={pending}
                      aria-label={`Remove ${participant.user.name} from the pick list`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Remove ${participant.user.name}?`,
                          message: lines.length > 0
                            ? `This deletes their ${participant.submission?.submittedAt ? "submitted" : "draft"} picks: ${lines.length} ${lines.length === 1 ? "line" : "lines"}, ${formatUsd(total)}. Adding them back starts them from scratch. The change is recorded in the audit log.`
                            : "They will no longer see the pick list.",
                          confirmLabel: "Remove",
                          variant: "danger",
                        });
                        if (ok) {
                          await onApply(
                            { action: "removeParticipant", participantId: participant.id },
                            `${participant.user.name} was removed from the pick list.`,
                          );
                        }
                      }}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
                {isExpanded && lines.length > 0 && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={7} className="py-2">
                      <ul className="flex flex-col gap-1 pl-6 text-sm">
                        {lines.map((line) => (
                          <li key={`${line.sku}|${line.size ?? ""}`} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="tabular-nums">{line.quantity} ×</span>
                            <span className="font-medium">{line.itemName}</span>
                            <span className="text-muted-foreground">{line.colorLabel}{line.size ? `, ${line.size}` : ""}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{line.sku}</span>
                            <span className="ml-auto tabular-nums">{formatUsd(line.lineTotalCents)}</span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
