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
  const auth = await authenticateSiteRequest(request);

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

    // Which product modules this project is licensed for. The wp-admin plugin
    // caches these and locks the modules a project is not entitled to.
    modules: context.modules,
    plan: context.plan,

    // Advertised to wp-admin so the editor can hide UI the backend cannot
    // serve yet. These flip on as the later milestones land.
    capabilities: {
      chat: true,
      proposals: true,
      preflight: true,
      apply: true,
      rollback: true,
      livePreview: false,
      cssFastPath: false,
      elementTargeting: false,
    },
  });
}
