import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Chromium ships as a package of brotli archives that must arrive in the
  // function whole — the first production render failed with a missing
  // libnss3.so because tracing saw only part of it. serverExternalPackages
  // keeps both out of the bundle and copies them complete; the explicit
  // includes below are belt and braces for the same files.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/agent/design-mockup-start": [
      "./node_modules/@sparticuz/chromium/**",
      "./node_modules/puppeteer-core/**",
    ],
    "/api/agent/design-edit": [
      "./node_modules/@sparticuz/chromium/**",
      "./node_modules/puppeteer-core/**",
    ],
    "/api/agent/design-thumb/[designId]": [
      "./node_modules/@sparticuz/chromium/**",
      "./node_modules/puppeteer-core/**",
    ],
  },
};

export default nextConfig;
