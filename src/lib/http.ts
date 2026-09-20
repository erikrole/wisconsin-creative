import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { isSerializationConflict } from "./serialization";

export class HttpError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function ok<T>(data: T, status = 200) {
  // Default authed JSON to no-store so a logged-out user can't replay
  // sensitive responses from the browser cache via Back. Routes that
  // benefit from caching should use cachedOk() explicitly.
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Like ok(), but adds a private 60s browser cache with 5-min stale-while-revalidate. */
export function cachedOk<T>(data: T) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}

export function fail(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, ...(error.data ? { data: error.data } : {}) },
      { status: error.status }
    );
  }

  // Zod validation errors — return 400 with field-level details
  if (error instanceof ZodError) {
    const messages = error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`
    );
    return NextResponse.json(
      { error: "Validation failed", details: messages },
      { status: 400 }
    );
  }

  // Unique-constraint violation — the record already exists
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      { error: "A record with that value already exists." },
      { status: 409 }
    );
  }

  // Serialization conflict (SERIALIZABLE isolation) — retryable by client.
  // Matches both the Prisma `P2034` shape and the raw `40001` driver code the
  // Neon adapter can surface, so a lost race never falls through to a 500.
  if (isSerializationConflict(error)) {
    return NextResponse.json(
      { error: "Someone else submitted at the same time — please try again." },
      { status: 409 }
    );
  }

  console.error(error);
  Sentry.captureException(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

const PAGINATION_DEFAULT_LIMIT = 50;
const PAGINATION_MAX_LIMIT = 200;
const PAGINATION_MAX_OFFSET = 10_000;

type PaginationParams = {
  limit: number;
  offset: number;
};

function parseUnsignedInteger(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
}

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const rawLimit = parseUnsignedInteger(searchParams.get("limit"));
  const rawOffset = parseUnsignedInteger(searchParams.get("offset"));

  if (rawOffset !== null && rawOffset > PAGINATION_MAX_OFFSET) {
    throw new HttpError(
      400,
      `offset must be a whole number between 0 and ${PAGINATION_MAX_OFFSET}`,
    );
  }

  const limit =
    rawLimit !== null && rawLimit > 0
      ? Math.min(rawLimit, PAGINATION_MAX_LIMIT)
      : PAGINATION_DEFAULT_LIMIT;

  const offset = rawOffset ?? 0;

  return { limit, offset };
}
