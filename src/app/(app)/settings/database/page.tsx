"use client";

import { useState } from "react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";
import { handleAuthRedirect, classifyError, isAbortError, parseJsonSafely } from "@/lib/errors";
import { SettingsGroup } from "../_components/SettingsGroup";
import { SettingsPageShell } from "../SettingsPageShell";

type MigrationRow = { name: string; appliedAt: string | null };
type DriftItem = { table: string; column: string; status: string };

type DiagnosticsResult = {
  ok: boolean;
  checks: {
    migrationTable: { exists: boolean; migrations: MigrationRow[] };
    tables: { present: string[]; missing: string[]; extra: string[] };
    enums: { present: string[]; missing: string[] };
    extensions: { present: string[]; missing: string[] };
    columns: { drift: DriftItem[] };
  };
  remediation: string[];
};

export default function DatabasePage() {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/db-diagnostics");
      if (handleAuthRedirect(res, "/settings/database")) return;
      if (!res.ok) {
        // Don't surface raw server error text — could leak schema internals.
        setError(
          res.status === 403
            ? "Admin access required to run diagnostics."
            : "Could not run diagnostics. Please try again."
        );
        setResult(null);
        return;
      }
      const json = await parseJsonSafely<DiagnosticsResult>(res);
      if (!json?.checks) {
        setError("Diagnostics ran, but the response could not be read. Please try again.");
        setResult(null);
        return;
      }
      setResult(json);
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      setError(kind === "network" ? "Could not reach the server. Check your connection." : "Something went wrong");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const checks = result?.checks;
  const summaryRows = checks
    ? [
        {
          label: "Migrations",
          ok: checks.migrationTable.exists,
          detail: checks.migrationTable.exists
            ? `${checks.migrationTable.migrations.length} recorded`
            : "Migration table missing",
          missing: [] as string[],
        },
        {
          label: "Tables",
          ok: checks.tables.missing.length === 0,
          detail: checks.tables.missing.length === 0
            ? `${checks.tables.present.length} present`
            : `${checks.tables.missing.length} missing`,
          missing: checks.tables.missing,
        },
        {
          label: "Enums",
          ok: checks.enums.missing.length === 0,
          detail: checks.enums.missing.length === 0
            ? `${checks.enums.present.length} present`
            : `${checks.enums.missing.length} missing`,
          missing: checks.enums.missing,
        },
        {
          label: "Extensions",
          ok: checks.extensions.missing.length === 0,
          detail: checks.extensions.missing.length === 0
            ? `${checks.extensions.present.length} installed`
            : `${checks.extensions.missing.length} missing`,
          missing: checks.extensions.missing,
        },
        {
          label: "Columns",
          ok: checks.columns.drift.length === 0,
          detail: checks.columns.drift.length === 0
            ? "No drift"
            : `${checks.columns.drift.length} missing`,
          missing: checks.columns.drift.map((d) => `${d.table}.${d.column}`),
        },
      ]
    : [];

  return (
    <SettingsPageShell
      href="/settings/database"
      description="A bounded baseline check for known tables, enums, columns, extensions, and migration records. Passing it does not replace the migration health and deploy checks."
      actions={
        <Button onClick={runCheck} loading={loading} className="h-10">
          {result ? "Run again" : "Run diagnostics"}
        </Button>
      }
      mainClassName="flex flex-col gap-7"
    >
      {error && (
        <SettingsGroup>
          <p role="alert" className="m-0 px-4 py-3.5 text-sm text-destructive">{error}</p>
        </SettingsGroup>
      )}

      {result && checks && (
        <>
          <SettingsGroup>
            <div className="flex items-center gap-3 px-4 py-3.5">
              {result.ok
                ? <CheckCircle2 className="size-5 shrink-0 text-[var(--green)]" aria-hidden="true" />
                : <XCircle className="size-5 shrink-0 text-destructive" aria-hidden="true" />}
              <span className="text-sm font-bold">
                {result.ok ? "Baseline checks passed" : "Issues detected"}
              </span>
            </div>
            {summaryRows.map((row) => (
              <div key={row.label} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold">{row.label}</span>
                  <span className={row.ok ? "text-muted-foreground" : "font-bold text-destructive"}>{row.detail}</span>
                </div>
                {row.missing.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {row.missing.map((item, i) => (
                      <code key={`${item}-${i}`} className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        {item}
                      </code>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </SettingsGroup>

          {result.remediation.length > 0 && (
            <SettingsGroup title="How to fix">
              {result.remediation.map((step, i) => (
                <p key={i} className="m-0 px-4 py-3 font-mono text-[13px] leading-relaxed">
                  {step}
                </p>
              ))}
            </SettingsGroup>
          )}

          {checks.migrationTable.migrations.length > 0 && (
            <SettingsGroup title="Migrations">
              <div className="max-h-80 overflow-y-auto">
                {checks.migrationTable.migrations.map((m, i) => (
                  <div
                    key={`${m.name}-${m.appliedAt ?? "pending"}-${i}`}
                    className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-[13px] last:border-b-0"
                  >
                    <code className="truncate">{m.name}</code>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {m.appliedAt ? new Date(m.appliedAt).toLocaleDateString() : "Not applied"}
                    </span>
                  </div>
                ))}
              </div>
            </SettingsGroup>
          )}
        </>
      )}

      {!result && !error && !loading && (
        <SettingsGroup>
          <EmptyState
            inline
            icon="check"
            title="No diagnostics run yet"
            description="Run the baseline diagnostic, then use the migration health check for release proof."
          />
        </SettingsGroup>
      )}
    </SettingsPageShell>
  );
}
