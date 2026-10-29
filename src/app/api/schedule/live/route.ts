import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { readScheduleRevision } from "@/lib/schedule-live";

// Answered from Redis alone so polling never wakes Neon. The counter carries no
// schedule data, so a session cookie is enough; the refetch it triggers is
// fully authenticated.
export async function GET() {
  const cookieStore = await cookies();
  if (!cookieStore.get(env.sessionCookieName)?.value) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const revision = await readScheduleRevision();
  return NextResponse.json({ data: { revision } }, { headers: { "Cache-Control": "private, no-store" } });
}
