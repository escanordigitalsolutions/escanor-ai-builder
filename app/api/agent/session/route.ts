import { NextRequest, NextResponse } from "next/server";

import { authenticateSiteRequest } from "@/lib/security/site-auth";

/**
 * WordPress -> SaaS handshake.
 *
 * The wp-admin builder calls this on load to resolve which project its key
 * belongs to and what the account is allowed to do. This is the first route
 * in the codebase authenticated by site rather than by browser session.
 *
 * Server-to-server only: PHP calls it, so there is no CORS surface.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { context } = auth;

  return NextResponse.json({
    success: true,

    project: {
      id: context.projectId,
      name: context.projectName,
    },

    site: {
      url: context.siteUrl,
      bridgeVersion: context.site?.bridge_version ?? null,
      wpVersion: context.site?.wp_version ?? null,
      phpVersion: context.site?.php_version ?? null,
      themeName: context.site?.theme_name ?? null,
      themeSlug: context.site?.theme_slug ?? null,
      pluginName: context.site?.plugin_name ?? null,
      pluginSlug: context.site?.plugin_slug ?? null,
      lastConnectedAt: context.site?.last_connected_at ?? null,
    },

    actor: {
      wpUserId: context.actor.wpUserId,
      login: context.actor.login,
      displayName: context.actor.displayName,
    },

    // Advertised to wp-admin. This is the clean base: read-only chat +
    // live preview. Build/edit capabilities were removed to be rebuilt.
    capabilities: {
      chat: true,
      livePreview: true,
    },
  });
}
