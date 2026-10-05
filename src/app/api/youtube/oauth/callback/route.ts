import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { completeConnection } from "@/lib/youtube/connection";
import { YouTubeToolError } from "@/lib/youtube/types";

import { OAUTH_COOKIE, oauthCookieOptions, toolUrl, verifierFor } from "../shared";

/** Google returns here. Always lands back on /youtube with a short result, never JSON. */
export const GET = withAuth(async (req, { user }) => {
  requirePermission(user.role, "youtube", "connect");
  const params = new URL(req.url).searchParams;
  const cookieValue = (await cookies()).get(OAUTH_COOKIE)?.value;

  let target: URL;
  if (params.get("error")) {
    target = toolUrl("cancelled");
  } else {
    const verifier = verifierFor(cookieValue, params.get("state"), user.id);
    const code = params.get("code");
    if (!verifier || !code) {
      target = toolUrl("error", "The sign-in expired or did not match. Start the connection again.");
    } else {
      try {
        await completeConnection(user, code, verifier);
        target = toolUrl("connected");
      } catch (error) {
        if (!(error instanceof HttpError || error instanceof YouTubeToolError)) throw error;
        target = toolUrl("error", error.message);
      }
    }
  }

  const response = NextResponse.redirect(target, { status: 303 });
  response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
});
