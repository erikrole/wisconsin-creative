"use client";

import { useState } from "react";
import { EyeIcon, LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type CurrentUser } from "@/hooks/use-current-user";
import { parseJsonSafely } from "@/lib/errors";

type PreviewRole = "STAFF" | "STUDENT" | "COLLABORATOR";
type CollaboratorAffiliation = "BIG_TEN_NETWORK" | "LEARFIELD";

const PREVIEW_ROLES: Array<{ role: PreviewRole; label: string; description: string }> = [
  { role: "STAFF", label: "Staff", description: "Staff navigation and gates" },
  { role: "STUDENT", label: "Student", description: "Student navigation and gates" },
  { role: "COLLABORATOR", label: "Collaborator", description: "Capability-scoped partner view" },
];

const PREVIEW_OPTIONS: Array<{
  role: PreviewRole;
  label: string;
  description: string;
  collaboratorAffiliation?: CollaboratorAffiliation;
}> = [
  { role: "STAFF", label: "Staff", description: "Staff navigation and gates" },
  { role: "STUDENT", label: "Student", description: "Student navigation and gates" },
  { role: "COLLABORATOR", label: "Big Ten Network", description: "Collaborator access · BTN", collaboratorAffiliation: "BIG_TEN_NETWORK" },
  { role: "COLLABORATOR", label: "Learfield", description: "Collaborator access · Learfield", collaboratorAffiliation: "LEARFIELD" },
];

function roleLabel(role: string) {
  return PREVIEW_ROLES.find((entry) => entry.role === role)?.label ?? role;
}

function useRolePreviewActions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function refreshShell() {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.refresh();
  }

  async function startPreview(role: PreviewRole, collaboratorAffiliation?: CollaboratorAffiliation) {
    setPending(true);
    try {
      const response = await fetch("/api/admin/role-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...(collaboratorAffiliation ? { collaboratorAffiliation } : {}) }),
      });
      if (!response.ok) {
        const error = await parseJsonSafely<{ error?: string }>(response);
        throw new Error(error?.error ?? "Could not start preview mode");
      }
      await refreshShell();
      toast.success(`Previewing as ${roleLabel(role)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start preview mode");
    } finally {
      setPending(false);
    }
  }

  async function stopPreview() {
    setPending(true);
    try {
      const response = await fetch("/api/admin/role-preview", { method: "DELETE" });
      if (!response.ok) {
        const error = await parseJsonSafely<{ error?: string }>(response);
        throw new Error(error?.error ?? "Could not exit preview mode");
      }
      await refreshShell();
      toast.success("Exited preview mode");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not exit preview mode");
    } finally {
      setPending(false);
    }
  }

  return { pending, startPreview, stopPreview };
}

export function RolePreviewBanner({ user }: { user: CurrentUser }) {
  const { pending, stopPreview } = useRolePreviewActions();
  if (!user.preview) return null;

  return (
    <div
      className="flex min-h-10 items-center justify-center gap-3 border-b border-amber-300/60 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/80 dark:text-amber-100 max-md:flex-wrap max-md:gap-2"
      role="status"
      data-role-preview="active"
    >
      <EyeIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Previewing as <strong>{roleLabel(user.preview.role)}</strong>
        {user.preview.role === "COLLABORATOR" && user.collaboratorPolicy?.displayName ? ` · ${user.collaboratorPolicy.displayName}` : ""}
        {" · Read-only. Signed in as "}{user.name}{" (Admin)."}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="border-amber-400/70 bg-transparent text-amber-950 hover:bg-amber-200 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900"
        onClick={() => void stopPreview()}
        loading={pending}
      >
        <LogOutIcon aria-hidden="true" />
        Exit preview
      </Button>
    </div>
  );
}

export function RolePreviewControl({ user }: { user: CurrentUser }) {
  const { pending, startPreview } = useRolePreviewActions();
  const canManage = user.role === "ADMIN" || user.preview?.actualRole === "ADMIN";
  if (!canManage) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs max-md:px-2"
          aria-label="Preview as another role"
          disabled={pending}
        >
          <EyeIcon className="size-3.5" aria-hidden="true" />
          <span className="max-md:hidden">Preview as</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Preview as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PREVIEW_OPTIONS.map((entry) => (
          <DropdownMenuItem
            key={entry.collaboratorAffiliation ?? entry.role}
            disabled={
              pending ||
              (user.preview?.role === entry.role &&
                (!entry.collaboratorAffiliation ||
                  user.collaboratorPolicy?.affiliationKey === entry.collaboratorAffiliation))
            }
            onSelect={() => void startPreview(entry.role, entry.collaboratorAffiliation)}
          >
            <div className="flex min-w-0 flex-col">
              <span>{entry.label}</span>
              <span className="text-xs text-muted-foreground">{entry.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
