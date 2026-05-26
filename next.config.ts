import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from package.json at build time so it can be exposed as NEXT_PUBLIC_ env
// without bundling package.json into the client.
// Uses process.cwd() (always project root during next build) instead of
// import.meta.url which breaks Next.js config compilation.
const appVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version as string;

const isDev = process.env.NODE_ENV === "development";

// --- Security Headers ---
// Applied to all routes. These are defense-in-depth measures that make
// common web attacks harder even if application-level defenses fail.

const securityHeaders = [
  // Prevent MIME-type sniffing — browser must respect declared Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Prevent clickjacking — this site cannot be embedded in iframes
  { key: "X-Frame-Options", value: "DENY" },
  // Disable legacy XSS filter (browsers have better built-in protections;
  // the old filter could actually introduce vulnerabilities)
  { key: "X-XSS-Protection", value: "0" },
  // Only send referrer to same-origin or on cross-origin navigations
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS: force HTTPS for 2 years, include subdomains, allow preloading
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Disable browser features we don't use (interest-cohort opts out of FLoC/Topics API)
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  // Content Security Policy
  // - 'unsafe-inline' needed by Next.js runtime (inline scripts/styles)
  // - 'unsafe-eval' only in dev (HMR); removed in prod to prevent eval()-based XSS
  // - img-src: Twitter profile images are loaded from pbs.twimg.com / abs.twimg.com
  // - connect-src: all API calls are same-origin
  // - font-src: Google Fonts are self-hosted via next/font/google (no external needed)
  // - upgrade-insecure-requests: force HTTP sub-resources to HTTPS
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
  ],
};

export default nextConfig;
