"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { parseErrorMessage } from "@/lib/errors";
import {
  QUICK_LINK_AUDIENCES,
  audienceForRoles,
  quickLinkBody,
  type QuickLinkAudienceId,
  type QuickLinkDto,
} from "@/lib/quick-links";
import { SettingsGroup } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";

const MANAGE_KEY = ["quick-links", "manage"] as const;

type Draft = { id: string | null; label: string; url: string; detail: string; audience: QuickLinkAudienceId };
const EMPTY_DRAFT: Draft = { id: null, label: "", url: "https://", detail: "", audience: "internal" };

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn’t save. Try again."));
  return res;
}

function hostOf(url: string) {
  if (url.startsWith("/")) return url;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function QuickLinksSettingsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<QuickLinkDto[]>({
    queryKey: MANAGE_KEY,
    queryFn: async () => {
      const res = await fetch("/api/quick-links?manage=1");
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      return ((await res.json()) as { data: QuickLinkDto[] }).data;
    },
  });
  const links = data ?? [];

  // The sidebar menu reads the same table, so it refreshes with this page.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["quick-links"] });

  async function move(index: number, by: -1 | 1) {
    const next = [...links];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    queryClient.setQueryData(MANAGE_KEY, next);
    try {
      await send("/api/quick-links", "PUT", { ids: next.map((l) => l.id) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t save the order");
    }
    void refresh();
  }

  async function remove(link: QuickLinkDto) {
    const ok = await confirm({
      title: `Remove ${link.label}?`,
      message: "It disappears from everyone’s Quick links menu.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await send(`/api/quick-links/${link.id}`, "DELETE");
      toast.success(`Removed ${link.label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t remove the link");
    }
    void refresh();
  }

  return (
    <SettingsPageShell
      href="/settings/quick-links"
      actions={
        <Button className="h-10" onClick={() => setDraft(EMPTY_DRAFT)}>
          <Plus data-icon="inline-start" />
          Add link
        </Button>
      }
    >
      {isLoading ? (
        <SettingsGroup>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5" aria-hidden="true">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ))}
        </SettingsGroup>
      ) : isError ? (
        <EmptyState icon="wifi-off" title="Couldn’t load Quick links" actionLabel="Try again" onAction={() => void refetch()} />
      ) : links.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No Quick links yet"
          description="Add the sites the team opens every day. They appear in the sidebar's Quick links menu."
          actionLabel="Add link"
          onAction={() => setDraft(EMPTY_DRAFT)}
        />
      ) : (
        <SettingsGroup
          footer="Links open in a new tab. People only see the links meant for their role."
        >
          {links.map((link, index) => {
            const audience = audienceForRoles(link.roles);
            return (
              <div key={link.id} className="flex items-center gap-3 px-4 py-3" data-quick-link-row>
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[13px] font-black text-muted-foreground">
                  {link.label.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex min-w-0 items-baseline gap-2 text-sm font-bold text-foreground">
                    <span className="truncate">{link.label}</span>
                    <span className="truncate text-[13px] font-normal text-muted-foreground max-sm:hidden">{hostOf(link.url)}</span>
                  </p>
                  <p className="m-0 mt-0.5 truncate text-[13px] text-muted-foreground">
                    {[audience.label, link.detail].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="size-9 max-sm:hidden" disabled={index === 0} onClick={() => void move(index, -1)} aria-label={`Move ${link.label} up`}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-9 max-sm:hidden" disabled={index === links.length - 1} onClick={() => void move(index, 1)} aria-label={`Move ${link.label} down`}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button asChild variant="ghost" size="icon" className="size-9">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link.label} in a new tab`}>
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    onClick={() => setDraft({ id: link.id, label: link.label, url: link.url, detail: link.detail ?? "", audience: audience.id })}
                    aria-label={`Edit ${link.label}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive" onClick={() => void remove(link)} aria-label={`Remove ${link.label}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}>
        {draft && (
          <LinkDialog
            draft={draft}
            busy={busy}
            onChange={setDraft}
            onSave={async () => {
              const parsed = quickLinkBody.safeParse(draft);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Check the link");
                return;
              }
              setBusy(true);
              try {
                await send(draft.id ? `/api/quick-links/${draft.id}` : "/api/quick-links", draft.id ? "PATCH" : "POST", parsed.data);
                toast.success(draft.id ? "Link saved" : `Added ${parsed.data.label}`);
                setDraft(null);
                void refresh();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Couldn’t save the link");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Dialog>
    </SettingsPageShell>
  );
}

function LinkDialog({ draft, busy, onChange, onSave }: {
  draft: Draft;
  busy: boolean;
  onChange: (next: Draft) => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <DialogContent className="sm:max-w-md">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <DialogHeader className="flex-col items-start gap-1">
          <DialogTitle>{draft.id ? "Edit link" : "Add a Quick link"}</DialogTitle>
          <DialogDescription>It shows in the sidebar&rsquo;s Quick links menu for the people you choose.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-link-label">Name</Label>
          <Input id="quick-link-label" value={draft.label} maxLength={40} placeholder="APM Music" onChange={(e) => set({ label: e.target.value })} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-link-url">Link</Label>
          <Input id="quick-link-url" value={draft.url} inputMode="url" placeholder="https://" onChange={(e) => set({ url: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-link-detail">Short description <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="quick-link-detail" value={draft.detail} maxLength={60} placeholder="Production music" onChange={(e) => set({ detail: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-link-audience">Who can see it</Label>
          <NativeSelect id="quick-link-audience" value={draft.audience} onChange={(e) => set({ audience: e.target.value as QuickLinkAudienceId })}>
            {QUICK_LINK_AUDIENCES.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </NativeSelect>
          <p className="m-0 text-[13px] text-muted-foreground">
            {QUICK_LINK_AUDIENCES.find((a) => a.id === draft.audience)?.description}
          </p>
        </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" className="h-10" disabled={busy}>{busy ? "Saving…" : draft.id ? "Save" : "Add link"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
