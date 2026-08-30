import { NextRequest, NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { authenticateSiteRequest } from "@/lib/security/site-auth";
import { encryptSecret } from "@/lib/security/encryption";
import { assertSafeBridgeOrigin, UnsafeOriginError } from "@/lib/security/url-guard";
import { errorDetail } from "@/lib/debug";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * WordPress -> SaaS : the plugin introduces itself.
 *
 * Connecting used to take six steps and two copy-pastes in opposite
 * directions: WordPress minted a bridge token that had to be pasted into
 * Meikero, and Meikero minted a site key that had to be pasted back. Half of
 * that exists only because neither side could talk first.
 *
 * One of them can. The plugin already holds the site key, so it can call here
 * and hand over its own bridge token — turning the second paste into a request
 * body. The customer pastes one key, once.
 *
 * The token still has to be proved before it is trusted: we call the site back
 * with it, over the guarded origin check, and only store it if WordPress
 * answers.
 */
export async function POST(request: NextRequest) {
  // credits: false — a handshake must work even for an account with none,
  // otherwise running out of credits would look like a broken installation.
  const auth = await authenticateSiteRequest(request, { credits: false });

  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rawUrl = typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";
  const bridgeToken =
    typeof body.bridgeToken === "string" ? body.bridgeToken.trim() : "";

  if (!rawUrl || !bridgeToken) {
    return NextResponse.json(
      {
        success: false,
        error: "The site address and bridge token are both required.",
        code: "connect_incomplete",
      },
      { status: 400 }
    );
  }

  let origin: string;

  try {
    origin = (await assertSafeBridgeOrigin(rawUrl)).origin;
  } catch (error) {
    if (error instanceof UnsafeOriginError) {
      return NextResponse.json(
        { success: false, error: error.message, code: "unsafe_origin" },
        { status: error.status }
      );
    }
    throw error;
  }

  try {
    const headers = {
      Authorization: `Bearer ${bridgeToken}`,
      Accept: "application/json",
    };

    const options: RequestInit = {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    };

    // Prove the token before storing it. A site that cannot answer with it is
    // either misconfigured or not the site it claims to be.
    const [statusResponse, projectResponse] = await Promise.all([
      fetch(`${origin}/wp-json/wp-ai-builder/v1/status`, options),
      fetch(`${origin}/wp-json/wp-ai-builder/v1/project`, options),
    ]);

    if (!statusResponse.ok || !projectResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Meikero could not read this site back with the token it was given.",
          code: "bridge_unverified",
          status: `${statusResponse.status}/${projectResponse.status}`,
        },
        { status: 502 }
      );
    }

    const status = await statusResponse.json();
    const bridgeProject = await projectResponse.json();

    const plugin = bridgeProject?.scopes?.plugin;
    const theme = bridgeProject?.scopes?.theme;

    const row = {
      project_id: auth.context.projectId,
      site_url: origin,
      bridge_token_encrypted: encryptSecret(bridgeToken),
      bridge_version: status?.bridge?.version ?? null,
      wp_version: status?.site?.wp_version ?? null,
      php_version: status?.site?.php_version ?? null,
      theme_name: theme?.label ?? status?.theme?.name ?? null,
      theme_slug: theme?.slug ?? status?.theme?.stylesheet ?? null,
      plugin_name: plugin?.available ? (plugin?.label ?? null) : null,
      plugin_slug: plugin?.available ? (plugin?.slug ?? null) : null,
      last_connected_at: new Date().toISOString(),
    };

    const db = createServiceClient();

    // Reconnecting a site — after a token rotation, or a move to a new
    // domain — updates the existing row rather than growing a second one.
    const { data: existing } = await db
      .from("wordpress_sites")
      .select("id")
      .eq("project_id", auth.context.projectId)
      .maybeSingle();

    const { error: writeError } = existing
      ? await db.from("wordpress_sites").update(row).eq("id", existing.id)
      : await db.from("wordpress_sites").insert(row);

    if (writeError) {
      console.error("connect write error:", writeError);
      return NextResponse.json(
        {
          success: false,
          error: "Could not save the connection.",
          code: "connect_write_failed",
          ...errorDetail(writeError),
        },
        { status: 500 }
      );
    }

    // A project created from the dashboard before the site was known carries
    // a placeholder name; adopt the real site title once we have it.
    const siteTitle =
      typeof status?.site?.name === "string" ? status.site.name.trim() : "";

    if (siteTitle && /^(new site|untitled)$/i.test(auth.context.projectName)) {
      await db
        .from("projects")
        .update({ name: siteTitle.slice(0, 120) })
        .eq("id", auth.context.projectId);
    }

    return NextResponse.json({
      success: true,
      project: { id: auth.context.projectId, name: siteTitle || auth.context.projectName },
      site: { url: origin, theme: row.theme_name, wp: row.wp_version },
    });
  } catch (error) {
    console.error("connect error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Meikero could not reach this site.",
        code: "connect_unreachable",
        ...errorDetail(error),
      },
      { status: 502 }
    );
  }
}
