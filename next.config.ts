import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withWorkflow } from "workflow/next";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const isVercelDeployment = process.env.VERCEL === "1";

const baseConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Error reports from the browser carry the deploy they came from.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "",
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV ?? "",
  },
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
    // lucide-react and recharts are already in Next's default list.
    // These are the barrels this app imports that the default list misses.
    optimizePackageImports: [
      "date-fns",
      "motion",
      "motion/react",
      "radix-ui",
      "@tanstack/react-query",
      "@tanstack/react-query-persist-client",
      "@tanstack/react-table",
      "cmdk",
      "react-day-picker",
    ],
    devtoolSegmentExplorer: false,
    // Sentry and Workflow both customize webpack, so Next does not enable its
    // separate build worker automatically. Isolate compilation and release
    // intermediate webpack data earlier to stay within Vercel's memory budget.
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  transpilePackages: ["@mdxeditor/editor"],
  serverExternalPackages: ["web-push"],
  // The equipment sheet route reads the department's workbook template at runtime.
  outputFileTracingIncludes: {
    "/api/gear-picks/admin/export.xlsx": ["./src/lib/gear-picks/templates/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  async headers() {
    const permissionsPolicyFor = (geolocation: string) => [
      "camera=(self)",
      "microphone=()",
      `geolocation=${geolocation}`,
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
    const permissionsPolicy = permissionsPolicyFor("()");

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
      // Email clients load these images from another origin. The site-wide
      // same-origin resource policy above makes Outlook and other webview-based
      // clients drop them as broken images, so the email assets opt out.
      {
        source: "/email/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      // Auth pages: never cache — prevents BFCache from replaying the form
      // after sign-out and avoids any shared-cache leakage.
      {
        source: "/(login|register|forgot-password|reset-password)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      // Golden Hour's "Use my location" is the one place the site asks for
      // geolocation. Later matches override earlier ones for the same key.
      {
        source: "/golden-hour/:path*",
        headers: [{ key: "Permissions-Policy", value: permissionsPolicyFor("(self)") }],
      },
    ];
  },
  async redirects() {
    return [
      // Users was renamed Staff. Old bookmarks, push links, and emails keep working.
      { source: "/users", destination: "/staff", permanent: true },
      { source: "/users/:path*", destination: "/staff/:path*", permanent: true },
      // Workforce now lives under Staff as an admin-only tab.
      { source: "/workforce", destination: "/staff/workforce", permanent: true },
      { source: "/workforce/:path*", destination: "/staff/workforce/:path*", permanent: true },
      { source: "/guides", destination: "/resources", permanent: true },
      { source: "/guides/:path*", destination: "/resources/:path*", permanent: true },
      // QR Studio is a static, client-only tool in public/qrcode. Linking to the
      // file path keeps it outside the nonce-CSP middleware, whose matcher skips
      // dotted paths; the page carries its own stricter CSP.
      { source: "/qrcode", destination: "/qrcode/index.html", permanent: false },
      // Same pattern for the other static tools and their hub.
      { source: "/tools", destination: "/apps", permanent: false },
      { source: "/golden-hour", destination: "/golden-hour/index.html", permanent: false },
      { source: "/timelapse", destination: "/timelapse/index.html", permanent: false },
      { source: "/board-sizes", destination: "/board-sizes/index.html", permanent: false },
      { source: "/frame", destination: "/frame/index.html", permanent: false },
      // The out-of-town scoreboard moved to its own Cloudflare Worker; old links and .uri files keep working.
      { source: "/ots", destination: "https://ots.wisconsincreative.com/", permanent: false },
      { source: "/ots/index.html", destination: "https://ots.wisconsincreative.com/", permanent: false },
      { source: "/ots/:page(control|chip|output|scenarios).html", destination: "https://ots.wisconsincreative.com/:page", permanent: false },
      { source: "/ots/:path*", destination: "https://ots.wisconsincreative.com/:path*", permanent: false },
    ];
  },
};

const development = process.env.WC_NEXT_MODE === "dev" || process.env.NODE_ENV === "development";
const nextConfig: NextConfig = {
  ...baseConfig,
  distDir: isVercelDeployment ? ".next" : development ? ".next/dev" : ".next/build",
  typescript: { ...baseConfig.typescript, tsconfigPath: development ? "tsconfig.dev.json" : "tsconfig.json" },
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
