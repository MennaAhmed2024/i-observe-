import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The FastAPI app is the system of record; this app only renders and proxies to it.
  reactStrictMode: true,
  // Open the app on 127.0.0.1 and Next.js treats localhost as a different origin and
  // blocks its own dev resources (HMR), which silently freezes the page on stale code.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
