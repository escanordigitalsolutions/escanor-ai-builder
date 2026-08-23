import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type Params = {
  params: Promise<{
    id: string;
    keyId: string;
  }>;
};

export async function DELETE(
  _request: NextRequest,
  { params }: Params
) {
  const { id, keyId } = await params;

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

  // RLS scopes this select to projects the caller owns, so a hit here is
  // proof of ownership before the service-role write below.
  const { data: existing } = await supabase
    .from("site_api_keys")
    .select("id, revoked_at")
    .eq("id", keyId)
    .eq("project_id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Site API key not found." },
      { status: 404 }
    );
  }

  if (existing.revoked_at) {
    return NextResponse.json({
      success: true,
      alreadyRevoked: true,
    });
  }

  const service = createServiceClient();

  const { error } = await service
    .from("site_api_keys")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("id", keyId)
    .eq("project_id", id);

  if (error) {
    console.error("Revoke site API key error:", error);

    return NextResponse.json(
      { success: false, error: "Could not revoke the site API key." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    alreadyRevoked: false,
  });
}
