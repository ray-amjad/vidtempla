// @ts-check
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
!process.env.SKIP_ENV_VALIDATION && (await import("./src/env/server.mjs"));
import createMDX from "@next/mdx";
import { withWorkflow } from "workflow/next";

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  images: {
    remotePatterns: [
      /* YouTube thumbnails */
      {
        hostname: "yt3.ggpht.com",
      },
      {
        hostname: "i.ytimg.com",
      },
      /* Prod */
      {
        hostname: "placehold.jp",
      },
      {
        hostname: "assets-prod.tensorai.app",
      },
      {
        hostname: "assets-prod-cdn.tensorai.app",
      },
      {
        hostname: "assets-dev.tensorai.app",
      },
      {
        hostname: "assets-dev-cdn.tensorai.app",
      },
      /* Dev */
      {
        protocol: "http",
        hostname: "10.221.182.22",
        port: "54321",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "54321",
      },
    ],
  },
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"], // Enable MDX pages
  async headers() {
    return [
      {
        source: "/privacy",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' app.termly.io vercel.live",
              "frame-src 'self' app.termly.io",
              "connect-src 'self' app.termly.io",
              "img-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline'",
            ].join("; "),
          },
        ],
      },
      {
        source: "/terms",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' app.termly.io vercel.live",
              "frame-src 'self' app.termly.io",
              "connect-src 'self' app.termly.io",
              "img-src 'self' data: https:",
              "style-src 'self' 'unsafe-inline'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // Enable WebAssembly to allow TikToken to accurately count tokens
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
  // PostHog is proxied by src/app/ingest/[...path]/route.ts rather than by a
  // rewrite. An external rewrite forwards inbound headers verbatim, which sent
  // the app's own session cookie to a third-party host; the route handler
  // builds the outbound headers from an allowlist instead.
  //
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

const withMDX = createMDX({
  // Add markdown plugins here, as desired
});

export default withWorkflow(withMDX(config));
