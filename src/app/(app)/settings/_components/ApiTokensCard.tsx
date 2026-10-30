"use client";

import { useState } from "react";
import { Copy, Loader2, Plus, Terminal, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/use-fetch";
import { copyTextToClipboard } from "@/lib/clipboard";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { formatDateShortCentral } from "@/lib/format";

type ApiToken = {
  id: string;
  name: string;
  scope: "READ" | "WRITE";
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
};

const EXPIRY_DAYS = [30, 90, 365] as const;

export function ApiTokensCard() {
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch<ApiToken[]>({
    url: "/api/me/api-tokens",
    returnTo: "/settings/security",
  });
  const tokens = data ?? [];

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"READ" | "WRITE">("READ");
  const [days, setDays] = useState<number>(90);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function openCreate() {
    setName("");
    setScope("READ");
    setDays(90);
    setSecret(null);
    setOpen(true);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/me/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scope, days }),
      });
      if (handleAuthRedirect(res, "/settings/security")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not create the token."));
        return;
      }
      const json = await parseJsonSafely<{ data: { secret: string } }>(res);
      setSecret(json?.data.secret ?? null);
      reload();
    } catch (err) {
      if (!isAbortError(err)) toast.error("Could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(token: ApiToken) {
    const ok = await confirm({
      title: `Revoke ${token.name}?`,
      message: "Anything using this token stops working right away.",
      confirmLabel: "Revoke",
      variant: "danger",
    });
    if (!ok) return;
    setRevokingId(token.id);
    try {
      const res = await fetch(`/api/me/api-tokens/${token.id}`, { method: "DELETE" });
      if (handleAuthRedirect(res, "/settings/security")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not revoke the token."));
        return;
      }
      toast.success("Token revoked.");
      reload();
    } catch (err) {
      if (!isAbortError(err)) toast.error("Could not reach the server. Check your connection.");
    } finally {
      setRevokingId(null);
    }
  }

  async function copySecret() {
    if (secret && (await copyTextToClipboard(`npm run wc -- login --token ${secret}`))) {
      toast.success("Copied.");
    }
  }

  return (
    <Card id="api-tokens" elevation="flat" className="rounded-xl shadow-xs">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-black">API tokens</CardTitle>
            <p className="text-sm text-muted-foreground">
              Let the wc command line and AI agents act as you.
            </p>
          </div>
          <Button className="h-10" variant="outline" onClick={openCreate}>
            <Plus className="size-4" />
            New token
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex flex-col gap-3 p-4 pt-0">
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : error ? (
          <div className="px-2 pb-2">
            <EmptyState
              inline
              icon={error === "network" ? "wifi-off" : "box"}
              title={error === "network" ? "You are offline" : "Could not load tokens"}
              description="Retry before managing tokens."
              actionLabel="Retry"
              onAction={reload}
            />
          </div>
        ) : tokens.length === 0 ? (
          <p className="px-6 pb-5 text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-center gap-3 px-6 py-3">
                <Terminal className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{token.name}</span>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {token.scope === "WRITE" ? "Read and write" : "Read only"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {token.lastUsedAt ? `Used ${formatDateShortCentral(token.lastUsedAt)}` : "Not used yet"}
                    {` · Expires ${formatDateShortCentral(token.expiresAt)}`}
                  </p>
                </div>
                <Button className="h-10" variant="ghost" disabled={revokingId !== null} onClick={() => handleRevoke(token)}>
                  {revokingId === token.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  <span className="sr-only">Revoke {token.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {secret ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your token</DialogTitle>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-3 pt-5">
                <DialogDescription>It will not be shown again. Copy puts the full wc login command on your clipboard.</DialogDescription>
                <div className="flex items-center gap-2">
                  <Input readOnly value={secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Token" />
                  <Button className="h-10 shrink-0" variant="outline" onClick={copySecret}>
                    <Copy className="size-4" />
                    Copy
                  </Button>
                </div>
              </DialogBody>
              <DialogFooter className="pt-5">
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New API token</DialogTitle>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4 pt-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-token-name">Name</Label>
                <Input
                  id="api-token-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Claude on my MacBook"
                  maxLength={60}
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Access</Label>
                <ToggleGroup
                  type="single"
                  value={scope}
                  onValueChange={(value) => value && setScope(value as "READ" | "WRITE")}
                  className="w-full"
                >
                  <ToggleGroupItem value="READ" className="flex-1">Read only</ToggleGroupItem>
                  <ToggleGroupItem value="WRITE" className="flex-1">Read and write</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-token-days">Expires in</Label>
                <NativeSelect id="api-token-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {EXPIRY_DAYS.map((d) => (
                    <option key={d} value={d}>{d === 365 ? "1 year" : `${d} days`}</option>
                  ))}
                </NativeSelect>
              </div>
              </DialogBody>
              <DialogFooter className="pt-6">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Create token
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
