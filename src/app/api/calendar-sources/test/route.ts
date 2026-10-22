import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok, HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertPublicHost, fetchPublicUrl } from "@/lib/security/ssrf";

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
});

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB cap so a malicious URL can't OOM the function

/**
 * POST /api/calendar-sources/test
 * Probe an ICS URL without persisting anything — used by the Add form on
 * /settings/calendar-sources to give immediate feedback before saving.
 *
 * Returns shape { ok, status, contentType, byteSize, eventCount, sampleSummaries[], error? }.
 *
 * SSRF note: this hits arbitrary admin-supplied URLs. Acceptable for an
 * admin-only endpoint behind auth + rate limit, but worth tightening later
 * (block private IP ranges) if STAFF ever gets access.
 */
export const POST = withAuth(async (req, { user }) => {
  requirePermission(user.role, "calendar_source", "create");
  await enforceRateLimit(`calendar-sources:test:${user.id}`, { max: 10, windowMs: 60_000 });

  const body = bodySchema.parse(await req.json());

  // webcal:// is just an unsecured HTTPS in calendar feeds.
  let url = body.url.trim().replace(/^webcal:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "URL must use http or https.");
  }
  try {
    await assertPublicHost(parsed.hostname);
  } catch {
    throw new HttpError(400, "URL host is private or non-routable.");
  }
  url = parsed.toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchPublicUrl(url, {
      headers: { "User-Agent": "GearTracker/1.0 (probe)" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const status = response.status;
    const contentType = response.headers.get("content-type") ?? null;

    if (!response.ok) {
      return ok({
        data: {
          ok: false,
          status,
          contentType,
          byteSize: 0,
          eventCount: 0,
          sampleSummaries: [],
          error: `HTTP ${status} ${response.statusText || ""}`.trim(),
        },
      });
    }

    // Read up to MAX_RESPONSE_BYTES so an oversized feed can't blow our budget.
    const reader = response.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.length;
          if (received > MAX_RESPONSE_BYTES) {
            try { await reader.cancel(); } catch { /* ignore */ }
            return ok({
              data: {
                ok: false,
                status,
                contentType,
                byteSize: received,
                eventCount: 0,
                sampleSummaries: [],
                error: `Feed exceeds ${MAX_RESPONSE_BYTES / 1024 / 1024} MB cap.`,
              },
            });
          }
          chunks.push(value);
        }
      }
    }
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { buffer.set(c, offset); offset += c.length; }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    // Lightweight VEVENT scan — avoids reusing the full parser for a probe.
    const eventBlocks = text.split(/BEGIN:VEVENT/i).slice(1);
    const eventCount = eventBlocks.length;
    const sampleSummaries: string[] = [];
    for (const block of eventBlocks.slice(0, 5)) {
      const m = block.match(/\nSUMMARY[^:]*:([^\r\n]{1,200})/i);
      if (m) sampleSummaries.push(m[1]!.trim()); // capture group 1 always present when match succeeds
    }

    const looksLikeIcs = /^BEGIN:VCALENDAR/im.test(text);
    if (!looksLikeIcs) {
      return ok({
        data: {
          ok: false,
          status,
          contentType,
          byteSize: received,
          eventCount: 0,
          sampleSummaries: [],
          error: "Reachable, but the response doesn't look like an ICS feed (no BEGIN:VCALENDAR).",
        },
      });
    }

    return ok({
      data: {
        ok: true,
        status,
        contentType,
        byteSize: received,
        eventCount,
        sampleSummaries,
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const message = isAbort
      ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s.`
      : err instanceof Error
        ? err.message
        : "Fetch failed.";
    return ok({
      data: {
        ok: false,
        status: 0,
        contentType: null,
        byteSize: 0,
        eventCount: 0,
        sampleSummaries: [],
        error: message,
      },
    });
  }
});
