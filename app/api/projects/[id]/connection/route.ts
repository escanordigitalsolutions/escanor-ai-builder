import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import {
  getBridgeProject,
  getBridgeStatus,
} from "@/lib/wordpress/bridge";

type SiteRow = {
  id: string;
  site_url: string;
  bridge_token_encrypted: string;
};

function buildMetadata(status: any, bridgeProject: any) {
  const theme = bridgeProject?.scopes?.theme;
  const plugin = bridgeProject?.scopes?.plugin;

  return {
    bridge_version: status?.bridge?.version ?? null,
    wp_version: status?.site?.wp_version ?? null,
    php_version: status?.site?.php_version ?? null,
    theme_name: theme?.label ?? status?.theme?.name ?? null,
    theme_slug: theme?.slug ?? status?.theme?.stylesheet ?? null,
    plugin_name: plugin?.available ? plugin?.label ?? null : null,
    plugin_slug: plugin?.available ? plugin?.slug ?? null : null,
    last_connected_at: new Date().toISOString(),
  };
}

async function getOwnedSite(projectId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      ),
      supabase,
      site: null as SiteRow | null,
    };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`
      id,
      wordpress_sites (
        id,
        site_url,
        bridge_token_encrypted
      )
    `)
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: "Project not found." },
        { status: 404 }
      ),
      supabase,
      site: null as SiteRow | null,
    };
  }

  const wordpressSites = project.wordpress_sites;
  const site = (Array.isArray(wordpressSites)
    ? wordpressSites[0]
    : wordpressSites) as SiteRow | null;

  if (!site) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: "WordPress connection is missing." },
        { status: 404 }
      ),
      supabase,
      site: null as SiteRow | null,
    };
  }

  return {
    errorResponse: null,
    supabase,
    site,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { errorResponse, supabase, site } = await getOwnedSite(id);

    if (errorResponse || !site) {
      return errorResponse;
    }

    const token = decryptSecret(site.bridge_token_encrypted);

    const [status, bridgeProject] = await Promise.all([
      getBridgeStatus(site.site_url, token),
      getBridgeProject(site.site_url, token),
    ]);

    const metadata = buildMetadata(status, bridgeProject);

    const { error: updateError } = await supabase
      .from("wordpress_sites")
      .update(metadata)
      .eq("id", site.id);

    if (updateError) {
      console.error("Connection metadata update error:", updateError);
    }

    return NextResponse.json({
      success: true,
      connection: {
        connected: true,
        siteUrl: site.site_url,
        bridgeVersion: metadata.bridge_version,
        wpVersion: metadata.wp_version,
        phpVersion: metadata.php_version,
        themeName: metadata.theme_name,
        pluginName: metadata.plugin_name,
        lastConnectedAt: metadata.last_connected_at,
      },
    });
  } catch (error) {
    console.error("Connection test error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not test WordPress connection.",
      },
      { status: 502 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { errorResponse, supabase, site } = await getOwnedSite(id);

    if (errorResponse || !site) {
      return errorResponse;
    }

    const body = await request.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (token.length < 20) {
      return NextResponse.json(
        { success: false, error: "A valid Bridge token is required." },
        { status: 400 }
      );
    }

    const [status, bridgeProject] = await Promise.all([
      getBridgeStatus(site.site_url, token),
      getBridgeProject(site.site_url, token),
    ]);

    const metadata = buildMetadata(status, bridgeProject);

    const { error: updateError } = await supabase
      .from("wordpress_sites")
      .update({
        ...metadata,
        bridge_token_encrypted: encryptSecret(token),
      })
      .eq("id", site.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      success: true,
      connection: {
        connected: true,
        siteUrl: site.site_url,
        bridgeVersion: metadata.bridge_version,
        wpVersion: metadata.wp_version,
        phpVersion: metadata.php_version,
        themeName: metadata.theme_name,
        pluginName: metadata.plugin_name,
        lastConnectedAt: metadata.last_connected_at,
      },
    });
  } catch (error) {
    console.error("Connection token update error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not update WordPress connection.",
      },
      { status: 502 }
    );
  }
}
