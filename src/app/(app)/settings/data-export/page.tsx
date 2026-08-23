"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";
import {
  getExportCompletionToast,
  getExportFilename,
  readExportFailureMessage,
} from "./export-download";

type ExportConfig = {
  key: string;
  label: string;
  description: string;
  url: string;
};

const EXPORTS: ExportConfig[] = [
  {
    key: "items",
    label: "Items",
    description: "All serialized inventory with status, category, department, and location.",
    url: "/api/assets/export",
  },
  {
    key: "users",
    label: "Users",
    description: "All user profiles — roles, areas, contact info, and sizes.",
    url: "/api/users/export",
  },
  {
    key: "licenses",
    label: "Licenses",
    description: "Software license codes, accounts, and holder assignments.",
    url: "/api/licenses/export",
  },
  {
    key: "bookings",
    label: "Bookings",
    description: "Checkout and reservation history with items, requesters, and status.",
    url: "/api/bookings/export",
  },
  {
    key: "audit",
    label: "Audit Log",
    description: "Full change history with actor, entity, action, and before/after snapshots (up to 5,000 rows).",
    url: "/api/audit/export",
  },
];

export default function DataExportPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const activeDownloadRef = useRef<string | null>(null);

  async function handleDownload(cfg: ExportConfig) {
    if (activeDownloadRef.current) {
      toast.info("Finish the current export before starting another download.");
      return;
    }
    activeDownloadRef.current = cfg.key;
    setDownloading(cfg.key);
    try {
      const res = await fetch(cfg.url);

      if (res.status === 401) {
        handleAuthRedirect(res, "/settings/data-export");
        return;
      }
      if (!res.ok) {
        toast.error(await readExportFailureMessage(res, cfg.label));
        return;
      }

      const truncated = res.headers.get("X-Truncated") === "true";
      const total = res.headers.get("X-Total-Count");

      const blob = await res.blob();
      const filename = getExportFilename(
        res.headers.get("Content-Disposition"),
        `${cfg.key}-export.csv`,
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const completionToast = getExportCompletionToast(cfg.label, truncated, total);
      if (completionToast.variant === "warning") {
        toast.warning(completionToast.message);
      } else {
        toast.success(completionToast.message);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Download failed. Check your connection and try again.");
    } finally {
      activeDownloadRef.current = null;
      setDownloading(null);
    }
  }

  return (
    <SettingsPageShell
      title="Data Export"
      description="Download a CSV snapshot of any data set. Exports are capped at 5,000 rows and include all records visible to your role."
    >
      <div className="flex flex-col gap-3">
        {EXPORTS.map((cfg) => {
          const isLoading = downloading === cfg.key;
          const actionLabel = `${isLoading ? "Downloading" : "Download"} ${cfg.label} CSV`;
          return (
            <Card key={cfg.key}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{cfg.label}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{cfg.description}</p>
                </div>
                <Button
                  variant="outline"
                  className="h-10 shrink-0"
                  disabled={!!downloading}
                  onClick={() => handleDownload(cfg)}
                  aria-label={actionLabel}
                  aria-busy={isLoading}
                >
                  {isLoading
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Download className="size-4" />
                  }
                  {actionLabel}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </SettingsPageShell>
  );
}
