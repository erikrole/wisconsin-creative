import { createHash } from "node:crypto";
import { normalizeMessage, type ErrorReportInput } from "./grouping";

/** Server-only: two reports with the same fingerprint are the same issue. */
export function fingerprintFor(input: ErrorReportInput): string {
  const parts = [
    input.platform,
    input.kind,
    input.name?.trim() ?? "",
    normalizeMessage(input.message),
    input.culprit ?? "",
    ...(input.groupingParts ?? []),
  ];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);
}
