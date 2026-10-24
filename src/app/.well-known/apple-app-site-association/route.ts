import { NextResponse } from "next/server";

export const dynamic = "force-static";

const APP_ID = "T26T3G8C7Q.com.erikrole.Wisconsin";
// The GearOps menu bar app signs in with the same account, so AutoFill should
// offer the credential saved for the website. It takes no universal links.
const GEAROPS_APP_ID = "T26T3G8C7Q.com.erikrole.GearOps";

export function GET() {
  return NextResponse.json({
    webcredentials: {
      apps: [APP_ID, GEAROPS_APP_ID],
    },
    applinks: {
      details: [
        {
          appIDs: [APP_ID],
          components: [
            // Browser setup remains usable by older installed app versions.
            { "/": "/login", "?": { web: "1" }, exclude: true },
            // Claim only emailed invite links; ordinary login stays on the web.
            { "/": "/login", "?": { invite: "?*" } },
            { "/": "/bookings" },
            { "/": "/bookings/*" },
            { "/": "/reservations/*" },
            { "/": "/checkouts/*" },
            { "/": "/events/*" },
            { "/": "/schedule" },
            { "/": "/schedule/*" },
            { "/": "/items" },
            { "/": "/items/*" },
            { "/": "/staff/*" },
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
