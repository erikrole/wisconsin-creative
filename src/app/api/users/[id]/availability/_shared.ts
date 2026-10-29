import { availabilityDateKey } from "@/lib/student-availability-display";
import { z } from "zod";
import { HttpError } from "@/lib/http";

export const availabilityDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && availabilityDateKey(parsed) === value;
}, "Choose a valid calendar date");
export const availabilityTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time from 00:00 to 23:59");

export function parseDateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

type AvailabilityBlockShape = {
  kind: "WEEKLY" | "AD_HOC";
  intent: "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
  status?: "APPROVED" | "PENDING" | "DENIED";
  dayOfWeek?: number | null;
  date?: string | null;
  dateEndsOn?: string | null;
  allDay?: boolean;
  startsAt: string;
  endsAt: string;
  semesterStartsOn?: string | null;
  semesterEndsOn?: string | null;
};

export function assertBlockShape<T extends AvailabilityBlockShape>(body: T) {
  if (body.startsAt >= body.endsAt) {
    throw new HttpError(400, "Start time must be before end time");
  }
  if (body.kind === "WEEKLY") {
    if (body.dayOfWeek === null || body.dayOfWeek === undefined) {
      throw new HttpError(400, "Day of week is required for weekly availability");
    }
    if (body.date) {
      throw new HttpError(400, "Weekly availability cannot include an ad hoc date");
    }
    if (body.dateEndsOn || body.allDay) {
      throw new HttpError(400, "Date ranges and all-day availability are only available for one-time entries");
    }
  }
  if (body.kind === "AD_HOC") {
    if (!body.date) {
      throw new HttpError(400, "Date is required for ad hoc availability");
    }
    if (body.dayOfWeek !== null && body.dayOfWeek !== undefined) {
      throw new HttpError(400, "Ad hoc availability cannot include a day of week");
    }
    if (body.dateEndsOn && body.date > body.dateEndsOn) {
      throw new HttpError(400, "End date must be on or after the start date");
    }
  }
  if (body.semesterStartsOn && body.semesterEndsOn && body.semesterStartsOn > body.semesterEndsOn) {
    throw new HttpError(400, "Semester end date must be on or after start date");
  }
  if (body.intent !== "TIME_OFF" && body.status && body.status !== "APPROVED") {
    throw new HttpError(400, "Only time-off requests can be pending or denied");
  }
}

export function normalizedTimes(body: Pick<AvailabilityBlockShape, "allDay" | "startsAt" | "endsAt">) {
  return body.allDay
    ? { startsAt: "00:00", endsAt: "23:59" }
    : { startsAt: body.startsAt, endsAt: body.endsAt };
}
