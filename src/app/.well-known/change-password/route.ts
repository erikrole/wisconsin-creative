import { NextResponse, type NextRequest } from "next/server";

/**
 * GET /.well-known/change-password — the well-known change-password URL.
 *
 * Password managers and browsers (Safari, Chrome, 1Password) send people here
 * from "Change password" on a saved item, so the credential they hold and the
 * one being replaced stay the same record. Without it they either give up or
 * drop the person on the home page to hunt for the setting.
 *
 * Clients only trust this when the site returns a real 404 for other unknown
 * `/.well-known/` paths, which Next already does.
 *
 * Redirects against the incoming origin so preview deployments and local
 * development resolve to themselves rather than production.
 */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/settings/security", request.url), 303);
}
