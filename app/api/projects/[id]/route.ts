import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { purgeProjectData } from "@/lib/account/purge";
import { debugErrors } from "@/lib/debug";

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

  // owner_id is restated on top of the row policy. Everything after this point
  // runs on the service client, which bypasses RLS, and it now destroys child
  // rows — so this one SELECT is the whole ownership gate, and it should not
  // rest on a policy defined outside this repository.
  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !project) {
    return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  }

  const service = createServiceClient();

  // Same cascade the account-deletion path uses, so a child table added later
  // cannot be remembered in one place and forgotten in the other.
  const warnings = await purgeProjectData(service, id);

  // These used to be logged and ignored, which meant a missing DELETE grant
  // produced a cheerful 200 while designs and chat history stayed in the
  // database. Saying so is the only honest option: the project row is kept, so
  // what is left is still reachable and can be deleted again once fixed.
  if (warnings.length) {
    console.error("project delete warnings:", id, warnings);

    return NextResponse.json(
      {
        success: false,
        error:
          "Some of this site's data could not be deleted, so the site was kept rather " +
          "than leaving that data stranded. Try again in a moment.",
        ...(debugErrors() ? { detail: warnings.join("; ") } : {}),
      },
      { status: 500 }
    );
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
