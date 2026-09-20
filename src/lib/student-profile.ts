export const STUDENT_YEAR_OPTIONS = [
  { value: "FRESHMAN", label: "Freshman" },
  { value: "SOPHOMORE", label: "Sophomore" },
  { value: "JUNIOR", label: "Junior" },
  { value: "SENIOR", label: "Senior" },
  { value: "GRAD", label: "Grad" },
] as const;

export type StudentYearValue = (typeof STUDENT_YEAR_OPTIONS)[number]["value"];

const GRADUATION_TERM_OPTIONS = [
  { value: "SPRING", label: "Spring" },
  { value: "SUMMER", label: "Summer" },
  { value: "FALL", label: "Fall" },
  { value: "WINTER", label: "Winter" },
] as const;

export type GraduationTermValue = (typeof GRADUATION_TERM_OPTIONS)[number]["value"];

export function anticipatedGraduationValue(
  term: GraduationTermValue | null,
  year: number | null,
): string {
  return term && year ? `${term}:${year}` : "";
}

export function anticipatedGraduationOptions(startYear = new Date().getFullYear()) {
  return Array.from({ length: 9 }, (_, yearOffset) => startYear + yearOffset)
    .flatMap((year) => GRADUATION_TERM_OPTIONS.map((term) => ({
      value: anticipatedGraduationValue(term.value, year),
      label: `${term.label} ${year}`,
      term: term.value,
      year,
    })));
}

export function parseAnticipatedGraduation(value: string): {
  term: GraduationTermValue;
  year: number;
} | null {
  const [term, rawYear] = value.split(":");
  const year = Number(rawYear);
  if (!GRADUATION_TERM_OPTIONS.some((option) => option.value === term)) return null;
  if (!Number.isInteger(year)) return null;
  return { term: term as GraduationTermValue, year };
}

export function formatAnticipatedGraduation(
  term: GraduationTermValue | null,
  year: number | null,
): string | null {
  if (!term || !year) return null;
  const label = GRADUATION_TERM_OPTIONS.find((option) => option.value === term)?.label;
  return label ? `${label} ${year}` : null;
}
