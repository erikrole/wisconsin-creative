import { ApplicantDocumentKind } from "@prisma/client";

export const MAX_APPLICANT_FILE_BYTES = 4 * 1024 * 1024; // under the 4.5 MB serverless body limit

export const APPLICANT_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type ApplicantFileType = (typeof APPLICANT_FILE_TYPES)[number];

export function isApplicantFileType(value: string): value is ApplicantFileType {
  return (APPLICANT_FILE_TYPES as readonly string[]).includes(value);
}

/** Verify leading bytes match the declared type so a client cannot lie via `file.type`. */
export function matchesFileSignature(bytes: Uint8Array, contentType: ApplicantFileType): boolean {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (contentType) {
    case "application/pdf":
      return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
  }
}

export function safeFileName(name: string): string {
  const leaf = name.split(/[\\/]/).pop()?.trim() || "document";
  return leaf.replace(/[\u0000-\u001f\u007f"\\]/g, "-").slice(0, 180) || "document";
}

export function documentPathname(
  applicationId: string,
  kind: ApplicantDocumentKind,
  id: string,
  contentType: ApplicantFileType,
): string {
  const ext = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
  return `applicants/${applicationId}/${kind.toLowerCase()}-${id}.${ext}`;
}
