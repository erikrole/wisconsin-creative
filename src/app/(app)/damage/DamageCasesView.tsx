"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageIcon } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeTime } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Resolution = "REPAIRED" | "REPLACED" | "WRITTEN_OFF" | "FOUND" | "NO_ISSUE";
type DamageCase = {
  id: string;
  type: "DAMAGED" | "LOST";
  description: string | null;
  imageUrl: string | null;
  reportedAt: string;
  asset: { id: string; assetTag: string; name: string | null; brand: string; model: string; imageUrl: string | null; status: string };
  booking: { id: string; title: string };
  responsible: { id: string; name: string };
  reportedBy: string;
  stillBookable: boolean;
  resolution: Resolution | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  allowedResolutions: Resolution[];
};
type CaseList = { counts: { open: number; missing: number; closed: number }; cases: DamageCase[] };

const LABELS: Record<Resolution, string> = {
  REPAIRED: "Repaired",
  REPLACED: "Replaced",
  WRITTEN_OFF: "Written off",
  FOUND: "Found",
  NO_ISSUE: "No issue found",
};
const HINTS: Record<Resolution, string> = {
  REPAIRED: "Back in service.",
  REPLACED: "Retired from the catalog. Add the replacement as a new item.",
  WRITTEN_OFF: "Retired from the catalog.",
  FOUND: "Back in service.",
  NO_ISSUE: "Back in service.",
};

async function load(view: "open" | "closed", signal?: AbortSignal): Promise<CaseList> {
  const res = await fetch(`/api/damage-cases?view=${view}`, { signal });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn't load cases"));
  return (await res.json()).data;
}

