import { after } from "next/server";
import type { NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { parseApiKey, verifyKeySecret } from "@/lib/security/api-key";

/**
 * Authenticates a request coming *from* a WordPress site.
 *
 * This is the inverse of the original model. There is no Supabase session
 * here: the caller is a server, identified by a site-scoped API key, acting
 * on behalf of a logged-in wp-admin user.
 *
 * The WordPress user identity arrives in X-WPAB-Actor-* headers. Those are
 * advisory — they are only as trustworthy as the site holding the key, and
 * the real `manage_options` check happens inside WordPress before the request
 * is ever made. They exist for attribution and audit, never for authorization
 * across projects.
 */

export type SiteActor = {
  wpUserId: number | null;
  login: string | null;
  email: string | null;
  displayName: string | null;
};

export type SiteAuthContext = {
  apiKeyRowId: string;
  keyId: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  siteUrl: string | null;
  site: SiteRecord | null;
  actor: SiteActor;
};

type SiteRecord = {
  site_url: string | null;
  bridge_version: string | null;
  wp_version: string | null;
  php_version: string | null;
  theme_name: string | null;
  theme_slug: string | null;
  plugin_name: string | null;
  plugin_slug: string | null;
  last_connected_at: string | null;
};

export type SiteAuthResult =
  | { ok: true; context: SiteAuthContext }
  | { ok: false; status: number; error: string };

function readBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization");

  if (!header) {
    return null;
  }

  const match = header.trim().match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : null;
}

function readActor(request: NextRequest): SiteActor {
  const rawId = request.headers.get("x-wpab-actor-id");
  const parsedId = rawId ? Number.parseInt(rawId, 10) : Number.NaN;

  const clean = (value: string | null) => {
    if (!value) {
      return null;
    }

    const trimmed = value.trim().slice(0, 200);

    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    wpUserId: Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null,
    login: clean(request.headers.get("x-wpab-actor-login")),
    email: clean(request.headers.get("x-wpab-actor-email")),
    displayName: clean(request.headers.get("x-wpab-actor-name")),
  };
}

function readClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim().slice(0, 100);
  }

  return request.headers.get("x-real-ip")?.slice(0, 100) ?? null;
}

export async function authenticateSiteRequest(
  request: NextRequest
): Promise<SiteAuthResult> {
  const presented = readBearerToken(request);

  if (!presented) {
    return {
      ok: false,
      status: 401,
      error: "Missing site API key.",
    };
  }

  const parsed = parseApiKey(presented);

  if (!parsed) {
    return {
      ok: false,
      status: 401,
      error: "Malformed site API key.",
    };
  }

  const supabase = createServiceClient();

  const { data: keyRow, error: keyError } = await supabase
    .from("site_api_keys")
    .select("id, project_id, key_hash, revoked_at")
    .eq("key_id", parsed.keyId)
    .maybeSingle();

  if (keyError) {
    console.error("Site key lookup failed:", keyError);

    return {
      ok: false,
      status: 500,
      error: "Could not verify the site API key.",
    };
  }

  if (!keyRow || keyRow.revoked_at) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or revoked site API key.",
    };
  }

  if (!verifyKeySecret(parsed.secret, keyRow.key_hash)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or revoked site API key.",
    };
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(`
      id,
      name,
      owner_id,
      wordpress_sites (
        site_url,
        bridge_version,
        wp_version,
        php_version,
        theme_name,
        theme_slug,
        plugin_name,
        plugin_slug,
        last_connected_at
      )
    `)
    .eq("id", keyRow.project_id)
    .maybeSingle();

  if (projectError) {
    console.error("Site key project lookup failed:", projectError);

    // Surface the underlying database error while we diagnose the v3A path.
    const detail = [
      projectError.message,
      projectError.code ? `[${projectError.code}]` : "",
      projectError.details ?? "",
      projectError.hint ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      ok: false,
      status: 500,
      error: `Could not load the project for this site key: ${detail}`,
    };
  }

  if (!project) {
    return {
      ok: false,
      status: 404,
      error:
        "This site key points to a project that no longer exists. Generate a new site key from the project dashboard and reconnect.",
    };
  }

  const sites = project.wordpress_sites as SiteRecord[] | SiteRecord | null;

  const site = Array.isArray(sites) ? sites[0] ?? null : sites;

  const actor = readActor(request);
  const clientIp = readClientIp(request);

  // Usage stamping must never delay the response.
  after(async () => {
    await supabase
      .from("site_api_keys")
      .update({
        last_used_at: new Date().toISOString(),
        last_used_ip: clientIp,
        last_actor_login: actor.login,
      })
      .eq("id", keyRow.id);
  });

  return {
    ok: true,
    context: {
      apiKeyRowId: keyRow.id,
      keyId: parsed.keyId,
      projectId: project.id,
      projectName: project.name,
      ownerId: project.owner_id,
      siteUrl: site?.site_url ?? null,
      site,
      actor,
    },
  };
}
