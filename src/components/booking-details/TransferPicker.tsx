"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Search } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FRESH_THEME_CLASS } from "@/components/trade-board/fresh-theme";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { cn } from "@/lib/utils";

/** Dialog chrome for every gear transfer, themed wc-fresh because dialogs render in a portal. */
/** Header stacks title over description; the default row layout squeezes a long description. */
export const TRANSFER_HEADER_CLASS = "flex-col items-start gap-1";
export const TRANSFER_DIALOG_CLASS = cn(FRESH_THEME_CLASS, "max-h-[min(92dvh,46rem)] sm:max-w-md");

export type TransferPerson = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  active: boolean;
  hiddenFromRoster?: boolean;
};

/** Active, visible roster for the recipient list. Loads each time the dialog opens. */
export function useTransferRoster(open: boolean) {
  const [users, setUsers] = useState<TransferPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetchWithTimeout("/api/users?limit=200&active=true&sort=name", { signal: controller.signal })
      .then(async (res) => {
        if (handleAuthRedirect(res)) return;
        if (!res.ok) return setError(true);
        const json = await parseJsonSafely<{ data?: TransferPerson[] }>(res);
        setUsers((json?.data ?? []).filter((user) => user.active && !user.hiddenFromRoster));
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open]);

  return { users, loading, error };
}

function PersonTile({ person, caption, empty }: {
  person: { name: string; avatarUrl?: string | null } | null; caption: string; empty?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      {person ? (
        <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
      ) : (
        <div className="size-10 rounded-full border border-dashed border-[var(--text-muted)]" aria-hidden />
      )}
      <p className="w-full truncate text-sm font-semibold">{person?.name ?? empty}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

type Props = {
  from: { name: string; avatarUrl?: string | null };
  fromCaption: string;
  users: TransferPerson[];
  loading: boolean;
  error: boolean;
  /** Current holder, who can't receive their own gear. */
  excludeId?: string;
  value: string;
  onChange: (id: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  disabled?: boolean;
  /** One line on what the recipient and old holder will see. */
  consequence: string;
};

export function TransferPicker({
  from, fromCaption, users, loading, error, excludeId, value, onChange, reason, onReasonChange, disabled, consequence,
}: Props) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => users.filter((user) => user.id !== excludeId), [users, excludeId]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(q));
  }, [candidates, query]);
  const selected = candidates.find((user) => user.id === value) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-4">
        <PersonTile person={from} caption={fromCaption} />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <PersonTile person={selected} caption="Receiving" empty="Choose below" />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>People could not load. Close and reopen to try again.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="transfer-search">Hand it to</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="transfer-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={loading ? "Loading people..." : "Search by name"}
            className="pl-9"
            disabled={disabled || loading || error}
            autoComplete="off"
          />
        </div>
        <div role="radiogroup" aria-label="Receiving person" className="max-h-44 overflow-y-auto rounded-xl border">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading people..." : "No one matches that search."}
            </p>
          ) : visible.map((user) => {
            const on = user.id === value;
            return (
              <button
                key={user.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(user.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                  on && "bg-[var(--accent-soft)]",
                )}
              >
                <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                {on && <Check className="size-4 shrink-0 text-[var(--accent)]" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="transfer-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea
          id="transfer-note"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Anything the next person should know"
          disabled={disabled}
        />
      </div>

      <p className="text-xs text-muted-foreground">{consequence}</p>
    </div>
  );
}
