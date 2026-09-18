import { NextResponse } from "next/server";

export const dynamic = "force-static";

const APP_ID = "T26T3G8C7Q.com.erikrole.Wisconsin";

export function GET() {
  return NextResponse.json({
    webcredentials: {
      apps: [APP_ID],
    },
    applinks: {
      details: [
        {
          appIDs: [APP_ID],
          components: [
            { "/": "/bookings" },
            { "/": "/bookings/*" },
            { "/": "/reservations/*" },
            { "/": "/checkouts/*" },
            { "/": "/events/*" },
            { "/": "/schedule" },
            { "/": "/schedule/*" },
            { "/": "/items" },
            { "/": "/items/*" },
            { "/": "/users/*" },
            { "/": "/licenses" },
            { "/": "/notifications" },
            { "/": "/search" },
          ],
        },
      ],
    },
  });
}
