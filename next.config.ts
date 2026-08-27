import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withWorkflow } from "workflow/next";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const isVercelDeployment = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // GitHub CI owns lint and TypeScript verification. Vercel's build container
  // has repeatedly exhausted its memory during the duplicate checks after
  // compiling this large App Router surface; keep the deployment build focused
  // on producing the already-verified application bundle.
  eslint: {
    ignoreDuringBuilds: isVercelDeployment,
  },
  typescript: {
    ignoreBuildErrors: isVercelDeployment,
  },
  experimental: {
    optimizePackageImports: ["date-fns", "motion"],
    devtoolSegmentExplorer: false,
    // Sentry and Workflow both customize webpack, so Next does not enable its
    // separate build worker automatically. Isolate compilation and release
    // intermediate webpack data earlier to stay within Vercel's memory budget.
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  transpilePackages: ["@mdxeditor/editor"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  async headers() {
    const permissionsPolicy = [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "serial=()",
      "bluetooth=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "autoplay=(self)",
      "encrypted-media=()",
      "fullscreen=(self)",
      "picture-in-picture=()",
      "display-capture=()",
      "midi=()",
      "screen-wake-lock=()",
      "web-share=(self)",
      "tools=(self)",
    ].join(", ");

    return [
      {
        source: "/:path*",
        headers: [
          isVercelDeployment ? { key: "X-Frame-Options", value: "DENY" } : null,
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: permissionsPolicy },
          isVercelDeployment ? { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" } : null,
          isVercelDeployment ? { key: "Cross-Origin-Opener-Policy", value: "same-origin" } : null,
          isVercelDeployment ? { key: "Cross-Origin-Resource-Policy", value: "same-origin" } : null,
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ].filter((header): header is { key: string; value: string } => Boolean(header)),
      },
      // Auth pages: never cache — prevents BFCache from replaying the form
      // after sign-out and avoids any shared-cache leakage.
      {
        source: "/(login|register|forgot-password|reset-password)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/guides", destination: "/resources", permanent: true },
      { source: "/guides/:path*", destination: "/resources/:path*", permanent: true },
    ];
  },
};

const config = withWorkflow(withBundleAnalyzer(nextConfig));

export default withSentryConfig(config, {
  // Upload source maps only when SENTRY_AUTH_TOKEN is set (CI/Vercel)
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Disable Sentry telemetry
  telemetry: false,
});
