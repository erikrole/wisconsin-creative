import { useQuery } from "@tanstack/react-query";

import { parseJsonSafely } from "@/lib/errors";

export type LastAuditInfo = {
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
};

export type LastAuditMap = Record<string, LastAuditInfo>;

type LastAuditResponse = {
  data?: unknown;
};

function isLastAuditInfo(value: unknown): value is LastAuditInfo {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const actor = entry.actor;

  return (
    typeof entry.action === "string" &&
    typeof entry.createdAt === "string" &&
    (actor === null ||
      (typeof actor === "object" &&
        typeof (actor as Record<string, unknown>).id === "string" &&
        typeof (actor as Record<string, unknown>).name === "string"))
  );
}

function isLastAuditMap(value: unknown): value is LastAuditMap {
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(isLastAuditInfo)
  );
}

const EMPTY_AUDIT_MAP: LastAuditMap = {};

async function fetchLastAudit(entityType: string, entityIds: string[], signal: AbortSignal): Promise<LastAuditMap> {
  const res = await fetch("/api/audit/last", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType, entityIds }),
    signal,
  });
  const json = res.ok ? await parseJsonSafely<LastAuditResponse>(res) : null;
  return isLastAuditMap(json?.data) ? json.data : EMPTY_AUDIT_MAP;
}

/**
 * Fetch the most-recent audit entry for each entityId in one round trip.
 * Returns an empty map until resolved. Re-runs when `entityIds` membership
 * changes (uses the joined string as a stable identity).
 */
export function useLastAudit(entityType: string, entityIds: string[]): LastAuditMap {
  const entityIdsKey = entityIds.slice().sort().join(",");
  const { data } = useQuery({
    queryKey: ["audit-last", entityType, entityIdsKey],
    queryFn: ({ signal }) => fetchLastAudit(entityType, entityIdsKey.split(","), signal),
    enabled: entityIdsKey.length > 0,
    // Last-edited is decoration, not load-bearing: never retry or surface errors.
    retry: false,
  });
  return entityIdsKey ? data ?? EMPTY_AUDIT_MAP : EMPTY_AUDIT_MAP;
}
