import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.104.7.26", "172.16.0.2"],
  serverExternalPackages: ["puppeteer"],
};

export default nextConfig;
