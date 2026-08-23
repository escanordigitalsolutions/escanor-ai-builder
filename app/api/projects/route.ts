import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/security/encryption";
import {
  assertSafeBridgeOrigin,
  UnsafeOriginError,
} from "@/lib/security/url-guard";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const siteUrl =
      typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";

    const token =
      typeof body.token === "string" ? body.token.trim() : "";

    if (!name || !siteUrl || !token) {
      return NextResponse.json(
        {
          success: false,
          error: "Project name, WordPress URL and token are required.",
        },
        { status: 400 }
      );
    }

    let origin: string;

    try {
      origin = (await assertSafeBridgeOrigin(siteUrl)).origin;
    } catch (originError) {
      if (originError instanceof UnsafeOriginError) {
        return NextResponse.json(
          { success: false, error: originError.message },
          { status: originError.status }
        );
      }

      throw originError;
    }

    const bridgeHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const options: RequestInit = {
      method: "GET",
      headers: bridgeHeaders,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    };

    const [statusResponse, projectResponse] = await Promise.all([
      fetch(
        `${origin}/wp-json/wp-ai-builder/v1/status`,
        options
      ),
      fetch(
        `${origin}/wp-json/wp-ai-builder/v1/project`,
        options
      ),
    ]);

    if (!statusResponse.ok || !projectResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "WordPress Bridge authentication failed.",
        },
        { status: 502 }
      );
    }

    const status = await statusResponse.json();
    const bridgeProject = await projectResponse.json();

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        owner_id: user.id,
        name,
      })
      .select()
      .single();

    if (projectError || !project) {
      throw new Error(
        projectError?.message ?? "Could not create project."
      );
    }

    const plugin = bridgeProject?.scopes?.plugin;
    const theme = bridgeProject?.scopes?.theme;

    const { error: siteError } = await supabase
      .from("wordpress_sites")
      .insert({
        project_id: project.id,
        site_url: origin,
        bridge_token_encrypted: encryptSecret(token),

        bridge_version: status?.bridge?.version ?? null,
        wp_version: status?.site?.wp_version ?? null,
        php_version: status?.site?.php_version ?? null,

        theme_name:
          theme?.label ??
          status?.theme?.name ??
          null,

        theme_slug:
          theme?.slug ??
          status?.theme?.stylesheet ??
          null,

        plugin_name:
          plugin?.available
            ? plugin?.label ?? null
            : null,

        plugin_slug:
          plugin?.available
            ? plugin?.slug ?? null
            : null,

        last_connected_at: new Date().toISOString(),
      });

    if (siteError) {
      await supabase
        .from("projects")
        .delete()
        .eq("id", project.id);

      throw new Error(siteError.message);
    }

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        siteUrl: origin,
        theme: theme?.label ?? null,
        plugin: plugin?.available
          ? plugin?.label ?? null
          : null,
      },
    });
  } catch (error) {
    console.error("Create project error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not create project.",
      },
      { status: 500 }
    );
  }
}
