import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { withHandler } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { readScheduleRevision } from "@/lib/schedule-live";

// Answered from Redis alone so polling never wakes Neon. The counter carries no
// schedule data, so a session cookie is enough; the refetch it triggers is
// fully authenticated.
export const GET = withHandler(async () => {
  const cookieStore = await cookies();
  if (!cookieStore.get(env.sessionCookieName)?.value) throw new HttpError(401, "Unauthorized");
  return ok({ data: { revision: await readScheduleRevision() } });
});
