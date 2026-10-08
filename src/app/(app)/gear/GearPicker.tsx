"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3Icon, LockIcon, SearchIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeUp } from "@/components/ui/motion";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { GEAR_PICKS_ME_QUERY_KEY, useGearPicksMe } from "@/hooks/use-gear-picks";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  dollarsToCents,
  findGearSku,
  formatUsd,
  GEAR_CATALOG,
  itemsForFit,
  sizeKindForCategory,
  type GearCatalogItem,
} from "@/lib/gear-picks/catalog";
import type { GearPicksMeResponse, GearPickSubmissionDto } from "@/lib/gear-picks/types";
import { cn } from "@/lib/utils";
import {
  categoryAnchorId,
  defaultSizeFor,
  draftLineId,
  draftLineProblems,
  draftLinesFromServer,
  draftTotalCents,
  itemSearchText,
  type DraftLine,
} from "./gear-pick-state";
import { GearItemCard } from "./GearItemCard";
import { GearPreviewDialog, type GearPreview } from "./GearPreviewDialog";

const KIT_LABELS = { STANDARD_ISSUE: "Standard issue", CORE_KIT: "Core kit" } as const;

export function GearPicker() {
  const { data, isLoading, isError, refetch } = useGearPicksMe();

  if (isLoading) {
    return (
      <div className="space-y-4" aria-label="Loading your gear picks" aria-busy="true">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load your gear picks"
        description="Check your connection and try again."
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  }

  if (!data?.cycle) {
    return (
      <EmptyState
        icon="calendar"
        title="Gear picks aren't open"
        description="There's no Under Armour gear pick window right now."
      />
    );
  }

  if (!data.participant) {
    return (
      <FadeUp>
        <PageHeader title="UA staff gear" description={data.cycle.title}>
          {data.isAdmin && <AdminResultsLink />}
        </PageHeader>
        <EmptyState
          icon="users"
          title="You're not on this year's pick list"
          description="Under Armour staff picks are for full-time creative staff on the 2027–28 roster. If you should be picking, ask an admin to add you."
        />
      </FadeUp>
    );
  }

  return <GearPickerForm data={data} />;
}

function AdminResultsLink() {
  return (
    <Button asChild variant="outline" className="min-h-10">
      <Link href="/gear/admin">
        <BarChart3Icon data-icon="inline-start" />
        See results
      </Link>
    </Button>
  );
}

function GearPickerForm({ data }: { data: GearPicksMeResponse }) {
  const queryClient = useQueryClient();
  const participant = data.participant!;
  const cycle = data.cycle!;
  const fit = participant.fit;
  const allowanceCents = participant.allowanceCents;
  const readOnly = !cycle.isOpen;
  const submittedAt = data.submission?.submittedAt ?? null;
  const serverVersion = data.submission?.version ?? 0;

  const [lines, setLines] = useState<DraftLine[]>(() => draftLinesFromServer(data));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("all");
  const [fitsOnly, setFitsOnly] = useState(true);
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<GearPreview | null>(null);

  // Adopt the server's list whenever it changes and nothing local is unsaved.
  const serverStamp = data.submission?.updatedAt ?? null;
  useEffect(() => {
    if (!dirty) setLines(draftLinesFromServer(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only on a new server version
  }, [serverStamp, serverVersion]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const totalCents = draftTotalCents(lines);
  const remainingCents = allowanceCents - totalCents;
  const over = remainingCents < 0;
  const problems = draftLineProblems(lines);

  const items = useMemo(() => itemsForFit(fit), [fit]);
  const searchIndex = useMemo(() => new Map(items.map((item) => [item.style, itemSearchText(item)])), [items]);
  const linesByStyle = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const line of lines) {
      const style = findGearSku(line.sku)?.item.style;
      if (!style) continue;
      map.set(style, [...(map.get(style) ?? []), line]);
    }
    return map;
  }, [lines]);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let hiddenForBudget = 0;
  const visible = items.filter((item) => {
    const text = searchIndex.get(item.style) ?? "";
    const matchesSearch = words.every((word) => text.includes(word));
    const matchesCollection = collection === "all" || item.collection === collection;
    const picked = linesByStyle.has(item.style);
    const fitsBudget = !fitsOnly || picked || dollarsToCents(item.price) <= Math.max(0, remainingCents);
    if (matchesSearch && matchesCollection && !fitsBudget) hiddenForBudget += 1;
    return matchesSearch && matchesCollection && fitsBudget;
  });
  const sections = GEAR_CATALOG.categories
    .map((category) => ({ category, items: visible.filter((item) => item.category === category) }))
    .filter((section) => section.items.length > 0);
  const collections = GEAR_CATALOG.collections.filter((entry) => items.some((item) => item.collection === entry.key));

  const updateLines = useCallback((updater: (current: DraftLine[]) => DraftLine[]) => {
    setLines(updater);
    setDirty(true);
  }, []);

  const addLine = useCallback(
    (sku: string) => {
      const entry = findGearSku(sku);
      if (!entry) return;
      const preferred = defaultSizeFor(sizeKindForCategory(entry.item.category), data.profile);
      updateLines((current) => {
        const taken = current.some((line) => line.sku === sku && line.size === preferred);
        return [...current, { id: draftLineId(), sku, size: taken ? null : preferred, quantity: 1 }];
      });
    },
    [data.profile, updateLines],
  );

  const changeLine = useCallback(
    (id: string, patch: Partial<Pick<DraftLine, "size" | "quantity">>) => {
      updateLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    },
    [updateLines],
  );

  const removeLine = useCallback(
    (id: string) => updateLines((current) => current.filter((line) => line.id !== id)),
    [updateLines],
  );

  const selectColor = useCallback((style: string, code: string) => {
    setSelectedColors((current) => ({ ...current, [style]: code }));
    setPreview((current) => (current?.kind === "item" && current.item.style === style ? { ...current, colorCode: code } : current));
  }, []);

  const reloadFromServer = useCallback(() => {
    setDirty(false);
    void queryClient.invalidateQueries({ queryKey: GEAR_PICKS_ME_QUERY_KEY });
  }, [queryClient]);

  async function save(submit: boolean) {
    setSaving(submit ? "submit" : "draft");
    try {
      const response = await fetch("/api/gear-picks/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map(({ sku, size, quantity }) => ({ sku, size, quantity })),
          submit,
          version: serverVersion,
        }),
      });
      if (handleAuthRedirect(response, "/gear")) return;
      const json = await parseJsonSafely<{ data?: GearPickSubmissionDto; error?: string; code?: string }>(response);
      if (!response.ok || !json?.data) {
        const message = json?.error ?? "Your picks weren't saved. Try again.";
        if (json?.code === "GEAR_PICKS_STALE") {
          toast.error(message, { action: { label: "Reload", onClick: reloadFromServer }, duration: 10_000 });
        } else if (json?.code === "GEAR_PICKS_CLOSED") {
          toast.error(message);
          reloadFromServer();
        } else {
          toast.error(message);
        }
        return;
      }
      const saved = json.data;
      setDirty(false);
      queryClient.setQueryData<GearPicksMeResponse | null>(GEAR_PICKS_ME_QUERY_KEY, (current) =>
        current ? { ...current, submission: saved } : current,
      );
      toast.success(
        submit && !submittedAt ? "Picks submitted. You can still change them until the deadline." : "Picks saved.",
      );
    } catch {
      toast.error("Couldn't reach the server. Your picks are still here, so try again.");
    } finally {
      setSaving(null);
    }
  }

  const kit = GEAR_CATALOG.kits[fit];
  const allowanceLabel = formatUsd(allowanceCents);
  const canSave = !readOnly && dirty && !over && problems.length === 0 && saving === null;
  const canSubmit = !readOnly && lines.length > 0 && !over && problems.length === 0 && saving === null;

  return (
    <FadeUp>
      <PageHeader
        title="UA staff gear"
        description={`${cycle.title}. Your standard issue is covered. Choose the rest of your gear, up to ${allowanceLabel}.`}
      >
        {data.isAdmin && <AdminResultsLink />}
      </PageHeader>

      {readOnly ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm" role="status">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-semibold">Picks are closed.</span>{" "}
            {cycle.deadline ? `The deadline was ${formatDateTime(cycle.deadline)}. ` : ""}
            {submittedAt ? "This is the list you submitted." : lines.length > 0 ? "This draft was never submitted; ask an admin if you still need gear." : "You didn't pick anything this year."}
          </p>
        </div>
      ) : cycle.deadline ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Picks lock on <span className="font-semibold text-foreground">{formatDateTime(cycle.deadline)}</span>. You can change them until then.
        </p>
      ) : null}

      <section aria-labelledby="gear-kit-title" className="mb-6">
        <h2 id="gear-kit-title" className="text-base font-semibold">Already in your kit</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {kit.some((entry) => entry.kind === "CORE_KIT")
            ? `Free standard issue plus the core kit. These don't count against your ${allowanceLabel}.`
            : `Free standard issue. It doesn't count against your ${allowanceLabel}.`}
        </p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {kit.map((entry) => (
            <li key={`${entry.style}-${entry.code}`}>
              <button
                type="button"
                className="group flex w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() =>
                  setPreview({
                    kind: "kit",
                    name: entry.name,
                    label: KIT_LABELS[entry.kind],
                    sku: `${entry.style}-${entry.code}`,
                    image: entry.image,
                  })
                }
                aria-label={`Preview ${entry.name} larger`}
              >
                <span className="relative block aspect-square w-full bg-white">
                  <Image src={entry.image} alt="" fill sizes="120px" className="object-contain p-1.5" />
                </span>
                <span className="block px-1.5 py-1">
                  <span className="block truncate text-[11.5px] font-medium">{entry.name}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{KIT_LABELS[entry.kind]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gear-catalog-title">
        <h2 id="gear-catalog-title" className="text-base font-semibold">Pick from the catalog</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {items.length} styles. Prices are team prices. Tap a color to see it, then add it and choose a size.
        </p>

        <div className="mb-3 flex flex-col gap-3">
          <div className="relative max-w-md">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search items, colors, or item numbers"
              aria-label="Search gear"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Collection">
              {[{ key: "all", label: "All" }, ...collections].map((entry) => (
                <Button
                  key={entry.key}
                  type="button"
                  size="sm"
                  variant={collection === entry.key ? "default" : "outline"}
                  aria-pressed={collection === entry.key}
                  className="min-h-10 rounded-full"
                  onClick={() => setCollection(entry.key)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Switch id="gear-fits-budget" checked={fitsOnly} onCheckedChange={setFitsOnly} />
              <Label htmlFor="gear-fits-budget" className="text-sm">Only what fits my budget</Label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {visible.length} {visible.length === 1 ? "item" : "items"}
            {hiddenForBudget > 0
              ? ` · ${hiddenForBudget} hidden because they cost more than your ${formatUsd(Math.max(0, remainingCents))} left`
              : ""}
          </p>
        </div>

        {sections.length > 1 && (
          <nav aria-label="Categories" className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {sections.map((section) => (
              <a
                key={section.category}
                href={`#${categoryAnchorId(section.category)}`}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {section.category} <span className="tabular-nums text-muted-foreground/70">{section.items.length}</span>
              </a>
            ))}
          </nav>
        )}

        {sections.length === 0 ? (
          <EmptyState
            icon="search"
            compact
            title="No items match"
            description={
              fitsOnly && hiddenForBudget > 0
                ? "Everything that matches costs more than you have left. Turn off Only what fits my budget to see it."
                : "Clear the search or pick another collection."
            }
          />
        ) : (
          sections.map((section) => (
            <section key={section.category} id={categoryAnchorId(section.category)} className="mb-6 scroll-mt-20">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {section.category}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {section.items.map((item: GearCatalogItem) => (
                  <GearItemCard
                    key={item.style}
                    item={item}
                    selectedCode={selectedColors[item.style] ?? item.colors[0]!.code}
                    lines={linesByStyle.get(item.style) ?? []}
                    readOnly={readOnly}
                    onSelectColor={(code) => selectColor(item.style, code)}
                    onPreview={() =>
                      setPreview({ kind: "item", item, colorCode: selectedColors[item.style] ?? item.colors[0]!.code })
                    }
                    onAddLine={addLine}
                    onChangeLine={changeLine}
                    onRemoveLine={removeLine}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </section>

      <div
        className={cn(
          "sticky bottom-0 z-10 -mx-8 mt-6 border-t bg-background/95 px-8 py-3 backdrop-blur max-md:-mx-4 max-md:bottom-[calc(64px+env(safe-area-inset-bottom,0px))] max-md:px-4",
          over ? "border-[var(--red-text)]/40" : "border-border",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold tabular-nums">
                {formatUsd(totalCents)} of {allowanceLabel}
              </span>
              <span className={cn("tabular-nums", over ? "font-semibold text-[var(--red-text)]" : "text-muted-foreground")}>
                {over ? `Over by ${formatUsd(-remainingCents)}` : `${formatUsd(remainingCents)} left`}
              </span>
              <FooterStatus readOnly={readOnly} dirty={dirty} submittedAt={submittedAt} hasSaved={Boolean(data.submission)} />
            </div>
            <Progress
              value={allowanceCents > 0 ? (totalCents / allowanceCents) * 100 : 0}
              aria-label="Allowance used"
              className={cn("mt-1.5 h-1.5", over && "[&>[data-slot=progress-indicator]]:bg-[var(--red-text)]")}
            />
            {!readOnly && problems.length > 0 && (
              <p className="mt-1 text-xs text-[var(--orange-text)]">{problems[0]}</p>
            )}
          </div>
          {!readOnly && (
            <div className="flex shrink-0 gap-2">
              {submittedAt ? (
                <Button type="button" className="min-h-10 flex-1 sm:flex-none" disabled={!canSave || lines.length === 0} onClick={() => void save(true)}>
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-10 flex-1 sm:flex-none"
                    disabled={!canSave}
                    onClick={() => void save(false)}
                  >
                    {saving === "draft" ? "Saving…" : "Save draft"}
                  </Button>
                  <Button type="button" className="min-h-10 flex-1 sm:flex-none" disabled={!canSubmit} onClick={() => void save(true)}>
                    {saving === "submit" ? "Submitting…" : "Submit picks"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <GearPreviewDialog
        preview={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onSelectColor={selectColor}
      />
    </FadeUp>
  );
}

function FooterStatus({
  readOnly,
  dirty,
  submittedAt,
  hasSaved,
}: {
  readOnly: boolean;
  dirty: boolean;
  submittedAt: string | null;
  hasSaved: boolean;
}) {
  if (readOnly) return <Badge variant="gray" size="sm">Locked</Badge>;
  if (dirty) return <Badge variant="orange" size="sm">Unsaved changes</Badge>;
  if (submittedAt) return <Badge variant="green" size="sm">Submitted {formatDateTime(submittedAt)}</Badge>;
  if (hasSaved) return <Badge variant="blue" size="sm">Draft saved</Badge>;
  return null;
}
