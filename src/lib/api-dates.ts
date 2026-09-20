import { HttpError } from "@/lib/http";

/**
 * Optional `?name=` date query param, returned as the validated raw string so
 * report services can pass it straight through. 400 "Invalid name" when unparseable.
 */
export function parseOptionalDateParam(searchParams: URLSearchParams, name: string): string | null {
  const value = searchParams.get(name);
  if (!value) return null;
  if (Number.isNaN(new Date(value).getTime())) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return value;
}

export function parseOptionalDate(value: string | null | undefined, label: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} must be a valid date`);
  }
  return date;
}

export function assertDateOrder(
  start: Date | null,
  end: Date | null,
  label = "endDate must be after startDate",
  options: { allowEqual?: boolean } = {},
) {
  if (!start || !end) return;
  const allowEqual = options.allowEqual ?? true;
  const invalid = allowEqual ? end < start : end <= start;
  if (invalid) {
    throw new HttpError(400, label);
  }
}
