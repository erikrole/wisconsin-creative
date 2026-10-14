import { NextResponse, type NextRequest } from "next/server";

/**
 * GET /.well-known/passkey-endpoints — the W3C Passkey Endpoints document.
 *
 * Password managers (1Password, Chrome, Apple Passwords) read this to offer
 * "Add a passkey" on a saved Wisconsin Creative login and to link straight to
 * where passkeys are created and removed, instead of leaving people to find
 * Settings → Security themselves.
 *
 * The spec requires absolute URLs. They are built from the incoming origin so
 * preview deployments and local development point at themselves.
 */
export function GET(request: NextRequest) {
  const security = new URL("/settings/security", request.url).toString();
  return NextResponse.json(
    { enroll: security, manage: security },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
