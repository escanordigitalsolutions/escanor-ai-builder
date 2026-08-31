import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TIERS = [
  "plan",
  "design",
  "build",
  "edit",
  "chat",
  "review",
  "cheap",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("projects")
    .select("model_config")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, modelConfig: data.model_config ?? {} });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const incoming =
    body.modelConfig && typeof body.modelConfig === "object"
      ? (body.modelConfig as Record<string, unknown>)
      : {};

  const clean: Record<string, string> = {};
  for (const tier of TIERS) {
    const v = incoming[tier];
    if (typeof v === "string" && v.trim()) {
      clean[tier] = v.trim().slice(0, 120);
    }
  }

  // RLS scopes this update to a project the signed-in user owns.
  const { error } = await supabase
    .from("projects")
    .update({ model_config: clean })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: "Could not save the models." }, { status: 500 });
  }

  return NextResponse.json({ success: true, modelConfig: clean });
}
