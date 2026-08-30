import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in areas and the machine-to-machine API have nothing to index,
      // and /auth carries one-time codes that must never reach a search result.
      disallow: ["/dashboard", "/admin", "/api/", "/auth/", "/reset-password"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
