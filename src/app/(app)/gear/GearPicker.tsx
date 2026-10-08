"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3Icon, ListChecksIcon, LockIcon, SearchIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  gearSku,
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
import { GearItemCard, gearItemAnchorId } from "./GearItemCard";
import { GearPicksSheet, type GearPicksSheetMode } from "./GearPicksSheet";
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
        {data.isAdmin ? (
          <EmptyState
            icon="users"
            title="You're not on this year's pick list"
            description="Add yourself on the results page to try the catalog, review, and submit exactly as staff will. You can remove yourself afterwards."
            actionLabel="Open results"
            actionHref="/gear/admin"
          />
        ) : (
          <EmptyState
            icon="users"
            title="You're not on this year's pick list"
            description="Under Armour staff picks are for full-time creative staff on the 2027–28 roster. If you should be picking, ask an admin to add you."
          />
        )}
      </FadeUp>
    );
  }

  return <GearPickerForm data={data} />;
}

/** The color a card shows: the one the person tapped, else the first color already in their list. */
function cardColorCode(
  item: GearCatalogItem,
  selectedColors: Record<string, string>,
  linesByStyle: Map<string, DraftLine[]>,
) {
  const chosen = selectedColors[item.style];
  if (chosen) return chosen;
  const pickedSkus = new Set((linesByStyle.get(item.style) ?? []).map((line) => line.sku));
  return (item.colors.find((color) => pickedSkus.has(gearSku(item.style, color.code))) ?? item.colors[0]!).code;
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
  const router = useRouter();
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
  const [category, setCategory] = useState("all");
  const [fitsOnly, setFitsOnly] = useState(true);
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<GearPreview | null>(null);
  const [sheetMode, setSheetMode] = useState<GearPicksSheetMode | null>(null);

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
  const pickCount = lines.reduce((sum, line) => sum + line.quantity, 0);
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
    const matchesCollection =
      (collection === "all" || item.collection === collection) && (category === "all" || item.category === category);
    const picked = linesByStyle.has(item.style);
    const fitsBudget = !fitsOnly || picked || dollarsToCents(item.price) <= Math.max(0, remainingCents);
    if (matchesSearch && matchesCollection && !fitsBudget) hiddenForBudget += 1;
    return matchesSearch && matchesCollection && fitsBudget;
  });
  const sections = GEAR_CATALOG.categories
    .map((category) => ({ category, items: visible.filter((item) => item.category === category) }))
    .filter((section) => section.items.length > 0);
  // Headwear and Footwear collections duplicate their categories, so only the
  // real collections (Sideline, Freedom, Ireland) get a collection filter.
  const collections = GEAR_CATALOG.collections.filter(
    (entry) =>
      !GEAR_CATALOG.categories.includes(entry.label) && items.some((item) => item.collection === entry.key),
  );
  const categories = GEAR_CATALOG.categories.filter((entry) => items.some((item) => item.category === entry));

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

  const openSheet = useCallback((mode: GearPicksSheetMode) => setSheetMode(mode), []);

  // Clear filters that could hide the card, then scroll to it once it renders.
  const jumpToItem = useCallback((style: string) => {
    setSheetMode(null);
    setSearch("");
    setCollection("all");
    setCategory("all");
    window.setTimeout(() => {
      document.getElementById(gearItemAnchorId(style))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
  }, []);

  // Replace local edits with the server's list. Set lines directly: a refused
  // save (e.g. the deadline just passed) leaves the version unchanged, so the
  // version-keyed sync effect wouldn't fire.
  const reloadFromServer = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: GEAR_PICKS_ME_QUERY_KEY, exact: true });
    setLines(draftLinesFromServer(queryClient.getQueryData<GearPicksMeResponse | null>(GEAR_PICKS_ME_QUERY_KEY)));
    setDirty(false);
  }, [queryClient]);

  /** Returns true once the server has the list, so the review panel can close. */
  async function save(submit: boolean): Promise<boolean> {
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
      if (handleAuthRedirect(response, "/gear")) return false;
      const json = await parseJsonSafely<{ data?: GearPickSubmissionDto; error?: string; code?: string }>(response);
      if (!response.ok || !json?.data) {
        const message = json?.error ?? "Your picks weren't saved. Try again.";
        if (json?.code === "GEAR_PICKS_STALE") {
          toast.error(message, { action: { label: "Reload", onClick: () => void reloadFromServer() }, duration: 10_000 });
        } else if (json?.code === "GEAR_PICKS_CLOSED") {
          toast.error(message);
          await reloadFromServer();
        } else {
          toast.error(message);
        }
        return false;
      }
      const saved = json.data;
      setDirty(false);
      queryClient.setQueryData<GearPicksMeResponse | null>(GEAR_PICKS_ME_QUERY_KEY, (current) =>
        current ? { ...current, submission: saved } : current,
      );
      if (submit && !submittedAt) {
        toast.success("Picks submitted. You can still change them until the deadline.", {
          action: { label: "View on profile", onClick: () => router.push("/profile?tab=gear") },
          duration: 10_000,
        });
      } else {
        toast.success("Picks saved.");
      }
      return true;
    } catch {
      toast.error("Couldn't reach the server. Your picks are still here, so try again.");
      return false;
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
        description={
          readOnly
            ? cycle.title
            : `${allowanceLabel} to spend${cycle.deadline ? ` · Due ${formatDateTime(cycle.deadline)}` : ""}`
        }
      >
        {data.isAdmin && <AdminResultsLink />}
      </PageHeader>

      {readOnly && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm" role="status">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-semibold">Picks are closed.</span>{" "}
            {submittedAt ? "This is the list you submitted." : lines.length > 0 ? "This draft was never submitted; ask an admin if you still need gear." : "You didn't pick anything this year."}
          </p>
        </div>
      )}

      <section aria-labelledby="gear-kit-title" className="mb-6">
        <h2 id="gear-kit-title" className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
          Already in your kit
          <span className="text-xs font-normal text-muted-foreground">Free</span>
        </h2>
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
          {kit.map((entry) => (
            <li key={`${entry.style}-${entry.code}`} className="w-20 shrink-0 sm:w-24">
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
                aria-label={`${entry.name}, ${KIT_LABELS[entry.kind].toLowerCase()}. Preview larger`}
                title={entry.name}
              >
                <span className="relative block aspect-square w-full bg-white">
                  <Image src={entry.image} alt="" fill sizes="96px" className="object-contain p-1.5" />
                </span>
                <span className="block truncate px-1.5 py-1 text-[11px] font-medium">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Catalog">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-60">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search gear"
                aria-label="Search gear by name, color, or item number"
                className="pl-9"
              />
            </div>
            {collections.length > 1 && (
              <NativeSelect
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
                aria-label="Collection"
                className="h-10 w-auto"
              >
                <option value="all">All collections</option>
                {collections.map((entry) => (
                  <option key={entry.key} value={entry.key}>{entry.label}</option>
                ))}
              </NativeSelect>
            )}
            <div className="flex min-h-10 items-center gap-2">
              <Switch id="gear-fits-budget" checked={fitsOnly} onCheckedChange={setFitsOnly} />
              <Label htmlFor="gear-fits-budget" className="text-sm">
                Fits my budget
                {hiddenForBudget > 0 && (
                  <span className="font-normal tabular-nums text-muted-foreground"> ({hiddenForBudget} hidden)</span>
                )}
              </Label>
            </div>
          </div>
          <div
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hide"
            role="group"
            aria-label="Category"
          >
            {["all", ...categories].map((entry) => (
              <Button
                key={entry}
                type="button"
                size="sm"
                variant={category === entry ? "default" : "outline"}
                aria-pressed={category === entry}
                className="min-h-10 shrink-0 rounded-full"
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "All" : entry}
              </Button>
            ))}
          </div>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            icon="search"
            compact
            title="No items match"
            description={
              fitsOnly && hiddenForBudget > 0
                ? "Everything that matches costs more than you have left. Turn off Fits my budget to see it."
                : "Clear the search or change the filters."
            }
          />
        ) : (
          sections.map((section) => (
            <section key={section.category} id={categoryAnchorId(section.category)} className="mb-8 scroll-mt-20">
              {category === "all" && (
                <h2 className="mb-3 text-sm font-semibold">
                  {section.category}
                  <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{section.items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {section.items.map((item: GearCatalogItem) => (
                  <GearItemCard
                    key={item.style}
                    item={item}
                    selectedCode={cardColorCode(item, selectedColors, linesByStyle)}
                    lines={linesByStyle.get(item.style) ?? []}
                    readOnly={readOnly}
                    onSelectColor={(code) => selectColor(item.style, code)}
                    onPreview={() =>
                      setPreview({ kind: "item", item, colorCode: cardColorCode(item, selectedColors, linesByStyle) })
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
          "sticky bottom-0 z-10 -mx-8 mt-6 border-t bg-background/95 px-8 py-3 backdrop-blur max-md:-mx-4 max-md:bottom-[calc(64px+env(safe-area-inset-bottom,0px))] max-md:px-4 max-md:py-2",
          over ? "border-[var(--red-text)]/40" : "border-border",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold tabular-nums">
                {formatUsd(totalCents)}
                <span className="font-normal text-muted-foreground"> of {allowanceLabel}</span>
              </span>
              <span
                className={cn(
                  "tabular-nums max-sm:hidden",
                  over ? "font-semibold text-[var(--red-text)]" : "text-muted-foreground",
                )}
              >
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
              <p className="mt-1 truncate text-xs text-[var(--orange-text)]">{problems[0]}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" className="min-h-10" onClick={() => openSheet("list")}>
              <ListChecksIcon data-icon="inline-start" />
              <span className="max-sm:sr-only">Your picks</span>
              <Badge variant="gray" size="sm" className="tabular-nums">{pickCount}</Badge>
            </Button>
            {!readOnly && !submittedAt && (
              <Button
                type="button"
                variant="outline"
                className="min-h-10 max-sm:px-3"
                disabled={!canSave}
                onClick={() => void save(false)}
              >
                {saving === "draft" ? (
                  "Saving…"
                ) : (
                  <>
                    <span className="sm:hidden">Save</span>
                    <span className="max-sm:hidden">Save draft</span>
                  </>
                )}
              </Button>
            )}
            {!readOnly && (
              <Button
                type="button"
                className="min-h-10"
                disabled={lines.length === 0 || (Boolean(submittedAt) && !dirty)}
                onClick={() => openSheet("review")}
              >
                <span className="sm:hidden">Review</span>
                <span className="max-sm:hidden">{submittedAt ? "Review changes" : "Review & submit"}</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      <GearPicksSheet
        open={sheetMode !== null}
        mode={sheetMode ?? "list"}
        onOpenChange={(open) => {
          if (!open) setSheetMode(null);
        }}
        lines={lines}
        readOnly={readOnly}
        totalCents={totalCents}
        allowanceCents={allowanceCents}
        deadline={cycle.deadline ? formatDateTime(cycle.deadline) : null}
        problems={problems}
        submitLabel={submittedAt ? "Save changes" : "Submit picks"}
        submitting={saving === "submit"}
        canSubmit={submittedAt ? canSave && lines.length > 0 : canSubmit}
        onSubmit={async () => {
          if (await save(true)) setSheetMode(null);
        }}
        onJump={jumpToItem}
        onRemoveLine={removeLine}
      />

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
