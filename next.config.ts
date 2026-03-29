import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*"],
  serverExternalPackages: ["puppeteer"],
};

export default nextConfig;
