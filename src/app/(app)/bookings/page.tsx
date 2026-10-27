import BookingsPageClient from "./BookingsPageClient";
import type { InitialBookingList } from "@/components/booking-list";
import { GET as listCheckouts } from "@/app/api/checkouts/route";

// What the Checkouts tab requests on a plain visit: active scope, no filters.
const DEFAULT_CHECKOUTS_URL = "/api/checkouts?limit=20&offset=0&status_in=OPEN%2CPENDING_PICKUP";

/**
 * Reads the first Checkouts list on the server, through the same handler the browser would call, so the
 * rows are in the HTML and the page makes no list request of its own. Any failure falls back to the
 * browser's request.
 */
async function readCheckouts(): Promise<InitialBookingList | null> {
  try {
    const response = await listCheckouts(new Request(`http://internal${DEFAULT_CHECKOUTS_URL}`), { params: Promise.resolve({}) });
    if (!response.ok) return null;
    return { url: DEFAULT_CHECKOUTS_URL, data: await response.json(), fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A tab, scope or filter in the address changes the request, so only the plain visit is read here.
  const plainVisit = Object.keys(await searchParams).length === 0;
  return <BookingsPageClient initialCheckouts={plainVisit ? await readCheckouts() : null} />;
}
