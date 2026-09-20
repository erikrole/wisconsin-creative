import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Sort strings ascending with locale-aware comparison. */
export function sortedStrings(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** De-duplicate an iterable, preserving first-seen order. */
export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** True when any key of a flat form-state object differs from its saved baseline. */
export function isDirty<T extends Record<string, unknown>>(local: T, base: T): boolean {
  return (Object.keys(local) as (keyof T)[]).some((key) => local[key] !== base[key]);
}
