import { db } from "@/lib/db";
import { isPreviewEnvironment } from "@/lib/environment-safety";
import { HttpError } from "@/lib/http";

let nextHeartbeat = 0;
let heartbeat: Promise<void> | undefined;
/** Authenticated use retains disposable previews; production does no DB work. */
export async function recordPreviewActivity(): Promise<void> {
  if (!isPreviewEnvironment() || !/^[a-f0-9]{20}$/.test(process.env.WC_PREVIEW_KEY || "") || Date.now() < nextHeartbeat) return;
  if (!heartbeat) heartbeat = (async () => {
    try {
      const updated = await db.$executeRaw`UPDATE wc_preview_meta.runtime SET last_seen_at=now() WHERE id=true AND cleanup_started_at IS NULL`;
      if (!updated) throw new HttpError(410, "This preview has expired. Open the current branch preview to continue.");
      nextHeartbeat = Date.now() + 15 * 60_000;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Retention bookkeeping must not turn a successful app request into a 500.
      console.warn("Preview activity could not be recorded; pin the environment before extended use.");
    }
  })().finally(() => { heartbeat = undefined; });
  await heartbeat;
}
