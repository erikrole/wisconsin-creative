"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  fiscalYearLabel,
  formatCentsCompact,
  parseDollarsToCents,
  type BudgetCategoryValue,
} from "@/lib/budget/contract";
import { parseErrorMessage, readApiData } from "@/lib/errors";
import {
  WISH_STATUS_LABELS,
  linkDomain,
  parseQuickAdd,
  pendingWishCents,
  wishCounts,
  type WishStatusValue,
} from "@/lib/wishlist/contract";
import type { WishView } from "@/lib/services/wishlist";

type BudgetOption = { id: string; name: string; fiscalYear: string };

const WISH_KEY = ["wishlist"] as const;

const PILL: Record<WishStatusValue, string> = {
  OPEN: "bg-muted text-muted-foreground",
  APPROVED: "bg-[#EEF2FF] text-[#3E63DD] dark:bg-[#3E63DD]/20",
  IN_BUDGET: "bg-[#E6F6EB] text-[#18794E] dark:bg-emerald-500/15 dark:text-emerald-300",
  DECLINED: "bg-muted text-muted-foreground",
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function WishlistView({ isAdmin, currentUserId }: { isAdmin: boolean; currentUserId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<WishStatusValue | "ALL">("OPEN");
  const [quick, setQuick] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WishView | null>(null);
  const [declining, setDeclining] = useState<WishView | null>(null);
  const [promoting, setPromoting] = useState<WishView | null>(null);

  const wishes = useQuery<WishView[]>({
    queryKey: WISH_KEY,
    queryFn: async ({ signal }) => readApiData(await fetch("/api/wishlist", { signal }), "Could not load the wish list"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: WISH_KEY });

  async function send(url: string, method: string, body: unknown, success: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That didn't save. Try again."));
        return false;
      }
      toast.success(success);
      void refresh();
      return true;
    } catch {
      toast.error("Couldn't reach the server. Try again.");
      return false;
    }
  }

  async function quickAdd() {
    const parsed = parseQuickAdd(quick);
    if (!parsed) return void toast.error("Paste a product link or type what you need.");
    if (await send("/api/wishlist", "POST", parsed, "Added to the wish list.")) setQuick("");
  }

  async function remove(wish: WishView) {
    const ok = await confirm({
      title: "Remove this wish?",
      message: `"${wish.title}" will be taken off the list.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (ok) await send(`/api/wishlist/${wish.id}`, "DELETE", undefined, "Wish removed.");
  }

  const all = wishes.data ?? [];
  const counts = wishCounts(all);
  const shown = filter === "ALL" ? all : all.filter((wish) => wish.status === filter);
  const pending = pendingWishCents(all);
  const canEdit = (wish: WishView) => wish.status !== "IN_BUDGET" && (isAdmin || (wish.requestedById === currentUserId && wish.status === "OPEN"));

  return (
    <>
      <PageHeader title="Wish list" description="Anyone on staff can add. Admins review wishes and move them into the budget." />

      <div className="flex flex-col gap-5">
        <form
          className="flex items-center gap-2.5 rounded-xl border bg-card py-2 pl-4 pr-2"
          onSubmit={(event) => {
            event.preventDefault();
            void quickAdd();
          }}
        >
          <PlusIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            aria-label="Add a wish"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            placeholder="Paste a link or type what you need"
            value={quick}
            maxLength={2000}
            onChange={(event) => setQuick(event.target.value)}
          />
          <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
            Add details
          </Button>
          <Button type="submit" className="bg-[#3E63DD] text-white hover:bg-[#3452B8]">
            Add to wish list
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]" role="group" aria-label="Filter wishes">
            {(["OPEN", "APPROVED", "IN_BUDGET", "DECLINED", "ALL"] as const).map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${
                  filter === status ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {status === "ALL" ? "All" : WISH_STATUS_LABELS[status]} {counts[status]}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[13px] text-muted-foreground">
            Open and approved wishes: <b className="font-bold text-foreground">~{formatCentsCompact(pending)}</b> · not counted in the budget
          </span>
        </div>

        {wishes.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : wishes.isError ? (
          <EmptyState icon="wifi-off" title="Couldn't load the wish list" description={wishes.error.message} actionLabel="Try again" onAction={() => void refresh()} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={all.length === 0 ? "Nothing on the wish list yet" : "No wishes here"}
            description={all.length === 0 ? "Paste a link or type what you need above." : "Try another filter."}
          />
        ) : (
          <ul className="overflow-hidden rounded-2xl border bg-card">
            {shown.map((wish) => {
              const domain = linkDomain(wish.linkUrl);
              return (
                <li key={wish.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3.5 last:border-b-0">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex items-center gap-2 text-[15px] font-bold">
                      <span className="truncate">{wish.title}</span>
                      {wish.linkUrl && (
                        <a href={wish.linkUrl} target="_blank" rel="noreferrer noopener" aria-label="Open product link">
                          <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                        </a>
                      )}
                    </div>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {[domain ?? "No link", wish.requestedByName, shortDate(wish.createdAt)].filter(Boolean).join(" · ")}
                      {wish.status === "DECLINED" && wish.statusNote ? ` · ${wish.statusNote}` : ""}
                    </p>
                  </div>
                  <span className="w-24 text-right font-mono text-xs">
                    {wish.estimateCents === null ? "—" : `${wish.quantity > 1 ? "" : "~"}${formatCentsCompact(wish.estimateCents)}`}
                    {wish.quantity > 1 && wish.estimateCents !== null ? ` ×${wish.quantity}` : ""}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL[wish.status]}`}>{WISH_STATUS_LABELS[wish.status]}</span>
                  <div className="flex items-center gap-1">
                    {isAdmin && wish.status === "OPEN" && (
                      <>
                        <Button type="button" variant="ghost" onClick={() => setDeclining(wish)}>Decline</Button>
                        <Button type="button" variant="outline" onClick={() => void send(`/api/wishlist/${wish.id}`, "PATCH", { status: "APPROVED" }, "Approved.")}>Approve</Button>
                      </>
                    )}
                    {isAdmin && (wish.status === "OPEN" || wish.status === "APPROVED") && (
                      <Button type="button" className="bg-[#3E63DD] text-white hover:bg-[#3452B8]" onClick={() => setPromoting(wish)}>Add to budget</Button>
                    )}
                    {isAdmin && wish.status === "DECLINED" && (
                      <Button type="button" variant="ghost" onClick={() => void send(`/api/wishlist/${wish.id}`, "PATCH", { status: "OPEN", statusNote: "" }, "Re-opened.")}>Re-open</Button>
                    )}
                    {wish.status === "IN_BUDGET" && wish.budgetLineId && (
                      <a className="text-[13px] font-bold text-[#3E63DD] hover:underline" href={`/budget?b=${wish.budgetId}&line=${wish.budgetLineId}`}>
                        View budget line →
                      </a>
                    )}
                    {canEdit(wish) && (
                      <>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit wish" onClick={() => setEditing(wish)}>
                          <PencilIcon />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove wish" onClick={() => void remove(wish)}>
                          <Trash2Icon />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(adding || editing) && (
        <WishDialog
          wish={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (body) => {
            const ok = editing
              ? await send(`/api/wishlist/${editing.id}`, "PATCH", body, "Wish updated.")
              : await send("/api/wishlist", "POST", body, "Added to the wish list.");
            if (ok) {
              setAdding(false);
              setEditing(null);
            }
          }}
        />
      )}
      {declining && (
        <DeclineDialog
          wish={declining}
          onClose={() => setDeclining(null)}
          onDecline={async (note) => {
            if (await send(`/api/wishlist/${declining.id}`, "PATCH", { status: "DECLINED", statusNote: note }, "Declined.")) setDeclining(null);
          }}
        />
      )}
      {promoting && (
        <PromoteDialog
          wish={promoting}
          onClose={() => setPromoting(null)}
          onPromote={async (body) => {
            if (await send(`/api/wishlist/${promoting.id}/promote`, "POST", body, "Moved to the budget.")) {
              setPromoting(null);
              void queryClient.invalidateQueries({ queryKey: ["budget"] });
            }
          }}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function WishDialog({ wish, onClose, onSave }: { wish: WishView | null; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    title: wish?.title ?? "",
    linkUrl: wish?.linkUrl ?? "",
    estimate: centsToInput(wish?.estimateCents ?? null),
    quantity: String(wish?.quantity ?? 1),
    neededBy: wish?.neededBy ?? "",
    reason: wish?.reason ?? "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    const estimateCents = form.estimate.trim() === "" ? null : parseDollarsToCents(form.estimate);
    const quantity = Number(form.quantity);
    if (!form.title.trim()) return void toast.error("Say what it is.");
    if (form.estimate.trim() !== "" && estimateCents === null) return void toast.error("Enter the rough price in dollars.");
    if (!Number.isInteger(quantity) || quantity < 1) return void toast.error("Quantity must be a whole number, 1 or more.");
    setPending(true);
    await onSave({
      title: form.title,
      linkUrl: form.linkUrl,
      estimateCents,
      quantity,
      neededBy: form.neededBy === "" ? null : form.neededBy,
      reason: form.reason,
    });
    setPending(false);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{wish ? "Edit wish" : "Add to wish list"}</DialogTitle>
          <DialogDescription>Doesn&apos;t affect the budget until an admin moves it there.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="What is it">
              <Input value={form.title} maxLength={200} onChange={(e) => set("title")(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Link">
              <Input value={form.linkUrl} maxLength={2000} placeholder="https://" onChange={(e) => set("linkUrl")(e.target.value)} />
            </Field>
          </div>
          <Field label="Rough price ($)">
            <Input inputMode="decimal" value={form.estimate} onChange={(e) => set("estimate")(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input inputMode="numeric" value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} />
          </Field>
          <Field label="Needed by">
            <Input type="date" value={form.neededBy} onChange={(e) => set("neededBy")(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Why we need it (optional)">
              <Textarea rows={3} maxLength={2000} value={form.reason} onChange={(e) => set("reason")(e.target.value)} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={pending}>{wish ? "Save changes" : "Add wish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ wish, onClose, onDecline }: { wish: WishView; onClose: () => void; onDecline: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline this wish?</DialogTitle>
          <DialogDescription>{wish.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Note (optional)">
            <Input value={note} maxLength={500} placeholder="For example: borrowing from Football" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            type="button"
            onClick={async () => {
              setPending(true);
              await onDecline(note);
              setPending(false);
            }}
            disabled={pending}
          >
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({
  wish,
  onClose,
  onPromote,
}: {
  wish: WishView;
  onClose: () => void;
  onPromote: (body: Record<string, unknown>) => Promise<void>;
}) {
  const budgets = useQuery<BudgetOption[]>({
    queryKey: ["budget", "list"],
    queryFn: async ({ signal }) => readApiData(await fetch("/api/budget", { signal }), "Could not load budgets"),
  });
  const [budgetId, setBudgetId] = useState("");
  const [category, setCategory] = useState<BudgetCategoryValue>("EQUIPMENT");
  const [unitCost, setUnitCost] = useState(centsToInput(wish.estimateCents));
  const [unplanned, setUnplanned] = useState(false);
  const [pending, setPending] = useState(false);
  const activeBudgetId = budgetId || budgets.data?.[0]?.id || "";

  async function submit() {
    const unitCostCents = parseDollarsToCents(unitCost);
    if (!activeBudgetId) return void toast.error("Pick a budget.");
    if (unitCostCents === null) return void toast.error("Enter the budgeted unit cost in dollars.");
    setPending(true);
    await onPromote({ budgetId: activeBudgetId, category, unitCostCents, quantity: wish.quantity, unplanned });
    setPending(false);
  }

  const total = parseDollarsToCents(unitCost);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move to the budget</DialogTitle>
          <DialogDescription>
            {wish.title}
            {wish.requestedByName ? ` · wished by ${wish.requestedByName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Budget">
            <NativeSelect value={activeBudgetId} onChange={(e) => setBudgetId(e.target.value)}>
              {(budgets.data ?? []).map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name} · {fiscalYearLabel(budget.fiscalYear)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Category">
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as BudgetCategoryValue)}>
              {BUDGET_CATEGORIES.map((value) => (
                <option key={value} value={value}>{BUDGET_CATEGORY_LABELS[value]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={`Budgeted each ($) × ${wish.quantity}`}>
            <Input inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
          <Field label="Counts as">
            <NativeSelect value={unplanned ? "unplanned" : "planned"} onChange={(e) => setUnplanned(e.target.value === "unplanned")}>
              <option value="planned">Planned</option>
              <option value="unplanned">Unplanned (after submitting)</option>
            </NativeSelect>
          </Field>
          <p className="text-[13px] text-muted-foreground sm:col-span-2">
            The wish stays on the list as In budget and links to its line.
            {total !== null && ` Adds ${formatCentsCompact(total * wish.quantity)} to planned spending.`}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" className="bg-[#3E63DD] text-white hover:bg-[#3452B8]" onClick={() => void submit()} disabled={pending || budgets.isLoading}>
            Move to budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
