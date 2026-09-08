export type CsvValue = boolean | Date | null | number | string | undefined;

export function escapeReportCsvValue(value: CsvValue) {
  const raw = value instanceof Date ? value.toISOString() : value == null ? "" : String(value);
  const formulaSafe = /^(?:\s*[=+\-@]|[\t\r])/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function buildReportCsv(rows: CsvValue[][]) {
  return `${rows.map((row) => row.map(escapeReportCsvValue).join(",")).join("\n")}\n`;
}

export function reportExportFilename(filenameBase: string, now = new Date()) {
  return `${filenameBase}-${now.toISOString().slice(0, 10)}.csv`;
}

export function formatReportExportSuccess({
  reportLabel,
  rowCount,
  scopeLabel = "visible rows",
}: {
  reportLabel: string;
  rowCount: number;
  scopeLabel?: string;
}) {
  const countLabel = `${rowCount} ${scopeLabel}`;
  return `${reportLabel} CSV downloaded: ${countLabel}.`;
}

export type ReportExportToast = {
  message: string;
  variant: "success" | "warning";
};

export function getReportExportFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || fallback;
}

export function getReportExportCompletionToast({
  reportLabel,
  rowCount,
  scopeLabel = "matching rows",
  total,
  truncated,
}: {
  reportLabel: string;
  rowCount: number;
  scopeLabel?: string;
  total?: string | null;
  truncated?: boolean;
}): ReportExportToast {
  if (truncated) {
    return {
      variant: "warning",
      message: `${reportLabel} CSV capped at ${rowCount.toLocaleString()} ${scopeLabel}${total ? `; ${total} total` : ""}. Narrow filters to export fewer rows.`,
    };
  }

  return {
    variant: "success",
    message: formatReportExportSuccess({ reportLabel, rowCount, scopeLabel }),
  };
}

export async function readReportExportFailureMessage(res: Response, reportLabel: string) {
  const fallback = `${reportLabel} CSV export failed (${res.status}).`;
  const body = (await res.text().catch(() => "")).trim();
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const message = typeof parsed.error === "string"
      ? parsed.error
      : typeof parsed.message === "string"
        ? parsed.message
        : "";
    return message ? `${reportLabel} CSV export failed: ${message}` : fallback;
  } catch {
    return `${reportLabel} CSV export failed: ${body}`;
  }
}

export function reportLabelFromFilenameBase(filenameBase: string) {
  return filenameBase
    .replace(/-report$/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
