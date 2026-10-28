"use client";

import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import type { Category } from "./types";

const ROOT_VALUE = "__root__";

/** Collect a category and all of its descendants (invalid move targets that would cycle). */
function collectSubtree(rootId: string, all: Category[]): Set<string> {
  const childrenByParent = new Map<string, Category[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }
  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!blocked.has(child.id)) {
        blocked.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return blocked;
}

/** Build a "Parent / Child" path label so same-named categories are distinguishable. */
function pathLabel(category: Category, byId: Map<string, Category>): string {
  const parts: string[] = [category.name];
  let cursor = category.parentId ? byId.get(category.parentId) : undefined;
  let guard = 0;
  while (cursor && guard < 50) {
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    guard += 1;
  }
  return parts.join(" / ");
}

export default function MoveCategoryDialog({
  node,
  allCategories,
  open,
  onOpenChange,
  onMoved,
}: {
  node: Category;
  allCategories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}) {
  const currentValue = node.parentId ?? ROOT_VALUE;
  const [target, setTarget] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const options = useMemo<ComboboxOption[]>(() => {
    const byId = new Map(allCategories.map((c) => [c.id, c]));
    const blocked = collectSubtree(node.id, allCategories);
    const cats = allCategories
      .filter((c) => !blocked.has(c.id))
      .map((c) => ({ value: c.id, label: pathLabel(c, byId), keywords: [c.name] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: ROOT_VALUE, label: "Top level (no parent)" }, ...cats];
  }, [allCategories, node.id]);

  async function save() {
    if (saving) return;
    if (target === currentValue) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const parentId = target === ROOT_VALUE ? null : target;
    try {
      const res = await fetch(`/api/categories/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId }),
      });
      if (handleAuthRedirect(res, "/settings/categories")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to move category"));
        return;
      }
      const destination = parentId
        ? allCategories.find((c) => c.id === parentId)?.name ?? "new parent"
        : "Top level";
      toast.success(`Moved "${node.name}" to ${destination}`);
      onOpenChange(false);
      onMoved();
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You’re offline. Check your connection." : "Failed to move category");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTarget(currentValue);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move &ldquo;{node.name}&rdquo;</DialogTitle>
          <DialogDescription>
            Choose a new parent category. Its own subcategories aren&rsquo;t shown to prevent loops.
          </DialogDescription>
        </DialogHeader>
        <Combobox
          options={options}
          value={target}
          onValueChange={(v) => setTarget(v || ROOT_VALUE)}
          placeholder="Select a parent…"
          searchPlaceholder="Search categories…"
          emptyMessage="No valid destinations."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || target === currentValue}>
            {saving ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
