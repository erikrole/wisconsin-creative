"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronRightIcon, PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportContext } from "@/lib/error-reporting/client";
import { summarizeUserAgent, type Breadcrumb } from "@/lib/error-reporting/grouping";
import { parseErrorMessage } from "@/lib/errors";

type OpenOptions = { message?: string };
type ReportProblemContextValue = { open: (options?: OpenOptions) => void };

const ReportProblemContext = createContext<ReportProblemContextValue | null>(null);

/** Opens the "Report a problem" dialog; null outside the signed-in app. */
export function useReportProblem(): ReportProblemContextValue | null {
  return useContext(ReportProblemContext);
}

type Snapshot = ReturnType<typeof supportContext> & { browser: string | null; os: string | null };

export function ReportProblemProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const open = useCallback((options?: OpenOptions) => {
    // Freeze the context when the form opens, so typing here never becomes a "recent action".
    const agent = summarizeUserAgent(navigator.userAgent);
    setSnapshot({ ...supportContext(), browser: agent.browser, os: agent.os });
    setMessage(options?.message ?? "");
    setShowDetails(false);
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  async function send() {
    if (!snapshot || message.trim().length < 3) return;
    setSending(true);
    try {
      const response = await fetch("/api/support-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          client: { platform: "web", appBuild: snapshot.appBuild, releaseChannel: snapshot.releaseChannel || null },
          screen: snapshot.screen,
          breadcrumbs: snapshot.breadcrumbs,
        }),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Your report didn't send. Try again."));
        return;
      }
      toast.success("Thanks. Your report was sent.");
      setSnapshot(null);
    } catch {
      toast.error("Your report didn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ReportProblemContext.Provider value={value}>
      {children}
      <Dialog open={snapshot !== null} onOpenChange={(next) => !next && !sending && setSnapshot(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              Tell us what happened. The details below are attached so we can find it quickly.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="report-problem-message">What happened?</Label>
              <Textarea
                id="report-problem-message"
                data-private
                autoFocus
                rows={5}
                maxLength={4000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What were you trying to do, and what went wrong?"
              />
            </div>
            {snapshot ? <AttachedDetails snapshot={snapshot} expanded={showDetails} onToggle={() => setShowDetails((v) => !v)} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSnapshot(null)} disabled={sending}>
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={sending || message.trim().length < 3}>
              {sending ? "Sending…" : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ReportProblemContext.Provider>
  );
}

function AttachedDetails({ snapshot, expanded, onToggle }: { snapshot: Snapshot; expanded: boolean; onToggle: () => void }) {
  const rows: Array<[string, string]> = [
    ["Page", snapshot.screen ?? "Unknown"],
    ["App version", snapshot.appBuild ? `Web ${snapshot.appBuild}` : "Web (local build)"],
    ["Browser", [snapshot.browser, snapshot.os].filter(Boolean).join(" on ") || "Unknown"],
    ["Recent actions", `${snapshot.breadcrumbs.length} in this session`],
  ];
  return (
    <div className="rounded-lg border bg-muted/40 text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        <PaperclipIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">Attached automatically</span>
        <ChevronRightIcon className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="m-0 min-w-0 truncate font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {snapshot.breadcrumbs.length > 0 ? <ActionList crumbs={snapshot.breadcrumbs} /> : null}
          <p className="m-0 text-xs text-muted-foreground">
            Nothing you typed into the app, and no passwords, are included.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ActionList({ crumbs }: { crumbs: Breadcrumb[] }) {
  return (
    <ol className="m-0 flex max-h-32 list-none flex-col gap-0.5 overflow-y-auto p-0 font-mono text-[11.5px] text-muted-foreground">
      {crumbs.slice(-8).map((crumb, index) => (
        <li key={`${crumb.at}-${index}`} className="truncate">
          {crumb.message}
        </li>
      ))}
    </ol>
  );
}
