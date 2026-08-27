import { NextRequest, NextResponse } from "next/server";

const isVercelDeployment = process.env.VERCEL === "1";
const isDevelopment = process.env.NODE_ENV !== "production";

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildContentSecurityPolicy(nonce: string) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    isVercelDeployment
      ? "connect-src 'self' https://vercel.com https://*.public.blob.vercel-storage.com https://*.sentry.io https://*.ingest.sentry.io"
      : "connect-src 'self' http: https: ws: wss:",
    "worker-src 'self'",
    "manifest-src 'self'",
    isVercelDeployment ? "frame-ancestors 'none'" : null,
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    isVercelDeployment ? "upgrade-insecure-requests" : null,
  ];

  return csp.filter(Boolean).join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
