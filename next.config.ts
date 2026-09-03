import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // The thumbnail renderer resolves these two at run time from names held in
  // variables (the local registry proxy refuses to install them, so a static
  // import would break the local type-check). A dynamic import like that is
  // invisible to output tracing, so the functions that screenshot a design
  // declare their cargo explicitly.
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
