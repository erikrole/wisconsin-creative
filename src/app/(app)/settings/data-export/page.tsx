"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { handleAuthRedirect, isAbortError } from "@/lib/errors";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
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
    description: "Everyone's profile: role, area, contact info, and sizes.",
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
    label: "Audit log",
    description: "Every change with who, what, and before and after values.",
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
      href="/settings/data-export"
      description="Download a spreadsheet (CSV) of any data set. Each export holds up to 5,000 rows of what your role can see."
    >
      <SettingsGroup>
        {EXPORTS.map((cfg) => {
          const isLoading = downloading === cfg.key;
          const actionLabel = `${isLoading ? "Downloading" : "Download"} ${cfg.label} CSV`;
          return (
            <SettingsRow key={cfg.key} label={cfg.label} description={cfg.description}>
              <div className="flex sm:justify-end">
                <Button
                  variant="outline"
                  className="h-10"
                  disabled={!!downloading}
                  onClick={() => handleDownload(cfg)}
                  aria-label={actionLabel}
                  aria-busy={isLoading}
                >
                  {isLoading
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Download className="size-4" />
                  }
                  {isLoading ? "Downloading" : "Download"}
                </Button>
              </div>
            </SettingsRow>
          );
        })}
      </SettingsGroup>
    </SettingsPageShell>
  );
}
