import crypto from "node:crypto";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

/**
 * C5 staff proof (Erik, 2026-10-01). Staff actions on someone else's booking
 * at the kiosk need a staff ID card scan, not a tapped name. The verify route
 * issues this short-lived token bound to the staff user and this kiosk device;
 * staff-privileged kiosk routes require it in `X-Kiosk-Staff-Token`.
 */
export const KIOSK_STAFF_TOKEN_HEADER = "x-kiosk-staff-token";
export const KIOSK_STAFF_TOKEN_TTL_MS = 10 * 60 * 1000;

type StaffTokenPayload = { v: 1; u: string; k: string; e: number };

const MISSING = "Scan your staff ID card to do this.";
const EXPIRED = "Your staff scan expired. Scan your staff ID card again.";
const INVALID = "That staff scan isn't valid here. Scan your staff ID card again.";

function signature(body: string): Buffer {
  // Domain-separated from every other SESSION_SECRET HMAC in the app.
  return crypto.createHmac("sha256", env.sessionSecret).update(`kiosk-staff:${body}`).digest();
}

export function issueKioskStaffToken(args: { userId: string; kioskId: string; now?: number }) {
  const expiresAt = (args.now ?? Date.now()) + KIOSK_STAFF_TOKEN_TTL_MS;
  const payload: StaffTokenPayload = { v: 1, u: args.userId, k: args.kioskId, e: expiresAt };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${body}.${signature(body).toString("base64url")}`, expiresAt: new Date(expiresAt) };
}

/**
 * Throws 403 unless `token` is an unexpired staff proof minted on this kiosk
 * for exactly `actorId`.
 */
export function verifyKioskStaffToken(
  token: string | null | undefined,
  expected: { actorId: string; kioskId: string; now?: number },
): void {
  if (!token) throw new HttpError(403, MISSING, { code: "staff_scan_required" });
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra !== undefined) throw new HttpError(403, INVALID, { code: "staff_scan_invalid" });
  const suppliedSig = Buffer.from(supplied, "base64url");
  const expectedSig = signature(body);
  if (suppliedSig.length !== expectedSig.length || !crypto.timingSafeEqual(suppliedSig, expectedSig)) {
    throw new HttpError(403, INVALID, { code: "staff_scan_invalid" });
  }
  let payload: Partial<StaffTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(403, INVALID, { code: "staff_scan_invalid" });
  }
  if (payload.v !== 1 || payload.u !== expected.actorId || payload.k !== expected.kioskId || typeof payload.e !== "number") {
    throw new HttpError(403, INVALID, { code: "staff_scan_invalid" });
  }
  if (payload.e <= (expected.now ?? Date.now())) {
    throw new HttpError(403, EXPIRED, { code: "staff_scan_expired" });
  }
}

export function readKioskStaffToken(req: Request): string | null {
  return req.headers.get(KIOSK_STAFF_TOKEN_HEADER);
}
