export type ExportToast = {
  message: string;
  variant: "success" | "warning";
};

export function getExportFilename(contentDisposition: string | null, fallback: string) {
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

export function getExportCompletionToast(label: string, truncated: boolean, total: string | null): ExportToast {
  if (truncated) {
    return {
      variant: "warning",
      message: `${label} export capped at 5,000 rows${total ? `; ${total} total` : ""}. Use filters to narrow the range.`,
    };
  }

  return {
    variant: "success",
    message: `${label} export downloaded.`,
  };
}

export async function readExportFailureMessage(res: Response, label: string) {
  const fallback = `${label} export failed (${res.status}).`;
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
    return message ? `${label} export failed: ${message}` : fallback;
  } catch {
    return `${label} export failed: ${body}`;
  }
}
