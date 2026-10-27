"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import {
  handleAuthRedirect,
  classifyError,
  isAbortError,
  parseErrorMessage,
  parseJsonSafely,
} from "@/lib/errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircleIcon } from "lucide-react";
import type { ColumnMapping, PreviewData, ImportResult, Step } from "./_types";
import { STEP_LABELS } from "./_types";
import { ImportUploadStep } from "./_components/ImportUploadStep";
import { ImportMappingStep } from "./_components/ImportMappingStep";
import { ImportPreviewStep } from "./_components/ImportPreviewStep";
import { ImportResultStep } from "./_components/ImportResultStep";

/* ───── Component ───── */

export default function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSample, setCsvSample] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importMode, setImportMode] = useState<"upsert" | "create_only">("upsert");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewingRef = useRef(false);
  const importingRef = useRef(false);

  // Load saved mapping from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("import-column-mapping");
      if (saved) setMapping(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError("");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && (dropped.name.endsWith(".csv") || dropped.name.endsWith(".CSV"))) {
      setFile(dropped);
      setError("");
    } else {
      setError("Please drop a CSV file");
    }
  }, []);

  /** Parse CSV headers client-side to show mapping step */
  async function handleParseHeaders() {
    if (!file) return;
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        setError("CSV must include a header and at least one data row");
        return;
      }

      const delimiter = lines[0]!.includes(";") ? ";" : ",";
      const headers = parseLine(lines[0]!, delimiter);
      setCsvHeaders(headers);

      // Parse first 3 data rows as sample
      const samples: string[][] = [];
      for (let i = 1; i < Math.min(4, lines.length); i++) {
        samples.push(parseLine(lines[i]!, delimiter));
      }
      setCsvSample(samples);

      // Auto-detect mapping (Cheqroom preset), but preserve any saved user overrides
      const autoMapping: ColumnMapping = {};
      const CHEQROOM_PRESET: Record<string, string> = {
        "Name": "assetTag", "Category": "type", "Brand": "brand", "Model": "model",
        "Serial number": "serialNumber", "Quantity": "quantity", "Kind": "kind",
        "Warranty Date": "warrantyDate", "Purchase Price": "purchasePrice",
        "Purchase Date": "purchaseDate", "Residual Value": "residualValue",
        "Location": "locationName", "Department": "department", "Kit": "kitName",
        "Image Url": "imageUrl", "UW Asset Tag": "uwAssetTag", "Codes": "codes",
        "Barcodes": "barcodes", "Id": "sourceId", "Retired": "retired",
        "Link": "link", "Description": "description", "Owner": "owner",
        "Fiscal Year Purchased": "fiscalYear",
      };

      for (const header of headers) {
        if (mapping[header]) {
          autoMapping[header] = mapping[header];
        } else if (CHEQROOM_PRESET[header]) {
          autoMapping[header] = CHEQROOM_PRESET[header];
        }
      }

      setMapping(autoMapping);
      setStep("mapping");
    } catch {
      setError("Failed to parse CSV headers");
    } finally {
      setLoading(false);
    }
  }

  /** Simple CSV line parser (client-side, for headers + sample only) */
  function parseLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
        continue;
      }
      if (ch === delimiter && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function updateMapping(header: string, field: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (field && field !== "__skip__") next[header] = field;
      else delete next[header];
      return next;
    });
  }

  async function handlePreview() {
    if (!file) return;
    if (previewingRef.current || loading) return;
    previewingRef.current = true;
    setLoading(true);
    setError("");

    // Save mapping for next time
    try { localStorage.setItem("import-column-mapping", JSON.stringify(mapping)); } catch { /* ignore */ }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));

      const res = await fetch("/api/assets/import?mode=preview", {
        method: "POST",
        body: formData,
      });

      if (handleAuthRedirect(res, "/import")) return;

      if (!res.ok) {
        const message = await parseErrorMessage(res, "Failed to parse CSV");
        setError(message);
        toast.error(message);
        return;
      }

      const json = await parseJsonSafely<PreviewData>(res);
      if (!json?.summary || !Array.isArray(json.rows)) {
        throw new Error("Import preview returned an incomplete response");
      }
      setPreview(json);
      setStep("preview");
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      const message = kind === "network"
        ? "You\u2019re offline. Check your connection."
        : err instanceof Error && err.message
          ? err.message
          : "Failed to upload file";
      setError(message);
      toast.error(message);
    } finally {
      previewingRef.current = false;
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    if (importingRef.current) return;
    importingRef.current = true;
    setStep("importing");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));

      const res = await fetch(`/api/assets/import?mode=import&importMode=${importMode}`, {
        method: "POST",
        body: formData,
      });

      if (handleAuthRedirect(res, "/import")) return;

      if (!res.ok) {
        const message = await parseErrorMessage(res, "Import failed");
        setError(message);
        toast.error(message);
        setStep("preview");
        return;
      }

      const json = await parseJsonSafely<ImportResult>(res);
      if (!json || typeof json.created !== "number" || typeof json.updated !== "number") {
        throw new Error("Import finished, but the response was incomplete");
      }
      setResult(json);
      setStep("summary");
      const changedCount = json.created + json.updated + (json.bulkCreated ?? 0);
      toast.success(
        changedCount > 0
          ? `Import complete: ${json.created} created, ${json.updated} updated, ${json.bulkCreated ?? 0} item families.`
          : "Import complete: no items changed.",
      );
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      const msg = kind === "network"
        ? "You\u2019re offline. Check your connection."
        : err instanceof Error && err.message
          ? err.message
          : "Import failed unexpectedly";
      setError(msg);
      toast.error(msg);
      setStep("preview");
    } finally {
      importingRef.current = false;
    }
  }

  function handleDownloadErrors() {
    if (!result?.errors.length) return;
    const csv = ["Line,Asset Tag,Error"]
      .concat(
        result.errors.map(
          (e) => `${e.line},"${e.assetTag.replace(/"/g, '""')}","${e.error.replace(/"/g, '""')}"`
        )
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetWizard() {
    setStep("upload");
    setFile(null);
    setCsvHeaders([]);
    setCsvSample([]);
    setPreview(null);
    setResult(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const stepOrder = STEP_LABELS.map((s) => s.key);
  const currentStepIndex = Math.max(0, stepOrder.indexOf(step));

  return (
    <FadeUp>
      <PageHeader
        title="Import Items"
        description="Upload a CSV, map columns (Cheqroom preset available), preview changes, then import. Source values are preserved even when a column has no first-class field."
      >
        {step !== "upload" && step !== "importing" && (
          <Button variant="outline" className="h-10" onClick={resetWizard}>
            Start over
          </Button>
        )}
      </PageHeader>

      <nav aria-label="Import steps" className="mb-6 max-w-full overflow-x-auto pb-1">
        <ol className="flex w-max items-center gap-2">
          {STEP_LABELS.map((s, i) => {
            const complete = i < currentStepIndex;
            const current = i === currentStepIndex;
            return (
              <li key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-6 bg-border" aria-hidden="true" />}
                <div
                  className={
                    current
                      ? "flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
                      : complete
                        ? "flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-foreground"
                        : "flex h-10 items-center gap-1.5 rounded-md bg-muted px-3 text-sm text-muted-foreground"
                  }
                  aria-current={current ? "step" : undefined}
                >
                  <span className="tabular-nums">{i + 1}</span>
                  <span>{s.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Upload step ── */}
      {step === "upload" && (
        <ImportUploadStep
          file={file}
          loading={loading}
          fileRef={fileRef}
          onFileSelect={handleFileSelect}
          onDrop={handleDrop}
          onParseHeaders={handleParseHeaders}
        />
      )}

      {/* ── Column mapping step ── */}
      {step === "mapping" && csvHeaders.length > 0 && (
        <ImportMappingStep
          csvHeaders={csvHeaders}
          csvSample={csvSample}
          mapping={mapping}
          loading={loading}
          onUpdateMapping={updateMapping}
          onPreview={handlePreview}
          onBack={() => setStep("upload")}
        />
      )}

      {/* ── Preview / Importing step ── */}
      {(step === "preview" || step === "importing") && preview && (
        <ImportPreviewStep
          preview={preview}
          importMode={importMode}
          isImporting={step === "importing"}
          onImportModeChange={setImportMode}
          onConfirmImport={handleImport}
          onBackToMapping={() => setStep("mapping")}
          onCancel={resetWizard}
        />
      )}

      {/* ── Summary step ── */}
      {step === "summary" && result && (
        <ImportResultStep
          result={result}
          onDownloadErrors={handleDownloadErrors}
          onReset={resetWizard}
        />
      )}
    </FadeUp>
  );
}
