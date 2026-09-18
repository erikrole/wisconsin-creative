/**
 * One destination map for inbox rows, APNs payloads, and browser-push clicks.
 * Prefer an explicit same-origin path, then the most specific identity key.
 * Never treat a recipient `userId` as a destination unless the type is a
 * profile/badge notification.
 */

function firstString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameOriginPath(value: unknown): string | null {
  const raw = firstString(value);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function notificationDestinationPath(
  payload?: Record<string, unknown> | null,
  type?: string | null,
): string | null {
  const href = sameOriginPath(payload?.href) ?? sameOriginPath(payload?.url);
  if (href) return href;

  const bookingId = firstString(payload?.bookingId) ?? firstString(payload?.checkoutId);
  if (bookingId) {
    if (type?.startsWith("reservation_") || payload?.bookingKind === "RESERVATION") {
      return `/reservations/${bookingId}`;
    }
    return `/checkouts/${bookingId}`;
  }

  const eventId = firstString(payload?.eventId);
  if (eventId) return `/events/${eventId}`;

  const assetId = firstString(payload?.assetId);
  if (assetId) return `/items/${assetId}`;

  if (type === "badge_awarded") {
    const userId = firstString(payload?.userId);
    if (userId) return `/users/${userId}?tab=badges`;
  }

  const payloadType = firstString(payload?.type);
  if (
    type?.startsWith("license_") ||
    payloadType === "license_expiry" ||
    payloadType === "license_nag"
  ) {
    return "/licenses";
  }

  if (type === "low_stock") {
    const skuName = firstString(payload?.skuName);
    if (skuName) return `/items?search=${encodeURIComponent(skuName)}`;
  }

  if (firstString(payload?.blastId)) return "/";

  if (type?.startsWith("trade_")) return "/schedule";

  return null;
}

export function notificationOpenPath(
  payload?: Record<string, unknown> | null,
  type?: string | null,
): string {
  return notificationDestinationPath(payload, type) ?? "/notifications";
}

export function withNotificationHref(
  payload?: Record<string, unknown>,
  type?: string | null,
): Record<string, unknown> | undefined {
  const href = notificationOpenPath(payload, type);
  if (!payload) {
    return href === "/notifications" ? payload : { href };
  }
  if (sameOriginPath(payload.href) || sameOriginPath(payload.url)) return payload;
  return { ...payload, href };
}
