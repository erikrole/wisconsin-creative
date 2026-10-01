import { normalizeName } from "@/lib/hiring/contract";

export type ResumeMatchTarget = {
  id: string;
  name: string;
  externalApplicationId: string | null;
};

export type ResumeMatch =
  | { status: "matched"; applicationId: string; via: "application_id" | "name" }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "none" };

const FILLER = new Set(["resume", "cv", "pdf", "final", "copy", "updated", "new", "docx"]);

function fileTokens(fileName: string): string[] {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  return normalizeName(base)
    .split(" ")
    .filter((t) => t && !FILLER.has(t));
}

/**
 * Match one uploaded file to an application by its filename. A PageUp application
 * ID in the name wins; otherwise the applicant's full name must appear in the
 * name (exact first, then as a subset such as "Jordan Fictional Resume").
 * More than one possible applicant is reported as ambiguous, never guessed.
 */
export function matchResumeFile(fileName: string, targets: ResumeMatchTarget[]): ResumeMatch {
  const ids: string[] = fileName.match(/\d{5,}/g) ?? [];
  if (ids.length > 0) {
    const byId = targets.filter((t) => t.externalApplicationId && ids.includes(t.externalApplicationId));
    if (byId.length === 1) return { status: "matched", applicationId: byId[0]!.id, via: "application_id" };
    if (byId.length > 1) return { status: "ambiguous", candidates: byId.map((t) => t.id) };
  }

  const tokens = fileTokens(fileName);
  if (tokens.length === 0) return { status: "none" };
  const tokenSet = new Set(tokens);

  const exact = targets.filter((t) => {
    const name = normalizeName(t.name).split(" ").filter(Boolean);
    return name.length === tokens.length && name.every((part) => tokenSet.has(part));
  });
  if (exact.length === 1) return { status: "matched", applicationId: exact[0]!.id, via: "name" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact.map((t) => t.id) };

  const subset = targets.filter((t) => {
    const name = normalizeName(t.name).split(" ").filter(Boolean);
    return name.length >= 2 && name.every((part) => tokenSet.has(part));
  });
  if (subset.length === 1) return { status: "matched", applicationId: subset[0]!.id, via: "name" };
  if (subset.length > 1) return { status: "ambiguous", candidates: subset.map((t) => t.id) };
  return { status: "none" };
}
