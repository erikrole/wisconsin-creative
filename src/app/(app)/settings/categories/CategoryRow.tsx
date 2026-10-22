"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CornerDownRightIcon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { LastEditedHint } from "@/components/LastEditedHint";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import type { LastAuditMap } from "@/hooks/use-last-audit";
import type { Category, TreeNode } from "./types";
import KebabMenu from "./KebabMenu";
import MoveCategoryDialog from "./MoveCategoryDialog";
import { Input } from "@/components/ui/input";

export default function CategoryRow({
  node,
  depth,
  lastEdited,
  isAdmin,
  allCategories,
  onRefresh,
}: {
  node: TreeNode;
  depth: number;
  lastEdited: LastAuditMap;
  isAdmin: boolean;
  allCategories: Category[];
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(node.name);
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const [moving, setMoving] = useState(false);
  const [savingRename, setSavingRename] = useState(false);
  const [savingSub, setSavingSub] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const subInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renaming) inputRef.current?.focus(); }, [renaming]);
  useEffect(() => { if (addingSub) subInputRef.current?.focus(); }, [addingSub]);

  async function saveRename() {
    if (!newName.trim() || newName.trim() === node.name) {
      setRenaming(false);
      setNewName(node.name);
      return;
    }
    setSavingRename(true);
    try {
      const res = await fetch(`/api/categories/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (handleAuthRedirect(res, "/settings/categories")) return;
      if (res.ok) {
        setRenaming(false);
        toast.success(`Renamed to "${newName.trim()}"`);
        onRefresh();
      } else {
        const msg = await parseErrorMessage(res, "Failed to rename");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to rename");
    } finally {
      setSavingRename(false);
    }
  }

  async function saveSub() {
    if (!subName.trim()) { setAddingSub(false); return; }
    setSavingSub(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: subName.trim(), parentId: node.id }),
      });
      if (handleAuthRedirect(res, "/settings/categories")) return;
      if (res.ok) {
        toast.success(`Added "${subName.trim()}"`);
        setSubName("");
        setAddingSub(false);
        onRefresh();
      } else {
        const msg = await parseErrorMessage(res, "Failed to create subcategory");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to create subcategory");
    } finally {
      setSavingSub(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    const ok = await confirm({
      title: "Delete category",
      message: `Delete "${node.name}"? This is only available when the category has no items and no subcategories. Item forms and filters will stop showing it immediately.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/categories/${node.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res, "/settings/categories")) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Delete failed");
        toast.error(msg);
      } else {
        onRefresh();
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  const isChild = depth > 0;
  // Direct items only. The badge links to /items?category=<id>, which filters
  // to exactly this category (not descendants), so the count must match.
  const displayCount = node.itemCount;

  const indent = depth > 0 ? 16 + depth * 22 : 16;

  return (
    <>
      <div
        className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2 pr-2 last:border-b-0 hover:bg-muted/50"
        style={{ paddingLeft: indent }}
      >
        <div className={`flex min-w-0 items-center text-sm ${isChild ? "font-normal" : "font-bold"}`}>
          {isChild && <CornerDownRightIcon className="size-3.5 text-muted-foreground mr-2 shrink-0" aria-hidden="true" />}
          {renaming ? (
            <Input
              ref={inputRef}
              aria-label={`Rename ${node.name}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") { setRenaming(false); setNewName(node.name); }
              }}
              disabled={savingRename}
              className={`h-8 w-[min(220px,100%)] ${isChild ? "font-normal" : "font-bold"} ${savingRename ? "opacity-60" : ""}`}
            />
          ) : (
            <div className="flex min-w-0 flex-col">
              <Link
                href={`/items?category=${node.id}`}
                className="truncate no-underline text-foreground hover:text-[var(--wi-red)] transition-colors"
              >
                {node.name}
              </Link>
              <LastEditedHint info={lastEdited[node.id]} className="font-normal" />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {displayCount > 0 && (
            <Link
              href={`/items?category=${node.id}`}
              className="rounded-md px-2 py-1 text-[13px] text-muted-foreground no-underline tabular-nums hover:bg-muted hover:text-foreground"
            >
              {displayCount} item{displayCount !== 1 ? "s" : ""}
            </Link>
          )}
          <KebabMenu
            onRename={() => { setNewName(node.name); setRenaming(true); }}
            onAddSub={() => setAddingSub(true)}
            onMove={() => setMoving(true)}
            onDelete={handleDelete}
            hasItems={node.itemCount > 0}
            hasChildren={node.children.length > 0}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      {moving && (
        <MoveCategoryDialog
          node={node}
          allCategories={allCategories}
          open={moving}
          onOpenChange={setMoving}
          onMoved={onRefresh}
        />
      )}

      {addingSub && (
        <div className="flex min-h-12 items-center border-b border-border py-2 pr-4 last:border-b-0" style={{ paddingLeft: 16 + (depth + 1) * 22 }}>
          <div className="flex min-w-0 items-center text-sm">
            <CornerDownRightIcon className="size-3.5 text-muted-foreground mr-2 shrink-0" />
            <Input
              ref={subInputRef}
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              aria-label={`New subcategory in ${node.name}`}
              placeholder="Subcategory name, then Enter"
              onBlur={saveSub}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSub();
                if (e.key === "Escape") { setAddingSub(false); setSubName(""); }
              }}
              disabled={savingSub}
              className={`h-8 w-[min(220px,100%)] ${savingSub ? "opacity-60" : ""}`}
            />
          </div>
        </div>
      )}

      {node.children.map((child) => (
        <CategoryRow
          key={child.id}
          node={child}
          depth={depth + 1}
          lastEdited={lastEdited}
          isAdmin={isAdmin}
          allCategories={allCategories}
          onRefresh={onRefresh}
        />
      ))}
    </>
  );
}
