import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/security/encryption";
import {
  assertSafeBridgeOrigin,
  UnsafeOriginError,
} from "@/lib/security/url-guard";
import { createServiceClient } from "@/lib/supabase/service";
import { entitlementFor } from "@/lib/billing/credits";
import { generateApiKey, maskKeyId } from "@/lib/security/api-key";

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

  // How many sites a plan allows is checked before anything is created, so a
  // customer never gets a half-connected project they are not entitled to.
  try {
    const { plan } = await entitlementFor(user.id);

    if (plan.siteLimit !== null) {
      const { count } = await createServiceClient()
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id);

      if ((count ?? 0) >= plan.siteLimit) {
        return NextResponse.json(
          {
            success: false,
            error:
              plan.siteLimit === 1
                ? `The ${plan.name} plan covers one site. Upgrade to connect another.`
                : `The ${plan.name} plan covers ${plan.siteLimit} sites. Upgrade to connect another.`,
          },
          { status: 402 }
        );
      }
    }
  } catch (error) {
    // A billing lookup failure must not block a paying customer from working.
    console.error("site limit check failed:", error);
  }

  try {
    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const siteUrl =
      typeof body.siteUrl === "string" ? body.siteUrl.trim() : "";

    const token =
      typeof body.token === "string" ? body.token.trim() : "";

    if (!name) {
      return NextResponse.json(
        { success: false, error: "A site name is required." },
        { status: 400 }
      );
    }

    /**
     * The ordinary path: create the project and hand back one site key.
     *
     * Nothing about the WordPress site is needed yet. The plugin reports its
     * address and bridge token itself, through agent/connect, the moment this
     * key is pasted into it — so the customer never carries a value back the
     * other way.
     *
     * The old shape, where the browser supplies a bridge token it collected by
     * hand, still works when both fields are sent; it is what already-running
     * installations use.
     */
    if (!siteUrl || !token) {
      const service = createServiceClient();

      const { data: project, error: projectError } = await service
        .from("projects")
        .insert({ owner_id: user.id, name })
        .select("id, name")
        .single();

      if (projectError || !project) {
        console.error("create project error:", projectError);
        return NextResponse.json(
          { success: false, error: "Could not create the site." },
          { status: 500 }
        );
      }

      const generated = generateApiKey();

      const { error: keyError } = await service.from("site_api_keys").insert({
        project_id: project.id,
        label: "WordPress plugin",
        key_id: generated.keyId,
        key_hash: generated.keyHash,
        created_by: user.id,
      });

      if (keyError) {
        console.error("mint site key error:", keyError);
        return NextResponse.json(
          { success: false, error: "The site was created but its key was not." },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        project,
        // Shown once, then only its hash exists.
        siteKey: generated.plaintext,
        keyMasked: maskKeyId(generated.keyId),
      });
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
