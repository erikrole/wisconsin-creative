/* One place to send a Trade Board decision from any surface (Home today; the
   Trade Board can adopt it). Same endpoints, methods and outcome copy as the
   board, so a claim or approval reads the same wherever it starts. */

import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";

export type ShiftTradeAction = "claim" | "approve" | "decline";

const METHOD: Record<ShiftTradeAction, "POST" | "PATCH"> = {
  claim: "POST",
  approve: "PATCH",
  decline: "PATCH",
};

const LOST = "The response was lost. Check the refreshed work before trying again.";

const SHIFT_TRADE_ACTION_COPY: Record<ShiftTradeAction, { success: string; server: string; network: string }> = {
  claim: {
    success: "Claim sent for Admin approval",
    server: "Could not claim the trade. Refresh the Trade Board and try again.",
    network: LOST,
  },
  approve: {
    success: "Trade approved",
    server: "Could not approve the trade. The shift assignment was not changed.",
    network: LOST,
  },
  decline: {
    success: "Claim declined",
    server: "Could not decline the trade. The claim stayed in review.",
    network: LOST,
  },
};

export type ShiftTradeActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; stale: boolean }
  | { ok: false; redirected: true };

/**
 * Sends one trade decision. A 5xx or a dropped connection means the outcome is
 * unknown, so callers must reload before showing anything as settled.
 */
export async function sendShiftTradeAction(tradeId: string, action: ShiftTradeAction): Promise<ShiftTradeActionResult> {
  const copy = SHIFT_TRADE_ACTION_COPY[action];
  try {
    const res = await fetch(`/api/shift-trades/${tradeId}/${action}`, { method: METHOD[action] });
    if (handleAuthRedirect(res)) return { ok: false, redirected: true };
    if (res.status >= 500) return { ok: false, message: copy.network, stale: true };
    if (res.ok) return { ok: true, message: copy.success };
    return {
      ok: false,
      message: await parseErrorMessage(res, copy.server),
      stale: res.status === 404 || res.status === 409 || res.status === 410,
    };
  } catch {
    return { ok: false, message: copy.network, stale: true };
  }
}
