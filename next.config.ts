import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow phone/tunnel access to dev resources (HMR, fonts) when testing
  // through a Cloudflare quick tunnel or over the LAN.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
