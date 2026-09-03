import { NextResponse } from "next/server";
import { withHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { cleanSourceSummary, normalizeOpponentName } from "@/lib/schedule-event-identity";
import { AREA_LABELS } from "@/types/areas";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^[a-f0-9]{48}$/i;
const ICS_ASSIGNMENT_LIMIT = 500;
const TOKEN_LIMIT = { max: 30, windowMs: 60_000 };
const IP_LIMIT = { max: 120, windowMs: 60_000 };

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

const ICS_FOLD_BYTES = 74;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * Fold a content line per RFC 5545 §3.1 (max 75 octets per physical line,
 * continuations start with a space). Byte-aware so multi-byte characters
 * (the 🔁 trade prefix) never split mid-codepoint.
 */
function icsFold(line: string): string[] {
  if (byteLength(line) <= ICS_FOLD_BYTES) return [line];
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const chBytes = byteLength(ch);
    if (currentBytes + chBytes > ICS_FOLD_BYTES) {
      out.push(current);
      current = " ";
      currentBytes = 1;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function latestDate(dates: Date[]): Date {
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function eventTitle(event: {
  summary: string;
  sportCode: string | null;
  opponent: string | null;
  isHome: boolean | null;
}) {
  if (event.sportCode && event.opponent) {
    const opponent = normalizeOpponentName(event.opponent) ?? event.opponent;
    const venueWord = event.isHome === false ? "at" : "vs";
    return `${event.sportCode} ${venueWord} ${opponent}`;
  }

  return cleanSourceSummary(event.summary);
}

function shiftSummary(area: string, title: string, isPosted: boolean) {
  const areaLabel = AREA_LABELS[area] ?? area;
  const prefix = isPosted ? "🔁 " : "";
  return `${prefix}${areaLabel}: ${title}`;
}

export const GET = withHandler<{ token: string }>(async (req, { params }) => {
  const { token } = params;

  if (!TOKEN_RE.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ip = getClientIp(req);
  const ipLimit = await checkRateLimit(`shifts:ics:ip:${ip}`, IP_LIMIT);
  const tokenLimit = await checkRateLimit(`shifts:ics:token:${token}`, TOKEN_LIMIT);
  if (!ipLimit.allowed || !tokenLimit.allowed) {
    const resetAt = Math.max(ipLimit.resetAt, tokenLimit.resetAt);
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    });
  }

  const user = await db.user.findFirst({ where: { icsToken: token, active: true } });
  if (!user || user.role === "COLLABORATOR") {
    return new NextResponse("Not found", { status: 404 });
  }

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMonth(windowStart.getMonth() - 1);
  const windowEnd = new Date(now);
  windowEnd.setFullYear(windowEnd.getFullYear() + 1);

  const assignments = await db.shiftAssignment.findMany({
    where: {
      userId: user.id,
      status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
      shift: {
        startsAt: { gte: windowStart, lte: windowEnd },
        // Cancelled/archived events must drop out of the VEVENT list — that
        // is how calendar apps remove them from subscribers' calendars.
        // Safe for the 1-month history window: events archive at 4 months.
        shiftGroup: { event: { status: "CONFIRMED", archivedAt: null } },
      },
    },
    include: {
      shift: {
        include: {
          shiftGroup: {
            include: {
              event: {
                select: {
                  id: true,
                  summary: true,
                  startsAt: true,
                  endsAt: true,
                  allDay: true,
                  sportCode: true,
                  opponent: true,
                  isHome: true,
                  site: true,
                  locationId: true,
                  updatedAt: true,
                  location: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      trades: {
        where: { status: { in: ["OPEN", "CLAIMED"] } },
        select: { id: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { shift: { startsAt: "asc" } },
    take: ICS_ASSIGNMENT_LIMIT,
  });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wisconsin Creative//Shifts//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(user.name + " Shifts")}`,
    "X-WR-TIMEZONE:America/Chicago",
  ];

  for (const a of assignments) {
    const shift = a.shift;
    const event = shift.shiftGroup.event;
    const location = event.location?.name;
    const activeTrade = a.trades[0];
    const studentCallTimeVisible = user.role !== "STUDENT" || studentCallTimeAppliesToEvent(event);
    const startsAt = shift.workerType === "ST" && studentCallTimeVisible
      ? a.callStartsAt ?? shift.callStartsAt ?? shift.startsAt
      : event.startsAt;
    const endsAt = shift.workerType === "ST" && studentCallTimeVisible
      ? a.callEndsAt ?? shift.callEndsAt ?? shift.endsAt
      : event.endsAt;
    const isInheritedAllDayWindow = event.allDay
      && startsAt.getTime() === event.startsAt.getTime()
      && endsAt.getTime() === event.endsAt.getTime();
    const title = shiftSummary(shift.area, eventTitle(event), Boolean(activeTrade));
    const uid = `shift-${a.id}@wisconsin.creative`;
    const lastModified = latestDate([
      a.updatedAt,
      shift.updatedAt,
      event.updatedAt,
      ...(activeTrade ? [activeTrade.updatedAt] : []),
    ]);
    const dtstamp = icsDate(lastModified);
    // The date-only representation fixes an existing component without a DB
    // write, so advance its revision once to make subscribers accept the new
    // DTSTART/DTEND shape even though the underlying assignment is unchanged.
    const sequence = Math.floor(lastModified.getTime() / 1000) + (isInheritedAllDayWindow ? 1 : 0);
    // Canonical origin, not the request's Host header — a spoofed Host must
    // not seed poisoned links into a subscribed calendar.
    const eventUrl = `${env.appUrl}/events/${event.id}`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`LAST-MODIFIED:${dtstamp}`);
    lines.push(`SEQUENCE:${sequence}`);
    if (isInheritedAllDayWindow) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(event.startsAt)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDateOnly(event.endsAt)}`);
    } else {
      lines.push(`DTSTART:${icsDate(startsAt)}`);
      lines.push(`DTEND:${icsDate(endsAt)}`);
    }
    lines.push(`SUMMARY:${icsEscape(title)}`);
    if (location) lines.push(`LOCATION:${icsEscape(location)}`);
    lines.push(`URL:${eventUrl}`);
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const body = lines.flatMap(icsFold).join("\r\n") + "\r\n";

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="shifts.ics"`,
      "Cache-Control": "no-cache, no-store",
      "X-Event-Limit": String(ICS_ASSIGNMENT_LIMIT),
    },
  });
});
