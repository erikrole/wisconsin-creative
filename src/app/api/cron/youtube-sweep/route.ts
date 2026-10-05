import { NextResponse } from "next/server";

import { withCron } from "@/lib/cron";
import { refreshLibrary } from "@/lib/youtube/queue";

export const maxDuration = 60;

/**
 * Morning sweep for the YouTube Studio Lite queue: reads new uploads and the official
 * sources, then prepares drafts so finished games are waiting under Ready. It only
 * reads and stores drafts. Nothing is ever sent to YouTube from a schedule.
 */
export const GET = withCron(async () => {
  try {
    return NextResponse.json({ ok: true, ...(await refreshLibrary(null)) });
  } catch (error) {
    // An unconnected channel is a normal state; the queue page explains it.
    console.error("youtube-sweep failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Sweep failed" }, { status: 200 });
  }
});