export function DamageCasesView() {
  const [view, setView] = useState<"open" | "closed">("open");
  const [type, setType] = useState<"all" | "DAMAGED" | "LOST">("all");
  const [active, setActive] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["damage-cases", view], queryFn: ({ signal }) => load(view, signal) });
  const cases = (list.data?.cases ?? []).filter((c) => type === "all" || c.type === type);

  return (
    <>
      <PageHeader title="Damage and loss" description="Gear reported damaged or missing at return. Each case stays open, and the item stays held, until staff record what happened." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={view}
          onChange={(v) => { setView(v); setActive(null); }}
          options={[
            { value: "open", label: "Open", count: list.data?.counts.open },
            { value: "closed", label: "Closed", count: list.data?.counts.closed },
          ]}
        />
        <Segmented
          label="Kind"
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: "All" },
            { value: "LOST", label: "Missing", count: view === "open" ? list.data?.counts.missing : undefined },
            { value: "DAMAGED", label: "Damaged" },
          ]}
        />
      </div>

      {list.isLoading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : list.isError ? (
        <EmptyState icon="wifi-off" title="Couldn't load cases" description={list.error.message} actionLabel="Try again" onAction={() => void list.refetch()} />
      ) : cases.length === 0 ? (
        <EmptyState icon="check" title={view === "open" ? "Nothing needs attention" : "No closed cases yet"} description={view === "open" ? "Damaged and missing gear reported at return shows up here." : undefined} />
      ) : (
        <ul className="m-0 list-none divide-y overflow-hidden rounded-2xl border bg-card p-0">
          {cases.map((c) => (
            <CaseRow key={c.id} item={c} open={active === c.id} onToggle={() => setActive(active === c.id ? null : c.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

function CaseRow({ item, open, onToggle }: { item: DamageCase; open: boolean; onToggle: () => void }) {
  const title = item.asset.name || `${item.asset.brand} ${item.asset.model}`;
  const closed = item.resolution !== null;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 sm:px-5"
      >
        <Thumb src={item.asset.imageUrl} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="m-0 truncate text-[14px] font-bold">{title}</p>
            <span className="text-[12.5px] text-muted-foreground">{item.asset.assetTag}</span>
          </div>
          <p className="m-0 mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {item.responsible.name} · {formatRelativeTime(item.reportedAt, new Date())}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {closed ? <Pill tone="muted">{LABELS[item.resolution!]}</Pill> : <Pill tone={item.type === "LOST" ? "red" : "orange"}>{item.type === "LOST" ? "Missing" : "Damaged"}</Pill>}
          {item.stillBookable && <span className="text-[11.5px] font-bold text-destructive">Still bookable</span>}
        </div>
      </button>
      {open && <CaseDetail item={item} />}
    </li>
  );
}

function CaseDetail({ item }: { item: DamageCase }) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<Resolution | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!choice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/damage-cases/${item.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: choice, note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn't close this case"));
      toast.success(`${item.asset.assetTag}: ${LABELS[choice].toLowerCase()}`);
      await queryClient.invalidateQueries({ queryKey: ["damage-cases"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-counts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close this case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 border-t bg-muted/20 px-4 py-4 sm:grid-cols-[auto_1fr] sm:px-5">
      {item.imageUrl ? (
        <a href={item.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Open evidence photo">
          <Image src={item.imageUrl} alt="Evidence" width={192} height={144} unoptimized className="h-36 w-48 rounded-lg border object-cover" />
        </a>
      ) : (
        <div className="flex h-36 w-48 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">No photo</div>
      )}
      <div className="flex min-w-0 flex-col gap-3">
        <p className="m-0 whitespace-pre-wrap break-words text-sm">{item.description || "No description was provided."}</p>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">Had the item</dt>
          <dd className="m-0">{item.responsible.name}</dd>
          <dt className="text-muted-foreground">Reported by</dt>
          <dd className="m-0">{item.reportedBy}</dd>
          <dt className="text-muted-foreground">Checkout</dt>
          <dd className="m-0 min-w-0 truncate">{item.booking.title}</dd>
        </dl>
        <div className="flex flex-wrap gap-3 text-[13px] font-bold">
          <Link href={`/items/${item.asset.id}`} className="text-foreground underline-offset-4 hover:underline">Open item</Link>
          <Link href={`/checkouts/${item.booking.id}`} className="text-foreground underline-offset-4 hover:underline">Open checkout</Link>
        </div>

        {item.resolution ? (
          <div className="rounded-lg border bg-card p-3 text-[13px]">
            <p className="m-0 font-bold">{LABELS[item.resolution]}</p>
            <p className="m-0 mt-0.5 text-muted-foreground">
              {item.resolvedBy ?? "Staff"}{item.resolvedAt ? ` · ${formatRelativeTime(item.resolvedAt, new Date())}` : ""}
            </p>
            {item.resolutionNote && <p className="m-0 mt-2 whitespace-pre-wrap break-words">{item.resolutionNote}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t pt-3">
            <p className="m-0 text-[13px] font-bold">What happened?</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Outcome">
              {item.allowedResolutions.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={choice === r}
                  onClick={() => setChoice(r)}
                  className={cn(
                    "h-8 rounded-full border px-3.5 text-[13px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    choice === r ? "border-foreground bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {LABELS[r]}
                </button>
              ))}
            </div>
            {choice && <p className="m-0 text-[12.5px] text-muted-foreground">{HINTS[choice]}</p>}
            <Textarea aria-label="Note" placeholder="Note (optional): repair shop, cost, replacement tag" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
            <Button className="self-start" disabled={!choice || busy} onClick={() => void submit()}>{busy ? "Saving…" : "Close case"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src ? (
    <Image src={src} alt="" width={40} height={40} unoptimized className="size-10 rounded-lg border object-cover" />
  ) : (
    <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true"><PackageIcon className="size-4" /></span>
  );
}

function Pill({ tone, children }: { tone: "red" | "orange" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-bold",
        tone === "red" && "bg-destructive/10 text-destructive",
        tone === "orange" && "bg-orange-500/10 text-orange-700 dark:text-orange-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-bold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              selected && "bg-card text-foreground shadow-xs",
            )}
          >
            {option.label}
            {option.count !== undefined ? <span className="tabular-nums font-normal">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
