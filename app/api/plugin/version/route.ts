import { NextResponse } from "next/server";

import { SITE_URL } from "@/lib/site";
import { PLUGIN_RELEASE } from "@/lib/plugin-release";

/**
 * The plugin's update manifest.
 *
 * WordPress fetches this with no credentials from every installation that has
 * the bridge plugin, so it carries nothing but a version number and where to
 * get the zip. It is what makes "Update available" appear on a customer's
 * Plugins screen for a plugin that does not come from wordpress.org.
 */
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      name: "Meikero Bridge",
      slug: "wp-ai-builder-bridge",
      version: PLUGIN_RELEASE.version,
      download_url: `${SITE_URL}${PLUGIN_RELEASE.file}`,
      homepage: SITE_URL,
      requires: PLUGIN_RELEASE.requiresWordPress,
      requires_php: PLUGIN_RELEASE.requiresPhp,
      tested: PLUGIN_RELEASE.testedWordPress,
      last_updated: PLUGIN_RELEASE.released,
      description:
        "Connects this WordPress site to Meikero, the AI website builder, and adds the AI Editor to wp-admin.",
      changelog: PLUGIN_RELEASE.changelog,
    },
    {
      headers: {
        // Sites check for updates every few hours; let the edge absorb that.
        "Cache-Control": "public, max-age=600, s-maxage=3600",
      },
    }
  );
}
