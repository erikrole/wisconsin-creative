"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, SearchIcon, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useFetch } from "@/hooks/use-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useLastAudit } from "@/hooks/use-last-audit";
import EmptyState from "@/components/EmptyState";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import type { Category } from "./types";
import { buildTree } from "./types";
import CategoryRow from "./CategoryRow";
import { SettingsPageShell } from "../SettingsPageShell";

export default function CategoriesPage() {
  const { data: categories, loading, error, reload } = useFetch<Category[]>({
    url: "/api/categories",
    returnTo: "/settings/categories",
    transform: (json) => (json.data as Category[]) ?? [],
  });
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [creatingRoot, setCreatingRoot] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const lastEdited = useLastAudit("category", (categories ?? []).map((category) => category.id));

  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);

  async function createRoot() {
    if (creatingRoot) return;
    setAddError("");
    // Empty input + blur/Enter cancels silently (matches subcategory add).
    if (!newName.trim()) {
      setAdding(false);
      setNewName("");
      return;
    }
    setCreatingRoot(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (handleAuthRedirect(res, "/settings/categories")) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to create category");
        setAddError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Added "${newName.trim()}"`);
      setNewName("");
      setAdding(false);
      reload();
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      const msg = kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to create category - please try again";
      setAddError(msg);
      toast.error(msg);
    } finally {
      setCreatingRoot(false);
    }
  }

  let tree = buildTree(categories ?? []);

  // Filter by search — keep the full ancestor chain visible so deeply-nested
  // matches don't render as orphans in the tree.
  if (search) {
    const q = search.toLowerCase();
    const all = categories ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const matchIds = new Set<string>();
    for (const c of all) {
      if (!c.name.toLowerCase().includes(q)) continue;
      let cursor: typeof c | undefined = c;
      while (cursor) {
        if (matchIds.has(cursor.id)) break;
        matchIds.add(cursor.id);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
    }
    const filtered = all.filter((c) => matchIds.has(c.id));
    tree = buildTree(filtered);
  }

  if (!sortAsc) {
    tree = [...tree].reverse();
  }

  const ErrorIcon = error === "network" ? WifiOff : AlertTriangle;
  const errorMessage =
    error === "network"
      ? "Unable to reach the server. Check your connection and try again."
      : "Something went wrong loading categories. Please try again.";

  return (
    <SettingsPageShell
      title="Categories"
      description="Organize inventory under categories and subcategories to make equipment easier to find and manage."
    >
        <div className="flex justify-end mb-3">
          <Button onClick={() => { setAdding(true); setAddError(""); }}>
            Add new category
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="relative w-full max-w-[260px]">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
	              <Input
	                id="category-search"
	                name="categorySearch"
	                type="text"
	                placeholder="Search"
	                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9"
                aria-label="Search categories"
              />
            </div>
          </CardHeader>

          <div className="px-4 py-2.5 border-b border-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={() => setSortAsc((v) => !v)}
                  className="h-10 text-xs font-semibold text-muted-foreground uppercase tracking-wider h-auto px-0 gap-1.5 hover:bg-transparent hover:text-foreground"
                >
                  Name
                  {sortAsc ? <ArrowDownAZ className="size-3.5" /> : <ArrowUpAZ className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sortAsc ? "Sort Z\u2013A" : "Sort A\u2013Z"}</TooltipContent>
            </Tooltip>
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 min-h-[48px]"
                >
                  <div className="flex items-center gap-2">
                    {i === 1 || i === 3 ? (
                      <Skeleton className="size-4 rounded-sm" />
                    ) : null}
                    <Skeleton
                      className={`h-4 rounded ${i % 2 === 0 ? "w-[140px]" : "w-[100px]"}`}
                    />
                  </div>
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-12 px-5 text-center">
              <ErrorIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-xs">
                {errorMessage}
              </p>
              <Button className="h-10" variant="outline" onClick={reload}>
                Retry
              </Button>
            </div>
          ) : (
          <div className="divide-y divide-border">
              {addError && (
                <div className="border-b border-border px-4 py-3">
                  <Alert variant="destructive">
                    <AlertDescription>{addError}</AlertDescription>
                  </Alert>
                </div>
              )}
              {adding && (
                <div className="flex items-center justify-between pl-4 pr-4 py-3 min-h-[48px] border-b border-border">
                  <div className="flex items-center font-semibold">
	                    <Input
	                      ref={addRef}
	                      id="new-category-name"
	                      name="newCategoryName"
	                      value={newName}
                      onChange={(e) => { setNewName(e.target.value); setAddError(""); }}
                      placeholder="Category name"
                      className="w-full max-w-[200px] font-semibold"
                      onBlur={createRoot}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") createRoot();
                        if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(""); }
                      }}
                      disabled={creatingRoot}
                    />
                  </div>
                </div>
              )}
              {tree.length === 0 && !adding ? (
                <EmptyState
                  inline
                  icon={search ? "search" : "folder"}
                  title={search ? "No categories match your search" : "No categories yet"}
                  description={search ? "Try a different category name." : "Add a category to keep item forms and filters organized."}
                />
              ) : (
                tree.map((node) => (
                  <CategoryRow
                    key={node.id}
                    node={node}
                    depth={0}
                    lastEdited={lastEdited}
                    isAdmin={isAdmin}
                    allCategories={categories ?? []}
                    onRefresh={reload}
                  />
                ))
              )}
            </div>
          )}
        </Card>
    </SettingsPageShell>
  );
}
