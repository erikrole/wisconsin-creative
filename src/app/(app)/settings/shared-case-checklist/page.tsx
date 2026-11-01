"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { CHECKLIST_LABEL_MAX, CHECKLIST_SECTION_MAX, type ChecklistItem } from "@/lib/shared-case-checklist";
import { SettingsGroup } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";

type DraftItem = { id?: string; key: string; label: string; section: string };
type GuideOption = { id: string; title: string };

const HREF = "/settings/shared-case-checklist";
let nextKey = 0;
const toDraft = (items: ChecklistItem[]): DraftItem[] =>
  items.map((item) => ({ id: item.id, key: item.id, label: item.label, section: item.section ?? "" }));

export default function SharedCaseChecklistPage() {
  const { data: me } = useCurrentUser();
  const canEdit = me?.role === "ADMIN";
  const { data, loading, error, reload } = useFetch<{ items: ChecklistItem[] }>({ url: "/api/settings/shared-case-checklist", returnTo: HREF });
  const { data: guides } = useFetch<GuideOption[]>({
    url: "/api/resources?q=check",
    transform: (json) => ((json.data as GuideOption[]) ?? []).map((guide) => ({ id: guide.id, title: guide.title })),
  });

  const [draft, setDraft] = useState<DraftItem[] | null>(null);
  const [base, setBase] = useState<DraftItem[] | null>(null);
  const [lastData, setLastData] = useState<typeof data>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const dirty = draft && base ? JSON.stringify(draft) !== JSON.stringify(base) : false;

  if (data && data !== lastData) {
    setLastData(data);
    if (!dirty && !saving) {
      setDraft(toDraft(data.items));
      setBase(toDraft(data.items));
    }
  }

  const sections = [...new Set((draft ?? []).map((item) => item.section.trim()).filter(Boolean))];

  function update(key: string, patch: Partial<DraftItem>) {
    setDraft((prev) => prev?.map((item) => (item.key === key ? { ...item, ...patch } : item)) ?? prev);
  }

  function move(index: number, by: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + by, 0, item);
      return next;
    });
  }

  function add() {
    const section = draft?.at(-1)?.section ?? "";
    setDraft((prev) => [...(prev ?? []), { key: `new-${nextKey++}`, label: "", section }]);
  }

  async function bringOver(resourceId: string) {
    setImporting(true);
    try {
      const res = await fetch("/api/settings/shared-case-checklist/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId }),
      });
      if (handleAuthRedirect(res, HREF)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't read that guide"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { title: string; items: { label: string; section: string | null }[] } }>(res);
      const items = json?.data?.items ?? [];
      setDraft((prev) => [
        ...(prev ?? []),
        ...items.map((item) => ({ key: `new-${nextKey++}`, label: item.label, section: item.section ?? "" })),
      ]);
      toast.success(`Added ${items.length} items from ${json?.data?.title}. Review them, then save.`);
    } catch {
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      setImporting(false);
    }
  }

  async function save() {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    try {
      const items = draft
        .filter((item) => item.label.trim())
        .map((item) => ({ id: item.id, label: item.label.trim(), section: item.section.trim() || null }));
      const res = await fetch("/api/settings/shared-case-checklist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (handleAuthRedirect(res, HREF)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't save the checklist"));
        return;
      }
      const json = await parseJsonSafely<{ data?: { items: ChecklistItem[] } }>(res);
      const next = toDraft(json?.data?.items ?? []);
      setDraft(next);
      setBase(next);
      toast.success("Checklist saved.");
    } catch {
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !draft) {
    return <SettingsPageShell href={HREF}><Skeleton className="h-64 w-full rounded-lg" /></SettingsPageShell>;
  }
  if (!draft) {
    return (
      <SettingsPageShell href={HREF}>
        <EmptyState inline icon="box" title="Could not load the checklist" actionLabel="Retry" onAction={reload} />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href={HREF} mainClassName="flex flex-col gap-4">
      {error && (
        <Alert>
          <AlertDescription>Could not refresh. The list shown may be out of date.</AlertDescription>
        </Alert>
      )}
      <SettingsGroup
        title="Items"
        description="Shows on every shared case reservation and checkout, on the website and at the kiosk. Anyone can tick items; each tick records who and when."
      >
        <datalist id="checklist-sections">
          {sections.map((section) => <option key={section} value={section} />)}
        </datalist>
        {draft.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No items yet. Add them one at a time, or bring over a checklist from Resources.</div>
        ) : (
          draft.map((item, index) => (
            <div key={item.key} className="flex items-center gap-2 px-3 py-2">
              <Input
                aria-label="Item"
                placeholder="Item, e.g. XLR cables (4)"
                value={item.label}
                maxLength={CHECKLIST_LABEL_MAX}
                onChange={(event) => update(item.key, { label: event.target.value })}
                className="h-10 min-w-0 flex-[3]"
                disabled={!canEdit || saving}
              />
              <Input
                aria-label="Section"
                placeholder="Section"
                list="checklist-sections"
                value={item.section}
                maxLength={CHECKLIST_SECTION_MAX}
                onChange={(event) => update(item.key, { section: event.target.value })}
                className="h-10 min-w-0 flex-[2] max-sm:hidden"
                disabled={!canEdit || saving}
              />
              {canEdit && (
                <div className="flex shrink-0 items-center">
                  <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Move ${item.label || "item"} up`} disabled={index === 0 || saving} onClick={() => move(index, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Move ${item.label || "item"} down`} disabled={index === draft.length - 1 || saving} onClick={() => move(index, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground hover:text-destructive" aria-label={`Remove ${item.label || "item"}`} disabled={saving} onClick={() => setDraft((prev) => prev?.filter((entry) => entry.key !== item.key) ?? prev)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </SettingsGroup>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-10" onClick={add} disabled={saving}>
            <Plus className="size-4" />
            Add item
          </Button>
          {(guides?.length ?? 0) > 0 && (
            <Select value="" onValueChange={bringOver} disabled={importing || saving}>
              <SelectTrigger className="h-10 w-auto" aria-label="Bring over from Resources">
                <SelectValue placeholder={importing ? "Bringing over…" : "Bring over from Resources"} />
              </SelectTrigger>
              <SelectContent>
                {guides?.map((guide) => <SelectItem key={guide.id} value={guide.id}>{guide.title}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <SettingsSaveBar className="ml-auto pt-0" dirty={dirty} saving={saving} onReset={() => setDraft(base)} onSave={save} />
        </div>
      )}
    </SettingsPageShell>
  );
}
