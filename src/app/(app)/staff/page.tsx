import { SeedFetchCache } from "@/components/SeedFetchCache";
import { readSeed } from "@/lib/server-seed";
import { requireAuth } from "@/lib/auth";
import { GET as readMe } from "@/app/api/me/route";
import { GET as readUsers } from "@/app/api/users/route";
import { GET as readFormOptions } from "@/app/api/form-options/route";
import { GET as readOnShift } from "@/app/api/users/on-shift/route";
import StaffPageClient from "./StaffPageClient";

// What the roster requests on a plain visit: first page by name, active people, no filters.
const DEFAULT_USERS_URL = "/api/users?limit=50&offset=0&sort=name";

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A filter, sort or page in the address changes the request, so only the plain visit is read here.
  if (Object.keys(await searchParams).length > 0) return <StaffPageClient />;
  const user = await requireAuth();
  const staffView = user.role !== "COLLABORATOR";
  const seeds = await Promise.all([
    readSeed(readMe, "/api/me"),
    readSeed(readUsers, DEFAULT_USERS_URL),
    // The page asks for these only once it knows the viewer is not a collaborator.
    ...(staffView ? [readSeed(readFormOptions, "/api/form-options"), readSeed(readOnShift, "/api/users/on-shift")] : []),
  ]);
  return (
    <SeedFetchCache seeds={seeds}>
      <StaffPageClient />
    </SeedFetchCache>
  );
}
