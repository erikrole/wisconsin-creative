import { NextResponse } from "next/server";

import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { oauthClient } from "@/lib/youtube/connection";
import { authorizationUrl, createPkcePair } from "@/lib/youtube/google";

import { encodeOAuthCookie, OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE, oauthCookieOptions } from "../shared";

/** Sends an admin to Google to grant management of the Badgers channel. */
export const GET = withAuth(async (_req, { user }) => {
  requirePermission(user.role, "youtube", "connect");
  const pkce = createPkcePair();
  const response = NextResponse.redirect(authorizationUrl(oauthClient(), pkce), { status: 303 });
  response.cookies.set(OAUTH_COOKIE, encodeOAuthCookie(pkce.state, pkce.verifier, user.id), { ...oauthCookieOptions(), maxAge: OAUTH_COOKIE_MAX_AGE });
  response.headers.set("Cache-Control", "no-store");
  return response;
});
