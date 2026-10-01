import { GraduationTerm, ShiftArea } from "@prisma/client";
import { z } from "zod";
import { isSportCode, normalizeSportCode } from "@/lib/sports";

/** Chronological order within a calendar year: Winter, Spring, Summer, Fall. */
export const TERM_ORDER: Record<GraduationTerm, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

export function compareTerms(a: { term: GraduationTerm; year: number }, b: { term: GraduationTerm; year: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  return TERM_ORDER[a.term] - TERM_ORDER[b.term];
}

export const startTermSchema = z
  .object({
    startTerm: z.nativeEnum(GraduationTerm).nullable(),
    startTermYear: z.number().int().min(2000).max(2100).nullable(),
  })
  .refine((v) => (v.startTerm === null) === (v.startTermYear === null), {
    message: "Set both the start term and year, or clear both",
  });

export const upsertPlacementSchema = z.object({
  term: z.nativeEnum(GraduationTerm),
  year: z.number().int().min(2000).max(2100),
  area: z.nativeEnum(ShiftArea).nullable().optional(),
  sportCodes: z
    .array(z.string().trim().min(1))
    .max(12)
    .transform((codes) => [...new Set(codes.map(normalizeSportCode))])
    .refine((codes) => codes.every(isSportCode), { message: "Unknown sport code" })
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
