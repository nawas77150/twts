import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel handles output automatically - no need for standalone */
  serverExternalPackages: ["oauth"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
