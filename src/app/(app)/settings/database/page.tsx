"use client";

import { useState } from "react";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { handleAuthRedirect, classifyError, isAbortError, parseJsonSafely } from "@/lib/errors";
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

  return (
    <SettingsPageShell
      href="/settings/database"
      description="Run a bounded baseline check for known tables, enums, columns, extensions, and migration records. Passing does not replace the migration health and deploy checks."
      actions={
        <Button onClick={runCheck} loading={loading} className="h-10">
          Run diagnostics
        </Button>
      }
    >

        {error && (
          <Card className="mb-1">
            <CardContent className="text-red">
              {error}
            </CardContent>
          </Card>
        )}

        {result && (
          <>
            {/* Overall status */}
            <Card className="mb-1">
              <CardContent className="flex items-center gap-3">
                <span
                  className={`shrink-0 inline-block size-3 rounded-full ${result.ok ? "bg-[var(--green)]" : "bg-destructive"}`}
                />
                <span className="font-semibold text-[length:var(--text-md)]">
                  {result.ok ? "Baseline checks passed" : "Issues detected"}
                </span>
              </CardContent>
            </Card>

            {/* Remediation steps */}
            {result.remediation.length > 0 && (
              <Card className="mb-1">
                <CardHeader>
                  <span className="font-semibold text-sm">Remediation</span>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {result.remediation.map((step, i) => (
                    <div
                      key={i}
                      className="text-sm font-mono px-3 py-2 bg-destructive/5 rounded-md leading-relaxed"
                    >
                      {step}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Migration table */}
            <Card className="mb-1">
              <CardHeader>
                <span className="font-semibold text-sm">Migrations</span>
                <StatusBadge ok={result.checks.migrationTable.exists} label={result.checks.migrationTable.exists ? "Table exists" : "Table missing"} />
              </CardHeader>
              {result.checks.migrationTable.migrations.length > 0 && (
                <CardContent className="px-0 py-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Migration</TableHead>
                        <TableHead>Applied</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.checks.migrationTable.migrations.map((m, i) => (
                        <TableRow key={`${m.name}-${m.appliedAt ?? "pending"}-${i}`}>
                          <TableCell>{m.name}</TableCell>
                          <TableCell>
                            {m.appliedAt ? new Date(m.appliedAt).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>

            {/* Tables */}
            <Card className="mb-1">
              <CardHeader>
                <span className="font-semibold text-sm">Tables</span>
                <StatusBadge
                  ok={result.checks.tables.missing.length === 0}
                  label={result.checks.tables.missing.length === 0
                    ? `${result.checks.tables.present.length} present`
                    : `${result.checks.tables.missing.length} missing`}
                />
              </CardHeader>
              {result.checks.tables.missing.length > 0 && (
                <CardContent>
                  <TagList items={result.checks.tables.missing} variant="danger" />
                </CardContent>
              )}
            </Card>

            {/* Enums */}
            <Card className="mb-1">
              <CardHeader>
                <span className="font-semibold text-sm">Enums</span>
                <StatusBadge
                  ok={result.checks.enums.missing.length === 0}
                  label={result.checks.enums.missing.length === 0
                    ? `${result.checks.enums.present.length} present`
                    : `${result.checks.enums.missing.length} missing`}
                />
              </CardHeader>
              {result.checks.enums.missing.length > 0 && (
                <CardContent>
                  <TagList items={result.checks.enums.missing} variant="danger" />
                </CardContent>
              )}
            </Card>

            {/* Extensions */}
            <Card className="mb-1">
              <CardHeader>
                <span className="font-semibold text-sm">Extensions</span>
                <StatusBadge
                  ok={result.checks.extensions.missing.length === 0}
                  label={result.checks.extensions.missing.length === 0
                    ? `${result.checks.extensions.present.length} installed`
                    : `${result.checks.extensions.missing.length} missing`}
                />
              </CardHeader>
              {result.checks.extensions.missing.length > 0 && (
                <CardContent>
                  <TagList items={result.checks.extensions.missing} variant="danger" />
                </CardContent>
              )}
            </Card>

            {/* Column drift */}
            {result.checks.columns.drift.length > 0 && (
              <Card className="mb-1">
                <CardHeader>
                  <span className="font-semibold text-sm">Column Drift</span>
                  <StatusBadge ok={false} label={`${result.checks.columns.drift.length} missing`} />
                </CardHeader>
                <CardContent className="px-0 py-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead>Column</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.checks.columns.drift.map((d, i) => (
                        <TableRow key={i}>
                          <TableCell><code>{d.table}</code></TableCell>
                          <TableCell><code>{d.column}</code></TableCell>
                          <TableCell>
                            <Badge variant="red" size="sm">{d.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!result && !error && !loading && (
          <Card>
            <CardContent className="py-0">
              <EmptyState
                inline
                icon="check"
                title="No diagnostics run yet"
                description="Run the baseline diagnostic, then use the migration health check for release proof."
              />
            </CardContent>
          </Card>
        )}
    </SettingsPageShell>
  );
}

/* ── Helpers ──────────────────────────────────────────── */

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "green" : "red"} size="sm">
      {label}
    </Badge>
  );
}

function TagList({ items, variant }: { items: string[]; variant: "danger" | "info" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <Badge key={`${item}-${i}`} variant={variant === "danger" ? "red" : "blue"} size="sm">
          {item}
        </Badge>
      ))}
    </div>
  );
}
