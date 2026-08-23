import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateApiKey, maskKeyId } from "@/lib/security/api-key";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

const MAX_ACTIVE_KEYS = 5;

async function requireProjectOwner(projectId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized.",
    };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return {
      ok: false as const,
      status: 404,
      error: "Project not found.",
    };
  }

  return {
    ok: true as const,
    user,
    project,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: Params
) {
  const { id } = await params;

  const owner = await requireProjectOwner(id);

  if (!owner.ok) {
    return NextResponse.json(
      { success: false, error: owner.error },
      { status: owner.status }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("site_api_keys")
    .select(
      "id, label, key_id, last_used_at, last_used_ip, last_actor_login, revoked_at, created_at"
    )
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("List site API keys error:", error);

    return NextResponse.json(
      { success: false, error: "Could not load site API keys." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    keys: (data ?? []).map((key) => ({
      id: key.id,
      label: key.label,
      masked: maskKeyId(key.key_id),
      lastUsedAt: key.last_used_at,
      lastUsedIp: key.last_used_ip,
      lastActorLogin: key.last_actor_login,
      revokedAt: key.revoked_at,
      createdAt: key.created_at,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: Params
) {
  const { id } = await params;

  const owner = await requireProjectOwner(id);

  if (!owner.ok) {
    return NextResponse.json(
      { success: false, error: owner.error },
      { status: owner.status }
    );
  }

  let label = "WordPress plugin";

  try {
    const body = await request.json();

    if (typeof body?.label === "string" && body.label.trim()) {
      label = body.label.trim().slice(0, 80);
    }
  } catch {
    // An empty body is fine; the default label applies.
  }

  const service = createServiceClient();

  const { data: activeKeys, error: countError } = await service
    .from("site_api_keys")
    .select("id")
    .eq("project_id", id)
    .is("revoked_at", null);

  if (countError) {
    console.error("Count site API keys error:", {
      message: countError.message,
      code: countError.code,
      details: countError.details,
      hint: countError.hint,
    });

    return NextResponse.json(
      { success: false, error: "Could not create the site API key." },
      { status: 500 }
    );
  }

  const count = activeKeys?.length ?? 0;

  if (count >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      {
        success: false,
        error: `This project already has ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
      },
      { status: 409 }
    );
  }

  const generated = generateApiKey();

  const { data, error } = await service
    .from("site_api_keys")
    .insert({
      project_id: id,
      label,
      key_id: generated.keyId,
      key_hash: generated.keyHash,
      created_by: owner.user.id,
    })
    .select("id, label, key_id, created_at")
    .single();

  if (error || !data) {
    console.error("Create site API key error:", error);

    return NextResponse.json(
      { success: false, error: "Could not create the site API key." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,

    // Returned exactly once. Only the SHA-256 is persisted.
    plaintext: generated.plaintext,

    key: {
      id: data.id,
      label: data.label,
      masked: maskKeyId(data.key_id),
      createdAt: data.created_at,
    },
  });
}
