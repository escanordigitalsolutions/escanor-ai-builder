import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * DELETE /api/projects/[id] — remove a project and everything attached to it.
 * Ownership is checked with the signed-in user's client (RLS on projects);
 * child rows are then removed with the service client, children first so no
 * foreign key blocks the final project delete.
 */

export async function DELETE(
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

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (error || !project) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  const service = createServiceClient();

  // Conversation-scoped children first.
  const { data: convs } = await service
    .from("ai_conversations")
    .select("id")
    .eq("project_id", id);
  const convIds = (convs ?? []).map((c) => c.id as string);
  if (convIds.length) {
    await service.from("ai_messages").delete().in("conversation_id", convIds);
    await service.from("ai_runs").delete().in("conversation_id", convIds);
  }

  const { data: props } = await service
    .from("ai_proposals")
    .select("id")
    .eq("project_id", id);
  const propIds = (props ?? []).map((c) => c.id as string);
  if (propIds.length) {
    await service.from("ai_proposal_files").delete().in("proposal_id", propIds);
  }

  // Project-scoped children (each best-effort — a missing table must not block).
  for (const table of [
    "ai_conversations",
    "ai_proposals",
    "ai_apply_runs",
    "ai_jobs",
    "ai_usage",
    "ai_live_steps",
    "site_api_keys",
    "wordpress_sites",
  ]) {
    const { error: childError } = await service.from(table).delete().eq("project_id", id);
    if (childError) {
      console.error(`project delete: ${table}:`, childError.message);
    }
  }

  // The signed-in user's client first (RLS delete policy); the service client
  // as fallback. Either way, verify a row actually went away.
  const { data: userDeleted } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .select("id");

  if (!userDeleted || userDeleted.length === 0) {
    const { data: svcDeleted, error: projectError } = await service
      .from("projects")
      .delete()
      .eq("id", id)
      .select("id");

    if (projectError || !svcDeleted || svcDeleted.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Could not delete the project: " +
            (projectError?.message ?? "no delete permission") +
            ' — in Supabase run: grant all on all tables in schema public to service_role;',
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
