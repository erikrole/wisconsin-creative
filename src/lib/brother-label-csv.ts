/**
 * CSV for Brother P-touch Editor's database merge.
 *
 * P-touch links each label object to a column, so the asset tag is split into
 * its base and unit number ("Z200 2" → "Z200", "2") to print on separate lines.
 * Values are written verbatim (no spreadsheet formula guard): P-touch would
 * print a leading apostrophe literally. Lines end in LF; P-touch for Mac
 * rejects CRLF files as "fewer than two lines".
 */
export type BrotherLabelRow = {
  assetTag: string;
  qrCodeValue: string;
  name?: string;
  /** Reviewed overrides; default to splitAssetTag(assetTag). */
  tag?: string;
  number?: string;
  /** Rows are repeated this many times (default 1). */
  copies?: number;
};

export const BROTHER_CSV_HEADERS = ["Tag", "Number", "QR", "Asset Tag", "Name"] as const;

export function splitAssetTag(assetTag: string): { tag: string; number: string } {
  const trimmed = assetTag.trim();
  const match = /^(.*\S)\s+(\d+)$/.exec(trimmed);
  return match ? { tag: match[1] ?? trimmed, number: match[2] ?? "" } : { tag: trimmed, number: "" };
}

function quote(value: string): string {
  return /[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildBrotherLabelCsv(rows: BrotherLabelRow[]): string {
  const lines = rows.flatMap((row) => {
    const split = splitAssetTag(row.assetTag);
    const line = [
      row.tag ?? split.tag,
      row.number ?? split.number,
      row.qrCodeValue,
      row.assetTag.trim(),
      row.name ?? "",
    ]
      .map(quote)
      .join(",");
    const copies = Math.max(1, Math.floor(row.copies ?? 1));
    return Array.from({ length: copies }, () => line);
  });
  return [BROTHER_CSV_HEADERS.join(","), ...lines].join("\n") + "\n";
}
